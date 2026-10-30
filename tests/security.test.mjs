import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import * as oidc from "openid-client";
import { loadConfig, identifier } from "../server/config.mjs";
import { Auth, userFromClaims, sameToken } from "../server/auth.mjs";
import { StateStore, hash } from "../server/state.mjs";

const env = {
  NODE_ENV: "production",
  APP_MODE: "snowflake",
  PUBLIC_ORIGIN: "https://data.example",
  STATE_DIR: process.cwd(),
  SNOWFLAKE_ACCOUNT: "example",
  SNOWFLAKE_USER: "reader",
  SNOWFLAKE_PRIVATE_KEY_PATH:
    process.platform === "win32" ? "C:/secrets/key.p8" : "/run/secrets/key",
  SNOWFLAKE_DATABASE: "TEST_DB",
  SNOWFLAKE_ROLE: "APP_READER",
  SNOWFLAKE_READER_ROLE: "APP_READER",
  SNOWFLAKE_WAREHOUSE: "COMPUTE_WH",
  OIDC_ISSUER: "https://idp.example/",
  OIDC_CLIENT_ID: "snowstack",
  OIDC_CLIENT_SECRET: "fixture-client-secret",
  OIDC_VIEWER_GROUP: "viewers",
  OIDC_OPERATOR_GROUP: "operators",
};
test("production refuses demo mode, HTTP, missing SSO, and a transformer web role", () => {
  for (const changes of [
    { APP_MODE: "demo" },
    { APP_MODE: "" },
    { PUBLIC_ORIGIN: "http://data.example" },
    { OIDC_CLIENT_ID: "" },
    { OIDC_ISSUER: "http://idp.example" },
    { SNOWFLAKE_ROLE: "TRANSFORMER" },
    { STATE_DIR: "relative" },
  ])
    assert.throws(() => loadConfig({ ...env, ...changes }));
  assert.equal(loadConfig(env).mode, "snowflake");
});
test("demo is loopback-only and SQL identifiers reject injection", () => {
  assert.throws(() => loadConfig({ HOST: "0.0.0.0" }), /loopback/);
  assert.throws(() => identifier("orders; DROP TABLE customer"));
  assert.equal(identifier("analytics_release"), "ANALYTICS_RELEASE");
});
test("opaque sessions are hashed, expire, revoke, and separate roles", () => {
  let now = 1000;
  const state = new StateStore(":memory:", () => now);
  try {
    const session = state.createSession(
      { actor: "actor", name: "Reader", role: "viewer" },
      300,
    );
    assert.equal(state.session(session.id).role, "viewer");
    assert.equal(
      state.db.prepare("SELECT id FROM sessions").get().id,
      hash(session.id),
    );
    assert.notEqual(session.id, hash(session.id));
    now += 300001;
    assert.equal(state.session(session.id), null);
    const fresh = state.createSession(
      { actor: "actor", name: "Operator", role: "operator" },
      300,
    );
    state.revokeSession(fresh.id);
    assert.equal(state.session(fresh.id), null);
  } finally {
    state.close();
  }
});
test("SSO groups cannot be replaced by an arbitrary role claim", () => {
  const cfg = loadConfig(env).oidc;
  assert.throws(() =>
    userFromClaims({ sub: "u", groups: [], role: "operator" }, cfg),
  );
  assert.equal(
    userFromClaims({ sub: "u", groups: ["viewers"], role: "operator" }, cfg)
      .role,
    "viewer",
  );
  assert.equal(
    userFromClaims({ sub: "u", groups: ["operators"] }, cfg).role,
    "operator",
  );
  assert.equal(sameToken("abcd", "abcd"), true);
  assert.equal(sameToken("abcd", "abcé"), false);
  assert.equal(sameToken(undefined, "abcd"), false);
});

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "fixture",
  alg: "RS256",
  use: "sig",
};
function jwt(claims, badSignature = false) {
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = encode({ alg: "RS256", kid: "fixture" }) + "." + encode(claims);
  const signature = sign("RSA-SHA256", Buffer.from(input), pair.privateKey);
  if (badSignature) signature[0] ^= 0xff;
  return input + "." + signature.toString("base64url");
}
async function authenticationFixture(overrides = {}, badSignature = false) {
  const config = loadConfig(env),
    store = new StateStore(":memory:");
  let authorization;
  const json = (data) =>
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  const fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/.well-known/openid-configuration"))
      return json({
        issuer: env.OIDC_ISSUER,
        authorization_endpoint: env.OIDC_ISSUER + "authorize",
        token_endpoint: env.OIDC_ISSUER + "token",
        jwks_uri: env.OIDC_ISSUER + "jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/token") {
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("client_id"), env.OIDC_CLIENT_ID);
      assert.equal(
        createHash("sha256")
          .update(params.get("code_verifier"))
          .digest("base64url"),
        authorization.searchParams.get("code_challenge"),
      );
      const now = Math.floor(Date.now() / 1000);
      return json({
        access_token: "fixture-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: jwt(
          {
            iss: env.OIDC_ISSUER,
            aud: env.OIDC_CLIENT_ID,
            sub: "member-1",
            iat: now,
            exp: now + 3600,
            nonce: authorization.searchParams.get("nonce"),
            groups: ["viewers"],
            name: "Fixture Reader",
            ...overrides,
          },
          badSignature,
        ),
      });
    }
    throw new Error("Unexpected OIDC endpoint.");
  };
  const client = {
    ...oidc,
    discovery: (server, id, metadata, authentication, options) =>
      oidc.discovery(server, id, metadata, authentication, {
        ...options,
        [oidc.customFetch]: fetch,
      }),
  };
  const auth = new Auth(config, store, client),
    login = await auth.login();
  authorization = new URL(login.url);
  const callback = new URL(config.origin + "/auth/callback");
  callback.searchParams.set("code", "fixture-code");
  callback.searchParams.set("state", authorization.searchParams.get("state"));
  return { auth, store, login, callback };
}
test("real OIDC code flow verifies signed token, PKCE, nonce, groups and replay protection", async () => {
  const f = await authenticationFixture();
  try {
    const result = await f.auth.callback(f.callback, f.login.cookie);
    assert.equal(result.user.role, "viewer");
    assert.match(result.cookies[0], /HttpOnly; Secure; SameSite=Lax/);
    const cookie = result.cookies[0].split(";")[0];
    assert.equal(
      f.auth.session({ headers: { cookie } }).name,
      "Fixture Reader",
    );
    await assert.rejects(
      () => f.auth.callback(f.callback, f.login.cookie),
      /expired|already used/,
    );
  } finally {
    f.store.close();
  }
});
for (const [name, claims, bad] of [
  ["wrong audience", { aud: "attacker" }, false],
  ["wrong issuer", { iss: "https://attacker.example/" }, false],
  ["wrong nonce", { nonce: "attacker" }, false],
  ["expired token", { exp: 1 }, false],
  ["tampered signature", {}, true],
  ["unauthorized group", { groups: ["outsiders"] }, false],
])
  test(`OIDC rejects ${name}`, async () => {
    const f = await authenticationFixture(claims, bad);
    try {
      await assert.rejects(() => f.auth.callback(f.callback, f.login.cookie));
      assert.equal(
        f.store.db.prepare("SELECT count(*) n FROM sessions").get().n,
        0,
      );
    } finally {
      f.store.close();
    }
  });
