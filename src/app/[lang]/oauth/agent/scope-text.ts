/** Every scope an agent can be granted, in words. The page lists the GRANTED set (DEFAULT_SIGN_IN_SCOPES); a scope added
 *  there without words here fails agent-auth.test.ts (commit gate, opus: never under-disclose a write-capable grant). */
export const SCOPE_TEXT: Record<string, { en: string; vi: string }> = {
  'listings:read': { en: 'See your shop and its listings', vi: 'Xem cửa hàng và các tin đăng của bạn' },
  'listings:write': { en: 'Post, edit, mark sold and remove your listings, and edit your shop profile', vi: 'Đăng, sửa, đánh dấu đã bán và gỡ tin đăng, và sửa hồ sơ cửa hàng của bạn' },
  'analytics:read': { en: 'See the views and leads on your listings', vi: 'Xem lượt xem và lượt liên hệ trên tin đăng của bạn' },
}
