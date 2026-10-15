import { describe, expect, it } from 'vitest'
import { storefrontAvatarUrl } from './storefront-avatar'

const SHOP = 'https://sb.eno.vn/storage/v1/object/public/avatars/shop.webp'
const FACE = 'https://lh3.googleusercontent.com/a/face'

// Owner, 2026-10-15: a person's storefront showed initials while their messages showed their photo.
describe('storefrontAvatarUrl', () => {
  it("a person's storefront with no picture of its own shows its owner's profile photo", () => {
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: { avatarUrl: FACE, accountType: 'individual' } })).toBe(FACE)
  })

  it("the storefront's own picture always wins", () => {
    expect(storefrontAvatarUrl({ avatarUrl: SHOP, owner: { avatarUrl: FACE, accountType: 'individual' } })).toBe(SHOP)
    expect(storefrontAvatarUrl({ avatarUrl: SHOP, owner: { avatarUrl: FACE, accountType: 'business' } })).toBe(SHOP)
  })

  it('⛔ fails closed: only a confirmed person lends their face — never a business, an untyped account or an unread type', () => {
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: { avatarUrl: FACE, accountType: 'business' } })).toBeNull()
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: { avatarUrl: FACE, accountType: null } })).toBeNull()
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: { avatarUrl: FACE } })).toBeNull()
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: { avatarUrl: FACE, accountType: 'Individual' } })).toBeNull()
  })

  it('nothing to show: no owner, an owner with no photo, or a query that did not read the photo', () => {
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: null })).toBeNull()
    expect(storefrontAvatarUrl({ avatarUrl: null })).toBeNull()
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: { avatarUrl: null, accountType: 'individual' } })).toBeNull()
    expect(storefrontAvatarUrl({ avatarUrl: null, owner: { accountType: 'individual' } })).toBeNull()
  })
})
