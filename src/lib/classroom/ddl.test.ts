import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ASSESS_STATUSES, AVATAR_LOOKS, TURN_FLAGS, TURN_STATUSES, CUSTOM_STATUSES, END_REASONS, FEEDBACK_STATUSES, LEARNER_KINDS, LEVELS, PLAN_SOURCES,
  PLAN_STATUSES, SEAT_STATUSES, SESSION_MINUTES, SESSION_MODES, SESSION_STATUSES, STRICTNESS,
} from './constants'

/**
 * scripts/classroom-ddl.mjs creates these tables by hand (CLAUDE.md: `prisma db push` would drop the tables Prisma does not
 * manage). Prisma selects every scalar column of a model, so a column in the schema that the DDL does not create is a 42703
 * on the first read — this pins the two files together, and every CHECK list to the constants the API validates with.
 */
const ROOT = join(__dirname, '../../..')
const SCHEMA = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const DDL = readFileSync(join(ROOT, 'scripts/classroom-ddl.mjs'), 'utf8')
const MODELS = ['ClassroomAvatar', 'ClassroomLearner', 'ClassroomEnrollment', 'ClassroomPlan', 'ClassroomSession', 'ClassroomTurn', 'ClassroomFeedback']
const SCALARS = new Set(['String', 'Boolean', 'Int', 'Float', 'DateTime', 'Json', 'BigInt', 'Decimal'])
const DDL_TYPE: Record<string, string> = { String: 'text', Boolean: 'boolean', Int: 'integer', DateTime: 'timestamp(3)', Json: 'jsonb' }

const modelBody = (model: string) => {
  const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA)?.[1]
  if (!body) throw new Error(`model ${model} not found in schema.prisma`)
  return body
}
const fieldLines = (model: string) => modelBody(model).split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@')).map((l) => l.split(/\s+/))
  .filter(([, type]) => type && SCALARS.has(type.replace(/[?[\]]/g, '')))

/** Each column as `name type[ not null]` — the DDL's type for the Prisma type (a uuid where the field says @db.Uuid). */
function prismaShape(model: string): string[] {
  return fieldLines(model).map(([name, type, ...attrs]) =>
    `${name} ${attrs.includes('@db.Uuid') ? 'uuid' : DDL_TYPE[type.replace(/[?[\]]/g, '')]}${type.endsWith('?') ? '' : ' not null'}`).sort()
}
const ddlBody = (table: string) => {
  const body = new RegExp(`create table if not exists "${table}" \\(([\\s\\S]*?)\\n  \\)\`\\)`).exec(DDL)?.[1]
  if (!body) throw new Error(`table ${table} not found in the DDL`)
  return body
}
function ddlShape(table: string): string[] {
  return [...ddlBody(table).matchAll(/^\s+"(\w+)" ([a-z]+(?:\(\d+\))?(?:\[\])?)(.*)$/gm)]
    .map(([, name, type, rest]) => `${name} ${type}${/ not null\b/.test(rest) ? ' not null' : ''}`).sort()
}

/**
 * Each column's DEFAULT as the DDL writes it, from Prisma's @default (round 5, opus: the database's default is the one that
 * applies — Prisma omits a column it has a static default for — so the two must say the same). cuid()/uuid() are made by
 * the client: no database default.
 */
function prismaDefaults(model: string): string[] {
  return fieldLines(model).map(([name, , ...attrs]) => {
    const raw = /@default\(((?:[^()]|\([^()]*\))*)\)/.exec(attrs.join(' '))?.[1]
    const v = !raw || raw === 'cuid()' || raw === 'uuid()' ? '' : raw === 'now()' ? 'current_timestamp' : /^"(.*)"$/.test(raw) ? `'${raw.slice(1, -1)}'` : raw
    return `${name} = ${v}`
  }).sort()
}
function ddlDefaults(table: string): string[] {
  return [...ddlBody(table).matchAll(/^\s+"(\w+)" [a-z]+(?:\(\d+\))?(?:\[\])?(.*)$/gm)]
    .map(([, name, rest]) => `${name} = ${/\bdefault\s+(.+?),?\s*$/.exec(rest)?.[1] ?? ''}`).sort()
}

/** Prisma's own index names: <Model>_<fields>_key for @@unique / @unique, _idx for @@index, <Model>_pkey for the id. */
function prismaIndexes(model: string): string[] {
  const body = modelBody(model)
  const names = [`${model}_pkey (unique)`]
  for (const [, kind, fields] of body.matchAll(/@@(unique|index)\(\[([^\]]+)\]\)/g)) {
    names.push(`${model}_${fields.split(',').map((f) => f.trim()).join('_')}_${kind === 'unique' ? 'key (unique)' : 'idx'}`)
  }
  for (const [name] of fieldLines(model).filter(([, , ...attrs]) => attrs.includes('@unique'))) names.push(`${model}_${name}_key (unique)`)
  return names.sort()
}
/** The DDL's indexes, except the partial ones Prisma cannot declare (they carry a `where`). */
function ddlIndexes(table: string): string[] {
  return [
    ...[...ddlBody(table).matchAll(/constraint "(\w+)" primary key/g)].map((m) => `${m[1]} (unique)`),
    ...[...DDL.matchAll(new RegExp(`create (unique )?index if not exists "(\\w+)" on "${table}"\\([^)]*\\)(\`| where)`, 'g'))]
      .filter((m) => m[3] === '`').map((m) => `${m[2]}${m[1] ? ' (unique)' : ''}`),
  ].sort()
}
/** The quoted values of `check ("<col>" in (…))` on a table. */
function checkList(table: string, col: string): string[] {
  const m = new RegExp(`check \\((?:"${col}" is null or )?"${col}" in \\(([^)]*)\\)\\)`).exec(ddlBody(table))
  if (!m) throw new Error(`no CHECK list for ${table}.${col}`)
  return m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
}

describe('scripts/classroom-ddl.mjs ↔ prisma/schema.prisma', () => {
  for (const model of MODELS) {
    it(`${model}: every column, its type and NOT NULL match`, () => {
      expect(ddlShape(model)).toEqual(prismaShape(model))
    })
    it(`${model}: every column's default is Prisma's @default`, () => {
      expect(ddlDefaults(model)).toEqual(prismaDefaults(model))
    })
    it(`${model}: every Prisma index exists in the DDL under Prisma's own name`, () => {
      expect(ddlIndexes(model)).toEqual(prismaIndexes(model))
    })
  }

  it('the FOUR partial unique indexes are rules: one live session per learner and per teacher test, one "me", one seat per class', () => {
    expect(DDL).toMatch(/create unique index if not exists "ClassroomSession_one_live_learner" on "ClassroomSession"\("learnerId"\) where "status" = 'live'/)
    expect(DDL).toMatch(/create unique index if not exists "ClassroomSession_one_live_tester" on "ClassroomSession"\("testerId"\) where "status" = 'live'/)
    expect(DDL).toMatch(/create unique index if not exists "ClassroomLearner_one_self" on "ClassroomLearner"\("ownerId"\) where "kind" = 'self'/)
    expect(DDL).toMatch(/create unique index if not exists "ClassroomEnrollment_one_seat_per_class" on "ClassroomEnrollment"\("avatarId", "learnerId"\) where "status" in \('active', 'paused'\)/)
    expect([...DDL.matchAll(/create unique index if not exists "\w+" on "\w+"\([^)]*\) where /g)]).toHaveLength(4)
  })

  it('every table gets RLS on and the script refuses a policy', () => {
    for (const m of MODELS) expect(DDL).toContain(`'${m}'`)
    expect(DDL).toMatch(/enable row level security/)
    expect(DDL).toMatch(/carries \$\{r\.policies\} RLS policies/)
  })

  it('the shape check reads a table the same on Postgres 14 (pg_temp_3.) and 16+ (pg_temp.)', () => {
    // Production prints its own temp schema as plain `pg_temp`: the first production run (2026-10-27) reported every index
    // and the trigger WRONG on that alone and rolled back.
    const literal = /const sameTable = \(def\) => def\.replace\(\/(.+)\/, ' ON '\)/.exec(DDL)?.[1]
    expect(literal).toBeTruthy()
    const re = new RegExp(literal!)
    for (const schema of ['pg_temp', 'pg_temp_3', 'public']) {
      expect(`CREATE UNIQUE INDEX "T_pkey" ON ${schema}."T" USING btree (id)`.replace(re, ' ON ')).toBe('CREATE UNIQUE INDEX "T_pkey" ON "T" USING btree (id)')
    }
  })
})

describe('every CHECK list is the constants list the API validates with', () => {
  const cases: [string, string, readonly (string | number)[]][] = [
    ['ClassroomAvatar', 'look', AVATAR_LOOKS],
    ['ClassroomAvatar', 'customStatus', CUSTOM_STATUSES],
    ['ClassroomLearner', 'kind', LEARNER_KINDS],
    ['ClassroomEnrollment', 'status', SEAT_STATUSES],
    ['ClassroomEnrollment', 'level', LEVELS],
    ['ClassroomEnrollment', 'sessionMinutes', SESSION_MINUTES],
    ['ClassroomEnrollment', 'strictness', STRICTNESS],
    ['ClassroomPlan', 'source', PLAN_SOURCES],
    ['ClassroomPlan', 'status', PLAN_STATUSES],
    ['ClassroomSession', 'status', SESSION_STATUSES],
    ['ClassroomSession', 'endReason', END_REASONS],
    ['ClassroomSession', 'mode', SESSION_MODES],
    ['ClassroomSession', 'feedbackStatus', FEEDBACK_STATUSES],
    ['ClassroomTurn', 'assessStatus', ASSESS_STATUSES],
    ['ClassroomTurn', 'status', TURN_STATUSES],
    ['ClassroomTurn', 'flag', TURN_FLAGS],
  ]
  for (const [table, col, values] of cases) {
    it(`${table}.${col}`, () => expect(checkList(table, col)).toEqual(values.map(String)))
  }
})
