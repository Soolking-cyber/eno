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
    expect([...added.keys()].sort()).toEqual([...ONBOARDING, ...EARLIER].sort())
    for (const [name, sql] of added) expect(sql, name).toBe(sqlFor(model.get(name)!))
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
    for (const marker of ['"teachAreas" text[]', 'TeacherProfile_teach_bounds', '"phoneShared" boolean']) {
      const at = ddl.indexOf(marker)
      expect(at > begin && at < commit, marker).toBe(true)
    }
  })
})
