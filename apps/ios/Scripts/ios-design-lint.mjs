#!/usr/bin/env node
// eno.vn iOS design-lint — the enforcement half of docs/ios-design-language.md.
// Fails the build when a feature screen hand-rolls a control instead of using EnoUI.
// SHRINKING BASELINE: existing debt is recorded in ios-design-lint-baseline.json keyed by
// `rule|file|normalized-source` (never line numbers). Only NEW violations fail. Delete a
// file's baseline entries as you migrate it; when the baseline hits zero, delete the file
// and this lint becomes zero-tolerance.
//
//   node apps/ios/Scripts/ios-design-lint.mjs                 # check (exit 1 on new debt)
//   node apps/ios/Scripts/ios-design-lint.mjs --update-baseline
//   node apps/ios/Scripts/ios-design-lint.mjs --stats         # print debt per rule
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(HERE, '..')                       // apps/ios
const SCAN_DIR = join(APP_ROOT, 'Eno')                  // feature + app code only
const BASELINE = join(HERE, 'ios-design-lint-baseline.json')

// Outside Packages/EnoUI/Sources, these are violations. Native specialized controls
// (PhotosPicker, ShareLink, Menu, NavigationLink, Map) are NOT banned — they are native
// primitives, not hand-rolls.
const RULES = [
  ['raw-font', /\.font\(\.system\(/, 'raw font size → use .enoText(role) / EnoText'],
  ['scaled-font', /\.scaledFont\(/, 'scaledFont removed → use .enoText(role)'],
  ['plain-button-style', /\.buttonStyle\(\.plain\)/, 'EnoButton/EnoIconButton own their style'],
  ['numeric-radius', /cornerRadius:\s*\d/, 'numeric radius → EnoRadius.{card,control,chip}'],
  ['raw-shadow', /\.shadow\(/, 'raw shadow → .enoElevation(level)'],
  ['raw-color', /Color\(red:/, 'raw RGB color → EnoColor.*'],
  ['raw-button', /\bButton\s*(\{|\(action)/, 'hand-rolled Button → EnoButton / EnoIconButton'],
  ['raw-textfield', /\b(TextField|SecureField|TextEditor)\(/, 'raw text input → EnoField / EnoTextArea'],
  ['raw-toggle', /\bToggle\(/, 'raw Toggle → EnoToggle (or a wrapped native toggle)'],
  ['styled-picker', /\.pickerStyle\(\.segmented/, 'segmented Picker → EnoSegmentedControl'],
]

function swiftFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...swiftFiles(p))
    else if (name.endsWith('.swift')) out.push(p)
  }
  return out
}

// Drop a trailing line comment so `// ... Button ...` prose doesn't trip a rule.
const stripComment = (line) => {
  const i = line.indexOf('//')
  return i >= 0 ? line.slice(0, i) : line
}

function scan() {
  const found = new Map() // key -> {rule, file, source}
  if (!existsSync(SCAN_DIR)) return found
  for (const file of swiftFiles(SCAN_DIR)) {
    const rel = relative(APP_ROOT, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const raw of lines) {
      const line = stripComment(raw)
      for (const [rule, re, msg] of RULES) {
        if (re.test(line)) {
          const source = line.trim()
          found.set(`${rule}|${rel}|${source}`, { rule, file: rel, source, msg })
        }
      }
    }
  }
  return found
}

const loadBaseline = () => (existsSync(BASELINE) ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).keys) : new Set())

const arg = process.argv[2]
const found = scan()

if (arg === '--update-baseline') {
  writeFileSync(BASELINE, JSON.stringify({ generatedFrom: 'apps/ios/Eno', count: found.size, keys: [...found.keys()].sort() }, null, 2) + '\n')
  console.log(`✓ baseline written: ${found.size} recorded violations (debt to migrate)`)
  process.exit(0)
}

if (arg === '--stats') {
  const byRule = {}
  for (const { rule } of found.values()) byRule[rule] = (byRule[rule] || 0) + 1
  console.log(`iOS design debt (${found.size} total):`)
  for (const [r, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`)
  process.exit(0)
}

const baseline = loadBaseline()
const fresh = [...found.values()].filter((v) => !baseline.has(`${v.rule}|${v.file}|${v.source}`))

if (fresh.length) {
  console.error(`✗ ${fresh.length} NEW design-lint violation(s) (not in baseline):\n`)
  for (const v of fresh.slice(0, 40)) console.error(`  [${v.rule}] ${v.file}\n     ${v.source}\n     → ${v.msg}`)
  if (fresh.length > 40) console.error(`  …and ${fresh.length - 40} more`)
  console.error(`\nUse an EnoUI primitive. To re-snapshot after a legit migration: --update-baseline.`)
  process.exit(1)
}
console.log(`✓ iOS design-lint clean (0 new; ${baseline.size} baselined debt remaining to migrate)`)
