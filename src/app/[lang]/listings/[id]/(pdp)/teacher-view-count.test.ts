import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * SOURCE-LEVEL guard on the teacher branch of the PDP (like ios-hide-visa.test.ts — the page is ISR with a database
 * behind it, so the file is asserted). The branch returned before <TrackView> rendered, so every teacher profile read
 * 0 views (111 of 111, measured 2026-10-19). It now mounts the view COUNTER alone; the counter itself is tested in
 * src/components/marketplace/track-view.count.test.tsx.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
const START = PAGE.indexOf('if (rawListing.listingType === TEACHER_LISTING_TYPE) {')
const BRANCH = START < 0 ? '' : PAGE.slice(START, PAGE.indexOf('\n  }\n', START))
/** The branch's code without its comments — the JSX comment beside the counter names <TrackView> to say why not. */
const CODE = BRANCH.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

describe('PDP × teacher view counter', () => {
  it('the teacher branch returns the profile', () => {
    expect(START).toBeGreaterThan(-1)
    expect(BRANCH).toContain('<TeacherProfileView')
  })

  it('mounts the counter-only tracker beside it, keyed on the listing id', () => {
    expect(BRANCH).toContain('<TrackViewCount id={listing.id} />')
    expect(PAGE).toContain("import { TrackView, TrackViewCount } from '@/components/marketplace/track-view'")
  })

  it("⛔ never <TrackView> on a teacher — its GA4/Meta item would carry the teacher's name", () => {
    expect(CODE).toContain('<TrackViewCount id={listing.id} />')
    expect(CODE).not.toMatch(/<TrackView[\s/>]/)
  })
})
