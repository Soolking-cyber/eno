/**
 * eno-mta-sts — the MTA-STS policy for mail to @eno.vn (RFC 8461), served at https://mta-sts.eno.vn/.well-known/mta-sts.txt.
 *
 * Owner, 2026-11-26 ("email yes"), after an SEO/GEO audit's MTA-STS check failed. It is email security, not SEO: a sending
 * server that supports MTA-STS learns from this file that mail to eno.vn must arrive over TLS, to these MX hosts.
 *
 * ⛔ A WORKER, NOT THE APP, BECAUSE THE APP REDIRECTS THIS HOST. `*.eno.vn` is the shop-subdomain wildcard: an unknown label
 * (mta-sts) is answered by the app with a 301 to https://eno.vn<path>, and RFC 8461 §3.3 forbids following a redirect for the
 * policy. A zone route `mta-sts.eno.vn/*` points at this script instead (route set by hand; a script PUT does not touch routes).
 * The shop handle is reserved (`mtasts`, src/lib/handle-format.ts), so no shop can be promised that subdomain.
 *
 * ⚠️ THE MX LINES MUST MATCH eno.vn's MX RECORDS — Cloudflare Email Routing, route1–3.mx.cloudflare.net (2026-11-26). Change the
 * MX and this file in the same hour, and bump the `id` in the `_mta-sts.eno.vn` TXT record whenever this policy changes.
 * ⚠️ `mode: testing` (2026-11-26): a sender that cannot verify TLS still delivers, and reports it to the TLS-RPT address:
 * TXT `_smtp._tls.eno.vn` "v=TLSRPTv1; rua=mailto:support@eno.vn" (the owner's mailbox, set 2026-11-26). `enforce` would make
 * such a sender refuse to deliver, so it waits for a few weeks of clean reports there.
 *
 * ── THE THREE PIECES, ALL IN CLOUDFLARE (zone eno.vn 55e558b62f68a44f8177d7d98cb5369e, account c91cf27edd31b01aba677ac9e007d569) ──
 *   1. This script, as a MODULE Worker named `eno-mta-sts`, no bindings:
 *      PUT /accounts/<account>/workers/scripts/eno-mta-sts, multipart: part `metadata` =
 *      {"main_module":"worker.js","compatibility_date":"2026-11-01"} and this file as the part whose FILENAME is worker.js
 *      (the filename is how Cloudflare finds the module: deploy-worker.sh's MODULE note). Re-run it after editing this file.
 *   2. The route: POST /zones/<zone>/workers/routes {"pattern":"mta-sts.eno.vn/*","script":"eno-mta-sts"}.
 *   3. The DNS record: TXT `_mta-sts.eno.vn` = "v=STSv1; id=<1–32 letters/digits>", a new id with every policy change.
 * Without 3 no sender looks for the policy; without 2 the host is the app's redirect again. First set 2026-11-26, id 20261126.
 */
const POLICY = [
  'version: STSv1',
  'mode: testing',
  'mx: route1.mx.cloudflare.net',
  'mx: route2.mx.cloudflare.net',
  'mx: route3.mx.cloudflare.net',
  'max_age: 86400',
  '',
].join('\r\n')

const TEXT = { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' }

const worker = {
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === '/.well-known/mta-sts.txt' && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(request.method === 'HEAD' ? null : POLICY, { headers: { ...TEXT, 'cache-control': 'public, max-age=3600' } })
    }
    return new Response('Not found\n', { status: 404, headers: TEXT })
  },
}

export default worker
