/**
 * THE GUIDE'S FACE FILES (owner, 2026-10-28: "find best free avatar from talking head lightweight one to become eno concierge
 * customize it to have eno shirt … and use it for eno.vn") — served from public/, drawn in the visitor's browser by
 * TalkingHead (src/components/concierge/talking-guide.ts). Nothing is billed per minute and no vendor sees the guide.
 *
 *   model     TalkingHead's own MPFB avatar (CC0 — every part a CC0 MakeHuman asset), its shirt recoloured to eno's blue
 *             with the "e" mark on the chest, textures 1024 px WebP, Meshopt geometry (TalkingHead decodes it):
 *             ~/eno-classroom-2026-10-25/concierge/avatar (make-shirt.mjs, optimize.mjs, the licence notes). A `.bin`
 *             name: Cloudflare caches .bin by extension and not .glb; three's loader reads the bytes, not the name.
 *   portrait  the same guide, still — the window's face before the model draws, and in its place where it cannot.
 *   worklet   HeadAudio's viseme detector (MIT, @met4citizen/headaudio dist/headworklet.min.mjs) and its model: the mouth
 *             follows the guide's AUDIO, in any language the voice speaks.
 *
 * ⛔ STAMPED (`?v=` = the first 8 hex of the file's sha256): next.config.ts STAMPABLE_STATIC serves these a year,
 * immutable; src/lib/asset-stamps.test.ts recomputes each stamp from the bytes — change a file, change its stamp.
 */
export const GUIDE_MODEL_URL = '/avatar/eno-guide-v1.bin?v=41bac85e'
export const GUIDE_PORTRAIT_URL = '/avatar/eno-guide-face-v1.webp?v=b6b49f71'
export const LIPS_WORKLET_URL = '/headaudio/headworklet-1.0.0.js?v=2c31bb9b'
export const LIPS_MODEL_URL = '/headaudio/model-en-mixed-1.0.0.bin?v=0358f689'

/** What the window draws: the model, and the still portrait. */
export type GuideFaceConfig = { model: string; portrait: string }
export const GUIDE_FACE: GuideFaceConfig = { model: GUIDE_MODEL_URL, portrait: GUIDE_PORTRAIT_URL }
