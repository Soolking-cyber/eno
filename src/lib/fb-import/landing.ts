/**
 * ⛔ THE FACEBOOK-IMPORT AD LANDING (owner 2026-11-17, "Ad landing page", after the measured funnel: the
 * eno_fb_marketplace_import_10d ads sent visitors to My listings › Import from Facebook — a signed-in tool that was blank for the
 * first 1–2 s and opened on a data notice; ~1% tapped through, ~0 signed up). The ad now points at FB_IMPORT_LANDING_PATH: what
 * eno is, in two lines, painted by the server, and the sign-in right there (Facebook first inside Facebook's browser). Signed in,
 * it goes on to the import itself (FB_IMPORT_PATH), whose notice is still read before Connect — or to /post when the import is off.
 * A Google / Facebook round trip comes back HERE (signInNextPath's plain rule), and the landing sends them on: one place decides.
 */
export const FB_IMPORT_LANDING_PATH = '/post/facebook'
export const FB_IMPORT_PATH = '/dashboard/listings?tab=facebook'
