import type { IdentityBlockCode, PublishBlockCode } from '@/lib/publish-guard'
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

// ⚠️ `satisfies` FORCES THIS LIST TO BE COMPLETE: a sixth identity code added to PublishBlockCode
// without being added here fails the build, instead of silently answering it as a content block
// (no legal citation, no verify link, a 400 where the contract says 403).
const IDENTITY_CODE_LIST = [
  'identity_unverified', 'identity_pending', 'identity_expired', 'identity_suspended', 'identity_sign_in_required',
] as const satisfies readonly IdentityBlockCode[]
type _EveryIdentityCodeListed = Exclude<IdentityBlockCode, (typeof IDENTITY_CODE_LIST)[number]> extends never ? true : never
const _everyIdentityCodeListed: _EveryIdentityCodeListed = true
void _everyIdentityCodeListed
const IDENTITY_CODES = new Set<PublishBlockCode>(IDENTITY_CODE_LIST)

/** Is this one of the LEGAL (identity) blocks — the ones answered 403 with the structured body? */
export function isIdentityBlockCode(code: unknown): code is IdentityBlockCode {
  return typeof code === 'string' && IDENTITY_CODES.has(code as PublishBlockCode)
}

const COPY: Record<string, { en: string; vi: string }> = {
  identity_unverified: {
    // ⚠️ "YOUR CCCD", NOT "VNeID" — VNeID is not wired and the flow photographs a card.
    en: 'Vietnamese law requires sellers to verify their identity before publishing. It takes about two minutes — your CCCD if you are a Vietnamese citizen, or your passport if you are a foreign resident.',
    vi: 'Theo quy định của pháp luật Việt Nam, người bán phải xác minh danh tính trước khi đăng tin. Việc này mất khoảng hai phút — dùng thẻ CCCD nếu bạn là công dân Việt Nam, hoặc hộ chiếu nếu bạn là người nước ngoài cư trú tại Việt Nam.',
  },
  identity_pending: {
    // ⚠️ "WITHIN A WORKING DAY", NOT "A FEW MINUTES" — a person reviews it, and every other surface
    // says a working day. The email promise is now true: see lib/kyc/notify-outcome.ts.
    en: 'Your documents are being reviewed by a person on our team, usually within a working day. We will let you know the result in your dashboard and by email.',
    vi: 'Hồ sơ của bạn đang được nhân viên của chúng tôi xem xét, thường trong một ngày làm việc. Chúng tôi sẽ thông báo kết quả trong bảng điều khiển và qua email.',
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
  identity_sign_in_required: {
    // ⚠️ A GUEST, NOT AN UNVERIFIED ACCOUNT — there is nothing to verify until they have an account,
    // so the sentence has to name both steps in order.
    // ⚠️ NO "YOUR DRAFT IS SAVED" IN ANY OF THIS COPY. It goes to API and MCP clients whose drafts the
    // server never stored (every refusal happens before the first write), so the promise would be
    // false wherever it was read. The in-app wording lives in src/lib/identity-block-copy.ts.
    en: 'Vietnamese law requires sellers to verify their identity before publishing. Sign in or create an account, then verify — it takes about two minutes.',
    vi: 'Theo quy định của pháp luật Việt Nam, người bán phải xác minh danh tính trước khi đăng tin. Hãy đăng nhập hoặc tạo tài khoản, sau đó xác minh — mất khoảng hai phút.',
  },
}

/** Where a guest goes: sign-in first, landing on the verify page afterwards. */
const GUEST_VERIFY_URL = '/signin?next=/dashboard/account/verify'

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
  opts: { draftPreserved?: boolean } = {},
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
    verifyUrl: !isIdentity || suspended ? null : code === 'identity_sign_in_required' ? GUEST_VERIFY_URL : '/dashboard/account/verify',
    message: COPY[code] ?? {
      en: 'This listing cannot be published yet.',
      vi: 'Tin đăng này chưa thể được đăng.',
    },
    ...(isIdentity
      ? { legalBasis: { en: LEGAL_BASIS.identityDecree.en, vi: LEGAL_BASIS.identityDecree.vi } }
      : {}),
    // ⚠️ TRUE ONLY WHEN THE CALLER SAYS IT PERSISTED SOMETHING. The flag promises the server kept the
    // draft; no route does today (createListingCore and bulkImportCore refuse before any write), so
    // every current caller answers false. It was `isIdentity` until 2026-09-23, which told every
    // refused client its work was saved when nothing had been stored. A future path that really
    // saves the draft before refusing passes `{ draftPreserved: true }`.
    draftPreserved: opts.draftPreserved === true,
  }
}

/** HTTP status for a block. See the 403-not-401 note above. */
export const PUBLISH_BLOCKED_STATUS = 403

/**
 * The SESSION-route body for an identity block: the structured refusal, with `error` carrying the
 * CODE rather than 'publish_blocked'.
 *
 * ⚠️ `error: code` IS THE COMPATIBILITY CONTRACT, NOT AN OVERSIGHT. Every existing client branches on
 * `body.error` (the post wizard's `msg === 'identity_…'`, the publish funnel's outcome bucket,
 * native builds already in people's pockets), and those answered `{ error: code }` before this body
 * existed. The richer fields ride alongside; nothing that read the old shape loses its answer.
 */
/**
 * The account state an identity code stands for, so a 403 carries `accountState` even where the
 * caller holds only the code (every route below). Without this both helpers answered a pending seller
 * with accountState: null while the message said "being reviewed" — a client branching on
 * accountState mis-routed them. `identity_unverified` also covers a REJECTED document; both mean
 * "no usable verification yet" and share the unverified state's call to action.
 */
const STATE_FOR_CODE: Partial<Record<IdentityBlockCode, VerificationStatus>> = {
  identity_unverified: 'unverified',
  identity_pending: 'pending',
  identity_expired: 'expired',
  identity_suspended: 'revoked',
  // identity_sign_in_required: no account, so no state — null is the honest answer.
}

export function publishBlockedJson(code: IdentityBlockCode): Omit<PublishBlockedBody, 'error'> & { error: IdentityBlockCode } {
  return { ...publishBlockedBody(code, STATE_FOR_CODE[code] ?? null), error: code }
}

/**
 * The /api/v1 body for an identity block. The partner API's envelope is `{ error: { code, message } }`
 * (src/lib/api/respond.ts) and generated clients parse exactly that, so the code and an English
 * message stay there and the structured fields ride at the top level.
 */
export function publishBlockedV1(code: IdentityBlockCode): Omit<PublishBlockedBody, 'error'> & { error: { code: IdentityBlockCode; message: string } } {
  const body = publishBlockedBody(code, STATE_FOR_CODE[code] ?? null)
  return { ...body, error: { code, message: body.message.en } }
}
