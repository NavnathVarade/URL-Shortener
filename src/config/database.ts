import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

// ─────────────────────────────────────────────────────────────────────────────
// Prisma Client Singleton
// ─────────────────────────────────────────────────────────────────────────────
// A single PrismaClient instance manages the connection pool. Creating multiple
// instances in a Node.js process wastes connections and causes errors.
// ─────────────────────────────────────────────────────────────────────────────

const prismaClientSingleton = (): PrismaClient => {
  return new PrismaClient({
    datasources: {
      db: { url: env.DATABASE_URL },
    },
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ],
  });
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const prisma: PrismaClientSingleton =
  globalForPrisma.prisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Logging (dev only — slow query detection)
// ─────────────────────────────────────────────────────────────────────────────
if (env.NODE_ENV === 'development') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$on as any)('query', (e: { query: string; duration: number }) => {
    if (e.duration > 100) {
      logger.warn({ query: e.query, durationMs: e.duration }, 'Slow query detected');
    } else {
      logger.debug({ query: e.query, durationMs: e.duration }, 'DB Query');
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma.$on as any)('error', (e: { message: string; target: string }) => {
  logger.error({ message: e.message, target: e.target }, 'Prisma error');
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('✅ Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}
