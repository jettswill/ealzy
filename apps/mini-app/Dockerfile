FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mini-app/package.json apps/mini-app/package.json
RUN pnpm install --filter @lifeos/mini-app... --frozen-lockfile
COPY apps/mini-app apps/mini-app
ARG VITE_API_BASE_URL=""
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_TELEGRAM_BOT_USERNAME
ARG VITE_TELEGRAM_BOT_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_TELEGRAM_BOT_USERNAME=$VITE_TELEGRAM_BOT_USERNAME
ENV VITE_TELEGRAM_BOT_ID=$VITE_TELEGRAM_BOT_ID
RUN pnpm --filter @lifeos/mini-app build

FROM nginx:1.27-alpine
COPY apps/mini-app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/mini-app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
