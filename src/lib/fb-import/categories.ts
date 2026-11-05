import { isPostableCategory, TAXONOMY } from '@/lib/taxonomy'

/** What Import offers: every shelf a person can post to except Jobs, whose forms and rules Marketplace listings don't answer. Client-safe. */
export const IMPORT_CATEGORY_SLUGS: readonly string[] = TAXONOMY.filter((c) => isPostableCategory(c.slug) && c.slug !== 'jobs').map((c) => c.slug)
