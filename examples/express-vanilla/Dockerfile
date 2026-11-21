# Build context is the repository root (see docker-compose.yml).
#
#   app  — the demo server (Node 22, Alpine)
#   e2e  — Playwright tests, on the official Playwright image (Chromium + glibc)
#
# Both stages install dependencies themselves: native binaries (esbuild) are
# platform-specific, so they can't be copied between the two base images.

FROM node:22-alpine AS app
WORKDIR /repo
COPY . .
# --no-package-lock: the committed lockfile is not yet in sync with the workspaces.
RUN npm install --no-package-lock --no-audit --no-fund \
 && npm run build --workspace=@qr-device-flow/core \
      --workspace=@qr-device-flow/server \
      --workspace=@qr-device-flow/storage-redis \
      --workspace=@qr-device-flow/web \
      --workspace=@qr-device-flow/react-native \
      --workspace=@qr-device-flow/element \
 && npm run build:client --workspace=qr-device-flow-example
WORKDIR /repo/examples/express-vanilla
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "serve"]

# The Next.js app. It reuses the app stage (dependencies and built packages),
# then builds itself. The API URL is read at runtime (API_URL), not at build time.
FROM app AS next
WORKDIR /repo/examples/nextjs-element
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
EXPOSE 3200
CMD ["npm", "run", "start"]

FROM mcr.microsoft.com/playwright:v1.65.1-noble AS e2e
WORKDIR /repo
COPY . .
RUN npm install --no-package-lock --no-audit --no-fund \
 && npm run build --workspace=@qr-device-flow/core \
      --workspace=@qr-device-flow/server \
      --workspace=@qr-device-flow/storage-redis \
      --workspace=@qr-device-flow/web \
      --workspace=@qr-device-flow/react-native \
      --workspace=@qr-device-flow/element \
 && npm run build:client --workspace=qr-device-flow-example
WORKDIR /repo/examples/express-vanilla
# Tests run against the app container (E2E_BASE_URL is set by docker-compose.yml).
CMD ["npm", "run", "test:e2e"]
