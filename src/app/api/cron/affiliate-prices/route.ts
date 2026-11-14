import { route } from '@/lib/api/handler'
import { affiliateNight } from '@/lib/affiliate-night'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

// Daily price refresh for imported affiliate listings (owner, 2026-08-25: "fetch prices daily").
// Guarded by CRON_SECRET like every other job here; driven by the systemd timer installed by
// infra/vn-node/cron/install-cron-timers.sh.
//
// ⚠️ CALLED ON 127.0.0.1 WITH A Host HEADER, NOT THROUGH CLOUDFLARE — which is what makes a
// multi-minute walk of a ~9,700-row datafeed legal. Cloudflare cuts a request at 100s; the timer's
// eno-cron.sh curl allows 900. Do not "helpfully" expose this on the public hostname.
// ⚠️ THE BODY LIVES IN src/lib/affiliate-night.ts (shared with /api/cron/affiliate-crawl since 2026-11-15).
export const GET = route({ auth: 'cron' }, () => affiliateNight('feed'))
