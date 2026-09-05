import type { PublishBlockCode } from '@/lib/publish-guard'
import { ACCOUNT_STATE, type VerificationStatus } from './account-state'
import { LEGAL_BASIS } from './legal-basis'

// ── The structured refusal a blocked publish returns ────────────────────────────────────────────
//
// ⚠️ A BLOCKED PUBLISH IS A UX MOMENT, NOT AN ERROR. The user just finished writing a listing —
// photos, price, description — and is being told they cannot post it. A bare 403 loses that work
// and teaches them the site is broken. The response therefore carries everything the client needs
// to route them onward and back: what happened, why, where to go, and what to do with the draft.
//
// ⚠️ 403, NOT 401. 401 means "log in", and every HTTP client in the world (including our own
// fetch wrapper) treats it as a session problem — some will silently redirect to /signin, which
// would bounce a signed-in user to a login page for a verification issue. They ARE authenticated;
// they are not permitted. That is 403.

export type PublishBlockedBody = {
  error: 'publish_blocked'
  code: PublishBlockCode
  /** Public account state, e.g. PENDING_VERIFICATION — the contract the client branches on. */
  accountState: string | null
  /** Can the user fix this themselves right now? Drives whether we show a CTA or a support link. */
  actionable: boolean
  /** Where to send them. null when there is nowhere useful to go (suspension). */
  verifyUrl: string | null
  /** Human-readable, bilingual. The client MAY override with its own copy. */
  message: { en: string; vi: string }
  /** Cited only for the legal blocks — never on a "your photo is blurry" refusal. */
  legalBasis?: { en: string; vi: string }
  /** ⚠️ Tells the client to KEEP the draft rather than discard it on a non-2xx. */
  draftPreserved: boolean
}

const IDENTITY_CODES = new Set<PublishBlockCode>([
  'identity_unverified', 'identity_pending', 'identity_expired', 'identity_suspended',
])

const COPY: Record<string, { en: string; vi: string }> = {
  identity_unverified: {
    // ⚠️ "YOUR CCCD", NOT "VNeID" — VNeID is not wired and the flow photographs a card.
    en: 'Vietnamese law requires sellers to verify their identity before publishing. It takes about two minutes — your CCCD if you are a Vietnamese citizen, or your passport if you are a foreign resident.',
    vi: 'Theo quy định của pháp luật Việt Nam, người bán phải xác minh danh tính trước khi đăng tin. Việc này mất khoảng hai phút — dùng thẻ CCCD nếu bạn là công dân Việt Nam, hoặc hộ chiếu nếu bạn là người nước ngoài cư trú tại Việt Nam.',
  },
  identity_pending: {
    // ⚠️ "WITHIN A WORKING DAY", NOT "A FEW MINUTES" — a person reviews it, and every other surface
    // says a working day. The email promise is now true: see lib/kyc/notify-outcome.ts.
    en: 'Your documents are being reviewed by a person on our team, usually within a working day. We will let you know the result in your dashboard and by email, and your draft is saved.',
    vi: 'Hồ sơ của bạn đang được nhân viên của chúng tôi xem xét, thường trong một ngày làm việc. Chúng tôi sẽ thông báo kết quả trong bảng điều khiển và qua email, và bản nháp của bạn đã được lưu.',
  },
  identity_expired: {
    // ⚠️ Deliberately NOT phrased as a failure. This person DID verify; a document lapsed. Telling
    // them "you are not verified" is both wrong and insulting to a long-standing seller.
    en: 'Your residence document has expired. Upload the renewed one to keep publishing — your account, listings and trust score are unaffected.',
    vi: 'Giấy tờ cư trú của bạn đã hết hạn. Vui lòng tải lên giấy tờ đã gia hạn để tiếp tục đăng tin — tài khoản, tin đăng và điểm tin cậy của bạn không bị ảnh hưởng.',
  },
  identity_suspended: {
    en: 'Publishing is suspended on this account. Our team has emailed you the details and how to respond.',
    vi: 'Tài khoản này đang bị tạm ngừng quyền đăng tin. Đội ngũ của chúng tôi đã gửi email cho bạn kèm chi tiết và cách phản hồi.',
  },
}

/**
 * Build the refusal body.
 *
 * ⚠️ ONLY THE IDENTITY BLOCKS CITE THE LAW. Quoting a decree at someone whose photo has glare is
 * both wrong and intimidating — and it trains users to ignore the citation on the one refusal
 * where it actually matters.
 */
export function publishBlockedBody(
  code: PublishBlockCode,
  status?: VerificationStatus | null,
): PublishBlockedBody {
  const isIdentity = IDENTITY_CODES.has(code)
  const suspended = code === 'identity_suspended'
  return {
    error: 'publish_blocked',
    code,
    accountState: status ? ACCOUNT_STATE[status] : null,
    // ⚠️ `account_restricted` IS NOT ACTIONABLE EITHER (agy). It means the trust score is too low to
    // publish, which no button can fix right now — offering a call-to-action there sends the seller
    // hunting for a control that does not exist. Only blocks the user can actually clear are
    // actionable: the identity ones (except suspension) and the content ones.
    actionable: isIdentity ? !suspended : code !== 'account_restricted',
    verifyUrl: isIdentity && !suspended ? '/dashboard/account/verify' : null,
    message: COPY[code] ?? {
      en: 'This listing cannot be published yet.',
      vi: 'Tin đăng này chưa thể được đăng.',
    },
    ...(isIdentity
      ? { legalBasis: { en: LEGAL_BASIS.identityDecree.en, vi: LEGAL_BASIS.identityDecree.vi } }
      : {}),
    // ⚠️ ALWAYS TRUE for identity blocks: the server must have persisted the draft before
    // returning this, or the promise is a lie and the user loses their work.
    draftPreserved: isIdentity,
  }
}

/** HTTP status for a block. See the 403-not-401 note above. */
export const PUBLISH_BLOCKED_STATUS = 403
