import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Button } from '@/components/ui/button'
import { Tr } from '@/context/language-context'
import { Bilingual } from '@/components/marketplace/bilingual'
import { checkAuthRequest, eligibleShop, issueConsentTicket, verifiedProfileId } from '@/lib/api/oauth-grant'

/**
 * /oauth/authorize — "SIGN IN WITH ENO", THE CONSENT SCREEN (2026-11-13; src/lib/api/oauth-grant.ts is the mechanism).
 *
 * An app (Claude, ChatGPT, Cursor…) sends the person here to let it manage their eno shop through the MCP server.
 * ⛔ An error is shown HERE, never redirected to the app: anyone can "register" a return address with a metadata
 * document, so an error redirect before sign-in would make this page an open redirect (RFC 9700 §4.11.2).
 * ⛔ The approve form carries a sealed consent ticket binding the exact request to the signed-in person; the POST
 * (src/app/api/oauth/authorize/route.ts) re-checks the session and the shop. Framing by other sites is already refused
 * site-wide (X-Frame-Options SAMEORIGIN, frame-ancestors 'self' — next.config.ts).
 * Never indexed, never cached.
 */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Sign in with eno', robots: { index: false, follow: false } }

const SCOPE_TEXT: Record<string, { en: string; vi: string }> = {
  'listings:read': { en: 'See your shop and its listings', vi: 'Xem cửa hàng và các tin đăng của bạn' },
  'listings:write': { en: 'Post, edit, mark sold and remove your listings, and edit your shop profile', vi: 'Đăng, sửa, đánh dấu đã bán và gỡ tin đăng, và sửa hồ sơ cửa hàng của bạn' },
  'analytics:read': { en: 'See the views and leads on your listings', vi: 'Xem lượt xem và lượt liên hệ trên tin đăng của bạn' },
  'media:write': { en: 'Upload photos to your shop', vi: 'Tải ảnh lên cửa hàng của bạn' },
}
/** What a person sees when the link itself is wrong (check.error), in both languages. */
const LINK_ERROR: Record<string, { en: string; vi: string }> = {
  invalid_client: { en: 'The app asking to connect could not be identified.', vi: 'Không xác định được ứng dụng đang xin kết nối.' },
  invalid_request: { en: 'The app sent a return address it has not registered, or left out a required part of the request.', vi: 'Ứng dụng gửi một địa chỉ quay lại chưa đăng ký, hoặc thiếu một phần bắt buộc của yêu cầu.' },
  invalid_scope: { en: 'The app asked for a permission eno does not offer.', vi: 'Ứng dụng xin một quyền mà eno không cung cấp.' },
  invalid_target: { en: 'The app asked to connect to something other than the eno shop tools.', vi: 'Ứng dụng xin kết nối tới một thứ khác ngoài công cụ cửa hàng eno.' },
  unsupported_response_type: { en: 'The app uses a sign-in method eno does not support.', vi: 'Ứng dụng dùng cách đăng nhập mà eno không hỗ trợ.' },
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') q.set(k, v)
  // Before anything is fetched: this page loads an app's metadata from the address the link names (review).
  const rl = await rateLimit('oauth-authorize', clientIp(await headers()), 30, '1 m')
  if (!rl.success) {
    return (
      <Shell>
        <h1 className="h-title text-foreground"><Tr text="Too many sign-in attempts" /></h1>
        <p className="mt-3 text-sm leading-relaxed text-body"><Tr text="Wait a minute, then start the connection again from the app." /></p>
      </Shell>
    )
  }
  const check = await checkAuthRequest(q)

  if (!check.ok) {
    // Shown here, never redirected — see checkAuthRequest (an open-registration server must not be an open redirect).
    return (
      <Shell>
        <h1 className="h-title text-foreground"><Tr text="This sign-in link does not work" /></h1>
        <p className="mt-3 text-sm leading-relaxed text-body">{LINK_ERROR[check.error] ? <Bilingual {...LINK_ERROR[check.error]} /> : <Bilingual {...LINK_ERROR.invalid_request} />}</p>
        <p className="mt-3 text-sm leading-relaxed text-body"><Tr text="Go back to the app and start the connection again." /></p>
      </Shell>
    )
  }

  const profileId = await verifiedProfileId()
  if (!profileId) redirect(`/signin?next=${encodeURIComponent(`/oauth/authorize?${q.toString()}`)}`)

  const { req, client } = check
  const ret = new URL(req.redirectUri)
  const returnHost = ['localhost', '127.0.0.1', '[::1]'].includes(ret.hostname) ? null : ret.host
  const elig = await eligibleShop(profileId)
  const shop = elig.ok ? elig.shop : null
  const ticket = shop ? issueConsentTicket(req, profileId, [shop.id], Math.floor(Date.now() / 1000)) : null

  return (
    <Shell>
      <p className="text-sm font-semibold text-body"><Tr text="Sign in with eno" /></p>
      <h1 className="mt-1 h-title text-foreground">{client.name}</h1>
      {/* The name is the app's own claim; the address is not. Shown so a look-alike name cannot pass for a real app. */}
      <p className="mt-2 text-sm leading-relaxed text-body"><Tr text="Check that this is the app you started from:" /> <strong className="font-mono text-foreground">{client.host}</strong></p>
      {/* Where the code goes, when that is another site than the app's own address (a shared host can serve anyone's
          metadata document) — a desktop app's own computer (loopback) is not another site. */}
      {returnHost && returnHost !== client.host ? (
        <p className="mt-1 text-sm leading-relaxed text-body"><Tr text="It will send you back to:" /> <strong className="font-mono text-foreground">{returnHost}</strong></p>
      ) : null}
      {shop && ticket ? (
        <>
          <p className="mt-5 text-sm leading-relaxed text-body"><Tr text="wants to manage your eno shop for you:" /> <strong className="text-foreground">{shop.name}</strong></p>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-body">
            {req.scopes.map((s) => <li key={s}>• {SCOPE_TEXT[s] ? <Bilingual {...SCOPE_TEXT[s]} /> : s}</li>)}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-body">
            <Tr text="Only allow apps you trust. You can disconnect it at any time in Dashboard › Developers." />
          </p>
          {/* Each button carries the sealed ticket as its own value, so the form needs no hidden field. */}
          <form method="post" action="/api/oauth/authorize" className="mt-6 flex flex-wrap gap-3">
            <Button type="submit" name="allow" value={ticket} variant="cta"><Tr text="Allow" /></Button>
            <Button type="submit" name="deny" value={ticket} variant="outline"><Tr text="Cancel" /></Button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-5 text-sm leading-relaxed text-body">
            {!elig.ok && elig.reason === 'not_business'
              ? <Tr text="Connecting an app needs a business account, where you can also disconnect it later. Switch your account to business, then start the connection again." />
              : !elig.ok && elig.reason === 'restricted'
                ? <Tr text="Your account cannot connect apps right now." />
                : <Tr text="You need an eno shop to connect an app. Open your shop from your account first, then start the connection again." />}
          </p>
          <form method="post" action="/api/oauth/authorize" className="mt-6">
            <Button type="submit" name="cancel" value={new URLSearchParams({ client_id: req.clientId, redirect_uri: req.redirectUri, state: req.state }).toString()} variant="outline"><Tr text="Back to the app" /></Button>
          </form>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 px-4 pt-12 pb-16">
        <div className="rounded-2xl border border-border bg-card p-6">{children}</div>
      </main>
      <Footer />
    </div>
  )
}
