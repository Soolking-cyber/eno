#!/usr/bin/env node
// OWNER PRE-DEPLOY CHECK — the private intro-video delivery path (2026-10-07, "hide and send upon request").
// A teacher's private video is watched through a 10-minute signed URL on sb.eno.vn, behind Cloudflare. Three things the
// code cannot prove from here: that Cloudflare never CACHES a signed read (DYNAMIC/BYPASS only — HIT, MISS, STALE,
// UPDATING, REVALIDATED and EXPIRED all mean the response was cacheable), that an EXPIRED link really stops working,
// and that a Range read answers 206 (iOS will not play a video without it).
//
// Run AFTER `node scripts/teachers-ddl.mjs` has created the bucket, BEFORE eno-deploy, with the service key in the env
// (never pasted anywhere): NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/check-teacher-video-delivery.mjs
// It uploads one 4 KB object to `teacher-videos/_delivery-check/`, reads it, and deletes it. Nothing else is touched.
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment (the deployed values).')
  process.exit(1)
}
const BUCKET = 'teacher-videos'
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const path = `_delivery-check/${Date.now()}.mp4`

// MP4-shaped bytes (an ftyp box, then a free box as padding): enough for headers and a Range read — never played.
const body = Buffer.alloc(4096)
body.writeUInt32BE(24, 0); body.write('ftypisom', 4, 'latin1'); body.writeUInt32BE(512, 12); body.write('isomiso2', 16, 'latin1')
body.writeUInt32BE(4096 - 24, 24); body.write('free', 28, 'latin1')

// Not cacheable at the edge: these, or no Cloudflare header at all. Anything else means Cloudflare could store the response.
const UNCACHED = new Set(['-', 'DYNAMIC', 'BYPASS'])
let failed = false
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
  return ok
}

let uploaded = false
try {
  const up = await sb.storage.from(BUCKET).upload(path, body, { contentType: 'video/mp4', cacheControl: '0', upsert: false })
  uploaded = check(!up.error, 'upload into the private bucket', up.error?.message)
  if (uploaded) {
    // The bucket must be PRIVATE: its public path serves nothing.
    const pub = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${path}`, { signal: AbortSignal.timeout(15000) })
    await pub.arrayBuffer()
    check(pub.status >= 400, 'the public path of a private object serves nothing', `HTTP ${pub.status}`)

    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 600)
    const link = signed.data?.signedUrl
    if (check(!signed.error && !!link, 'a 10-minute signed URL is minted', signed.error?.message)) {
      check(new URL(link).host === new URL(url).host, 'the signed URL is on the public storage host', new URL(link).host)
      // Twice: a second read is where a cached copy would show (cf-cache-status HIT).
      for (const n of [1, 2]) {
        const r = await fetch(link, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000) })
        const bytes = (await r.arrayBuffer()).byteLength
        const cf = r.headers.get('cf-cache-status') ?? '-'
        check(r.status === 206 && bytes === 1024, `Range read #${n} answers 206 with 1024 bytes (iOS playback)`, `HTTP ${r.status}, ${bytes} B`)
        check(UNCACHED.has(cf), `Range read #${n} is not cacheable at Cloudflare`, `cf-cache-status ${cf}, cache-control ${r.headers.get('cache-control') ?? '-'}`)
      }
      const bad = new URL(link)
      bad.searchParams.set('token', 'x')
      const t = await fetch(bad, { signal: AbortSignal.timeout(15000) })
      await t.arrayBuffer()
      check(t.status >= 400, 'a forged token is refused', `HTTP ${t.status}`)
    }
    // EXPIRY, measured: a 5-second link works, then — read once, so a cache would hold it — must stop working.
    const short = await sb.storage.from(BUCKET).createSignedUrl(path, 5)
    if (check(!short.error && !!short.data?.signedUrl, 'a 5-second signed URL is minted', short.error?.message)) {
      const first = await fetch(short.data.signedUrl, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000) })
      await first.arrayBuffer()
      check(first.status === 206, 'the short link works while it is valid', `HTTP ${first.status}`)
      await new Promise((r) => setTimeout(r, 8000))
      const late = await fetch(short.data.signedUrl, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000) })
      await late.arrayBuffer()
      check(late.status >= 400, 'the same link is refused once it has expired', `HTTP ${late.status}, cf-cache-status ${late.headers.get('cf-cache-status') ?? '-'}`)
    }
  }
} catch (e) {
  check(false, 'the check ran to the end', e instanceof Error ? e.message : String(e))
} finally {
  if (uploaded) {
    const rm = await sb.storage.from(BUCKET).remove([path])
    check(!rm.error, 'the test object is removed', rm.error?.message)
  }
}

if (failed) {
  console.log('\nIf a read was cacheable (anything but DYNAMIC/BYPASS) or the expired link still played: add a Cache Rule on the sb.eno.vn zone that BYPASSES cache for')
  console.log('URI path starts with /storage/v1/object/sign/ — then run this again. Do not deploy the video feature before it passes.')
  process.exitCode = 1
} else {
  console.log('\nAll checks passed: private intro videos can be delivered.')
}
