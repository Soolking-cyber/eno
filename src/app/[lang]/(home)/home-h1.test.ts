import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

/** The home page's one <h1> (owner 2026-11-17): the site's title in words, opening on the name, with a curated Vietnamese line. */
describe('the home page H1', () => {
  const src = readFileSync(fileURLToPath(new URL('./layout.tsx', import.meta.url)), 'utf8')
  it('is sr-only, opens on SITE_NAME, and is not the footer\'s tagline (Seobility 2026-11-23: one sentence twice in one page)', () => {
    expect(src).toContain('<h1 className="sr-only">{POSTING_IS_FREE')
    expect(src).toContain('<Bilingual en={`${SITE_NAME} — free classifieds in Vietnam: rentals, jobs and used goods for expats and locals`}')
    expect(src).toContain('vi={`${SITE_NAME} — rao vặt miễn phí tại Việt Nam: nhà cho thuê, việc làm và đồ cũ cho người nước ngoài và người Việt`}')
    expect(src).not.toContain('free classifieds for expats and locals in Vietnam.`')
  })
  it('has curated Vietnamese for both forms, as the footer prints them', () => {
    expect(VI_OVERRIDES['eno.vn — free classifieds for expats and locals in Vietnam.']).toBe('eno.vn — rao vặt miễn phí cho người nước ngoài và người Việt.')
    expect(VI_OVERRIDES['eno.vn — classifieds for expats and locals in Vietnam.']).toBe('eno.vn — rao vặt cho người nước ngoài và người Việt.')
  })
})
