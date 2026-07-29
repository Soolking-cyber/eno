import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * SOURCE-LEVEL guard on "contacting a visa product starts the application".
 *
 * The behaviour needs a database and a seeded visa storefront to exercise end to end, but what
 * actually breaks here is a MISSING BRANCH, not a wrong value — so the file is asserted, the same
 * idiom as sync-pairs.test.ts and the trip concierge's desk-gate test.
 */

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('⚠️ POST /api/conversations must start a visa case, never a chat', () => {
  const route = read('src/app/api/conversations/route.ts')

  it('branches on isVisaShopListing before creating an ordinary conversation', () => {
    // Why here and not in the cards: listing-card.tsx, compact-listing-row.tsx and
    // listings-video-feed.tsx all stash a quick-compose and push to /messages/pending, which POSTs
    // this route. Only the PDP rendered <VisaStart>, so every OTHER Message button opened a blank
    // thread with "Hi! Is this still available?" in it and no wizard ever started.
    expect(route).toContain('isVisaShopListing')
    expect(route).toContain('startVisaDmFlow')
  })

  it('⚠️ runs enforcement BEFORE the visa branch — suspended accounts must not bypass it', () => {
    // The first cut put the visa branch above conversationGate, making a visa listing the one door
    // into a thread that skipped suspension and probation. Both reviewers found it independently.
    const gateAt = route.indexOf('await conversationGate(')
    const visaAt = route.indexOf('isVisaShopListing(listing.id)')
    expect(gateAt).toBeGreaterThan(-1)
    expect(visaAt).toBeGreaterThan(gateAt)
  })

  it('⚠️ treats an UNCERTAIN classification as retryable, never as "not visa"', () => {
    // isVisaShopListing swallows its own errors and returns [], so a blip would open the exact
    // blank chat this branch exists to prevent — permanently. The listing's own subcategory is the
    // local second opinion that turns "could not tell" into a 503 instead of a wrong answer.
    expect(route).toContain('VISA_SUBCATEGORY_SLUG')
    expect(route).toMatch(/!isVisaProduct && mightBeVisa/)
    expect(route).toMatch(/shop_unavailable'\s*\},\s*\{\s*status:\s*503/)
    // ⚠️ AND the null case, which the first guard missed: getVisaShopListings is EXCLUDE-shaped, so
    // a desk row with no subcategory counts as visa there and must count as "might be" here too.
    // Asserted separately because dropping just this clause would silently reopen the hole.
    expect(route).toMatch(/subcategorySlug === VISA_SUBCATEGORY_SLUG \|\| listing\.subcategorySlug === null/)
    // ⚠️ AND scoped to the desk seller. `visa-legal` is a PUBLIC subcategory, so an unscoped slug
    // test would permanently 503 the Message button of any agency posting under it.
    expect(route).toMatch(/listing\.sellerId === visaDesk\.id/)
  })

  it('runs the visa branch BEFORE the ordinary conversation is created', () => {
    const visaAt = route.indexOf('isVisaShopListing(listing.id)')
    const createAt = route.indexOf('db.conversation.create')
    expect(visaAt).toBeGreaterThan(-1)
    // A visa branch placed after the create would make a throwaway thread on every tap.
    if (createAt > -1) expect(visaAt).toBeLessThan(createAt)
  })

  it('charges the SAME visa-create quota as the other entry points', () => {
    // Otherwise this route becomes a way around the 5-a-day cap on minting government forms.
    // ⚠️ Delimited by a marker that really FOLLOWS the branch. Two earlier delimiters were wrong:
    // `'conversationGate'` matched the import on line 8, and `'await conversationGate('` moved
    // ABOVE the branch when enforcement was reordered — both yield an empty slice that asserts
    // nothing while looking green.
    const branch = route.slice(route.indexOf('isVisaShopListing(listing.id)'), route.indexOf('// Create the conversation, letting'))
    expect(branch).toContain("rateLimit('visa-create'")
    expect(branch).toContain('strict: true')
  })

  it('returns `id`, so every existing caller keeps working', () => {
    // /messages/pending reads `id` and routes to /messages/<id>; a differently-named field would
    // send the applicant to /messages/undefined.
    // ⚠️ Delimited by a marker that really FOLLOWS the branch. Two earlier delimiters were wrong:
    // `'conversationGate'` matched the import on line 8, and `'await conversationGate('` moved
    // ABOVE the branch when enforcement was reordered — both yield an empty slice that asserts
    // nothing while looking green.
    const branch = route.slice(route.indexOf('isVisaShopListing(listing.id)'), route.indexOf('// Create the conversation, letting'))
    expect(branch).toMatch(/id:\s*started\.conversationId/)
  })
})

describe('⚠️ the visa upload picker must offer the camera on iOS', () => {
  it('accepts image/* rather than an explicit MIME list only', () => {
    // A WKWebView narrows the picker to the accept list: with explicit MIME types alone the "Take
    // Photo" option disappears, which is the primary action when the passport is in your hand.
    // Never `capture`, which would remove the library for someone whose scan is already saved.
    const cards = read('src/components/marketplace/visa-cards.tsx')
    const accept = cards.match(/accept="([^"]*)"/)?.[1] ?? ''
    expect(accept).toContain('image/*')
    // ⚠️ ATTRIBUTE POSITION ONLY — a bare /capture=/ matched the comment directly above the input,
    // which WARNS against `capture="camera"`. Second time this session a source-level test failed
    // on its own documentation; anchoring to the line start is what distinguishes an attribute
    // from prose about one.
    expect(cards).not.toMatch(/^\s*capture=["']camera["']/m)
  })
})
