import { LANG_VARIANTS } from '@/lib/lang-variant'

/**
 * THE POST FLOW'S OWN PAGES — /post and /listings/<id>/edit, where the PostWizard is the page.
 *
 * A test that agrees on both sides of the proxy's rewrite: the server may render the internal
 * `/en/post`, the browser reads the public `/post`, and the optional variant prefix makes both answer
 * the same. So chrome can decide at RENDER time with no hydration gate and no layout jump.
 *
 * Who asks (keep this list true):
 *   · header.tsx — the orange Post button stands down (a second "Free Post" over the form reads as a restart);
 *   · footer.tsx — the footer stands down (O-30 W-CHROME: nothing below a form that ends in a Publish bar);
 *   · back-to-top.tsx — the support FAB stands down (O-30: it sat over the wizard's sticky Publish bar).
 * The tab bar STAYS on these pages (owner, O-30).
 *
 * ⚠️ Lives in lib, not in header.tsx, so the footer and the floating cluster can ask without importing
 * the whole header module into their chunks. header.tsx re-exports it for its existing callers.
 */
const POST_FLOW = new RegExp(`^(?:/(?:${LANG_VARIANTS.join('|')}))?/(?:post|listings/[^/]+/edit)/?$`)

export const isPostFlowPath = (pathname: string | null | undefined) => !!pathname && POST_FLOW.test(pathname)
