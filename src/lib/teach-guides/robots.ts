import type { Metadata } from 'next'

/**
 * THE ROBOTS META OF THE TEACH-IN-VIETNAM HUB AND EVERY LIVE GUIDE: `<meta name="robots" content="max-image-preview:large">`
 * (teacher visibility plan §3a item 16).
 *
 * Google Discover shows a large image only for a page that allows one — this directive, or AMP — and these pages carried
 * no robots meta at all, so Google could show at most its default, smaller image preview (developers.google.com/search/
 * docs/appearance/google-discover; the rule itself: …/crawling-indexing/robots-meta-tag). Discover also wants an image at
 * least 1200 px wide: the per-guide share cards are the other half of item 16, not this file.
 * ⚠️ THE ONE DIRECTIVE, NO `index` OR `follow`: both are the default when unstated, so the pages stay exactly as
 * indexable and followed as they were with no tag. A guide that is not live, and the hub before its first guide, keep
 * their own `{ index: false }` (their 404s) and never use this. hub-page.test.tsx and [slug]/page.test.ts pin both.
 */
export const TEACH_ROBOTS = { 'max-image-preview': 'large' } as const satisfies Metadata['robots']
