# syntax=docker/dockerfile:1

# -------- Stage 1: Dependencies --------
FROM node:20.19.0-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++ postgresql-client
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev && npm cache clean --force

# -------- Stage 2: Build --------
FROM node:20.19.0-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json tsconfig.json ./
COPY packages ./packages
RUN npm ci && npm run build

# -------- Stage 3: Production --------
FROM node:20.19.0-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN apk add --no-cache postgresql-client curl
RUN addgroup -g 1001 -S nodejs && adduser -S node -u 1001
COPY --from=deps --chown=node:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=node:nodejs /app/dist ./dist
COPY --from=builder --chown=node:nodejs /app/package.json ./package.json
COPY --chown=node:nodejs db/seeds ./db/seeds
COPY --chown=node:nodejs scripts/db ./scripts/db
USER node
EXPOSE 3001 9090
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/packages/middleware-engine/src/index.js"]
