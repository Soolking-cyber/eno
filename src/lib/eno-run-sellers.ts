/**
 * The SELLER IDS of the storefronts eno runs (src/lib/eno-run-partners.ts) — and nothing else. The partner strip is a client
 * component: it imports this, never the pinned pairs, so the eno-held logins' profile ids never ship in the browser bundle
 * (commit gate, opus 2026-11-14). eno-run-partners.test.ts holds the two lists together.
 */
export const ENO_RUN_SELLER_IDS: readonly string[] = ['cmt78nvif0000gpq48kvzmxjw', 'cmtr9qva90000glq44fkjs18b', 'cmwgyb5m10000rjq4xxjkwwaz', 'cmwgyb5sl0001rjq4yuj9b2sq']
