import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { containsPhoneNumber } from '@/lib/phone'
import { RENTAL_DESK_SELLER_IDS } from '@/lib/rental-check/desk-ids'
import { JOBS_DESK_SELLER_ID } from '@/lib/teachers/job-dms/constants'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'

/**
 * WHAT AN AI AGENT MAY WRITE IN eno CHAT — the label and the contact/payment rule, shared by the two ways an agent writes:
 * the MCP messaging tools (src/lib/mcp/messaging-tools.ts, which re-exports these) and a browser agent's WebMCP
 * start_seller_chat (src/lib/webmcp-script.ts → POST /api/conversations with agent "webmcp"). Moved here unchanged
 * (2026-11-19) so the chat route can apply them without importing the MCP tools, which import the chat routes.
 */

/** eno's own desks: an agent negotiates with people, never with eno (the thread route's DESK_BY_SELLER_ID + support). */
export const ENO_DESK_SELLER_IDS: ReadonlySet<string> = new Set<string>([...RENTAL_DESK_SELLER_IDS, JOBS_DESK_SELLER_ID, SUPPORT_SELLER_ID])

/** New conversations a person's MCP agents may open a day (bucket 'agent-thread-new'); WebMCP's start_seller_chat gets the
 *  same number of calls a day in a bucket of its own ('agent-webmcp-chat'), so neither can use up the other's. */
export const AGENT_NEW_THREADS_PER_DAY = 10

/** Every text an agent sends starts with this, so the other person sees it on every surface that shows the body. */
export const AI_PREFIX = '🤖 AI: '

const OWN_HOST = new URL(OAUTH_ISSUER).hostname.replace(/^www\./, '')

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i
const URLISH = /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|vn|io|me|co|info|xyz|top|shop|link|ly|app|site|online|store|biz|gg|to|cc)\b(?:\/[^\s]*)?/gi
/** One number as written: digits with . or , inside ("35.000.000", "0912345678"). A range "35.000.000 - 36.000.000"
 *  is two numbers, never one long run (gate review 2026-11-17). */
const NUMBER = /\d[\d.,]*\d|\d/g
/** An account number typed in blocks, "1903 4567 8910 12": three or more blocks of 3–4 digits split by one space or dash. */
const BLOCKED_DIGITS = /\b\d{3,4}(?:[ -]\d{2,4}){2,}\b/g
/** A price written the Vietnamese way (35.000.000) or the English way (35,000,000). Never one starting with 0: that is
 *  a phone or an account number in dots (091.234.567). */
const GROUPED_AMOUNT = /^[1-9]\d{0,2}(?:[.,]\d{3})+$/
/** Bank and account words (EN + VI, and the big VN banks and wallets): beside a 9+ digit number, it is an account. */
const ACCOUNT_WORDS = /\b(?:stk|số\s*tk|số\s*tài\s*khoản|tài\s*khoản|account\s*(?:number|no\.?)|acc\s*no|iban|swift|bank\s*transfer|chuyển\s*khoản|ngân\s*hàng|vietcombank|vcb|techcombank|tcb|bidv|agribank|vietinbank|acb|vpbank|tpbank|sacombank|mb\s*bank|momo|zalopay|vnpay)\b/i
/** Moving the chat off eno: a chat app named, or an @handle. */
const OFF_APP = /\b(?:zalo|telegram|whats\s?app|viber|wechat|kakao|signal|line\s+id|messenger|instagram|facebook|fb)\b|(?:^|\s)@[a-z0-9_.]{3,}/i

/** Why an agent's text may not be sent, or null. People's chat has no such rule; an agent's does (see the header). */
export function agentTextProblem(raw: string): string | null {
  // Checked as a reader sees it: full-width digits and letters folded (NFKC), zero-width and joiner characters dropped,
  // so "０９０１…" or a digit run split by U+200B is the number it shows as.
  const text = raw.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
  if (containsPhoneNumber(text)) return 'It contains a phone number.'
  if (EMAIL.test(text)) return 'It contains an email address.'
  if (OFF_APP.test(text)) return 'It moves the chat to another app or handle.'
  for (const m of text.matchAll(URLISH)) {
    const host = m[0].replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#:]/)[0].toLowerCase()
    if (host !== OWN_HOST && !host.endsWith(`.${OWN_HOST}`)) return 'It contains a link to another site.'
  }
  const LONG = 'It contains a long number (an account or phone number?). Write amounts grouped, such as 3.500.000 đ.'
  const accountTalk = ACCOUNT_WORDS.test(text)
  for (const m of text.matchAll(NUMBER)) {
    const digits = m[0].replace(/\D/g, '').length
    if (digits < 9) continue
    // 35.000.000 is a price — unless the text is about a bank account, where any 9+ digit number is the account.
    if (GROUPED_AMOUNT.test(m[0]) && !accountTalk) continue
    return accountTalk ? 'It looks like a bank account number. Payment is arranged between the people themselves, never by an agent.' : LONG
  }
  for (const m of text.matchAll(BLOCKED_DIGITS)) if (m[0].replace(/\D/g, '').length >= 9) return LONG
  return null
}

export const CONTACT_RULE = 'Keep contact details and payment details out of agent messages: people arrange those themselves in the app.'
