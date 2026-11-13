# Build a single immutable image; promote the tested image digest between environments.
FROM node:24-bookworm-slim AS node-runtime
FROM python:3.15-slim-bookworm AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 libgcc-s1 libatomic1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && groupadd --gid 10001 snowstack \
    && useradd --uid 10001 --gid snowstack --create-home snowstack
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY --chown=snowstack:snowstack . .
RUN DBT_SEND_ANONYMOUS_USAGE_STATS=false dbt deps --profiles-dir config \
    && chown -R snowstack:snowstack dbt_packages \
    && mkdir -p /var/lib/snowstack /var/lib/snowstack-artifacts \
    && chown snowstack:snowstack /var/lib/snowstack /var/lib/snowstack-artifacts
ENV NODE_ENV=production APP_MODE=snowflake HOST=0.0.0.0 PORT=3000 STATE_DIR=/var/lib/snowstack
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
