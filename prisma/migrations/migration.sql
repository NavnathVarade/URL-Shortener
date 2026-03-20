-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0001_init
-- Description: Initial schema with partition-ready click_events table
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for LIKE query acceleration on URLs

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: urls
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "urls" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "shortCode"    VARCHAR(16)  NOT NULL,
    "originalUrl"  VARCHAR(2048) NOT NULL,
    "userId"       VARCHAR(255),
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "clickCount"   BIGINT       NOT NULL DEFAULT 0,
    "expiresAt"    TIMESTAMPTZ,
    "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "urls_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on shortCode (the hot read path)
CREATE UNIQUE INDEX IF NOT EXISTS "urls_shortCode_key" ON "urls" ("shortCode");

-- Index for user-scoped queries
CREATE INDEX IF NOT EXISTS "urls_userId_idx" ON "urls" ("userId") WHERE "userId" IS NOT NULL;

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS "urls_createdAt_idx" ON "urls" ("createdAt" DESC);

-- Index for expiry cleanup background job
CREATE INDEX IF NOT EXISTS "urls_expiresAt_idx" ON "urls" ("expiresAt") WHERE "expiresAt" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: click_events (PARTITIONED by clickedAt — monthly partitions)
--
-- At 11,600 reads/sec with click tracking on each redirect:
--   - 11,600 writes/sec × 86,400 sec/day ≈ 1 billion clicks/day
--   - Monthly partitions make archival & DROP PARTITION O(1)
--   - PostgreSQL 15 automatically routes INSERTs to the correct partition
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "click_events" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "shortCode"   VARCHAR(16)  NOT NULL,
    "ipAddress"   VARCHAR(45),
    "userAgent"   VARCHAR(512),
    "referer"     VARCHAR(2048),
    "country"     VARCHAR(2),
    "device"      VARCHAR(50),
    "clickedAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
) PARTITION BY RANGE ("clickedAt");

-- Indexes on the partitioned table (automatically inherited by child partitions)
CREATE INDEX IF NOT EXISTS "click_events_shortCode_clickedAt_idx"
    ON "click_events" ("shortCode", "clickedAt" DESC);

CREATE INDEX IF NOT EXISTS "click_events_clickedAt_idx"
    ON "click_events" ("clickedAt" DESC);

-- Add foreign key constraint AFTER both tables exist
ALTER TABLE "click_events"
    ADD CONSTRAINT "click_events_shortCode_fkey"
    FOREIGN KEY ("shortCode") REFERENCES "urls" ("shortCode") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Create initial monthly partitions (current year + 1 ahead)
-- In production, a cron job auto-creates future partitions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "click_events_2024_01"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_02"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_03"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_04"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_05"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_06"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_07"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_08"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_09"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_10"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_11"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE IF NOT EXISTS "click_events_2024_12"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_01"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_02"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_03"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_04"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_05"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_06"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_07"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_08"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_09"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_10"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_11"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE IF NOT EXISTS "click_events_2025_12"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS "click_events_2026_01"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE IF NOT EXISTS "click_events_2026_02"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS "click_events_2026_03"
    PARTITION OF "click_events"
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Default partition catches any out-of-range data
CREATE TABLE IF NOT EXISTS "click_events_default"
    PARTITION OF "click_events" DEFAULT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Function + trigger: auto-update updatedAt on urls
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "urls_updated_at_trigger"
    BEFORE UPDATE ON "urls"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
