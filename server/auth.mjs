import { timingSafeEqual } from "node:crypto";
import { hash } from "./state.mjs";

export function cookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((x) => x.trim().split(/=(.*)/s))
      .filter(([key]) => key)
      .map(([key, value]) => [key, value || ""]),
  );
}
export function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function userFromClaims(claims, config) {
  const groups = claims[config.groupsClaim];
  if (
    typeof claims.sub !== "string" ||
    !claims.sub ||
    !Array.isArray(groups) ||
    groups.some((g) => typeof g !== "string")
  )
    throw new Error("The required identity claims are missing.");
  const role = groups.includes(config.operatorGroup)
    ? "operator"
    : groups.includes(config.viewerGroup)
      ? "viewer"
      : null;
  if (!role)
    throw new Error("This identity is not a member of an authorized group.");
  return {
    actor: hash(`${config.issuer}|${claims.sub}`),
    name:
      typeof claims.name === "string"
        ? claims.name.slice(0, 100)
        : "Workspace member",
    role,
  };
}
export class Auth {
  constructor(config, state, client) {
    this.config = config;
    this.state = state;
    this.client = client;
    this.discoveryPromise = null;
  }
  cookie(name, value, ttl) {
    return `__Host-${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
  }
  async discovery() {
    if (!this.discoveryPromise)
      this.discoveryPromise = (async () => {
        this.client ||= await import("openid-client");
        return this.client.discovery(
          new URL(this.config.oidc.issuer),
          this.config.oidc.clientId,
          this.config.oidc.clientSecret,
          undefined,
          { timeout: 10, execute: [this.client.enableNonRepudiationChecks] },
        );
      })().catch((e) => {
        this.discoveryPromise = null;
        throw e;
      });
    return this.discoveryPromise;
  }
  async login() {
    const discovered = await this.discovery();
    const verifier = this.client.randomPKCECodeVerifier(),
      nonce = this.client.randomNonce(),
      state = this.client.randomState();
    const id = this.state.saveLogin({ verifier, nonce, state });
    const url = this.client.buildAuthorizationUrl(discovered, {
      redirect_uri: `${this.config.origin}/auth/callback`,
      scope: "openid profile email",
      code_challenge: await this.client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return { url: url.href, cookie: this.cookie("oidc", id, 600) };
  }
  async callback(url, header) {
    const tx = this.state.takeLogin(cookies(header)["__Host-oidc"]);
    if (!tx)
      throw new Error("The login transaction expired or was already used.");
    const tokens = await this.clientForGrant(url, tx);
    const claims = tokens.claims();
    const user = userFromClaims(claims, this.config.oidc);
    const ttl = Math.min(
      this.config.sessionTtl,
      Math.floor(claims.exp - Date.now() / 1000),
    );
    if (!Number.isFinite(ttl) || ttl <= 0)
      throw new Error("The identity token has expired.");
    const session = this.state.createSession(user, ttl);
    this.state.audit(user.actor, "login", "session", "success");
    return {
      user,
      cookies: [
        this.cookie("session", session.id, ttl),
        this.cookie("oidc", "", 0),
      ],
    };
  }
  async clientForGrant(url, tx) {
    const discovered = await this.discovery();
    return this.client.authorizationCodeGrant(discovered, url, {
      pkceCodeVerifier: tx.verifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    });
  }
  session(req) {
    return this.state.session(cookies(req.headers.cookie)["__Host-session"]);
  }
  logout(req) {
    this.state.revokeSession(cookies(req.headers.cookie)["__Host-session"]);
    return this.cookie("session", "", 0);
  }
}
