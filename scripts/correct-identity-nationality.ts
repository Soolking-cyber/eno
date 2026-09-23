/**
 * SET THE NATIONALITY ON A VERIFIED IDENTITY, THROUGH THE DOMAIN — not with raw SQL.
 *
 * ⛔ IT CALLS `correctVerifiedIdentity`, WHICH IS THE WHOLE POINT. An UPDATE would be two lines and
 * would skip every guarantee that function exists for: the serializable read-and-write that stops a
 * concurrent erasure being undone, the pinned-column predicate, the append-only `corrections` log,
 * and the hash-chained complianceAudit row naming who did it and why. A compliance record edited by
 * a script with no audit entry is exactly the thing an auditor asks about.
 *
 * ⛔ AND PROVISIONING IS DELIBERATELY DISARMED, TWICE. `correctVerifiedIdentity` re-drives
 * `provisionWithinBudget` on success — correct in production, dangerous from a laptop: DATABASE_URL
 * here points through the SSH tunnel at the PRODUCTION database while CROSSMINT_SERVER_SIDE_API_KEY
 * in the local .env is a **staging** key. That combination would create a `base-sepolia` TESTNET
 * wallet and write it into the production CustodyWallet table, where the chain is stored precisely
 * so a staging wallet can never masquerade as a real one. Undoing that means deleting a row a real
 * person's money could already have been sent to.
 * So this runs with the edition forced to `marketplace` (walletGate returns `skipped_edition`
 * before reading anything) AND with the Crossmint credentials blanked (configState → `absent`).
 * The real wallet is then created by PRODUCTION, with production keys, when the user opens the
 * wallet page — which is where that should happen anyway.
 *
 * ⚠️ DRY RUN BY DEFAULT. Pass --apply to write.
 *
 *   npx tsx --tsconfig scripts/tsconfig.import.json --env-file=.env \
 *     scripts/correct-identity-nationality.ts <verificationId> <ISO3> "<reason>" [--apply]
 */

// ⛔ SET BEFORE THE IMPORTS BELOW RESOLVE. `IS_SERVICES` and the Crossmint config are read at module
// scope in some of this graph, so assigning these after the import would be too late.
process.env.NEXT_PUBLIC_ENO_EDITION = 'marketplace'
process.env.CROSSMINT_SERVER_SIDE_API_KEY = ''
process.env.CROSSMINT_SIGNER_SECRET = ''

const APPLY = process.argv.includes('--apply')
/** ⛔ FLAGS ARE STRIPPED BEFORE POSITIONS ARE READ, and that is not tidiness (reviewer). Reading
 *  positionally out of raw argv meant `<id> <ISO3> --apply` — the reason simply forgotten — put the
 *  literal string "--apply" into `reasonArg` AND set APPLY, so the run wrote to production with
 *  "--apply" as its audit note. The note is the entire reason this script exists rather than an
 *  UPDATE: an auditor asking why a verified identity changed would have found a command-line flag.
 *  Putting `--apply` first was the mirror image, silently shifting the id. */
const [verificationId, nationalityArg, reasonArg] = process.argv.slice(2).filter(a => !a.startsWith('--'))

if (!verificationId || !nationalityArg || !reasonArg?.trim()) {
  console.error('usage: <verificationId> <ISO3> "<reason>" [--apply]')
  process.exit(1)
}
const nationality = nationalityArg.trim().toUpperCase()

async function main() {
  const { db } = await import('@/lib/db')
  const { isoNationality } = await import('@/lib/kyc/identity')
  const { correctVerifiedIdentity } = await import('@/lib/kyc/review')

  const row = await db.identityVerification.findUnique({
    where: { id: verificationId },
    select: {
      id: true, status: true, tier: true, documentType: true, nationality: true,
      residenceCountry: true, residenceSource: true, profileId: true, documentExpiresAt: true,
    },
  })
  if (!row) { console.error(`no verification ${verificationId}`); process.exit(1) }

  const iso = isoNationality(nationality)
  console.log('record   :', JSON.stringify(row, null, 1))
  console.log('setting  :', nationality, '→ ISO', iso ?? '(REFUSED — not a code this app can assess)')
  if (!iso) process.exit(1)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await db.$disconnect()
    return
  }

  const r = await correctVerifiedIdentity({
    verificationId,
    // The admin identity of record: the only address in ADMIN_EMAILS on both editions.
    admin: 'support@eno.forum',
    /** ⛔ `iso`, NOT the raw argument (reviewer). `isoNationality` MAPS as well as validates
     *  (`const mapped = MRZ_TO_ISO[c] ?? c; return ISO_ALPHA3.has(mapped) ? mapped : null` — quoted
     *  in FULL because the half without the ISO_ALPHA3 membership test reads as if any three-letter
     *  string were accepted, which a reviewer duly concluded; `ZZZ` returns null and is refused),
     *  so an MRZ spelling passes the guard above and then wrote its
     *  un-normalised form into the compliance record — while the line printed just above claimed
     *  the ISO code. For an argument already in ISO-3 the two are identical, which is exactly why
     *  it would have survived the documented usage and failed on the case the mapping exists for. */
    nationality: iso,
    note: reasonArg.slice(0, 500),
  })
  console.log('\nresult   :', JSON.stringify(r))

  if (r.ok && r.changed) {
    const after = await db.identityVerification.findUnique({
      where: { id: verificationId },
      select: { nationality: true, residenceCountry: true, residenceSource: true, evidence: true },
    })
    const ev = (after?.evidence ?? {}) as { corrections?: unknown[] }
    console.log('after    :', JSON.stringify({
      nationality: after?.nationality,
      residenceCountry: after?.residenceCountry,
      residenceSource: after?.residenceSource,
      corrections: ev.corrections,
    }, null, 1))
    console.log('\n⚠️  NO WALLET WAS CREATED HERE, ON PURPOSE — see the header. Production will')
    console.log('    provision it with production keys when the user opens the wallet page.')
  }
  await db.$disconnect()
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
