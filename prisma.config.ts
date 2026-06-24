import 'dotenv/config' // Prisma 7 no longer auto-loads .env; load it for CLI runs.
import { defineConfig, env } from 'prisma/config'

// Prisma 7 config. The CLI (db push / studio / generate) connects via this
// datasource — pointed at the DIRECT connection (port 5432) so schema DDL never
// runs over the transaction-mode pooler. The RUNTIME client connects through the
// @prisma/adapter-pg driver adapter on the POOLED url (see src/lib/db.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
})
