// Listing.facetTokens — the multi-valued facet column ("|size:m|size:l|"). Nullable, additive,
// no FK, no default → safe outside the profile_auth_fk push flow (same class as marketPosition,
// video and the sold-attribution columns). Mirrored in prisma/schema.prisma on Listing.
// IDEMPOTENT — re-apply after any DB reset.
//
// ⛔ RUN THIS BEFORE DEPLOYING THE CODE THAT READS IT. Prisma selects every scalar column, so the
// new revision throws 42703 undefined_column against an old database on any unscoped query. New
// columns are additive, so the OLD revision is unaffected by this script — DB first is always the
// safe order (CLAUDE.md, the schema-change flow).
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/facet-tokens-col.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })

const SQL = `
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "facetTokens" TEXT;
`

try {
  await client.connect()
  await client.query(SQL)
  const { rows } = await client.query(
    `select count(*)::int as n from information_schema.columns where table_name='Listing' and column_name='facetTokens'`,
  )
  if (rows[0]?.n !== 1) throw new Error('column not present after ALTER')
  console.log('✓ Listing.facetTokens applied')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
