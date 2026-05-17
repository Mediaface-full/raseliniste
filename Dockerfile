# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl

# ---- deps: full install pro build (devDeps pro tsx, prisma CLI, astro build) ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- prod-deps: jen runtime deps + prisma CLI (pro migrate deploy) ----
FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- builder: astro build + prisma generate ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma 7: generate bez DATABASE_URL (datasource v schema.prisma nemá url).
RUN npx prisma generate
RUN npm run build

# ---- runner: minimální runtime image ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache su-exec ffmpeg tzdata postgresql-client rsync openssh-client
# - tzdata: Europe/Prague (jinak Alpine fallback UTC, booking sloty rozbité)
# - postgresql-client: pg_dump pro denní zálohu DB (src/lib/backup.ts)
# - rsync + openssh-client: sync záloh na druhý NAS přes Tailscale

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 app

# Astro build output (server entry + client assets)
COPY --from=builder /app/dist ./dist

# Runtime deps (Astro adapter-node, Prisma client, argon2 a spol.)
COPY --from=prod-deps /app/node_modules ./node_modules

# Prisma schema + config + generated client (klient se regeneruje v prod-deps
# přes prisma generate níž; tady jen kopírujeme schema pro migrate deploy).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/generated ./src/generated

# Pomocné skripty a seed
COPY --from=builder /app/scripts ./scripts

COPY package.json ./

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
RUN chown -R app:nodejs /app

EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000
ENTRYPOINT ["./docker-entrypoint.sh"]
