FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mini-app/package.json apps/mini-app/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @lifeos/api... --frozen-lockfile
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @lifeos/contracts build && pnpm --filter @lifeos/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache ffmpeg wget && corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mini-app/package.json apps/mini-app/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @lifeos/api... --prod --frozen-lockfile
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/health || exit 1
CMD ["pnpm", "--filter", "@lifeos/api", "start"]

FROM node:22-alpine AS migration
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mini-app/package.json apps/mini-app/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY scripts scripts
COPY supabase/migrations supabase/migrations
CMD ["pnpm", "db:migrate"]
