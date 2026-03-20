// ─────────────────────────────────────────────────────────────────────────────
// Domain Types & DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface UrlRecord {
  id: string;
  shortCode: string;
  originalUrl: string;
  userId?: string | null;
  isActive: boolean;
  clickCount: bigint;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClickEventRecord {
  id: string;
  shortCode: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  country?: string | null;
  device?: string | null;
  clickedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request / Response DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface ShortenUrlRequest {
  url: string;
  customCode?: string;
  expiresAt?: string; // ISO 8601
  userId?: string;
}

export interface ShortenUrlResponse {
  shortUrl: string;
  shortCode: string;
  originalUrl: string;
  expiresAt?: string | null;
  createdAt: string;
}

export interface UrlStatsResponse {
  shortCode: string;
  originalUrl: string;
  clickCount: string; // serialized bigint as string
  createdAt: string;
  expiresAt?: string | null;
  recentClicks: ClickEventSummary[];
}

export interface ClickEventSummary {
  clickedAt: string;
  country?: string | null;
  device?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Queue Job Payload
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticsJobPayload {
  shortCode: string;
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
  country?: string;
  device?: string;
  clickedAt: string; // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// API Error Shape
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  message: string;
  code: string;
  details?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceHealth = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResponse {
  status: ServiceHealth;
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceHealth;
    cache: ServiceHealth;
    queue: ServiceHealth;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
