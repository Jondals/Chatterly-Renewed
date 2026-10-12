# Dockerfile
# Builds Chatterly-Renewed into one small image (works on ARM, like the Always Free machines of Oracle, and on x86).
# Stage 1 compiles the backend and the web app; stage 2 keeps only what is needed to run them.
# Inside the container: the API listens on 3000 and the web app on 4200 (a reverse proxy, Caddy, sits in front).

# ---- Stage 1: build ----
FROM node:24-bookworm-slim AS build
# better-sqlite3 is native code: it is downloaded ready-made, and compiled with these tools when there is none for the CPU.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.2.2
ENV CI=true
WORKDIR /app
# The build takes pictures of the sign-in page with a real browser (so it paints at once): Playwright and Chromium, only in this stage.
RUN npm install --no-save --no-package-lock playwright@^1.55.0 && npx playwright install --with-deps chromium

COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml backend/
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml frontend/
RUN pnpm --dir backend install --frozen-lockfile && pnpm --dir frontend install --frozen-lockfile

COPY backend backend
COPY frontend frontend
RUN pnpm --dir backend build && pnpm --dir frontend build
# Only what the backend needs to run (compiling the native module again for production).
RUN pnpm --dir backend install --frozen-lockfile --prod

# ---- Stage 2: runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_PORT=4200 \
    TRUST_PROXY=1 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist/frontend frontend/dist/frontend
COPY scripts/produccion.mjs scripts/static-server.mjs scripts/backup.mjs scripts/
# The database, the uploads and the secrets of the server live here: keep this folder in a volume.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4200/').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})"
CMD ["node", "scripts/produccion.mjs"]
