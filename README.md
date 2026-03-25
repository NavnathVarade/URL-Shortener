# 🔗 URL Shortener — Production-Grade Service

A production-ready URL shortening service built to top tier engineering standards. Handles **100 million URLs/day**, **11,600 redirects/second**, and 10 years of data (~365 TB).

---

## 📐 System Design

### High-Level Architecture

```
                          ┌─────────────────────────────────────────────────────────────┐
                          │                      AWS / Cloud                             │
                          │                                                              │
  Users / Clients         │   ┌──────────────┐     ┌─────────────────────────────────┐  │
  ────────────────────────┼──▶│  CloudFront  │────▶│  Application Load Balancer (ALB)│  │
  HTTP / HTTPS            │   │     (CDN)    │     └──────────────┬──────────────────┘  │
                          │   └──────────────┘                    │                     │
                          │                          ┌────────────┼────────────┐        │
                          │                          ▼            ▼            ▼        │
                          │                   ┌──────────┐ ┌──────────┐ ┌──────────┐   │
                          │                   │ API Pod 1│ │ API Pod 2│ │ API Pod N│   │
                          │                   │(ECS/K8s) │ │(ECS/K8s) │ │(ECS/K8s) │   │
                          │                   └────┬─────┘ └────┬─────┘ └────┬─────┘   │
                          │                        │             │             │         │
                          │            ┌───────────┼─────────────┼─────────────┼──────┐ │
                          │            │           ▼             ▼             ▼      │ │
                          │            │    ┌─────────────────────────────────────┐   │ │
                          │            │    │        Redis Cluster (ElastiCache)   │   │ │
                          │            │    │   Cache: shortCode → originalUrl     │   │ │
                          │            │    │   BullMQ: Analytics job queue        │   │ │
                          │            │    └─────────────────────────────────────┘   │ │
                          │            │                                               │ │
                          │            │    ┌─────────────────────────────────────┐   │ │
                          │            │    │     PostgreSQL (RDS Multi-AZ)        │   │ │
                          │            │    │  Primary: writes (shorten)           │   │ │
                          │            │    │  Read Replicas: reads (stats)        │   │ │
                          │            │    │  Partitioned click_events table      │   │ │
                          │            │    └─────────────────────────────────────┘   │ │
                          │            │                                               │ │
                          │            │    ┌─────────────────────────────────────┐   │ │
                          │            │    │   Analytics Workers (BullMQ)         │   │ │
                          │            │    │   Async click event processing       │   │ │
                          │            │    └─────────────────────────────────────┘   │ │
                          │            └───────────────────────────────────────────────┘ │
                          └─────────────────────────────────────────────────────────────┘
```

### Request Flow

**POST /shorten (write path — ~1,160 req/sec)**
```
Client → ALB → API Server → Validate URL → Generate Base62 code
       → PostgreSQL (INSERT) → Warm Redis cache → Return shortUrl
```

**GET /:shortCode (read path — ~11,600 req/sec)**
```
Client → CloudFront CDN (edge cache for popular URLs)
       → ALB → API Server → Redis cache lookup (hit: ~0.1ms) → 302 Redirect
                          → DB lookup (miss: ~5ms) → Warm cache → 302 Redirect
                          → Async: Enqueue analytics event (BullMQ → Worker → DB)
```

---

## 🏗️ URL Generation Strategy

### Counter + Base62 (Production Choice)

We use a **PostgreSQL SEQUENCE + Base62 encoding** — the same approach used by YouTube for video IDs and Bitly for short codes.

```
PostgreSQL SEQUENCE (atomic int64)
    → nextval() = 1,000,000
    → Base62 encode(1,000,000) = "4c92"
    → pad to 7 chars → "004c92" (or similar)
```

**Why not MD5/SHA256?**
- Truncating a hash causes collisions at scale (birthday paradox: 50% collision probability at √(62^7) ≈ 1.87M URLs)
- Each write requires a SELECT + retry loop
- Counter-based is O(1), guaranteed unique, no retry needed

**Why not random nanoid?**
- Requires a collision-check DB round-trip on every write at scale

**7 characters of Base62 = 62^7 = 3.52 trillion unique codes**
- At 100M URLs/day for 10 years = 365 billion codes → well within capacity

---

## 🗄️ Database Design

### Schema

#### `urls` table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| shortCode | VARCHAR(16) | Unique short code (indexed) |
| originalUrl | VARCHAR(2048) | The destination URL |
| userId | VARCHAR(255) | Optional user association |
| isActive | BOOLEAN | Soft delete flag |
| clickCount | BIGINT | Denormalized click counter |
| expiresAt | TIMESTAMPTZ | Optional TTL for URL |
| createdAt | TIMESTAMPTZ | Creation timestamp |

#### `click_events` table (partitioned)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| shortCode | VARCHAR(16) | FK → urls.shortCode |
| ipAddress | VARCHAR(45) | Client IP (IPv4/6) |
| userAgent | VARCHAR(512) | Browser/client UA |
| referer | VARCHAR(2048) | HTTP Referer header |
| country | VARCHAR(2) | ISO country code |
| device | VARCHAR(50) | mobile/desktop/bot |
| clickedAt | TIMESTAMPTZ | Click timestamp |

### Indexing Strategy

```sql
-- Hot path: shortCode lookup (redirect)
CREATE UNIQUE INDEX urls_shortCode_key ON urls (shortCode);

-- Analytics range queries
CREATE INDEX click_events_shortCode_clickedAt_idx
  ON click_events (shortCode, clickedAt DESC);

-- Expiry cleanup job
CREATE INDEX urls_expiresAt_idx ON urls (expiresAt)
  WHERE expiresAt IS NOT NULL;
```

### Partitioning

`click_events` uses **PostgreSQL range partitioning** by `clickedAt` (monthly):
- Each month's data is a separate child table
- Old partitions can be `DROP`ped in O(1) (vs millions of `DELETE`)
- Query planner uses partition pruning — time-range queries touch only relevant partitions

### Sharding Strategy (at extreme scale)

For truly extreme scale (1000+ write TPS), shard by `shortCode`:
- Shard key: `hash(shortCode) % N_SHARDS`
- Each shard is an independent PostgreSQL cluster
- Application-level routing using a consistent hash ring
- Use Citus (PostgreSQL extension) or Vitess for transparent sharding

---

## ⚡ Caching Strategy

### Redis Cache Architecture
```
Redirect Request
      │
      ▼
┌─────────────────────────────┐
│ Redis GET url:{shortCode}   │ ← ~0.1ms latency
│ TTL: 24 hours               │
└─────────────────────────────┘
      │ hit                │ miss
      ▼                    ▼
  Return URL         PostgreSQL SELECT
                           │
                           ▼
                     SET cache (warm)
                           │
                           ▼
                       Return URL
```

**Cache key format:** `url:{shortCode}` → original URL string  
**TTL:** 24 hours (configurable via `CACHE_TTL_SECONDS`)  
**Eviction policy:** `allkeys-lru` (evict least recently used when memory is full)  
**Cache warming:** Immediately after URL creation, the cache is warmed so the first redirect is fast.

**Cache invalidation:**
- On URL deactivation: `DEL url:{shortCode}`
- On URL update: `DEL url:{shortCode}`

---

## 📊 Analytics Pipeline

```
HTTP Redirect (hot path, <20ms)
      │
      ├──► 302 Redirect (immediate)
      │
      └──► BullMQ.add('click', payload)  ← fire-and-forget, non-blocking
                    │
                    ▼
            Redis Queue (persisted)
                    │
                    ▼
          Analytics Worker (async)
                    │
           ┌────────┴────────┐
           ▼                 ▼
     INSERT click_event    UPDATE urls
     (click_events table)  SET clickCount++
```

Workers run with configurable concurrency (`ANALYTICS_WORKER_CONCURRENCY=5`).
Jobs are retried 3 times with exponential backoff on failure.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### 1. Clone and configure
```bash
git clone https://github.com/NavnathVarade/URL-Shortener.git
cd url-shortener
cp .env.example .env
# Edit .env with your settings
```

### 2. Start all services
```bash
docker-compose up -d
```

### 3. Run migrations
```bash
# With Docker running:
docker exec url-shortener-api npx prisma migrate deploy

# Or locally:
npm install
npx prisma migrate deploy
```

### 4. Verify
```bash
curl http://localhost:3000/health
# → {"status":"healthy","services":{"database":"healthy","cache":"healthy","queue":"healthy"}}
```

---

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Start infrastructure (Postgres + Redis)
docker-compose up postgres redis -d

# Run DB migrations
npx prisma migrate dev

# Start dev server (hot reload)
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

---

## 📡 API Documentation

### POST /shorten
Create a short URL.

**Request:**
```json
POST /shorten
Content-Type: application/json

{
  "url": "https://www.example.com/very/long/path?with=query&params=true",
  "customCode": "mylink",        // optional: custom short code (3-16 chars)
  "expiresAt": "2025-12-31T23:59:59Z",  // optional: ISO 8601 expiry
  "userId": "user-123"           // optional: for user-scoped URL management
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "shortUrl": "http://localhost:3000/mylink",
    "shortCode": "mylink",
    "originalUrl": "https://www.example.com/very/long/path?with=query&params=true",
    "expiresAt": "2025-12-31T23:59:59.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Errors:**
- `400 VALIDATION_ERROR` — Invalid URL, custom code format, or past expiresAt
- `409 CONFLICT` — Custom code already taken
- `429 RATE_LIMIT_EXCEEDED` — 10 shortens per minute per IP

---

### GET /:shortCode
Redirect to the original URL.

```
GET /mylink
→ 302 Location: https://www.example.com/very/long/path?with=query&params=true
```

**Errors:**
- `400 VALIDATION_ERROR` — Invalid short code format
- `404 NOT_FOUND` — Short code doesn't exist
- `410 GONE` — URL has expired or been deactivated

---

### GET /stats/:shortCode
Retrieve analytics for a short URL.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "shortCode": "mylink",
    "originalUrl": "https://www.example.com/very/long/path",
    "clickCount": "1234",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "expiresAt": null,
    "recentClicks": [
      {
        "clickedAt": "2024-01-15T11:00:00.000Z",
        "country": "US",
        "device": "mobile"
      }
    ]
  }
}
```

---

### DELETE /:shortCode
Deactivate a short URL (soft delete).

```
DELETE /mylink
→ 200 {"success": true, "message": "Short URL 'mylink' has been deactivated"}
```

---

### GET /health
Health check endpoint for load balancers.

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "uptime": 3600,
  "services": {
    "database": "healthy",
    "cache": "healthy",
    "queue": "healthy"
  }
}
```

### GET /health/live
Kubernetes liveness probe — returns 200 if process is alive.

### GET /health/ready
Kubernetes readiness probe — returns 200 only if all dependencies are healthy.

---

## 📁 Project Structure

```
url-shortener/
├── src/
│   ├── config/           # Environment config, DB client, Redis client, Logger
│   │   ├── env.ts        # Zod-validated environment variables (fail-fast)
│   │   ├── database.ts   # Prisma client singleton + connection lifecycle
│   │   ├── redis.ts      # ioredis client + cache helper functions
│   │   └── logger.ts     # Pino structured logger
│   │
│   ├── types/            # TypeScript interfaces and DTOs
│   │   └── index.ts      # Domain types, request/response shapes
│   │
│   ├── utils/            # Pure utility functions (no side effects)
│   │   ├── base62.ts     # Base62 encoder/decoder, URL helpers
│   │   ├── validators.ts # Zod schemas + validate() helper
│   │   └── errors.ts     # Custom error class hierarchy
│   │
│   ├── repositories/     # Data access layer — all DB queries here
│   │   ├── url.repository.ts       # CRUD for urls table
│   │   └── analytics.repository.ts # CRUD for click_events table
│   │
│   ├── services/         # Business logic layer
│   │   ├── url.service.ts    # URL shortening + resolution + stats
│   │   └── health.service.ts # Dependency health checks
│   │
│   ├── controllers/      # HTTP layer — thin adapter over services
│   │   ├── url.controller.ts    # Request extraction → service → response
│   │   └── health.controller.ts
│   │
│   ├── routes/           # Express Router definitions
│   │   └── index.ts      # URL routes + health routes
│   │
│   ├── middleware/       # Express middleware
│   │   ├── errorHandler.ts  # Global error handler + 404 handler
│   │   ├── rateLimiter.ts   # Global + per-endpoint rate limiting
│   │   └── requestLogger.ts # Request ID injection + pino-http logger
│   │
│   ├── workers/          # Background job processing
│   │   ├── analytics.queue.ts   # BullMQ queue factory + enqueue helper
│   │   └── analytics.worker.ts  # BullMQ consumer — writes click events to DB
│   │
│   ├── app.ts            # Express application factory (testable)
│   └── index.ts          # Entry point: bootstrap + graceful shutdown
│
├── prisma/
│   ├── schema.prisma     # Prisma schema (urls, click_events)
│   └── migrations/       # SQL migration files
│
├── tests/
│   ├── unit/             # Pure unit tests (mocked deps)
│   │   ├── base62.test.ts
│   │   ├── validators.test.ts
│   │   └── url.service.test.ts
│   └── integration/      # Full HTTP cycle tests (Supertest)
│       └── api.test.ts
│
├── docker/
│   ├── Dockerfile.dev    # Dev image with hot reload
│   └── redis.conf        # Production Redis configuration
│
├── docs/                 # Additional documentation
├── .github/workflows/    # GitHub Actions CI/CD
├── Dockerfile            # Multi-stage production Docker image
├── docker-compose.yml    # Full local stack
├── .env.example          # Environment variable template
├── jest.config.ts        # Jest configuration
├── tsconfig.json         # TypeScript compiler options
└── package.json
```

---

## 🔒 Security

### Rate Limiting
- **Global:** 100 requests/minute per IP (all endpoints)
- **Shorten endpoint:** 10 requests/minute per IP (stricter)
- Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`

### Input Validation
- All inputs validated with Zod schemas before reaching business logic
- URL scheme allowlist: `http`, `https` only
- SSRF protection: blocks localhost and private IP ranges in production
- Custom code allowlist: `[a-zA-Z0-9\-_]` only
- Max URL length: 2048 characters
- Max payload: 10KB (Express body limit)

### Security Headers (Helmet)
- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy`
- `X-XSS-Protection`

### Additional
- Runs as non-root user in Docker (`uid=1001`)
- Sensitive fields redacted from logs (IPs, auth headers)
- No secrets in environment at build time

---

## 📈 Scalability

### Horizontal Scaling
- Stateless API servers (no local state) → scale to N instances behind ALB
- Session/state stored in Redis (shared across instances)
- Database connection pooling via Prisma (2–10 connections per pod)

### CDN Integration
- CloudFront sits in front of ALB
- Popular short URLs cached at edge (302 responses with short TTLs)
- Cache-Control: `no-store` by default (analytics accuracy) — set to `max-age=3600` for static/permanent URLs

### Database Scaling
- **Reads:** RDS Read Replicas for stats queries
- **Writes:** Primary RDS instance (1,160 writes/sec is well within PostgreSQL limits)
- **Partitioning:** `click_events` partitioned monthly — archives old data without DELETE overhead
- **Future sharding:** Consistent hash by `shortCode` across N PostgreSQL clusters using Citus

### Capacity Estimates
| Metric | Value |
|--------|-------|
| Writes/sec | ~1,160 |
| Reads/sec | ~11,600 |
| Cache hit ratio (expected) | >95% |
| DB reads at 95% cache hit | ~580/sec |
| URLs after 10 years | 365 billion |
| Storage (URLs only, 100B avg) | ~36.5 TB |
| Storage (click events) | ~300+ TB |

---

## 🚀 AWS Deployment Architecture

```
                    ┌───────────────────────────────────┐
                    │          Route 53 (DNS)            │
                    └──────────────┬────────────────────┘
                                   │
                    ┌──────────────▼────────────────────┐
                    │       CloudFront (CDN)             │
                    │  - Edge cache for popular URLs     │
                    │  - DDoS protection (Shield)        │
                    │  - WAF rules                       │
                    └──────────────┬────────────────────┘
                                   │
                    ┌──────────────▼────────────────────┐
                    │   Application Load Balancer (ALB)  │
                    │   - HTTPS termination              │
                    │   - Health check: /health/ready    │
                    └──────┬────────────────┬───────────┘
                           │                │
              ┌────────────▼─┐          ┌───▼────────────┐
              │  ECS Fargate  │          │  ECS Fargate   │  (N instances)
              │  API Service  │          │  API Service   │
              └──────┬────────┘          └───┬────────────┘
                     │                       │
         ┌───────────▼───────────────────────▼─────────────┐
         │            ElastiCache (Redis 7)                  │
         │  - Redis Cluster mode (multi-AZ)                  │
         │  - URL cache + BullMQ queues                      │
         └───────────────────────────────────────────────────┘
         ┌───────────────────────────────────────────────────┐
         │              RDS PostgreSQL 15                     │
         │  - Multi-AZ (automatic failover)                   │
         │  - 1 Primary (writes) + 2 Read Replicas (reads)   │
         │  - Automated backups (35-day retention)            │
         └───────────────────────────────────────────────────┘
```

### Infrastructure as Code (Terraform)
See `docs/terraform/` for complete IaC setup covering:
- VPC, subnets, security groups
- ECS cluster + task definitions + services
- RDS Multi-AZ PostgreSQL
- ElastiCache Redis cluster
- ALB + target groups + listeners
- CloudFront distribution
- Auto-scaling policies

---

## 🔭 Observability

### Metrics (Prometheus / CloudWatch)
- `http_requests_total{method, route, status}` — request throughput
- `http_request_duration_seconds{route}` — latency histograms (p50, p95, p99)
- `cache_hit_total` / `cache_miss_total` — cache effectiveness
- `analytics_queue_depth` — queue lag monitoring
- `db_query_duration_ms` — slow query detection

### Logging (Pino → CloudWatch Logs / Datadog)
- Structured JSON in production
- `x-request-id` on every request/response
- Slow queries logged (>100ms)
- All errors logged with full context

### Distributed Tracing
- Add `@opentelemetry/sdk-node` for trace context propagation
- Instrument Prisma, Redis, and BullMQ clients
- Export to Jaeger, Zipkin, or AWS X-Ray

### Alerting (Recommended)
- Error rate > 1% → PagerDuty
- p99 redirect latency > 100ms → Slack
- Cache hit rate < 80% → Slack
- DB connections > 80% → PagerDuty
- Analytics queue depth > 10,000 → Slack

---

## 🧪 Testing

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage report
npm run test:coverage
```

Test coverage targets: 80% lines, 80% functions, 70% branches.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit with conventional commits: `git commit -m 'feat: add custom aliases'`
4. Push and open a PR against `main`
5. CI must pass (lint, type-check, tests, Docker build)

---

## 📄 License

MIT © 2026 Navnath Varade
