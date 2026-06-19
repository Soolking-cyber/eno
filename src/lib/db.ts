import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Only log queries in dev — query logs contain seller phone numbers (PII).
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error'],
  })

// Reuse the singleton in every env to avoid exhausting the pooler.
globalForPrisma.prisma = db