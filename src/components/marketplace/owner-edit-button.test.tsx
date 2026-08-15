// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { OwnerEditButton } from './owner-edit-button'

/**
 * THE OWNERSHIP AFFORDANCE — pinned because the thing it gets wrong is invisible.
 *
 * ⛔ THIS IS NOT A SECURITY BOUNDARY AND THESE TESTS DO NOT PRETEND IT IS. `/listings/[id]/edit`
 * re-proves ownership server-side; hiding a control is not authorisation. What is pinned here is
 * that the control never CLAIMS ownership it cannot support — a pencil on a stranger's listing is a
 * lie about who owns it, and the person it lies to is the one viewer who cannot tell.
 *
 * ⚠️ THE CASE THAT SHIPPED BROKEN IS `renders nothing while identity is stale`. The first version
 * of auth-context kept `sellerId` in its own state and cleared it inside the identity effect, which
 * runs one commit AFTER the render that already has the new user — so for one frame a freshly
 * switched account read the PREVIOUS account's storefront id. codex caught it post-deploy. The
 * context now derives `sellerId` from a `{ userId, sellerId }` pair stamped at fetch time, so a
 * mismatch reads null during the very same render; this suite pins the consumer half of that.
 *
 * ⚠️ Explicit cleanup: this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach (same note as count-chip.test.tsx).
 */
afterEach(cleanup)

const MINE = 'seller_mine'
const THEIRS = 'seller_theirs'
const LABEL = /S(ử|u)a tin|Edit listing/

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, prefetch: vi.fn() }),
}))

// The auth answer is the whole input to this component, so it is the one thing the tests vary.
let auth: { sellerId: string | null; identityLoaded: boolean } = { sellerId: null, identityLoaded: false }
vi.mock('@/context/auth-context', () => ({
  useAuth: () => auth,
}))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ tr: (en: string, vi: string) => vi || en }),
}))

vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))

function mount(listingSellerId: string | null | undefined) {
  return render(<OwnerEditButton listingId="listing_1" sellerId={listingSellerId} compact dense />)
}

describe('OwnerEditButton — who sees it', () => {
  it('renders for the seller who owns the listing', () => {
    auth = { sellerId: MINE, identityLoaded: true }
    mount(MINE)
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeNull()
  })

  it('renders nothing for a signed-in seller looking at someone else’s listing', () => {
    auth = { sellerId: MINE, identityLoaded: true }
    mount(THEIRS)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
  })

  it('renders nothing for a guest', () => {
    // ⚠️ A GUEST IS `identityLoaded: false`, NOT TRUE — /api/me is never asked for a signed-out
    // visitor, so the flag never flips. An earlier version of this test used `true` here, which is
    // a state a guest cannot reach; a reviewer caught the fixture describing something real code
    // never produces. The assertion is unchanged, but the fixture now matches production.
    auth = { sellerId: null, identityLoaded: false }
    mount(THEIRS)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
  })

  it('renders nothing for a signed-in buyer with no storefront, even on a listing whose seller id is null', () => {
    // Both sides null must NOT read as "equal, therefore mine".
    auth = { sellerId: null, identityLoaded: true }
    mount(null)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
  })

  it('renders nothing while identity is still loading, even when the ids would match', () => {
    // ⚠️ The regression this pins: an owner-only control that pops in after hydration is movement
    // on the feed for a control almost nobody sees. Waiting costs the owner nothing.
    auth = { sellerId: MINE, identityLoaded: false }
    mount(MINE)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
  })

  it('renders nothing when the card payload predates sellerId on the wire', () => {
    // Stale ISR HTML / adopted client caches serialize cards without the field.
    auth = { sellerId: MINE, identityLoaded: true }
    mount(undefined)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
  })
})
