import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Prisma 7: the Rust query engine is gone — the client talks to Postgres through a
// driver adapter. We use node-postgres against the POOLED Supabase url (Supavisor,
// port 6543, transaction mode); node-postgres uses unnamed prepared statements, which
// are compatible with the transaction pooler. DDL/migrations use the DIRECT url via
// prisma.config.ts instead.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// ⛔ A SMALL POOL WHILE `next build` PRERENDERS (2026-09-30). The build runs ~15 workers, each with its
// own client, and node-postgres defaults to 10 connections per pool — up to 150 against a database that
// sits at ~45 of max_connections=100 at rest (Supabase's own services). Two box deploys of the services
// edition died on "too many clients already" mid-prerender. 3 per worker keeps the build under ~45;
// the running app (any other phase) keeps the default.
const buildPool = process.env.NEXT_PHASE === 'phase-production-build' ? { max: 3 } : {}
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, ...buildPool })

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    // Only log queries in dev — query logs contain seller phone numbers (PII).
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error'],
  })

// Reuse the singleton in every env to avoid exhausting the pooler.
globalForPrisma.prisma = db
