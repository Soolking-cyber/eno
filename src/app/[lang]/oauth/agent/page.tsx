import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Bilingual } from '@/components/marketplace/bilingual'
import { emailHash, openAttempt } from '@/lib/api/agent-auth'
import { DEFAULT_SIGN_IN_SCOPES, eligibleShop, openAgentTicket, verifiedPerson } from '@/lib/api/oauth-grant'
import { SCOPE_TEXT } from './scope-text'

/**
 * /oauth/agent — CONNECT AN AI AGENT BY CODE (the auth.md service_auth claim ceremony; src/lib/api/agent-auth.ts).
 *
 * An agent that knows only the person's email registered at /api/agent/identity and showed them a 6-digit code and this
 * address. ⛔ The address carries nothing: the person opens it themselves, signed in, and types the code; the code is
 * looked up only among requests made for THEIR OWN confirmed email (lookup route). Then this page shows the shop and the
 * access asked, and Allow / Cancel post a sealed ticket (complete route), where every check runs again.
 * Never indexed, never cached; under the existing /oauth root, so no storefront handle can be shadowed.
 */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Connect an AI agent', robots: { index: false, follow: false } }

/** Why the last step did not go through (the lookup and complete routes send `?e=`). */
const PROBLEM: Record<string, { en: string; vi: string }> = {
  code: { en: 'That code does not work. Check it, and check that your agent asked with this account’s email address (shown above); or ask your agent for a new one.', vi: 'Mã đó không dùng được. Hãy kiểm tra lại mã, và kiểm tra rằng trợ lý AI đã dùng đúng địa chỉ email của tài khoản này (hiện ở trên); hoặc nhờ trợ lý tạo mã mới.' },
  tries: { en: 'Too many tries. Wait a few minutes, then type the code again.', vi: 'Thử quá nhiều lần. Hãy đợi vài phút rồi nhập lại mã.' },
  expired: { en: 'This request is no longer open. Ask your agent to start again.', vi: 'Yêu cầu này đã đóng. Hãy nhờ trợ lý AI của bạn bắt đầu lại.' },
  answered: { en: 'This request was already answered.', vi: 'Yêu cầu này đã được trả lời.' },
  unavailable: { en: 'Something went wrong on our side. Try again in a moment.', vi: 'Có lỗi phía chúng tôi. Hãy thử lại sau giây lát.' },
  not_business: { en: 'Connecting an AI agent needs a business account, where you can also disconnect it later. Switch your account to business, then type the code again.', vi: 'Để kết nối trợ lý AI, bạn cần tài khoản doanh nghiệp, nơi bạn cũng có thể ngắt kết nối sau này. Hãy chuyển tài khoản sang doanh nghiệp rồi nhập lại mã.' },
  no_shop: { en: 'You need an eno shop to connect an AI agent. Open your shop from your account first.', vi: 'Bạn cần có cửa hàng trên eno để kết nối trợ lý AI. Hãy mở cửa hàng từ tài khoản của bạn trước.' },
  restricted: { en: 'Your account cannot connect AI agents right now.', vi: 'Tài khoản của bạn hiện không thể kết nối trợ lý AI.' },
}

type Search = Record<string, string | string[] | undefined>

export default async function AgentClaimPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '')
  const person = await verifiedPerson()
  if (!person) redirect(`/signin?next=${encodeURIComponent('/oauth/agent')}`)

  if (one('done') === 'allowed' || one('done') === 'denied') {
    const allowed = one('done') === 'allowed'
    return (
      <Shell>
        <h1 className="h-title text-foreground">{allowed ? <Bilingual en="Connected" vi="Đã kết nối" /> : <Bilingual en="Not connected" vi="Chưa kết nối" />}</h1>
        <p className="mt-3 text-sm leading-relaxed text-body">
          {allowed
            ? <Bilingual en="Go back to your AI agent: it finishes by itself. You can disconnect it at any time in Dashboard › Developers." vi="Hãy quay lại trợ lý AI của bạn: nó sẽ tự hoàn tất. Bạn có thể ngắt kết nối bất cứ lúc nào trong Bảng điều khiển › Nhà phát triển." />
            : <Bilingual en="The agent was told you said no." vi="Trợ lý AI đã được báo rằng bạn từ chối." />}
        </p>
      </Shell>
    )
  }

  if (!person.email) {
    return (
      <Shell>
        <h1 className="h-title text-foreground"><Bilingual en="Connect an AI agent" vi="Kết nối trợ lý AI" /></h1>
        <p className="mt-3 text-sm leading-relaxed text-body">
          <Bilingual en="Your account has no confirmed email address, so an AI agent cannot ask to connect to it by email. Add and confirm an email in your account settings, or connect the agent's app with Sign in with eno instead." vi="Tài khoản của bạn chưa có địa chỉ email đã xác nhận, nên trợ lý AI không thể xin kết nối qua email. Hãy thêm và xác nhận email trong phần cài đặt tài khoản, hoặc kết nối ứng dụng của trợ lý bằng Đăng nhập với eno." />
        </p>
      </Shell>
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const sealed = one('ticket')
  const t = sealed ? openAgentTicket(sealed, now) : null
  if (t && t.pid === person.profileId) {
    const [open, elig] = await Promise.all([openAttempt(t.reg, t.n, emailHash(person.email), now), eligibleShop(person.profileId)])
    if (open && elig.ok && elig.shop.id === t.sid) {
      const minutes = Math.max(0, Math.floor((now - open.requestedAt) / 60))
      return (
        <Shell>
          <p className="text-sm font-semibold text-body"><Bilingual en="Connect an AI agent" vi="Kết nối trợ lý AI" /></p>
          <h1 className="mt-1 h-title text-foreground">{elig.shop.name}</h1>
          <p className="mt-3 text-sm leading-relaxed text-body">
            <Bilingual en="An AI agent asked {minutes} min ago to manage this shop for you:" vi="Một trợ lý AI đã xin quản lý cửa hàng này giúp bạn, {minutes} phút trước:" values={{ minutes: String(minutes) }} />
          </p>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-body">
            {DEFAULT_SIGN_IN_SCOPES.map((s) => <li key={s}>• {SCOPE_TEXT[s] ? <Bilingual {...SCOPE_TEXT[s]} /> : s}</li>)}
          </ul>
          <p className="mt-4 text-sm font-semibold leading-relaxed text-foreground">
            <Bilingual en="Only allow this if you asked an AI agent to connect to your shop just now. eno never asks for this code by email, chat or phone." vi="Chỉ cho phép nếu chính bạn vừa nhờ một trợ lý AI kết nối với cửa hàng. eno không bao giờ hỏi mã này qua email, tin nhắn hay điện thoại." />
          </p>
          <p className="mt-2 text-sm leading-relaxed text-body">
            <Bilingual en="You can disconnect it at any time in Dashboard › Developers." vi="Bạn có thể ngắt kết nối bất cứ lúc nào trong Bảng điều khiển › Nhà phát triển." />
          </p>
          {/* Each button carries the sealed ticket as its own value, as on the consent page. */}
          <form method="post" action="/api/agent/identity/claim/complete" className="mt-6 flex flex-wrap gap-3">
            <Button type="submit" name="allow" value={sealed} variant="cta"><Bilingual en="Allow" vi="Cho phép" /></Button>
            <Button type="submit" name="deny" value={sealed} variant="outline"><Bilingual en="Cancel" vi="Hủy" /></Button>
          </form>
        </Shell>
      )
    }
  }

  // A ticket that no longer opens (expired, answered, another account) reads as an expired request.
  const problem = PROBLEM[one('e')] ?? (sealed ? PROBLEM.expired : null)
  return (
    <Shell>
      <h1 className="h-title text-foreground"><Bilingual en="Connect an AI agent" vi="Kết nối trợ lý AI" /></h1>
      <p className="mt-3 text-sm leading-relaxed text-body">
        <Bilingual en="Type the 6-digit code your AI agent gave you. You will see what it asks for before anything is connected." vi="Nhập mã 6 chữ số mà trợ lý AI của bạn đưa. Bạn sẽ thấy nó xin những quyền gì trước khi kết nối." />
      </p>
      {/* The person's OWN confirmed email: the agent must have asked with this one, or no code can match (plan review). */}
      <p className="mt-2 text-sm leading-relaxed text-body">
        <Bilingual en="Signed in as {email}. Your agent must ask with this address." vi="Đang đăng nhập bằng {email}. Trợ lý AI phải dùng đúng địa chỉ này." values={{ email: person.email }} />
      </p>
      {problem ? <p role="alert" className="mt-3 text-sm font-semibold leading-relaxed text-destructive"><Bilingual {...problem} /></p> : null}
      <form method="post" action="/api/agent/identity/claim/lookup" className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-foreground">
          <Bilingual en="Code" vi="Mã" />
          <Input name="user_code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="w-40 rounded-lg px-3 py-2 font-mono text-base" />
        </label>
        <Button type="submit" variant="cta"><Bilingual en="Continue" vi="Tiếp tục" /></Button>
      </form>
      <p className="mt-4 text-sm leading-relaxed text-body">
        <Bilingual en="Only continue if you asked an AI agent to connect to your shop just now." vi="Chỉ tiếp tục nếu chính bạn vừa nhờ một trợ lý AI kết nối với cửa hàng." />
      </p>
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
