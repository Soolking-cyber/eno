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

describe('teacher-job-dms-ddl.mjs ↔ schema.prisma', () => {
  for (const t of ['ExternalJobPost', 'TeacherJobDmConsent', 'TeacherJobDm', 'TeacherJobDmDay']) {
    it(`${t}: the same columns`, () => {
      expect(ddlColumns(t)).toEqual(prismaColumns(t))
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
