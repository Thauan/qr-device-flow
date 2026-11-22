# Build context is the repository root (see docker-compose.yml).
#
#   app  — the demo server (Node 22, Alpine)
#   next — the Next.js app, built on top of app
#
# Only the dependencies of the two demos are installed (pnpm --filter), so the
# image doesn't carry the rest of the monorepo.
# pnpm is pinned to the version used by the lockfile (keep in sync with "packageManager").

FROM node:22-alpine AS app
WORKDIR /repo
COPY . .
RUN npm install -g pnpm@9.15.9 \
 && pnpm install --frozen-lockfile \
      --filter qr-device-flow-example... \
      --filter qr-device-flow-next-example... \
 && pnpm --filter @qr-device-flow/core \
      --filter @qr-device-flow/server \
      --filter @qr-device-flow/storage-redis \
      --filter @qr-device-flow/web \
      --filter @qr-device-flow/react-native \
      --filter @qr-device-flow/element \
      run build \
 && pnpm --filter qr-device-flow-example run build:client
WORKDIR /repo/examples/express-vanilla
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "run", "serve"]

# The Next.js app. It reuses the app stage (dependencies and built packages),
# then builds itself. The API URL is read at runtime (API_URL), not at build time.
FROM app AS next
WORKDIR /repo/examples/nextjs-element
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build
EXPOSE 3200
CMD ["pnpm", "run", "start"]
