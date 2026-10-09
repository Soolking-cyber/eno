import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * infra/vn-node/eno-deploy.sh probe() — the language probes that decide whether a deploy stays or rolls
 * back, driven against a fake `curl` that models the site through Cloudflare (SEO wave B, V5: the `/vi`
 * pilot). The point is both directions: a deploy of the pilot passes only when eno.vn's `/` is English
 * for a Vietnamese browser AND `/vi` is Vietnamese for an English one; a rollback to pre-pilot images
 * passes as what it is (pilot off) instead of being reported as a failed restore, while a half-switched
 * site fails either way.
 */
const ROOT = join(__dirname, '..', '..')
const DEPLOY = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
const PROBE = DEPLOY.match(/^probe\(\)\{[\s\S]*?^\}$/m)?.[0]
const PILOT_EXPECT = DEPLOY.match(/^PILOT_EXPECT=(\w+)$/m)?.[1]

type Site = {
  pilot: 'on' | 'off'
  /** `/` still adapts although `/vi` is up (the app pinned nothing, or a stale edge entry). */
  unpinned?: boolean
  /** `/vi` follows the cookie instead of the path. */
  viFollowsCookie?: boolean
  /** a `/vi` path outside the pilot answers 200 */
  strayVi?: boolean
  /** only `/` is piloted: /c/furniture-appliances negotiates and its /vi twin 404s */
  furnitureOff?: boolean
  /** the edge Worker pins `/` and `/c/furniture-appliances` to the `en` key (V5's Worker), with a cache */
  workerPinned?: boolean
  /** the forum apex: 308 to `www` (next.config.ts — the default), or 'none' (images from before it: the apex answers
   *  itself), or — the failures — 308 across to eno.vn, or a temporary 302 to www */
  forumApex?: 'www' | 'none' | 'eno.vn' | 'temporary'
}

/**
 * The fake curl, in bash (a node one costs ~0.2 s a call, and probe() makes ~30): the site as the probes
 * see it through the edge. SITE_* switches select the state.
 * Written with `@{` for bash's `${`, so the template literal does not interpolate it.
 */
const FAKE_CURL = String.raw`#!/usr/bin/env bash
url= fmt= quiet=0 al= ck=
while [ $# -gt 0 ]; do
  case "$1" in
    -w) fmt=$2; shift ;;
    -o) [ "$2" = /dev/null ] && quiet=1; shift ;;
    -H) case "$2" in [Aa]ccept-[Ll]anguage:*) al=@{2#*: } ;; [Cc]ookie:*) ck=@{2#*: } ;; esac; shift ;;
    --max-time) shift ;;
    https://*) url=$1 ;;
  esac
  shift
done
rest=@{url#https://}; host=@{rest%%/*}; path=/@{rest#*/}; [ "$rest" = "$host" ] && path=/
q=; case "$path" in *\?*) q="?@{path#*\?}"; path=@{path%%\?*} ;; esac
cookie=; case "; $ck" in *"; lang="*) cookie=@{ck##*lang=}; cookie=@{cookie%%;*} ;; esac
if [ "$cookie" = en ] || [ "$cookie" = vi ]; then neg=$cookie
else case "$al" in [Vv][Ii]*) neg=vi ;; *) neg=en ;; esac; fi
forum=0; case "$host" in *eno.forum) forum=1 ;; esac
code=200 loc= lang=$neg
if [ "$host" = www.eno.vn ]; then code=308; loc="https://eno.vn$path$q"
elif [ "$host" = eno.forum ] && [ "@{SITE_FORUM_APEX:-www}" != none ] && [ "@{path#/api/}" = "$path" ]; then
  code=308; case "$SITE_FORUM_APEX" in www) loc="https://www.eno.forum$path$q" ;; temporary) code=302; loc="https://www.eno.forum$path$q" ;; *) loc="https://eno.vn$path$q" ;; esac
elif [ "$path" = /visa ] || { [ $forum = 0 ] && [ "$path" = /itinerary ]; }; then code=404
elif [ "$path" = /vi ] || [ "@{path#/vi/}" != "$path" ]; then
  if [ $forum = 0 ] && [ "$SITE_PILOT" = on ] && { [ "$path" = /vi ] || { [ "$path" = /vi/c/furniture-appliances ] && [ -z "@{SITE_FURNITURE_OFF:-}" ]; }; }; then
    if [ -n "@{SITE_VI_FOLLOWS_COOKIE:-}" ]; then lang=$neg; else lang=vi; fi
  elif [ -n "@{SITE_STRAY_VI:-}" ] && [ $forum = 0 ]; then lang=vi
  else code=404; fi
elif [ $forum = 0 ] && [ "$SITE_PILOT" = on ] && [ -z "@{SITE_UNPINNED:-}" ] && { [ "$path" = / ] || { [ "$path" = /c/furniture-appliances ] && [ -z "@{SITE_FURNITURE_OFF:-}" ]; }; }; then lang=en
fi
# The Worker in front of a pinned plain path: key en for everyone; a stored entry is served as a HIT;
# a MISS is stored only when the origin answered en (storable()). Cache-busted requests never share it.
if [ -n "@{SITE_WORKER_PINNED:-}" ] && [ $forum = 0 ] && [ "$host" = eno.vn ] && [ -z "$q" ] && [ $code = 200 ] \
   && { [ "$path" = / ] || [ "$path" = /c/furniture-appliances ]; }; then
  entry="$SITE_STATE/en$(printf '%s' "$path" | tr / _)"
  if [ -f "$entry" ]; then lang=$(cat "$entry"); elif [ "$lang" = en ]; then printf en > "$entry"; fi
fi
if [ $quiet = 0 ]; then
  if [ $code = 200 ]; then printf '<!doctype html><html lang="%s"><body>x</body></html>' "$lang"
  elif [ $code = 404 ]; then printf '<html lang="en">404</html>'; fi
fi
if [ -n "$fmt" ]; then fmt=@{fmt//'%{http_code}'/$code}; printf '%s' "@{fmt//'%{redirect_url}'/$loc}"; fi
`.replaceAll('@{', '${')

const tmp: string[] = []
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }) })

function runProbe(site: Site, mode: 'deploy' | 'rollback') {
  const d = mkdtempSync(join(tmpdir(), 'eno-probe-'))
  tmp.push(d)
  writeFileSync(join(d, 'curl'), FAKE_CURL)
  chmodSync(join(d, 'curl'), 0o755)
  writeFileSync(join(d, 'fn.sh'), `PILOT_EXPECT=${PILOT_EXPECT}\n${PROBE}\n`)
  const r = spawnSync('bash', ['-c', `set -uo pipefail; source "${d}/fn.sh"; probe ${mode === 'rollback' ? 'rollback' : ''}; echo "rc=$?"`], {
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: `${d}:${process.env.PATH}`,
      SITE_PILOT: site.pilot,
      SITE_UNPINNED: site.unpinned ? '1' : '',
      SITE_VI_FOLLOWS_COOKIE: site.viFollowsCookie ? '1' : '',
      SITE_STRAY_VI: site.strayVi ? '1' : '',
      SITE_FURNITURE_OFF: site.furnitureOff ? '1' : '',
      SITE_WORKER_PINNED: site.workerPinned ? '1' : '',
      SITE_FORUM_APEX: site.forumApex ?? 'www',
      SITE_STATE: d,
    },
  })
  return { out: r.stdout + r.stderr, rc: /rc=(\d+)/.exec(r.stdout)?.[1] }
}

// Each case runs probe() up to five times (~30 fake-curl calls apiece): 0.3–3 s alone, but a full
// parallel run pushed two cases past vitest's 5 s default (5.1 s, 5.5 s) and CI runs plain
// `npx vitest run`. 20 s is ~4x the worst measured. A HANG is bounded by spawnSync's own `timeout`
// in runProbe (a synchronous child blocks vitest's timer): the killed probe prints no `rc=`, so it fails.
describe('eno-deploy.sh probe() — the /vi pilot (V5)', { timeout: 20_000 }, () => {
  it('ships the pilot on, and restore() probes the restored images in rollback mode', () => {
    expect(PROBE).toBeTruthy()
    expect(PILOT_EXPECT).toBe('on')
    expect(DEPLOY).toMatch(/if probe rollback; then/)
    expect(DEPLOY).toMatch(/if ! probe; then restore; exit 1; fi/)
  })

  it('a deploy of the pilot passes on the pilot site — and checks what it says', () => {
    const r = runProbe({ pilot: 'on' }, 'deploy')
    expect(r.out, r.out).toMatch(/rc=0/)
    expect(r.out).toMatch(/https:\/\/eno\.vn\/\s+lang=en \(vi-VN\)/) // pinned: English for a Vietnamese browser
    expect(r.out).toMatch(/https:\/\/eno\.vn\/vi\s+lang=vi \(en-US\)/)
    expect(r.out).toMatch(/https:\/\/eno\.vn\/c\/furniture-appliances\s+lang=en \(vi-VN\)/)
    expect(r.out).toMatch(/https:\/\/eno\.vn\/vi\/c\/furniture-appliances\s+lang=vi \(en-US\)/)
    // en-US runs first on eno.vn, so the vi-VN line reads whatever the edge stored for `en`
    expect(r.out.indexOf('https://eno.vn/                        lang=en (en-US)')).toBeLessThan(r.out.indexOf('lang=en (vi-VN)'))
    expect(r.out).toMatch(/https:\/\/www\.eno\.vn\/vi\s+308 → https:\/\/eno\.vn\/vi/)
    expect(r.out).toMatch(/https:\/\/eno\.vn\/vi\s+lang=vi \(cookie lang=en\)/)
    expect(r.out).toMatch(/https:\/\/eno\.vn\/\s+lang=en \(cookie lang=vi\)/)
    expect(r.out).toMatch(/https:\/\/eno\.vn\/privacy\s+lang=vi \(cookie lang=vi\)/)
    expect(r.out).toMatch(/https:\/\/www\.eno\.forum\/\s+lang=vi \(vi-VN\)/) // the forum still adapts
    expect(r.out).toMatch(/https:\/\/eno\.vn\/vi\/c\/rentals\s+404/)
    expect(r.out).toMatch(/https:\/\/www\.eno\.forum\/vi\s+404/)
  })

  it('a deploy of the pilot FAILS when the site is not piloted, or half-piloted', () => {
    for (const site of [
      { pilot: 'off' },
      { pilot: 'on', unpinned: true },
      { pilot: 'on', viFollowsCookie: true },
      { pilot: 'on', strayVi: true },
      { pilot: 'on', furnitureOff: true },
    ] as Site[]) {
      const r = runProbe(site, 'deploy')
      expect(r.rc, JSON.stringify(site) + '\n' + r.out).toBe('1')
    }
  })

  it('a rollback to pre-pilot images passes as pilot=off — not "did not restore service"', () => {
    const r = runProbe({ pilot: 'off' }, 'rollback')
    expect(r.out, r.out).toMatch(/rc=0/)
    expect(r.out).toMatch(/probing the restored images as pilot=off/)
    expect(r.out).toMatch(/https:\/\/eno\.vn\/\s+lang=vi \(vi-VN\)/)
  })

  it('the pilot with V5\'s Worker in front passes; pre-pilot images behind a Worker STILL PINNING fail, with the hint', () => {
    expect(runProbe({ pilot: 'on', workerPinned: true }, 'deploy').rc).toBe('0')
    // a pinned Worker's stored en copy must not hide an origin that stopped pinning `/`
    expect(runProbe({ pilot: 'on', workerPinned: true, unpinned: true }, 'deploy').rc).toBe('1')
    expect(runProbe({ pilot: 'on', workerPinned: true }, 'rollback').rc).toBe('0')
    const r = runProbe({ pilot: 'off', workerPinned: true }, 'rollback')
    expect(r.rc, r.out).toBe('1')
    expect(r.out).toMatch(/https:\/\/eno\.vn\/\s+lang=en for vi-VN \(want vi\)/)
    expect(r.out).toMatch(/edge Worker still pinning this path to en\? redeploy the unpinned Worker/)
  })

  it('a rollback to pilot images passes as pilot=on; a half-switched restore still fails', () => {
    expect(runProbe({ pilot: 'on' }, 'rollback').out).toMatch(/pilot=on[\s\S]*rc=0/)
    for (const site of [{ pilot: 'on', unpinned: true }, { pilot: 'on', viFollowsCookie: true }, { pilot: 'off', strayVi: true }, { pilot: 'on', furnitureOff: true }] as Site[]) {
      expect(runProbe(site, 'rollback').rc, JSON.stringify(site)).toBe('1')
    }
  })
})

/**
 * ⛔ THE FORUM APEX MOVES ITS PAGES TO `www` (next.config.ts). The probe checked `https://eno.forum/` and its
 * `/itinerary` for a plain 200, so the first deploy carrying the redirect would have failed its own probe and rolled
 * itself back. The apex lines now accept the canonical hop — and only that one: a redirect anywhere else still fails,
 * and images from before the redirect (a rollback) still pass.
 */
describe('eno-deploy.sh probe() — the forum apex moves to www', { timeout: 20_000 }, () => {
  it('a deploy whose apex 308s to www passes, and the www target is checked in its place', () => {
    const r = runProbe({ pilot: 'on', forumApex: 'www' }, 'deploy')
    expect(r.out).toMatch(/https:\/\/eno\.forum\/\s+308 → https:\/\/www\.eno\.forum\//)
    expect(r.out).toMatch(/https:\/\/eno\.forum\/itinerary\s+308 → https:\/\/www\.eno\.forum\/itinerary/)
    expect(r.rc).toBe('0')
  })

  it('a rollback to images from before the redirect (the apex answering 200 itself) still passes', () => {
    expect(runProbe({ pilot: 'off', forumApex: 'none' }, 'rollback').rc).toBe('0')
  })

  it('⛔ a deploy whose apex still answers 200 itself fails: the redirect is missing, the two origins are back', () => {
    const r = runProbe({ pilot: 'on', forumApex: 'none' }, 'deploy')
    expect(r.out).toMatch(/https:\/\/eno\.forum\/\s+200 ⛔ the apex should 308 to www/)
    expect(r.rc).not.toBe('0')
  })

  it('⛔ a temporary redirect is not the canonical one: a 302 to www fails the apex line', () => {
    const r = runProbe({ pilot: 'on', forumApex: 'temporary' }, 'deploy')
    expect(r.out).toMatch(/https:\/\/eno\.forum\/\s+302 ⛔ not the permanent 308 to www/)
    expect(r.rc).not.toBe('0')
  })

  it('⛔ an apex that redirects anywhere but its own www fails the deploy', () => {
    const r = runProbe({ pilot: 'on', forumApex: 'eno.vn' }, 'deploy')
    // The apex's own line (hostcheck), not langcheck's "…for this page": /itinerary on the apex is only checked there.
    expect(r.out).toMatch(/https:\/\/eno\.forum\/itinerary\s+308 → https:\/\/eno\.vn\/itinerary ⛔ not the canonical host$/m)
    expect(r.rc).not.toBe('0')
  })
})
