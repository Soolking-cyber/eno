import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * scripts/teacher-job-dms-ddl.mjs creates these tables by hand (CLAUDE.md: `prisma db push` would drop the tables Prisma
 * does not manage). Prisma selects every scalar column of a model, so a column in the schema that the DDL does not create
 * is a 42703 on the first read — this pins the two files together.
 */
const ROOT = join(__dirname, '../../../..')
const SCHEMA = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const DDL = readFileSync(join(ROOT, 'scripts/teacher-job-dms-ddl.mjs'), 'utf8')
const SCALARS = new Set(['String', 'Boolean', 'Int', 'Float', 'DateTime', 'Json', 'BigInt', 'Decimal'])

function prismaColumns(model: string): string[] {
  const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA)?.[1]
  if (!body) throw new Error(`model ${model} not found`)
  return body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)).filter(([, type]) => type && SCALARS.has(type.replace(/[?[\]]/g, ''))).map(([name]) => name).sort()
}

function ddlColumns(table: string): string[] {
  const body = new RegExp(`create table if not exists "${table}" \\(([\\s\\S]*?)\\n  \\)\`\\)`).exec(DDL)?.[1]
  if (!body) throw new Error(`table ${table} not found in the DDL`)
  return [...body.matchAll(/^\s+"(\w+)" /gm)].map((m) => m[1]).sort()
}

/** Each column as `name type[ not null]` — the DDL's type for the Prisma type (a uuid where the field says @db.Uuid). */
const DDL_TYPE: Record<string, string> = { String: 'text', Boolean: 'boolean', Int: 'integer', DateTime: 'timestamp(3)', Json: 'jsonb' }
function prismaShape(model: string): string[] {
  const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA)?.[1] ?? ''
  return body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)).filter(([, type]) => type && SCALARS.has(type.replace(/[?[\]]/g, '')))
    .map(([name, type, ...attrs]) => `${name} ${attrs.includes('@db.Uuid') ? 'uuid' : DDL_TYPE[type.replace(/[?[\]]/g, '')]}${type.endsWith('?') ? '' : ' not null'}`).sort()
}
function ddlShape(table: string): string[] {
  const body = new RegExp(`create table if not exists "${table}" \\(([\\s\\S]*?)\\n  \\)\`\\)`).exec(DDL)?.[1] ?? ''
  return [...body.matchAll(/^\s+"(\w+)" ([a-z]+(?:\(\d+\))?(?:\[\])?)(.*)$/gm)].map(([, name, type, rest]) => `${name} ${type}${/ not null\b/.test(rest) ? ' not null' : ''}`).sort()
}
/** Prisma's own index names: <Model>_<fields>_key for @@unique, _idx for @@index, <Model>_pkey for the id. */
function prismaIndexes(model: string): string[] {
  const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA)?.[1] ?? ''
  const names = [`${model}_pkey (unique)`]
  for (const [, kind, fields] of body.matchAll(/@@(unique|index)\(\[([^\]]+)\]\)/g)) {
    names.push(`${model}_${fields.split(',').map((f) => f.trim()).join('_')}_${kind === 'unique' ? 'key (unique)' : 'idx'}`)
  }
  return names.sort()
}
function ddlIndexes(table: string): string[] {
  const body = new RegExp(`create table if not exists "${table}" \\(([\\s\\S]*?)\\n  \\)\`\\)`).exec(DDL)?.[1] ?? ''
  return [
    ...[...body.matchAll(/constraint "(\w+)" primary key/g)].map((m) => `${m[1]} (unique)`),
    ...[...DDL.matchAll(new RegExp(`create (unique )?index if not exists "(\\w+)" on "${table}"`, 'g'))].map((m) => `${m[2]}${m[1] ? ' (unique)' : ''}`),
  ].sort()
}

/** scripts/teacher-job-dms-shape.sql's `want` rows: (table, kind, item). */
const SHAPE = readFileSync(join(ROOT, 'scripts/teacher-job-dms-shape.sql'), 'utf8')
const shapeRows = (kind: string, table: string) =>
  [...SHAPE.matchAll(/^  \('(\w+)', '(\w+)', \$\$(.*)\$\$\),?$/gm)].filter(([, t, k]) => t === table && k === kind).map((m) => m[3]).sort()
const PG_TYPE: Record<string, string> = { text: 'text', boolean: 'boolean', uuid: 'uuid', integer: 'integer', jsonb: 'jsonb', 'timestamp(3)': 'timestamp(3) without time zone' }
const ddlBody = (t: string) => new RegExp(`create table if not exists "${t}" \\(([\\s\\S]*?)\\n  \\)\`\\)`).exec(DDL)?.[1] ?? ''
const listOf = (l: string) => l.replace(/"/g, '').split(',').map((x) => x.trim()).join(',')

describe('scripts/teacher-job-dms-shape.sql ↔ the DDL script', () => {
  for (const t of ['ExternalJobPost', 'TeacherJobDmConsent', 'TeacherJobDm', 'TeacherJobDmDay']) {
    it(`${t}: every column (type, NOT NULL, default), index and RLS row is the DDL's own`, () => {
      const cols = [...ddlBody(t).matchAll(/^\s+"(\w+)" ([a-z]+(?:\(\d+\))?(?:\[\])?)(.*)$/gm)].map(([, n, ty, rest]) => {
        const d = / default (.*?),?$/.exec(rest)?.[1]?.toLowerCase().trim()
        return `${n} ${PG_TYPE[ty] ?? `unmapped ${ty}`}${/ not null\b/.test(rest) ? ' not null' : ''}${d ? ` default ${d}` : ''}`
      }).sort()
      expect(cols.length).toBeGreaterThan(3)
      expect(shapeRows('column', t)).toEqual(cols)
      expect(shapeRows('index', t)).toEqual([
        ...[...ddlBody(t).matchAll(/constraint "(\w+)" primary key \(([^)]+)\)/g)].map((m) => `${m[1]} unique (${listOf(m[2])})`),
        ...[...DDL.matchAll(new RegExp(`create (unique )?index if not exists "(\\w+)" on "${t}"\\(([^)]+)\\)`, 'g'))].map((m) => `${m[2]}${m[1] ? ' unique' : ''} (${listOf(m[3])})`),
      ].sort())
      expect(shapeRows('rls', t)).toEqual(['on'])
      expect(shapeRows('policy', t)).toEqual([])
    })
    it(`${t}: a constraint row for every constraint the DDL names — and each foreign key cascades to "Profile"`, () => {
      const rows = shapeRows('constraint', t)
      const fks = [...DDL.matchAll(new RegExp(`conname = '(\\w+)' and conrelid = '"${t}"'`, 'g'))].map((m) => m[1])
      expect(rows.map((r) => r.split(' ')[0]).sort()).toEqual([...[...ddlBody(t).matchAll(/constraint "(\w+)"/g)].map((m) => m[1]), ...fks].sort())
      for (const fk of fks) expect(rows).toContain(`${fk} FOREIGN KEY ("profileId") REFERENCES "Profile"(id) ON UPDATE CASCADE ON DELETE CASCADE`)
    })
  }
})

describe('teacher-job-dms-ddl.mjs ↔ schema.prisma', () => {
  for (const t of ['ExternalJobPost', 'TeacherJobDmConsent', 'TeacherJobDm', 'TeacherJobDmDay']) {
    it(`${t}: the same columns`, () => {
      expect(ddlColumns(t)).toEqual(prismaColumns(t))
    })
    // The DDL's --check holds the database to the DDL's text; this holds that text to the schema (codex, gate 6c).
    it(`${t}: the same types and NOT NULLs, and Prisma's index names`, () => {
      expect(ddlShape(t)).toEqual(prismaShape(t))
      expect(ddlShape(t).length, 'parsed').toBe(prismaColumns(t).length)
      expect(ddlIndexes(t)).toEqual(prismaIndexes(t))
    })
  }
  it('every table gets RLS and no policy', () => {
    expect(DDL).toMatch(/enable row level security/)
    expect(DDL).not.toMatch(/create policy/i)
  })
  it('alters no existing table', () => {
    const altered = [...DDL.matchAll(/alter table "(\w+)"/g)].map((m) => m[1])
    for (const t of altered) expect(['ExternalJobPost', 'TeacherJobDmConsent', 'TeacherJobDm', 'TeacherJobDmDay']).toContain(t)
  })
})
