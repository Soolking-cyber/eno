import { z } from 'zod'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { vietqrPayoutReady } from '@/lib/payments/eligibility'
import { sendMail } from '@/lib/mail'
import { sendPushToProfile } from '@/lib/push'
import { logWarn } from '@/lib/log'
import { renderBrandEmail, esc } from '@/lib/emails/layout'
import { SITE_NAME } from '@/lib/edition'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * WHERE A SELLER SAYS WHICH ACCOUNT TO PAY THEM INTO.
 *
 * ⛔ `.svc.` — settlement is a services-edition feature, so this route does not exist on eno.vn at
 * all. Excluded at BUILD time by `pageExtensions`, not gated at runtime.
 *
 * ⛔ THE DETAILS GO TO `seller_payout`, NOT ONTO `Seller`. That table exists because `Seller` is the
 * most-queried model in the app and ~16 of its queries take no explicit `select` — a bank account
 * number on it would be one `{...seller}` away from a public response forever. Writing it here is
 * the only path, so there is one place to audit.
 *
 * ⛔ AND A CHANGE IS ANNOUNCED TO THE SELLER, IN BOTH LANGUAGES. Masking the account on read protects the direction
 * worth least; a single authenticated write redirects every future payment, and a stolen session
 * needs exactly one. The email is what an attacker cannot suppress.
 *
 * ⚠️ AND NOTHING READS IT BACK IN FULL. A GET returns whether the seller is payable and the LAST
 * FOUR digits, never the account number: the person editing it already knows it, and a session
 * hijack should not be able to read out where someone's money goes.
 */

/**
 * ⛔ THE SAME SHAPES `vietqrPayoutReady` AND THE QR BUILDER REQUIRE. A NAPAS acquirer BIN is exactly
 * six digits and a Vietnamese account number is digits only — validating loosely here would let a
 * seller save details that pass this route and then silently fail to render a QR at checkout, which
 * is the worst place to discover it.
 */
const payoutSchema = z.object({
  bankBin: z.string().trim().regex(/^\d{6}$/),
  bankAccountNo: z.string().trim().regex(/^\d{4,19}$/),
  bankAccountName: z.string().trim().min(2).max(120),
})

async function sellerIdFor(userId: string): Promise<string | null> {
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  return seller?.id ?? null
}

export const PUT = route(
  {
    auth: 'userId',
    body: payoutSchema as unknown as z.ZodTypeAny,
    invalidBodyCode: 'invalid_body',
    // ⚠️ STRICT: changing where money is sent is exactly the action a limiter outage must not wave
    // through, and no honest seller edits their bank account ten times an hour.
    rateLimit: { bucket: 'seller-payout', limit: 10, window: '1 h', strict: true },
  },
  async ({ userId, body }) => {
    const sellerId = await sellerIdFor(userId)
    if (!sellerId) return Response.json({ error: 'not_found' }, { status: 404 })

    const details = body as z.infer<typeof payoutSchema>
    /**
     * ⚠️ CHECKED AGAINST THE RAIL'S OWN PREDICATE, not just the schema. The two agree today, and
     * this is what keeps them agreeing: a seller must never be able to save details the checkout
     * will then refuse to draw a code from.
     */
    if (!vietqrPayoutReady(details)) return Response.json({ error: 'invalid_body' }, { status: 400 })

    const before = await db.sellerPayout.findUnique({
      where: { sellerId },
      select: { bankAccountNo: true, bankBin: true },
    })

    await db.sellerPayout.upsert({
      where: { sellerId },
      create: { sellerId, ...details },
      update: details,
    })

    /**
     * ⛔ THE SELLER IS TOLD THEIR PAYOUT ACCOUNT CHANGED, AND THIS IS THE POINT OF THE ENDPOINT'S
     * SECURITY. Two reviewers found the same hole independently: masking the account on READ
     * protects the low-value direction, while a single authenticated WRITE silently redirects every
     * future payment. A stolen session needs exactly one request. Step-up authentication is the
     * fuller answer and is not built; a notification the attacker cannot suppress is the half that
     * costs nothing and is what makes the theft visible the same minute.
     *
     * ⚠️ ONLY ON A CHANGE. Re-saving the same details is a seller correcting a typo in the holder
     * name, and an alert for that trains people to ignore the one that matters.
     * ⚠️ AND IT NEVER FAILS THE SAVE. A seller must not be unable to fix their bank details because
     * an email provider is down — the write is the durable fact, the warning is a consequence.
     * ⚠️ THE EMAIL CARRIES THE LAST FOUR ONLY, for the same reason the GET does.
     */
    const changed = !before || before.bankAccountNo !== details.bankAccountNo || before.bankBin !== details.bankBin
    if (changed) {
      /**
       * ⛔ PUSH AS WELL AS EMAIL, BECAUSE NOT EVERY SELLER HAS AN EMAIL ADDRESS. A reviewer found
       * the premise of this whole control — "a notification the attacker cannot suppress" — silently
       * absent for a class of users: sign-in also works by phone OTP, so `Profile.email` can be
       * null and those sellers got nothing at all. Push reaches an app the attacker is not holding.
       * ⚠️ AND WHEN NEITHER CHANNEL EXISTS THE GAP IS LOGGED RATHER THAN SHRUGGED AT. A payout
       * redirected with no way to tell anyone is the state worth being able to find afterwards.
       */
      try {
        await sendPushToProfile(userId, {
          title: 'Payout account changed / Tài khoản nhận tiền đã đổi',
          body: `Now ending ${details.bankAccountNo.slice(-4)}. If this was not you, contact support.`,
          url: '/dashboard/payout',
          tag: `payout-${sellerId}`,
        })
      } catch { /* a dead push subscription is not a reason to fail the save */ }

      try {
        const profile = await db.profile.findUnique({ where: { id: userId }, select: { email: true } })
        if (!profile?.email) {
          logWarn('payout account changed but the seller has no email to warn', {
            at: 'seller.payout.no_channel', sellerId,
          })
        }
        if (profile?.email) {
          const last4 = esc(details.bankAccountNo.slice(-4))
          const origin = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
          // ⚠️ THE SUPPORT ADDRESS FOLLOWS THE EDITION. A reviewer spotted `support@eno.vn`
          // hardcoded in mail this endpoint only ever sends from eno.forum — pointing a hijacked
          // seller at the wrong company's inbox at the moment they most need the right one.
          const supportAddress = `support@${SITE_NAME}`
          // ⚠️ THROUGH `renderBrandEmail`, NOT HAND-ROLLED HTML — the house rule, and it is what
          // gives this the same header, footer and unsubscribe handling as every other message. An
          // alert that does not look like the rest of our mail is one people distrust or miss.
          /**
           * ⛔ NOT "CHANGE YOUR PASSWORD" — THERE IS NO PASSWORD. All three reviewers caught it
           * independently, and it is the worst possible place for advice that cannot be followed:
           * the one alert that matters, telling a seller whose account was just hijacked to do
           * something this platform does not have. Sign-in is a magic link or an OTP, so the action
           * that actually helps is ending every other session and telling us.
           */
          /**
           * ⛔ BOTH LANGUAGES IN ONE EMAIL, NOT THE RECIPIENT'S STORED PREFERENCE. A reviewer caught
           * this shipping English only — on a marketplace whose sellers are largely Vietnamese
           * speakers, for the single message where not understanding it costs someone their money.
           * A security alert is the wrong place to depend on a preference being set correctly, or
           * on a machine translation being available at send time. Both, always, English first
           * because that is the source of record.
           */
          const bodyHtml =
            `<p>The bank account that receives your ${esc(SITE_NAME)} payments was just changed to one ending <b>${last4}</b>.</p>` +
            `<p><b>If this was not you:</b> sign out everywhere from Settings, then email ` +
            `<a href="mailto:${supportAddress}">${supportAddress}</a> straight away. ` +
            `Do not use any sign-in link you did not request yourself.</p>` +
            `<hr>` +
            `<p>Tài khoản ngân hàng nhận thanh toán ${esc(SITE_NAME)} của bạn vừa được đổi sang tài khoản kết thúc bằng <b>${last4}</b>.</p>` +
            `<p><b>Nếu không phải bạn:</b> hãy đăng xuất khỏi mọi thiết bị trong phần Cài đặt, rồi gửi email tới ` +
            `<a href="mailto:${supportAddress}">${supportAddress}</a> ngay. ` +
            `Không sử dụng bất kỳ liên kết đăng nhập nào bạn không tự yêu cầu.</p>`
          await sendMail({
            to: profile.email,
            subject: `Your payout account was changed / Tài khoản nhận tiền đã thay đổi — ${SITE_NAME}`,
            html: renderBrandEmail({ preheader: 'Your payout account was changed', bodyHtml, origin }),
            text:
              `The bank account that receives your ${SITE_NAME} payments was just changed to one ending ${details.bankAccountNo.slice(-4)}.\n` +
              `If this was not you: sign out everywhere from Settings, then email ${supportAddress} straight away. ` +
              `Do not use any sign-in link you did not request yourself.\n\n` +
              `Tai khoan ngan hang nhan thanh toan cua ban vua duoc doi sang tai khoan ket thuc bang ${details.bankAccountNo.slice(-4)}.\n` +
              `Neu khong phai ban: hay dang xuat khoi moi thiet bi trong phan Cai dat, roi gui email toi ${supportAddress} ngay. ` +
              // ⚠️ THE LAST SENTENCE WAS MISSING FROM THE VIETNAMESE PLAIN TEXT. A reviewer caught
              // the half-translation: the HTML carried it, the text did not, so a client that shows
              // plain text dropped the one instruction that stops a hijack continuing.
              `Khong su dung bat ky lien ket dang nhap nao ban khong tu yeu cau.`,
          })
        }
      } catch { /* a warning that could not be sent must not stop a seller fixing their details */ }
    }

    return Response.json({ ok: true }, { status: 200, headers: { 'cache-control': 'no-store' } })
  },
)

export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const sellerId = await sellerIdFor(userId)
  if (!sellerId) return Response.json({ error: 'not_found' }, { status: 404 })

  const payout = await db.sellerPayout.findUnique({
    where: { sellerId },
    select: { bankBin: true, bankAccountNo: true, bankAccountName: true },
  })

  /**
   * ⛔ THE LAST FOUR DIGITS, NEVER THE NUMBER. Enough for a seller to recognise which account they
   * saved; not enough for anyone who reaches this endpoint with a stolen session to learn where the
   * money goes. The same reasoning a card form uses, and for the same reason.
   */
  return Response.json(
    {
      configured: vietqrPayoutReady(payout),
      bankBin: payout?.bankBin ?? null,
      accountLast4: payout?.bankAccountNo ? payout.bankAccountNo.slice(-4) : null,
      bankAccountName: payout?.bankAccountName ?? null,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
})
