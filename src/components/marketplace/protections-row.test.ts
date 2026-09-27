import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE LISTING PAGE'S REPORTS-AND-DISPUTES COPY IS AN APPROVED SHEET, NOT FREE TEXT (SEO wave B,
 * P0, copy sheet CS-0).
 *
 * It replaced "ENO protects you — disputes handled in 72h · listings screened", three claims the code
 * never made true. Every sentence of the replacement was checked against the line that makes it
 * true, and the owner approves the English and the Vietnamese together. So this file pins:
 *  - the exact EN/VI pairs, in order — an edit to either language has to come with a new sheet;
 *  - no protection, guarantee or screening wording, in either language;
 *  - no deadline (72 hours, 7 or 15 working days) while the Regulations and the code disagree
 *    (plan decisions P0-a, P0-c);
 *  - the photo limit, in both languages, equal to DISPUTE_IMAGES_MAX. `src/lib/dispute.ts` is
 *    server-only, so the component cannot import it and the number is read here from its text;
 *  - the /safety heading that the dialog links to, renamed with it (decision P0-b).
 */

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const ROW = read('src/components/marketplace/protections-row.tsx')
const SAFETY = read('src/app/[lang]/safety/page.tsx')
const DISPUTE = read('src/lib/dispute.ts')

/** The same pattern e2e/ci/protections-row.spec.ts applies to what renders. */
const FORBIDDEN = /protect|guarantee|screened|reviewed before|bảo vệ|đảm bảo|kiểm duyệt/i
const DEADLINE = /\b72\s*h?\b|working days?|ngày làm việc/i

/** Every tr(English, Vietnamese) call with two string literals, in source order, quotes unescaped. */
function trPairs(src: string): [string, string][] {
  const lit = String.raw`(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")`
  const re = new RegExp(String.raw`\btr\(\s*${lit}\s*,\s*${lit}\s*,?\s*\)`, 'g')
  const unesc = (s: string) => s.replace(/\\(['"\\])/g, '$1')
  return [...src.matchAll(re)].map((m) => [unesc(m[1] ?? m[2]), unesc(m[3] ?? m[4])])
}

/** CS-0 as approved, in the order the component renders it. */
const CS0: [string, string][] = [
  ["Report from the listing, the seller's page or a chat", 'Báo cáo ngay trên tin đăng, trang người bán hoặc cuộc trò chuyện'],
  [
    "Tap Report (you'll need to sign in). A report opens a private case between you, the seller and our team, which you can follow under Disputes.",
    'Bấm Báo cáo (cần đăng nhập). Báo cáo sẽ mở một hồ sơ riêng giữa bạn, người bán và đội ngũ của chúng tôi, và bạn theo dõi được trong mục Khiếu nại.',
  ],
  ['Both sides can send evidence', 'Hai bên đều được gửi bằng chứng'],
  [
    "You can send one statement with up to 6 photos before the deadline shown on the case. If the seller has an account, they're told about the case and can do the same, but we never tell them who reported it. If the seller doesn't respond before the deadline, the case is decided on what we have.",
    'Bạn được gửi một lần trình bày, kèm tối đa 6 ảnh, trước hạn chót ghi trên hồ sơ. Nếu người bán có tài khoản, họ được thông báo về hồ sơ và cũng được gửi như vậy, nhưng chúng tôi không bao giờ cho họ biết ai đã báo cáo. Nếu người bán không phản hồi trước hạn chót, hồ sơ được quyết định dựa trên những gì đã có.',
  ],
  ['Our team decides', 'Đội ngũ của chúng tôi quyết định'],
  [
    'Decisions are made by a person on our team, not automatically. The deadlines for an answer are set out in our Operating Regulations.',
    'Quyết định do một người trong đội ngũ của chúng tôi đưa ra, không phải tự động. Thời hạn trả lời được quy định trong Quy chế hoạt động.',
  ],
  ['Read the Operating Regulations', 'Xem Quy chế hoạt động'],
  ['What can happen', 'Kết quả có thể là gì'],
  [
    "If a report is upheld, we can take the listing down, lower the seller's Trust score, and warn, restrict or suspend their account. If it isn't, the case is closed with no action against the seller. If the seller has an account, they can appeal the decision with an explanation and any photos.",
    'Nếu báo cáo có căn cứ, chúng tôi có thể gỡ tin đăng, trừ điểm uy tín của người bán, và cảnh cáo, hạn chế hoặc khoá tài khoản của họ. Nếu không, hồ sơ được đóng và người bán không bị xử lý. Nếu người bán có tài khoản, họ có thể khiếu nại lại quyết định, kèm lời giải thích và ảnh (nếu có).',
  ],
  ["We don't handle your money", 'Chúng tôi không giữ tiền của bạn'],
  [
    "You pay the seller directly. We take no payment and hold no escrow, so we can't refund you or reverse a payment. Meet in a public place, check the item, and pay only when you're satisfied — never send a deposit to someone you haven't met. If money was lost, contact your bank and the police straight away.",
    'Bạn trả tiền trực tiếp cho người bán. Chúng tôi không thu tiền và không giữ tiền ký quỹ, nên không thể hoàn tiền hay huỷ một khoản thanh toán. Hãy gặp ở nơi công cộng, kiểm tra món hàng và chỉ trả khi hài lòng — đừng chuyển cọc cho người bạn chưa gặp. Nếu đã mất tiền, hãy liên hệ ngân hàng và công an ngay.',
  ],
  ['Automatic checks on new listings', 'Kiểm tra tự động tin mới'],
  [
    "Before a listing goes live, its text is checked for banned items and contact details, it must have enough photos, and it's compared with the seller's other live listings to catch duplicates. After it goes live, some listings are checked again and can be hidden for review. Checks can miss things, so judge each listing yourself.",
    'Trước khi tin được đăng, nội dung được kiểm tra hàng cấm và thông tin liên hệ, tin phải có đủ ảnh, và được so với các tin đang đăng khác của người bán để phát hiện tin trùng. Sau khi đăng, một số tin được kiểm tra lại và có thể bị ẩn để xem xét. Việc kiểm tra có thể bỏ sót, nên hãy tự đánh giá từng tin.',
  ],
  ['Reports & disputes', 'Báo cáo & khiếu nại'],
  ['how they work', 'cách xử lý'],
  ['How reports and disputes work', 'Cách xử lý báo cáo và khiếu nại'],
  [
    "We're a marketplace, not a payment or escrow service: we don't hold your money, and we can't refund you or promise how a case ends.",
    'Chúng tôi là sàn giao dịch, không phải dịch vụ thanh toán hay ký quỹ: chúng tôi không giữ tiền của bạn, không thể hoàn tiền và không cam kết kết quả của một khiếu nại.',
  ],
  ['Read our safety guide', 'Xem hướng dẫn an toàn'],
]

/** The /safety heading, renamed with the dialog (CS-0, decision P0-b). */
const SAFETY_HEADING = { en: 'What we do — and what we don’t', vi: 'Những gì chúng tôi làm — và không làm' }

describe('reports-and-disputes row: the approved copy (CS-0)', () => {
  const pairs = trPairs(ROW)

  it('renders exactly the approved EN/VI pairs, in order', () => {
    expect(pairs).toEqual(CS0)
  })

  // ⚠️ THE EQUALITY ABOVE ONLY SEES tr() CALLS WITH TWO STRING LITERALS. A sentence added any other
  // way — <Tr>, useTr, <Bilingual>, a one-argument or template-literal tr(), bare JSX text or a
  // braced string child — would render unpinned and unscreened by every check in this file. So the
  // component may carry copy through that one shape only (second-opinion finding, 2026-09-28).
  it('carries no copy outside the pinned tr(en, vi) pairs', () => {
    const code = ROW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect((code.match(/\btr\(/g) ?? []).length).toBe(pairs.length)
    expect(code).not.toMatch(/<Tr\b|\buseTr\b|<Bilingual\b|[^.\w]t\(/)
    const jsxText = [...code.matchAll(/>([^<>{}]*[A-Za-zÀ-ỹ]{2,}[^<>{}]*)</g)].map((m) => m[1].trim())
    expect(jsxText).toEqual([])
    const bracedChildren = [...code.matchAll(/(?<!=)\{\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1\s*\}/g)].map((m) => m[2])
    expect(bracedChildren.filter((t) => /[A-Za-zÀ-ỹ]/.test(t))).toEqual([])
  })

  it('makes no protection, guarantee or screening claim in either language', () => {
    for (const [en, vi] of pairs) {
      expect(en).not.toMatch(FORBIDDEN)
      expect(vi).not.toMatch(FORBIDDEN)
    }
  })

  it('names no deadline while the Regulations and the code disagree (P0-a)', () => {
    for (const [en, vi] of pairs) {
      expect(en).not.toMatch(DEADLINE)
      expect(vi).not.toMatch(DEADLINE)
    }
  })

  it('states the photo limit as DISPUTE_IMAGES_MAX, in both languages', () => {
    const max = Number(/export const DISPUTE_IMAGES_MAX = (\d+)\b/.exec(DISPUTE)?.[1])
    expect(max).toBeGreaterThan(0)
    const en = pairs.flatMap(([e]) => [...e.matchAll(/up to (\d+) photos/g)].map((m) => Number(m[1])))
    const vi = pairs.flatMap(([, v]) => [...v.matchAll(/tối đa (\d+) ảnh/g)].map((m) => Number(m[1])))
    // Exactly one mention per language: a second one would need its own check here.
    expect(en).toEqual([max])
    expect(vi).toEqual([max])
  })

  it('draws no shield: the mark is a process glyph, not a promise of cover', () => {
    expect(ROW).not.toMatch(/\bShieldCheck\b/)
  })

  // The Regulations are the one place the sheet sends a reader for deadlines. A renamed article id
  // would not 404; it would land them at the top of a long legal page, which nothing else would catch.
  it("links to the Regulations' complaints article, and that article keeps its id", () => {
    expect(ROW).toContain("href: '/regulations#complaints'")
    expect(read('src/app/[lang]/regulations/page.tsx')).toMatch(/\bid: 'complaints',/)
  })

  it('carries the attribute the e2e checks count', () => {
    expect(ROW).toMatch(/data-protections-row=""/)
  })
})

describe('/safety: the heading the dialog links to (CS-0, P0-b)', () => {
  it('is the approved heading, in both languages, for the section and its rail label', () => {
    expect(SAFETY).toContain(`const PROTECTION_HEADING = { en: '${SAFETY_HEADING.en}', vi: '${SAFETY_HEADING.vi}' }`)
    expect(SAFETY).toMatch(/\{ id: 'protection', label: PROTECTION_HEADING\.en, labelVi: PROTECTION_HEADING\.vi \}/)
    expect(SAFETY).toMatch(/<ContentSection id="protection" title=\{PROTECTION_HEADING\.en\} titleVi=\{PROTECTION_HEADING\.vi\}/)
  })

  it('no longer says the site protects you', () => {
    expect(SAFETY_HEADING.en).not.toMatch(FORBIDDEN)
    expect(SAFETY_HEADING.vi).not.toMatch(FORBIDDEN)
    expect(SAFETY).not.toMatch(/protects you/i)
  })
})
