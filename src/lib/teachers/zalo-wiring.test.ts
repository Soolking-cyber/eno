import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COVER_ZALO_NOTICE_VERSION, ZALO_REVEAL_LIMITS, formatVnMobile, normalizeVnMobile } from './zalo-rules'

/**
 * "Zalo for urgent cover" (owner, 2026-10-28 — zalo.ts) — the rules that are structure, not behaviour: every writer of the
 * cover columns deletes the number when cover goes off; nothing serves the number to a cache or to Google Analytics; the
 * bell naming a school is never machine-translated. The behaviour runs on a real database in zalo.it.test.ts.
 */
const read = (f: string) => readFileSync(f, 'utf8')
const code = (f: string) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')

describe('normalizeVnMobile — a Vietnamese mobile with Zalo, canonical, or nothing', () => {
  it('accepts the local and +84 forms with spaces, dots and dashes; refuses landlines, foreign and junk', () => {
    for (const ok of ['0901234567', '090 123 4567', '+84 90 123 4567', '84901234567', '0386.123.456', '(+84) 70-123-4567']) {
      expect(normalizeVnMobile(ok), ok).toMatch(/^0[35789]\d{8}$/)
    }
    for (const bad of ['02438251234', '+44 7700 900123', '0901234', '09012345678', '0601234567', 'zalo 0901234567', '', 12345, null]) {
      expect(normalizeVnMobile(bad as unknown), String(bad)).toBeNull()
    }
    expect(formatVnMobile('0901234567')).toBe('0901 234 567')
    expect(ZALO_REVEAL_LIMITS).toEqual({ school: 1, verified: 20 })
    expect(COVER_ZALO_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('wiring', () => {
  it('⛔ every save that writes the cover columns deletes the Zalo when cover is off — the same count, under the same lock', () => {
    const files = execFileSync('git', ['grep', '-l', 'coverWrites(', '--', 'src', 'scripts'], { encoding: 'utf8' }).trim().split('\n')
      .filter((f) => !/\.test\.tsx?$/.test(f))
    expect(files).toEqual(['src/lib/teachers/publish.ts'])
    const src = code('src/lib/teachers/publish.ts')
    const writes = (src.match(/= coverWrites\(/g) ?? []).length
    expect(writes).toBe(2)
    expect((src.match(/await withdrawZaloForCoverOff\(tx, \{[^}]*coverOpen: cover\.coverOpen \}\)/g) ?? []).length).toBe(writes)
  })

  it('⛔ the number never reaches a link (Google Analytics outbound clicks), the page HTML or a shared cache', () => {
    const ui = code('src/components/teachers/cover-zalo-reveal.tsx')
    expect(ui).not.toMatch(/href=\{?[^}]*(shown|zalo)/i)
    expect(ui).toMatch(/window\.open\(shown\.href, '_blank', 'noopener,noreferrer'\)/)
    for (const f of ['src/app/api/teachers/zalo/route.ts', 'src/app/api/teachers/me/cover-zalo/route.ts']) {
      const r = code(f)
      expect(r, f).toContain("const NO_STORE = { 'Cache-Control': 'private, no-store' }")
      expect((r.match(/NextResponse\.json\(/g) ?? []).length, f).toBe((r.match(/headers: NO_STORE/g) ?? []).length)
    }
    // The teacher page's data never carries it: nothing that builds the public profile reads the column.
    const readers = execFileSync('git', ['grep', '-l', 'coverZalo\\b', '--', 'src'], { encoding: 'utf8' }).trim().split('\n').filter((f) => !/\.test\.tsx?$/.test(f)).sort()
    // Only the teacher's own export and the module itself read it (the school's export lists its reveals, never a number).
    expect(readers).toEqual(['src/lib/teachers/export.ts', 'src/lib/teachers/zalo.ts'])
  })

  it('⛔ every read of TeacherPrivate names its columns — a full row would now carry the Zalo to whoever got it (review round 5)', () => {
    const files = execFileSync('git', ['grep', '-l', '-E', 'teacherPrivate\\.find|private:', '--', 'src/app', 'src/lib'], { encoding: 'utf8' }).trim().split('\n')
      .filter((f) => f && !/\.test\.tsx?$/.test(f))
    for (const f of files) {
      const src = code(f)
      for (const m of src.matchAll(/teacherPrivate\.find\w*\(\{([^)]*)\}\)/g)) expect(m[1], `${f}: ${m[0].slice(0, 80)}`).toMatch(/\bselect:/)
      expect(src, f).not.toMatch(/(include|select):\s*\{[^}]*\bprivate:\s*true/)
      expect(src, f).not.toMatch(/\bprivate:\s*\{\s*include:/)
    }
  })

  it('the bell naming a school is shown as written — never machine-translated', () => {
    const nt = code('src/lib/notification-text.ts')
    const allow = /const MACHINE_TRANSLATABLE[^=]*= new Set\(\[([\s\S]*?)\]\)/.exec(nt)![1]!
    expect(allow).not.toContain('teacher_zalo_seen')
    expect(code('src/lib/teachers/zalo.ts')).toContain("type: 'teacher_zalo_seen'")
  })
})
