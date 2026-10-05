import 'server-only'
import ids from '@/data/gone-listing-ids.json'

/**
 * THE ROWS THE OWNER REMOVED FOR THE SECOND-HAND FOCUS — the only rows the gone page may serve.
 *
 * ⛔ WHY A JOURNAL AND NOT A RULE (commit gate, 2026-10-05, codex + opus). Nothing in the database records WHY a
 * row was hidden: a predicate over its state ("verified, hidden, an import shop's goods, a clean title") cannot
 * tell the 10-03 new-goods hide from a takedown after a counterfeit report, a brand's IP complaint or a merchant
 * asking to leave — and those must stay a 404 that names nothing. A date cutoff fails the same way for every
 * takedown before it. The journals are the record of the owner's decision, so they are the allow-list:
 *  · scripts/journals/new-goods-hide-20261003T040816Z.csv — 68,250 rows, "keep used, remove else" (2026-10-03);
 *  · ~/eno-ux2-work/tgs-new100-hidden.txt — 31 "[New 100%]" laptops (2026-10-05).
 * NOT included, on purpose: SuperSports (2026-10-02, "remove all supersports products from website" — nothing of
 * theirs may show), the warranty packages and the ad-banned hide. A later cleanup that should get the page adds
 * its journal's ids here deliberately; anything else hidden stays a 404.
 * Server-only (the 1.9 MB set never reaches a client bundle); the ids are public listing URLs anyway.
 * ⚠️ VERIFIABLE, NOT TRUSTED: the file is excluded from what the commit gate's reviewers READ (it is still in the
 * hash), so gone-listing-ids.test.ts pins its SHA-256. Regenerate — and compare — with:
 *   python3 -c "import json,re; ids=set(); [ids.add(l.split(',')[0]) for l in open('scripts/journals/new-goods-hide-20261003T040816Z.csv') if re.fullmatch(r'c[a-z0-9]{20,30}', l.split(',')[0].strip())]; [ids.add(l.strip()) for l in open('tgs-new100-hidden.txt') if re.fullmatch(r'c[a-z0-9]{20,30}', l.strip())]; print(len(ids))"
 */
const GONE_IDS: ReadonlySet<string> = new Set(ids as string[])

export function isJournaledGone(id: string): boolean {
  return GONE_IDS.has(id)
}
