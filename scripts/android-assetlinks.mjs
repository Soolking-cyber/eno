#!/usr/bin/env node
/**
 * REWRITES public/.well-known/assetlinks.json FROM THE FINGERPRINTS THAT ACTUALLY SIGN THE APP.
 *
 * ⛔ THE FILE ON PRODUCTION TODAY CARRIES A *DEBUG* KEYSTORE FINGERPRINT — measured 2026-09-06, it
 * is byte-identical to `~/.android/debug.keystore` on the machine the app was developed on. Two
 * consequences, and the second is the one that bites on release day:
 *   1. It authorises any build signed with that developer debug key to claim eno.vn links. Debug
 *      keystores are not secret and are shared across every project on a machine.
 *   2. A build distributed through Play is signed by GOOGLE's app signing key, whose fingerprint is
 *      not this one — so App Links verification FAILS and every shared eno.vn/listings/… link keeps
 *      opening in the browser. Nothing errors; the feature is simply, quietly absent.
 *
 * ⚠️ THE FINGERPRINT YOU NEED IS THE **APP SIGNING** CERTIFICATE, NOT THE UPLOAD KEY. Play Console →
 * Test and release → Setup → App integrity → App signing key certificate → SHA-256. The upload key
 * is a different certificate; adding it too is optional and only helps locally-built release APKs
 * verify during testing.
 *
 * Usage (one or more fingerprints, colon-separated hex, order does not matter):
 *   node scripts/android-assetlinks.mjs AB:CD:… [UPLOAD_KEY_SHA256]
 *   node scripts/android-assetlinks.mjs --check          # print what is live and flag a debug key
 *
 * One file serves BOTH editions: eno.vn and eno.forum are the same root built twice, so they share
 * `public/`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'public/.well-known/assetlinks.json')
const PACKAGE = 'vn.eno.app'
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

/** This machine's debug fingerprint, so `--check` can name the exact problem rather than guess. */
function debugFingerprint() {
  try {
    const out = execFileSync('keytool', [
      '-list', '-v', '-keystore', join(process.env.HOME || '', '.android/debug.keystore'),
      '-storepass', 'android', '-keypass', 'android',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.match(/SHA256:\s*([0-9A-F:]+)/)?.[1] ?? null
  } catch {
    return null
  }
}

const args = process.argv.slice(2)

if (args[0] === '--check' || args.length === 0) {
  const current = JSON.parse(readFileSync(FILE, 'utf8'))
  const live = current[0]?.target?.sha256_cert_fingerprints ?? []
  const dbg = debugFingerprint()
  console.log(`package: ${current[0]?.target?.package_name}`)
  for (const f of live) {
    const isDebug = dbg && f.toUpperCase() === dbg.toUpperCase()
    console.log(`  ${f}${isDebug ? '   ⛔ THIS MACHINE\'S DEBUG KEY — replace before release' : ''}`)
  }
  if (args.length === 0) {
    console.log('\nTo set the real ones: node scripts/android-assetlinks.mjs <APP_SIGNING_SHA256> [UPLOAD_SHA256]')
    process.exit(1)
  }
  process.exit(0)
}

const fingerprints = args.map((a) => a.trim().toUpperCase())
for (const f of fingerprints) {
  if (!SHA256.test(f)) {
    console.error(`not a SHA-256 certificate fingerprint: "${f}"\nExpected 32 colon-separated hex bytes, as Play Console prints them.`)
    process.exit(1)
  }
}
const dbg = debugFingerprint()
if (dbg && fingerprints.some((f) => f === dbg.toUpperCase())) {
  console.error('refusing: that is this machine\'s DEBUG keystore fingerprint, not an app signing key.')
  process.exit(1)
}
// De-duped, because a repeated fingerprint is silently accepted by Google and reads as two keys.
const unique = [...new Set(fingerprints)]

writeFileSync(FILE, JSON.stringify([
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: unique },
  },
], null, 2) + '\n')
console.log(`wrote ${unique.length} fingerprint(s) to public/.well-known/assetlinks.json`)
console.log('⚠️ It reaches users only after a DEPLOY. Verify with:')
console.log('   curl -s https://eno.vn/.well-known/assetlinks.json')
console.log('   adb shell pm verify-app-links --re-verify vn.eno.app   # then: adb shell pm get-app-links vn.eno.app')
