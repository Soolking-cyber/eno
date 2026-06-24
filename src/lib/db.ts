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

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    // Only log queries in dev — query logs contain seller phone numbers (PII).
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error'],
  })

// Reuse the singleton in every env to avoid exhausting the pooler.
globalForPrisma.prisma = db
