/**
 * The home page's questions and answers (owner 2026-11-17, from the AEO checker's "FAQPage or HowTo schema" and "FAQ/Q&A
 * patterns": "fix ALL of these"). Drawn at the end of the home page AND sent as FAQPage JSON-LD, from these same pairs,
 * so the markup never says what the page does not show (Google's rule for FAQ structured data).
 *
 * ⛔ EVERY ANSWER IS COPY THAT ALREADY STANDS ELSEWHERE, NOT NEW CLAIMS: "free" from /about's Cost row (gated on
 * POSTING_IS_FREE, as that row is); posting from the help article help-how-to-post-a-listing; contacting a seller from
 * help-how-to-contact-seller; payments from help-is-eno-free-fees and /about's Payments row; trust from /about's lede.
 * Posting says "most listings": a listing in a licence-checked aisle (e-Visa, Legal & permits) waits for an admin.
 * Change one there, change it here.
 * ⚠️ `{site}` is the edition's SITE_NAME, filled after translation (Bilingual `values`), so eno.forum never names eno.vn.
 * ⚠️ Each string stays under 200 characters: gen-ui-strings harvests `{ en, vi }` pairs up to that length, so the nine
 * machine-translated languages get them in the bundled catalogue.
 */
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { POSTING_IS_FREE } from '@/lib/site-identity'

export type FaqText = { en: string; vi: string }
export type FaqPair = { q: FaqText; a: FaqText }

export const HOME_FAQ_HEADING: FaqText = { en: 'Questions about {site}', vi: 'Câu hỏi thường gặp về {site}' }

const FREE: FaqPair = {
  q: { en: 'Is {site} free to use?', vi: 'Dùng {site} có mất phí không?' },
  a: {
    en: 'Browsing, posting and contacting sellers are currently free, and {site} takes no commission on what you sell.',
    vi: 'Hiện tại, việc xem tin, đăng tin và liên hệ người bán đều miễn phí, và {site} không thu hoa hồng trên những gì bạn bán.',
  },
}
const POST: FaqPair = {
  q: { en: 'How do I post a listing?', vi: 'Làm sao để đăng tin?' },
  a: {
    en: 'Go to {site}/post, add photos, a description, a category, a price and an area, then publish. Most listings go live as soon as they pass the checks.',
    vi: 'Vào {site}/post, thêm ảnh, mô tả, danh mục, giá và khu vực rồi đăng. Phần lớn tin đăng hiển thị ngay khi vượt qua bước kiểm tra.',
  },
}
const CONTACT: FaqPair = {
  q: { en: 'How do I contact a seller?', vi: 'Làm sao để liên hệ người bán?' },
  a: {
    en: 'Open the listing and tap the message button to chat about that item; you need to be signed in. The seller’s phone or Zalo appears in the chat once they reply.',
    vi: 'Mở tin đăng và bấm nút nhắn tin để trò chuyện về món đó; bạn cần đăng nhập. Số điện thoại hoặc Zalo của người bán sẽ hiện trong cuộc trò chuyện khi họ trả lời.',
  },
}
/**
 * ⛔ THE SCAM SENTENCE IS THE MARKETPLACE'S ONLY. On eno.forum the e-Visa desk is eno's own and settles payment with the
 * applicant in its chat (owner, 2026-09-13), so "anyone asking you to pay eno.forum is running a scam" would brand the
 * forum's one paid service a fraud — on its home page and in its FAQPage markup (gate review, 2026-11-17).
 */
const PAY_Q: FaqText = { en: 'How do payments work?', vi: 'Thanh toán như thế nào?' }
const PAY: FaqPair = IS_MARKETPLACE
  ? {
      q: PAY_Q,
      a: {
        en: 'There is no checkout and no escrow: you pay the seller directly, after checking the item. Anyone asking you to pay {site} or into an “eno escrow” is running a scam.',
        vi: 'Không có thanh toán qua sàn hay ký quỹ: bạn trả tiền trực tiếp cho người bán sau khi đã kiểm tra món hàng. Ai bảo bạn chuyển tiền cho {site} hay “ký quỹ eno” là lừa đảo.',
      },
    }
  : {
      q: PAY_Q,
      a: {
        en: 'There is no checkout and no escrow: you pay the seller directly.',
        vi: 'Không có thanh toán qua sàn hay ký quỹ: bạn trả tiền trực tiếp cho người bán.',
      },
    }
const TRUST: FaqPair = {
  q: { en: 'How do I know a seller is genuine?', vi: 'Làm sao biết người bán là thật?' },
  a: {
    en: 'A seller who posts from an account shows a public trust score, or an official partner badge, and anyone can report a listing that is not what it claims to be.',
    vi: 'Người bán đăng tin từ tài khoản có điểm uy tín công khai, hoặc huy hiệu đối tác chính thức, và ai cũng có thể báo cáo tin đăng không đúng như mô tả.',
  },
}
/** Marketplace only: the Claude connector, the MCP Registry entries and /developers/mcp all name eno.vn. */
const AGENTS: FaqPair = {
  q: { en: 'Can my AI assistant use {site}?', vi: 'Trợ lý AI có dùng được {site} không?' },
  a: {
    en: 'Yes. Connect Claude or any MCP client to search listings and, once you sign in, to post, message and negotiate. Agent messages are labelled 🤖 AI; only you accept an offer.',
    vi: 'Có. Kết nối Claude hoặc ứng dụng MCP bất kỳ để tìm tin, và sau khi đăng nhập, để đăng tin, nhắn tin và trả giá. Tin nhắn của AI được gắn nhãn 🤖 AI; chỉ bạn mới chấp nhận đề nghị.',
  },
}

export const HOME_FAQ: readonly FaqPair[] = [
  ...(POSTING_IS_FREE ? [FREE] : []),
  POST,
  CONTACT,
  PAY,
  TRUST,
  ...(IS_MARKETPLACE ? [AGENTS] : []),
]

/** `{site}` → SITE_NAME, as Bilingual's `values` fills it on the page. */
export const fillSite = (s: string) => s.split('{site}').join(SITE_NAME)

/** FAQPage JSON-LD in the server variant's language (en, or vi on the vi variant), from the same pairs the page draws. */
export function homeFaqJsonLd(lang: string): Record<string, unknown> {
  const pick = (t: FaqText) => fillSite(lang === 'vi' ? t.vi : t.en)
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: lang === 'vi' ? 'vi' : 'en',
    mainEntity: HOME_FAQ.map((p) => ({ '@type': 'Question', name: pick(p.q), acceptedAnswer: { '@type': 'Answer', text: pick(p.a) } })),
  }
}
