import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE DDL IS THE MIGRATION (plan review D9, 2026-10-08): every TeacherProfile column added after the table was
 * created is added by scripts/teachers-ddl.mjs, exactly as `prisma migrate diff` prints it for schema.prisma — so the
 * production run leaves no drift, and nothing ever goes through `prisma db push` (CLAUDE.md "SCHEMA CHANGES"). This pins
 * the two files together in both directions, and pins that the script is additive only.
 */
const ddl = readFileSync(join(process.cwd(), 'scripts/teachers-ddl.mjs'), 'utf8')
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

/** A model's scalar fields: name → its Prisma type line. */
const modelFields = (name: string) => {
  const body = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema)![1]
  const fields = new Map<string, string>()
  for (const line of body.split('\n')) {
    const m = /^\s+(\w+)\s+(\S+)(.*)$/.exec(line)
    if (m && !line.trim().startsWith('//') && !line.trim().startsWith('@@')) fields.set(m[1], `${m[2]}${m[3]}`.replace(/\/\/.*$/, '').trim())
  }
  return fields
}
const model = modelFields('TeacherProfile')

/** Prisma's own DDL for a field type (what `migrate diff` prints, lower-cased as the script writes it). */
function sqlFor(prismaType: string): string {
  const [type] = prismaType.split(/\s+/)
  const dflt = /@default\(([^)]*)\)/.exec(prismaType)?.[1]
  switch (type) {
    case 'String?': return 'text'
    case 'Int?': return 'integer'
    case 'DateTime?': return 'timestamp(3)'
    case 'String[]': return dflt === '[]' ? 'text[] default array[]::text[]' : 'text[]'
    case 'Boolean': return `boolean not null default ${dflt}`
    case 'Int': return `integer not null default ${dflt}`
    default: throw new Error(`no DDL mapping for ${prismaType}`)
  }
}

/** Every `add column if not exists` the script makes on a table: name → its SQL type. */
const addedTo = (table: string) => {
  const out = new Map<string, string>()
  for (const block of ddl.matchAll(new RegExp(`alter table "${table}"([\\s\\S]*?)\`\\)`, 'g'))) {
    for (const m of block[1].matchAll(/add column if not exists "(\w+)" ([^,\n]+?)\s*(?:,|$)/gm)) out.set(m[1], m[2].trim())
  }
  return out
}
const added = addedTo('TeacherProfile')

/** The onboarding redesign's sixteen columns (2026-10-08) — and the cover and intro-video ones before them. */
const ONBOARDING = [
  'livesIn', 'currentProvince', 'currentDistrictKey', 'teachAreas', 'teachAreasConfirmedAt', 'teachLanguages', 'englishLevel',
  'experienceBand', 'situationVersion', 'consentPublicVersion', 'matchEmailOptInAt', 'matchEmailNoticeVersion', 'matchEmailWithdrawnAt',
  'staffContactOptInAt', 'staffContactNoticeVersion', 'staffContactWithdrawnAt',
]
const EARLIER = ['coverOpen', 'coverSlots', 'coverAreas', 'coverRateVnd', 'coverConfirmedAt', 'coverConsentAt', 'coverConsentVersion', 'coverWithdrawnAt', 'videoOnRequest', 'videoVersion']
/**
 * The "Identity verified" switch (owner, 2026-10-15; AUTOMATIC since 2026-10-16): the switch and its three server-written
 * records (last show, its words, last hide). The automatic rule needed NO column — identity-mark.ts reads "hidden" from
 * these two — so the DDL is exactly what the opt-in added, and must stay so.
 */
const IDENTITY_MARK = ['identityMarkOn', 'identityMarkAt', 'identityMarkNoticeVersion', 'identityMarkWithdrawnAt']
/** TeacherContactShare's later columns: whether the share's tap included the phone (gate review, 2026-10-09). */
const CONTACT_SHARE = ['phoneShared']

describe('scripts/teachers-ddl.mjs ↔ prisma/schema.prisma', () => {
  it('adds every onboarding column the schema declares — and they are all nullable or defaulted (the old code keeps running)', () => {
    for (const f of ONBOARDING) {
      expect(model.has(f), `schema.prisma has ${f}`).toBe(true)
      expect(added.get(f), `the DDL adds ${f}`).toBe(sqlFor(model.get(f)!))
      expect(added.get(f)!, f).not.toMatch(/not null(?! default)/)
    }
  })
  it('adds nothing the schema does not declare, with exactly Prisma\'s type — the earlier columns included', () => {
    expect([...added.keys()].sort()).toEqual([...ONBOARDING, ...EARLIER, ...IDENTITY_MARK].sort())
    for (const [name, sql] of added) expect(sql, name).toBe(sqlFor(model.get(name)!))
  })
  it('adds the identity-mark columns exactly as the schema declares them: every existing row untouched (false, NULL — NOT hidden: the mark is automatic), never backfilled', () => {
    for (const f of IDENTITY_MARK) {
      expect(model.has(f), `schema.prisma has ${f}`).toBe(true)
      expect(added.get(f), `the DDL adds ${f}`).toBe(sqlFor(model.get(f)!))
    }
    expect(added.get('identityMarkOn')).toBe('boolean not null default false')
    for (const f of ['identityMarkAt', 'identityMarkNoticeVersion', 'identityMarkWithdrawnAt']) expect(added.get(f), f).not.toMatch(/not null|default/)
  })
  it('adds TeacherContactShare.phoneShared exactly as the schema declares it — and nothing else on that table', () => {
    const share = modelFields('TeacherContactShare')
    const addedShare = addedTo('TeacherContactShare')
    expect([...addedShare.keys()]).toEqual(CONTACT_SHARE)
    for (const f of CONTACT_SHARE) {
      expect(share.has(f), `schema.prisma has ${f}`).toBe(true)
      expect(addedShare.get(f), f).toBe(sqlFor(share.get(f)!))
    }
    // ⛔ THE DEFAULT IS THE BACKFILL: every share before the column was made while a phone was required, under the line
    // "Shared my phone, email and CV" — and a rolled-back revision, which never writes it, must still insert.
    expect(addedShare.get('phoneShared')).toBe('boolean not null default true')
  })
  it('⛔ is additive only: no DROP, no ALTER COLUMN, no TRUNCATE outside its comments', () => {
    const code = ddl.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/\bdrop\b/i)
    expect(code).not.toMatch(/alter\s+column/i)
    expect(code).not.toMatch(/\btruncate\b/i)
  })
  it('runs the new columns and the teach-area CHECK inside the one transaction, before its COMMIT', () => {
    const begin = ddl.indexOf("client.query('begin')")
    const commit = ddl.indexOf("client.query('commit')")
    for (const marker of ['"teachAreas" text[]', 'TeacherProfile_teach_bounds', '"phoneShared" boolean', '"identityMarkOn" boolean']) {
      const at = ddl.indexOf(marker)
      expect(at > begin && at < commit, marker).toBe(true)
    }
  })
  // ⛔ THE CARD'S DISPLAY CACHE HAS ITS OWN SCRIPT (plan conflict 2, 2026-10-15): `ALTER TABLE "Listing"` takes ACCESS
  // EXCLUSIVE before IF NOT EXISTS is checked, and this "re-run any time" script runs in one transaction that also locks
  // Conversation — so it must never touch Listing.
  it('⛔ never alters "Listing" — the identity mark\'s card cache is scripts/listing-identity-mark-ddl.mjs', () => {
    const code = ddl.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/alter\s+table\s+"?Listing"?\b/i)
  })
  it('scripts/listing-identity-mark-ddl.mjs adds exactly Listing."identityMarkNotice" text (as the schema declares it), under a lock_timeout, between BEGIN and COMMIT — and nothing else', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/listing-identity-mark-ddl.mjs'), 'utf8')
    const code = script.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    const listing = modelFields('Listing')
    expect(listing.get('identityMarkNotice'), 'schema.prisma declares Listing.identityMarkNotice').toBe('String?')
    // Every column it adds, on any table: exactly the one, with Prisma's own type (nullable, no default).
    const adds = [...code.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN IF NOT EXISTS "(\w+)" ([^'"`\n]+)/gi)].map((m) => [m[1], m[2], m[3].trim()])
    expect(adds).toEqual([['Listing', 'identityMarkNotice', sqlFor(listing.get('identityMarkNotice')!)]])
    expect(sqlFor(listing.get('identityMarkNotice')!)).toBe('text')
    // ⛔ additive only
    expect(code).not.toMatch(/\bdrop\b/i)
    expect(code).not.toMatch(/alter\s+column/i)
    expect(code).not.toMatch(/\btruncate\b/i)
    // the ALTER runs inside its own short transaction, after SET LOCAL lock_timeout (a queued ALTER would stall every
    // Listing read behind it), and the script verifies the column afterwards
    const begin = code.indexOf("client.query('BEGIN')")
    const timeout = code.indexOf("SET LOCAL lock_timeout = '5s'")
    const alter = code.indexOf('ALTER TABLE "Listing"')
    const commit = code.indexOf("client.query('COMMIT')")
    expect(begin).toBeGreaterThan(-1)
    expect(begin < timeout && timeout < alter && alter < commit, 'BEGIN → SET LOCAL lock_timeout → ALTER → COMMIT').toBe(true)
    expect(code).toMatch(/information_schema\.columns[\s\S]*column_name = 'identityMarkNotice'/)
    expect(code).toContain("'55P03'")
  })
  it('creates TeacherDraft exactly as its Prisma model, with RLS on and the account foreign key, inside the transaction (2026-10-11)', () => {
    const fields = modelFields('TeacherDraft')
    expect([...fields.keys()].filter((k) => k !== 'profile').sort()).toEqual(['createdAt', 'data', 'gen', 'profileId', 'rev', 'step', 'updatedAt'])
    for (const col of ['"profileId" uuid not null', '"data" jsonb not null', '"step" text not null', '"rev" integer not null default 1',
      '"gen" uuid not null default gen_random_uuid()',
      '"createdAt" timestamp(3) not null default current_timestamp', '"updatedAt" timestamp(3) not null default current_timestamp']) {
      expect(ddl, col).toContain(col)
    }
    // a table made by an earlier run (a scratch database) gets the generation too, inside the same transaction
    const add = ddl.indexOf('alter table "TeacherDraft" add column if not exists "gen" uuid not null default gen_random_uuid()')
    expect(add > ddl.indexOf("client.query('begin')") && add < ddl.indexOf("client.query('commit')")).toBe(true)
    expect(ddl).toContain('alter table "TeacherDraft" enable row level security')
    expect(ddl).toContain('"TeacherDraft_updatedAt_idx" on "TeacherDraft"("updatedAt")')
    expect(ddl).toMatch(/"TeacherDraft_profileId_fkey"\s+foreign key \("profileId"\) references "Profile"\("id"\) on delete cascade/)
    const at = ddl.indexOf('create table if not exists "TeacherDraft"')
    expect(at > ddl.indexOf("client.query('begin')") && at < ddl.indexOf("client.query('commit')")).toBe(true)
  })
})

