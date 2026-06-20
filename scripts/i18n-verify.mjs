// Harvest EVERY UI string the app renders, then translate+verify them for a
// target language: pre-warms the cache (instant, no English leak) and flags any
// string that comes back identical to the source (potential gap).
//
// Usage: node scripts/i18n-verify.mjs <lang>   (needs the dev server running)
//   e.g. node scripts/i18n-verify.mjs zh-Hans

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const lang = process.argv[2]
if (!lang) { console.error('Usage: node scripts/i18n-verify.mjs <lang>'); process.exit(1) }
const BASE = process.env.BASE_URL || 'http://localhost:3000'

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (/\.(tsx|ts)$/.test(e)) out.push(p)
  }
  return out
}

const strings = new Set()
const add = (s) => { if (s && s.trim() && s.length <= 400) strings.add(s.trim()) }
const unesc = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')

for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8')
  if (file.endsWith('language-context.tsx')) {
    const enBlock = src.split('const EN:')[1]?.split('const VI:')[0] || ''
    for (const m of enBlock.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  }
  for (const m of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) { add(unesc(m[1])); add(unesc(m[2])) }
  for (const m of src.matchAll(/<Tr\s+text=\{?\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/<Tr\s+text="((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]))
}
for (const u of ['month', 'month (est.)', 'hour', 'visit (from)', 'service (from)', 'day', 'year', 'week']) add(u)

const list = [...strings].filter((s) => /[a-zA-Z]/.test(s))
console.log(`Harvested ${list.length} unique UI strings.`)

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
