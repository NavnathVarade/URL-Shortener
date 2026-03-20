# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: deps — install ALL dependencies (dev + prod)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

# Install OS packages needed by Prisma (openssl) and Alpine build tools
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy manifests first (layer cache: only re-install when these change)
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts

# Generate Prisma client (binaryTargets includes linux-musl-openssl-3.0.x for Alpine)
RUN npx prisma generate

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: builder — compile TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript → dist/
RUN npx tsc --project tsconfig.json

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runner — minimal production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root user
RUN apk add --no-cache openssl curl && \
    addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 appuser

WORKDIR /app

# Copy only production node_modules (skip devDependencies)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled app
COPY --from=builder /app/dist ./dist

# Copy Prisma schema and generated client
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma

# Metadata
ARG BUILD_DATE
ARG GIT_SHA
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="url-shortener" \
      org.opencontainers.image.description="Production-grade URL shortener service"

ENV NODE_ENV=production \
    PORT=3000

# Run as non-root
USER appuser

EXPOSE 3000

# Health check for Docker / ECS / Kubernetes
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["node", "dist/index.js"]
