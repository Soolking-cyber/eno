import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ A PRIVATE FILE IS NEVER STORED BY ANY CACHE — sb.eno.vn in infra/vn-node/nginx/eno.conf (security review
 * 2026-10-22, item 21 follow-up). Storage answers with each object's own metadata: max-age=3600 on everything uploaded
 * before 2026-10-22, max-age=0 since — and Cloudflare documents that with Origin Cache Control on (always on, not
 * switchable, on Free/Pro/Business) `max-age=0` "Caches and always revalidates", while `no-store` "Will not cache". So
 * nginx REPLACES the header on every non-public storage read. Verified once against a live nginx 1.24 in front of a
 * stub upstream (2026-10-23); this pins the config that run exercised.
 */

const CONF = readFileSync(join(__dirname, '../../infra/vn-node/nginx/eno.conf'), 'utf8')
const SB = (() => {
  const start = CONF.indexOf('server_name sb.eno.vn;')
  return CONF.slice(start, CONF.indexOf('\n}', start))
})()

/** The sb.eno.vn regex locations in file order: nginx tries them in this order and the first match wins. */
// Either a one-liner (`{ return 404; }`) or a block closed by a two-space `}` line.
const LOCS = [...SB.matchAll(/location ~\* (\S+) \{(?:([^\n]*)\}|([\s\S]*?)\n {2}\})/g)]
  .map(([, re, oneLine, block]) => ({ re: new RegExp(re, 'i'), src: re, body: oneLine ?? block }))
const PUBLIC = LOCS.find((l) => l.src.includes('public'))!
const PRIVATE = LOCS.find((l) => l.src.includes('storage') && !l.src.includes('public'))!
/** Which location nginx picks for an already-normalised URI (merged slashes, decoded) — '/' when no regex matches. */
const pick = (uri: string) => LOCS.find((l) => l.re.test(uri))?.src ?? '/'

describe('sb.eno.vn storage reads', () => {
  it('public reads are matched BEFORE the private catch-all (nginx: first matching regex wins)', () => {
    expect(PUBLIC && PRIVATE).toBeTruthy()
    expect(LOCS.indexOf(PUBLIC)).toBeLessThan(LOCS.indexOf(PRIVATE))
    // the authorize guard and identity-linking locations stay first (apply-apple-signin.test.ts destructures them)
    expect(LOCS[0].src).toContain('authorize')
    expect(LOCS[1].src).toContain('identities')
  })

  it.each([
    '/storage/v1/object/sign/kyc/a.jpg',
    '/storage/v1/object/authenticated/evidence/b.png',
    '/storage/v1/object/kyc/c.jpg', // the API's own authenticated read
    '/STORAGE/V1/OBJECT/SIGN/x.jpg',
    '/storage/v1/render/image/sign/kyc/e.jpg',
    '/storage/v1/render/image/authenticated/kyc/e.jpg',
    '/storage/v1/object/upload/sign/listing-videos/h.mp4',
  ])('⛔ %s → the no-store location', (uri) => {
    expect(pick(uri)).toBe(PRIVATE.src)
  })

  it.each([
    '/storage/v1/object/public/listings/f.webp',
    '/storage/v1/render/image/public/listings/g.webp',
  ])('%s → the public location, which keeps its long max-age', (uri) => {
    expect(pick(uri)).toBe(PUBLIC.src)
  })

  it.each(['/storage/v1/bucket', '/rest/v1/listings', '/auth/v1/verify', '/realtime/v1/websocket'])('%s is not a storage read → location /', (uri) => {
    expect(pick(uri)).toBe('/')
  })

  it('the private location REPLACES Cache-Control — hides the upstream one, adds no-store on every status', () => {
    expect(PRIVATE.body).toContain('proxy_hide_header Cache-Control;')
    expect(PRIVATE.body).toContain('add_header Cache-Control "private, no-store" always;')
    expect(PUBLIC.body).not.toMatch(/Cache-Control/)
  })

  it('both keep location /\'s long timeouts — a paused private-video download must not be cut at 60 s', () => {
    for (const l of [PUBLIC, PRIVATE]) {
      expect(l.body).toContain('proxy_read_timeout 3600s;')
      expect(l.body).toContain('proxy_send_timeout 3600s;')
      expect(l.body).toContain('proxy_pass http://127.0.0.1:8000;')
    }
  })
})
