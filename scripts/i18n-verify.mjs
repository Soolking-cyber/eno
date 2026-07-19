// Translate+verify EVERY UI string the app renders for a target language:
// pre-warms the cache (instant, no English leak) and flags any string that comes
// back identical to the source (potential gap). The harvest itself is owned by
// scripts/gen-ui-strings.mjs (which also covers taxonomy.ts display strings) —
// this script reads its generated output instead of re-harvesting inline, so the
// two can never drift.
//
// Usage: node scripts/i18n-verify.mjs <lang>   (needs the dev server running)
//   e.g. node scripts/i18n-verify.mjs zh-Hans

import { readFileSync } from 'fs'

const lang = process.argv[2]
if (!lang) { console.error('Usage: node scripts/i18n-verify.mjs <lang>'); process.exit(1) }
const BASE = process.env.BASE_URL || 'http://localhost:3000'

// ui-strings.ts is a TS module — extract the JSON array literal (after the `=`,
// NOT the first `[`: that's the `string[]` type annotation). Same technique as
// scripts/prewarm-translations.mjs.
const tsSrc = readFileSync('src/generated/ui-strings.ts', 'utf8')
const eq = tsSrc.indexOf('= [')
const STRINGS = JSON.parse(tsSrc.slice(eq + 2, tsSrc.lastIndexOf(']') + 1))

const list = STRINGS.filter((s) => /[a-zA-Z]/.test(s))
console.log(`Loaded ${list.length} UI strings from src/generated/ui-strings.ts.`)

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
let i = 0
for (const part of chunk(list, 60)) {
  const res = await fetch(`${BASE}/api/translate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: part, target: lang }),
  })
  if (!res.ok) { console.error('translate HTTP', res.status, await res.text().catch(() => '')); process.exit(1) }
  const { translations } = await res.json()
  part.forEach((src, k) => results.push({ src, out: translations?.[k] ?? src }))
  i += part.length
  process.stdout.write(`\r  translated ${i}/${list.length}`)
  await sleep(12000)
}
console.log('')

const identical = results.filter((r) => r.out === r.src && r.src.length > 2)
console.log(`\n✓ ${results.length - identical.length}/${results.length} translated to ${lang}`)
if (identical.length) {
  console.log(`\n⚠️ ${identical.length} returned identical to source (review — some may legitimately match):`)
  identical.slice(0, 40).forEach((r) => console.log('   • ' + JSON.stringify(r.src)))
} else {
  console.log('All strings have a distinct translation. 🎉')
}
console.log('\nSample translations:')
results.filter((r) => r.out !== r.src).slice(0, 12).forEach((r) => console.log(`   ${JSON.stringify(r.src)} → ${r.out}`))
