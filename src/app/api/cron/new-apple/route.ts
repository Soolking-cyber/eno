import { route } from '@/lib/api/handler'
import { newAppleNight } from '@/lib/new-apple-night'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 1200

/**
 * NIGHTLY PRICE + STOCK FOR THE NEW iPHONE 18 / CURRENT-MAC ROWS of ShopDunk, CellphoneS and Hoàng Hà (owner 2026-11-26,
 * src/lib/new-apple.ts). Each row's own product page is read (src/lib/new-apple-night.ts): price written, sold only on the
 * page's own out-of-stock markup or a 404, back when in stock again; anything unclear is left and counted.
 * ⚠️ Called on 127.0.0.1 with a Host header (install-cron-timers.sh, 22:31 UTC = 05:31 ICT), ~3 minutes of polite reads.
 * On eno.forum it only flushes that container's cache (the database is shared).
 */
export const GET = route({ auth: 'cron' }, () => newAppleNight())
