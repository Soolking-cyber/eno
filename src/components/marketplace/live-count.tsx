import { cache, type ReactNode } from 'react'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { liveCountFacts, liveCountWhere, type LiveCountFacts, type LiveCountTarget } from './live-count-facts'

/**
 * LIVE LISTING COUNTS FOR PROSE — a server component a guide drops into a sentence.
 *
 * ⛔ WHY A RENDER PROP AND NOT A NUMBER COMPONENT. A count is never alone in a sentence: "there are
 * 25,502 rental listings, every one of them in Ho Chi Minh City" carries a SECOND claim that is only
 * true while it is true, and the sentence around a count has to survive the count being unavailable
 * (database unreachable at build, which is when an ISR page is first rendered). So the page writes the
 * whole sentence twice — the live version and a neutral one — and this component picks. A `<Count/>`
 * that printed a bare number would leave "There are  rental listings" on the page on a bad build.
 *
 * ⚠️ ONLY ON PAGES THAT REVALIDATE. A page without `revalidate` renders this once, at build, and the
 * number is then exactly as stale as the literal it replaced. Every page using it today sets 3600.
 *
 * ⚠️ `cache()` DEDUPES PER REQUEST, KEYED ON PRIMITIVES — which is why the arguments below are spread
 * into strings rather than passed as the target object (a fresh object literal per call site would
 * never hit). Two sentences on one page asking for the rentals count make one query.
 */
const countLive = cache(async (categorySlug: string, condition: string, subcategories: string, province: string): Promise<number | null> => {
  // `subcategories` travels comma-joined for the same reason (a primitive key); '' is "no narrowing".
  const target = (categorySlug
    ? { categorySlug, condition: condition || undefined, subcategoryIn: subcategories ? subcategories.split(',') : undefined }
    : {}) as LiveCountTarget
  try {
    return await db.listing.count({ where: await scopedListingWhere(liveCountWhere(target, province || undefined)) })
  } catch {
    // Unreachable database (build time) or a transient error: "could not count", never "zero".
    return null
  }
})

async function factsFor(target: LiveCountTarget, lang: 'en' | 'vi'): Promise<LiveCountFacts | null> {
  const cat = target.categorySlug ?? ''
  const cond = target.condition ?? ''
  const subs = target.subcategoryIn?.join(',') ?? ''
  const total = await countLive(cat, cond, subs, '')
  // The province question is only worth a query when there is a total to compare it with.
  const inside = target.allIn && total ? await countLive(cat, cond, subs, target.allIn) : null
  return liveCountFacts(total, inside, lang)
}

/**
 * Count several targets at once and hand the page what it may say about each (`null` = use the
 * neutral wording). `lang` is the language of the PROSE, which on these guides is fixed per article,
 * not the visitor's UI language.
 */
export async function LiveCounts<K extends string>({
  targets,
  lang,
  children,
}: {
  targets: Record<K, LiveCountTarget>
  lang: 'en' | 'vi'
  children: (live: Record<K, LiveCountFacts | null>) => ReactNode
}) {
  const keys = Object.keys(targets) as K[]
  const facts = await Promise.all(keys.map((k) => factsFor(targets[k], lang)))
  const live = Object.fromEntries(keys.map((k, i) => [k, facts[i]])) as Record<K, LiveCountFacts | null>
  return <>{children(live)}</>
}
