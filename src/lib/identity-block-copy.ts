// ── What a SELLER-FACING surface says when the identity gate refuses a publish ─────────────────
//
// Client-safe (no imports), shared by the post wizard, the bulk importer and the dashboard's
// relist action so the three can never tell the same seller three different things. The server's
// publishBlockedBody() carries its own bilingual copy for API clients; these are the in-app words,
// shorter because they sit next to a button that does the next step.
//
// ⚠️ `tr(en, vi)` WITH LITERAL ARGUMENTS, AND NO APOSTROPHES IN THE ENGLISH. scripts/gen-ui-strings.mjs
// harvests `tr('…'` by regex over single-quoted literals only — a message built from a variable, or
// an English half needing double quotes, silently never reaches the translation catalogue (the same
// trap post-wizard.tsx documents above its own error ladder).
//
// ⚠️ NO "YOUR DRAFT IS SAVED". Nothing saves it: the wizard's localStorage draft is text-only and
// expires in 15 minutes, and a pending review takes a working day. The wizard instead opens the
// verify page in a NEW TAB so the form, photos included, stays open.

type Tr = (en: string, vi: string) => string

/** The in-app sentence for an identity refusal, or null when `code` is not one. */
export function identityBlockMessage(code: unknown, tr: Tr): string | null {
  switch (code) {
    case 'identity_unverified':
      return tr('Vietnamese law requires sellers to verify their identity before publishing. It takes about two minutes.', 'Theo quy định của pháp luật Việt Nam, người bán phải xác minh danh tính trước khi đăng tin. Chỉ mất khoảng hai phút.')
    case 'identity_pending':
      return tr('Your identity check is still being reviewed, usually within a working day. You can publish as soon as it is approved.', 'Hồ sơ xác minh danh tính của bạn đang được xem xét, thường trong một ngày làm việc. Bạn có thể đăng tin ngay khi được duyệt.')
    case 'identity_expired':
      return tr('Your identity document has expired. Upload the renewed one to keep publishing.', 'Giấy tờ tùy thân của bạn đã hết hạn. Hãy tải lên giấy tờ mới để tiếp tục đăng tin.')
    case 'identity_suspended':
      return tr('Publishing is suspended on this account. Check your email for the details.', 'Tài khoản này đang bị tạm ngừng quyền đăng tin. Vui lòng xem email để biết chi tiết.')
    case 'identity_sign_in_required':
      return tr('Sellers must verify their identity before publishing. Sign in or create an account, then verify.', 'Người bán phải xác minh danh tính trước khi đăng tin. Hãy đăng nhập hoặc tạo tài khoản, sau đó xác minh.')
    default:
      return null
  }
}

/**
 * The next step the refusal offers: go and verify, sign in first (a guest), or nothing a button
 * can do (suspension — support handles it).
 */
export function identityBlockAction(code: unknown): 'verify' | 'sign_in' | null {
  // Pending goes to the verify page too — it shows where the review stands.
  if (code === 'identity_unverified' || code === 'identity_expired' || code === 'identity_pending') return 'verify'
  if (code === 'identity_sign_in_required') return 'sign_in'
  return null
}

export const IDENTITY_VERIFY_PATH = '/dashboard/account/verify'
