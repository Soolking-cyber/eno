import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

/** The home page's one <h1> (owner 2026-11-17): the site's title in words, opening on the name, with a curated Vietnamese line. */
describe('the home page H1', () => {
  const src = readFileSync(fileURLToPath(new URL('./layout.tsx', import.meta.url)), 'utf8')
  it('is the site title, sr-only, opening on SITE_NAME', () => {
    expect(src).toContain('<h1 className="sr-only"><Tr text={POSTING_IS_FREE ? `${SITE_NAME} — free classifieds for expats and locals in Vietnam.`')
  })
  it('has curated Vietnamese for both forms, as the footer prints them', () => {
    expect(VI_OVERRIDES['eno.vn — free classifieds for expats and locals in Vietnam.']).toBe('eno.vn — rao vặt miễn phí cho người nước ngoài và người Việt.')
    expect(VI_OVERRIDES['eno.vn — classifieds for expats and locals in Vietnam.']).toBe('eno.vn — rao vặt cho người nước ngoài và người Việt.')
  })
})
