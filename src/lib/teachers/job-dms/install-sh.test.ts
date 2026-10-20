import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The box install script (infra/vn-node/job-dms/install.sh) — what it checks before it enables anything, and how it
 *  hands curl the cron secret. The table shape itself is scripts/teacher-job-dms-shape.sql, pinned in ddl.test.ts. */
const ROOT = join(__dirname, '../../../..')
const SCHEMA = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const SH = readFileSync(join(ROOT, 'infra/vn-node/job-dms/install.sh'), 'utf8')
describe('infra/vn-node/job-dms/install.sh', () => {
  it('checks the tables with the SAME file the DDL script checks itself with, and stops on any line it prints', () => {
    expect(SH).toContain(`SHAPE=$(docker exec -i supabase-db psql -U postgres -At -v ON_ERROR_STOP=1 < scripts/teacher-job-dms-shape.sql)`)
    expect(SH).toMatch(/\[ -z "\$SHAPE" \] \|\| \{ echo "STOP:/)
    expect(readFileSync(join(ROOT, 'scripts/teacher-job-dms-ddl.mjs'), 'utf8')).toContain(`new URL('./teacher-job-dms-shape.sql', import.meta.url)`)
  })

  it('re-reads the mode and re-checks the invite timer right before enabling the run timer (opus, gate 6f)', () => {
    const step5 = SH.slice(SH.indexOf('STEP=5'))
    expect(step5.indexOf(`kv_get('job-dms:mode')`)).toBeGreaterThan(-1)
    expect(step5.indexOf('INVITE_BEFORE')).toBeGreaterThan(-1)
    expect(step5.indexOf('systemctl enable --now eno-cron-teacher-job-dms.timer')).toBeGreaterThan(step5.indexOf(`kv_get('job-dms:mode')`))
    // …and never runs the invite's enable itself — it only PRINTS it, as the owner's step a
    expect(SH.split('\n').filter((l) => !/^\s*(#|echo )/.test(l)).join('\n')).not.toMatch(/systemctl (enable|start)\b[^\n]*eno-cron-job-dms-invite/)
  })

  it('names tables and columns as the models do — no @@map / @map for its queries to miss (opus, gate 6c)', () => {
    for (const m of ['ExternalJobPost', 'TeacherJobDmConsent', 'TeacherJobDm', 'TeacherJobDmDay']) {
      expect(new RegExp(`model ${m} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA)?.[1], m).not.toMatch(/@@?map\(/)
    }
  })

  it('hands curl the secret as a header line on stdin, verbatim — nothing to escape (opus, gates 6c + 6d)', () => {
    const group = /(\{ IFS= read -r SECRET;.*; \}) \\$/m.exec(SH)?.[1]
    expect(group).toBeTruthy()
    const r = spawnSync('bash', ['-c', group!], { input: ' ab"c\\d &e\n', encoding: 'utf8' })
    expect(r.stdout).toBe('Authorization: Bearer  ab"c\\d &e\n')
    expect(SH).toMatch(/-H @- 'http:\/\/127\.0\.0\.1:3001\/api\/cron\/teacher-job-dms\?dryRun=1'/)
    expect(SH).not.toMatch(/Bearer \$|-K -/)
  })
})
