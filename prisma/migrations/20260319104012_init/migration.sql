-- CreateTable
CREATE TABLE "urls" (
    "id" UUID NOT NULL,
    "shortCode" VARCHAR(16) NOT NULL,
    "originalUrl" VARCHAR(2048) NOT NULL,
    "userId" VARCHAR(255),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clickCount" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_events" (
    "id" UUID NOT NULL,
    "shortCode" VARCHAR(16) NOT NULL,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(512),
    "referer" VARCHAR(2048),
    "country" VARCHAR(2),
    "device" VARCHAR(50),
    "clickedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "click_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "urls_shortCode_key" ON "urls"("shortCode");

-- CreateIndex
CREATE INDEX "urls_shortCode_idx" ON "urls"("shortCode");

-- CreateIndex
CREATE INDEX "urls_userId_idx" ON "urls"("userId");

-- CreateIndex
CREATE INDEX "urls_createdAt_idx" ON "urls"("createdAt");

-- CreateIndex
CREATE INDEX "urls_expiresAt_idx" ON "urls"("expiresAt");

-- CreateIndex
CREATE INDEX "click_events_shortCode_clickedAt_idx" ON "click_events"("shortCode", "clickedAt" DESC);

-- CreateIndex
CREATE INDEX "click_events_clickedAt_idx" ON "click_events"("clickedAt");

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_shortCode_fkey" FOREIGN KEY ("shortCode") REFERENCES "urls"("shortCode") ON DELETE CASCADE ON UPDATE CASCADE;
