import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { IS_SERVICES } from '@/lib/edition'
import { fontMetrics, woff2ToSfnt, type FontMetrics } from '@/lib/sfnt'
import {
  fitTitle,
  parseTeachCard,
  teachCardParams,
  teachCardText,
  TEACH_CARD_COLORS as C,
  TEACH_CARD_SERIES_TRACKING,
  TEACH_CARD_TITLE_LEADING,
  TEACH_CARD_TITLE_TRACKING,
} from '@/lib/teach-guides/share-cards'

/**
 * /og/teach-in-vietnam/<slug>/<w>x<h>.png and /og/teach-in-vietnam/<w>x<h>.png — the share cards of the teach guides
 * and the hub, drawn by next/og. What each says, its shapes and its URL are src/lib/teach-guides/share-cards.ts; this
 * draws one.
 *
 * ⚠️ OUTSIDE `[lang]` ON PURPOSE, like /hcmc-rent-index.csv: a picture has no language, and src/proxy.ts never rewrites
 * a dotted path (nor anything under /og/), so the card answers at exactly the URL the page's metadata names.
 * ⚠️ STATIC: every card is rendered at build (`generateStaticParams`), and any other path under this route is a 404
 * without running it (`dynamicParams = false`). ⚠️ AND A RUNTIME RENDER IS STILL NORMAL, NOT A FAULT: the repo's cache
 * handler keeps no build-time prerender (cache-handler.cjs: "prod first-hits re-render once"), so the first request for
 * a card in a new container draws it again — same inputs, same picture. That is why the font is read from
 * `process.cwd()` by a literal path: the build's file trace follows it into the standalone bundle
 * (`.next/standalone/src/fonts/` — measured on a minimal Turbopack standalone build with this same read, 2026-10-21),
 * and next.config.ts `outputFileTracingIncludes` names the file for this route as well.
 * ⚠️ CACHE: the unstamped public-asset lane of next.config.ts (STAMPABLE_STATIC, `missing: v`) — a browser keeps a card
 * an hour, the edge thirty days, and every deploy's tag purge (`eno-public`, which nginx stamps on all of `location /` —
 * infra/vn-node/nginx/eno.conf) refreshes the edge, so a renamed guide's card follows its deploy. Not next/og's own
 * `public, max-age=0, must-revalidate`, which has the edge go back to the origin on every fetch (as /og/share-card.jpg
 * does today: `cf-cache-status: REVALIDATED`); and no `immutable` year either — the URL carries no content stamp, and a
 * browser's year could never be taken back.
 * ⚠️ NO X-Robots-Tag and no robots.txt rule: Google may index these (Discover shows them; robots.txt disallows nothing
 * under /og/).
 * ⛔ MARKETPLACE ONLY: eno.forum renders none and answers 404, like the library it illustrates (next.config.ts 308s it).
 */
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return IS_SERVICES ? [] : teachCardParams()
}

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400'

/**
 * Open Runde Bold, the app's own face and the eno.vn wordmark's — decoded once per process (src/lib/sfnt.ts: the renderer
 * reads no WOFF2). ⚠️ THE ONLY FACE THE RENDERER IS GIVEN, so a character it lacks would send next/og to fetch a fallback
 * from Google Fonts mid-build; share-cards.test.ts checks every character of every card against this font first.
 */
let face: Promise<{ data: Buffer; metrics: FontMetrics }> | undefined
function brandFace() {
  face ??= readFile(join(process.cwd(), 'src', 'fonts', 'open-runde-bold.woff2'))
    .then((woff2) => {
      const data = woff2ToSfnt(woff2)
      return { data, metrics: fontMetrics(data) }
    })
    // ⚠️ A FAILURE IS NOT KEPT — a failed read or a failed decode alike (review, codex): a cached rejection would fail
    // every card in the process until a restart. The next request reads the file again.
    .catch((e: unknown) => {
      face = undefined
      throw e
    })
  return face
}

export async function GET(_req: Request, { params }: { params: Promise<{ card: string[] }> }) {
  if (IS_SERVICES) return new Response('Not found', { status: 404 })
  const card = parseTeachCard((await params).card)
  const text = card && teachCardText(card.slug)
  if (!card || !text) return new Response('Not found', { status: 404 })
  const { shape } = card
  const { data, metrics } = await brandFace()
  const title = fitTitle(text.title, shape, metrics)
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: `${shape.pad.top}px ${shape.pad.x}px ${shape.pad.bottom}px`,
          backgroundColor: C.brand,
          backgroundImage: `linear-gradient(150deg, ${C.brand} 45%, ${C.brandDark} 135%)`,
          color: C.ink,
          fontFamily: 'Open Runde',
          fontWeight: 700,
        }}
      >
        {/* The series line over the title, as the eyebrow sits over a guide's H1 — the pair centred in the room above the
            wordmark, so a one-line name and a five-line one sit the same way, and a centre crop keeps the title. */}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center', paddingBottom: shape.gap }}>
          <div
            style={{
              display: 'flex',
              fontSize: shape.series,
              lineHeight: 1,
              letterSpacing: `${TEACH_CARD_SERIES_TRACKING}em`,
              textTransform: 'uppercase',
              color: C.brand100,
            }}
          >
            {text.series}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: shape.gap }}>
            {title.lines.map((line, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  fontSize: title.size,
                  lineHeight: TEACH_CARD_TITLE_LEADING,
                  letterSpacing: `${TEACH_CARD_TITLE_TRACKING}em`,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: shape.mark, lineHeight: 1 }}>{text.mark}</div>
      </div>
    ),
    {
      width: shape.width,
      height: shape.height,
      fonts: [{ name: 'Open Runde', data, weight: 700, style: 'normal' }],
      headers: { 'Cache-Control': CACHE_CONTROL },
    },
  )
}
