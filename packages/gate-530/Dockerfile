# syntax=docker/dockerfile:1

# ------------------------------------------------------------------------
# Wave 1 MVP — gate-530 API Service Dockerfile
# Per-service build: only gate-530 + its dependencies
# ------------------------------------------------------------------------

# -------- Stage 1: Root dependency installation --------
FROM node:20.19.0-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++ postgresql-client

# Copy root package files and install root deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# -------- Stage 2: TypeScript build --------
FROM node:20.19.0-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/evidence-fabric ./packages/evidence-fabric
COPY packages/cos-plus ./packages/cos-plus
COPY packages/gate-530 ./packages/gate-530

# Install all deps (including dev) and build
RUN npm ci && npm run build

# -------- Stage 3: Production image --------
FROM node:20.19.0-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

RUN apk add --no-cache postgresql-client curl ca-certificates
RUN addgroup -g 1001 -S nodejs && adduser -S node -u 1001

# Copy production node_modules from deps stage
COPY --from=deps --chown=node:nodejs /app/node_modules ./node_modules

# Copy built artifacts from builder stage
COPY --from=builder --chown=node:nodejs /app/dist ./dist
COPY --from=builder --chown=node:nodejs /app/package.json ./package.json

# Create key directory for evidence signer
RUN mkdir -p /data/keys && chown -R node:nodejs /data/keys

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/ready || exit 1

CMD ["node", "dist/packages/gate-530/src/api-index.js"]
