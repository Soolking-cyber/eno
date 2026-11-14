import { route } from '@/lib/api/handler'
import { affiliateNight } from '@/lib/affiliate-night'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 2700

/**
 * NIGHTLY PRICE + STOCK FOR THE AccessTrade CRAWL CAMPAIGNS — Hoàng Hà and ShopDunk (owner 2026-11-14: "All of them";
 * chat only). Their used stock is not in a datafeed, so the whole used section of each shop is READ every night
 * (src/lib/accesstrade-crawl.ts) and reconciled whole-shop by the same body /api/cron/affiliate-prices runs
 * (src/lib/affiliate-night.ts): complete read + floors → a unit gone is `sold`; seen again in stock → restocked.
 *
 * ⚠️ CALLED ON 127.0.0.1 WITH A Host HEADER, NOT THROUGH CLOUDFLARE (which cuts at 100 s): a night is ~27 minutes of
 * polite reads. The timer (install-cron-timers.sh, 21:31 UTC = 04:31 ICT, after the 03:01 datafeed run) gives eno-cron.sh's
 * curl 2,700 s. eno.forum's container has no ACCESSTRADE_KEY, so its call only flushes (the same rule as affiliate-prices).
 */
export const GET = route({ auth: 'cron' }, () => affiliateNight('crawl'))
