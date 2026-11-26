# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --ignore-scripts && npx vite build apps/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev --ignore-scripts || true
USER node
EXPOSE 8787
CMD ["npx", "tsx", "apps/server/src/main.ts"]
