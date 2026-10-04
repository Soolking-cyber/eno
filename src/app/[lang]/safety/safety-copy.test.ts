import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ WHAT /safety SAYS THE PLATFORM DOES IS AN APPROVED SHEET, NOT FREE TEXT (SEO wave B, copy sheet
 * CS-0b, 2026-09-28).
 *
 * The page said listings were "screened" and "held for review before they go live", that phone
 * numbers were "stripped from public text", that sellers "verify a real phone number", that every
 * report was "acknowledged within 3 working days", and it quoted a 72-hour window. The code does none
 * of that: listings go live on creation, a post with a phone number is refused, phone verification is
 * optional, nothing tracks a reply time, and 72 hours is only the evidence window. Every replacement
 * sentence was checked against the line that makes it true. So this file pins:
 *  - the exact EN/VI pairs, in order — an edit to either language needs a new sheet;
 *  - the sentences that repeat the listing page's dialog (CS-0) stay identical to it, in both
 *    languages, so the two cannot drift apart;
 *  - no removed claim, no protection/guarantee/screening wording and no deadline anywhere in the
 *    page's copy (comments are exempt: they quote what was removed);
 *  - the photo limit, in both languages, equal to DISPUTE_IMAGES_MAX;
 *  - every "what we do" tip, and the intro, render their authored Vietnamese.
 *
 * ⚠️ THE SOURCE IS READ THROUGH THE TYPESCRIPT PARSER, NOT REGEXES (second-opinion finding,
 * 2026-09-28). A regex comment-stripper cut every `//` it found, including one inside a string, so
 * 'Keep it // we protect you' hid its own forbidden claim from every check here (measured: all tests
 * passed). The parser never sees a comment as a literal or a literal as a comment.
 */

const ROOT = process.cwd()
const parse = (p: string) =>
  ts.createSourceFile(p, readFileSync(join(ROOT, p), 'utf8'), ts.ScriptTarget.Latest, true, p.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const PAGE = parse('src/app/[lang]/safety/page.tsx')
const ROW = parse('src/components/marketplace/protections-row.tsx')
const SERVICES = parse('src/lib/edition-services-copy.ts')
const DISPUTE = readFileSync(join(ROOT, 'src/lib/dispute.ts'), 'utf8')

/** The same patterns protections-row.test.ts and its e2e spec apply. */
const FORBIDDEN = /protect|guarantee|screened|reviewed before|bảo vệ|đảm bảo|kiểm duyệt/i
const DEADLINE = /\b72\s*h?\b|working days?|ngày làm việc/i
/** The page's own removed claims, each one false against the code (CS-0b §1). */
const REMOVED = [
  /held for review/i,
  /stripped/i,
  /acknowledged within/i,
  /verify a real phone/i,
  /never bought/i,
  /no way for us to help/i,
  /case room/i,
  /any proof/i,
  /directly, in person/i,
  /go smoothly/i,
  /keep every one of them safe/i,
  /accounts are verified/i,
  /rank first/i,
  /means real history/i,
]

/** Every node, parents before children — i.e. source order. */
function nodes(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = []
  const visit = (n: ts.Node) => { out.push(n); n.forEachChild(visit) }
  visit(sf)
  return out
}

/** A plain string: a quoted literal or a template without `${}`. */
const plain = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null

/** Every `{ en: '…', vi: '…' }` object whose two properties are plain strings, in source order. */
function enViPairs(sf: ts.SourceFile, within: ts.Node = sf): [string, string][] {
  const out: [string, string][] = []
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n) && n.properties.length === 2) {
      const get = (key: string) => {
        const p = n.properties.find((x) => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === key)
        return p && ts.isPropertyAssignment(p) ? plain(p.initializer) : null
      }
      const en = get('en')
      const vi = get('vi')
      if (en != null && vi != null) out.push([en, vi])
    }
    n.forEachChild(visit)
  }
  visit(within)
  return out
}

/** Every tr(English, Vietnamese) call with two plain strings (the listing page's dialog). */
function trPairs(sf: ts.SourceFile): [string, string][] {
  return nodes(sf).flatMap((n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'tr' || n.arguments.length !== 2) return []
    const [en, vi] = n.arguments.map(plain)
    return en != null && vi != null ? [[en, vi] as [string, string]] : []
  })
}

/** Every piece of text the code carries — literals, templates (with their `${}` kept) and JSX text. */
function prose(sf: ts.SourceFile): string[] {
  return nodes(sf).flatMap((n) => {
    if (inClassName(n)) return []
    const t = plain(n) ?? (ts.isTemplateExpression(n) ? n.getText(sf) : ts.isJsxText(n) ? n.text.trim() : null)
    return t && / /.test(t) && /[A-Za-zÀ-ỹ]{3}/.test(t) ? [t] : []
  })
}

/**
 * Inside a `className` attribute — a class list, not copy. Without this a future `h-72` would fail the
 * deadline check for a styling reason (second-opinion finding, 2026-09-28).
 */
function inClassName(n: ts.Node): boolean {
  for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isJsxAttribute(p)) return p.name.getText() === 'className'
  }
  return false
}

/** The source text of the first node matching `pick`, comments inside it included. */
function find(sf: ts.SourceFile, pick: (n: ts.Node) => boolean): string {
  const n = nodes(sf).find(pick)
  expect(n, 'node not found').toBeDefined()
  return n!.getText(sf)
}
const fn = (name: string) => (n: ts.Node) => ts.isFunctionDeclaration(n) && n.name?.text === name
const variable = (name: string) => (n: ts.Node) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name

/** The page sets apostrophes as ’; the dialog as '. Compared as the same character. */
const norm = (s: string) => s.replace(/’/g, "'")

/** CS-0b as drafted, in the order the page's source holds it. */
const CS0B: [string, string][] = [
  ['Prefer trusted sellers', 'Ưu tiên người bán uy tín'],
  [
    'Check the seller’s Trust score — how it works is explained below. A high score is a good sign, not a promise. Be extra careful with a brand-new account selling something valuable far below market.',
    'Hãy xem điểm uy tín của người bán — cách tính điểm được giải thích ở phần dưới. Điểm cao là dấu hiệu tốt chứ không phải lời cam kết. Hãy đặc biệt thận trọng với tài khoản mới lập bán món đồ giá trị với giá rẻ hơn hẳn thị trường.',
  ],
  ['Keep every chat on eno', 'Giữ mọi cuộc trò chuyện trên eno'],
  [
    'Message through eno so there’s a record of exactly what was agreed. If a seller rushes you onto Zalo, Messenger or Telegram before the basics are settled, slow down — off-platform there’s no record for our team to check.',
    'Nhắn tin qua eno để có bản lưu chính xác những gì hai bên đã thỏa thuận. Nếu người bán hối thúc bạn chuyển sang Zalo, Messenger hay Telegram khi chưa thống nhất những điều cơ bản, hãy chậm lại — ngoài eno sẽ không có bản lưu nào để đội ngũ của chúng tôi kiểm tra.',
  ],
  ['Trust is earned, and can be lost', 'Uy tín phải tích lũy, và có thể mất đi'],
  [
    'A seller’s Trust score goes up with a verified phone number, verified reviews, quick replies and completed sales, and goes down when a report against them is upheld. If it falls too low, the account can’t post new listings unless the score recovers or our team allows it.',
    'Điểm uy tín của người bán tăng nhờ số điện thoại đã xác minh, đánh giá đã xác minh, trả lời tin nhắn nhanh và các lần bán thành công, và giảm khi một báo cáo về họ có căn cứ. Nếu điểm xuống quá thấp, tài khoản không thể đăng tin mới trừ khi điểm phục hồi hoặc đội ngũ của chúng tôi cho phép.',
  ],
  ['Automatic checks on new listings', 'Kiểm tra tự động tin mới'],
  [
    'Before a listing goes live, its text is checked for banned items and contact details, it must have enough photos, and it’s compared with the seller’s other live listings to catch duplicates. After it goes live, some listings are checked again and can be hidden for review. Checks can miss things, so judge each listing yourself.',
    'Trước khi tin được đăng, nội dung được kiểm tra hàng cấm và thông tin liên hệ, tin phải có đủ ảnh, và được so với các tin đang đăng khác của người bán để phát hiện tin trùng. Sau khi đăng, một số tin được kiểm tra lại và có thể bị ẩn để xem xét. Việc kiểm tra có thể bỏ sót, nên hãy tự đánh giá từng tin.',
  ],
  ['Chats stay on the record', 'Tin nhắn được lưu lại'],
  [
    'You must be signed in to message a seller or see their phone number. Deleting a message only hides it from the chat: it’s kept, and our team can still read it, for example when a conversation is reported.',
    'Bạn phải đăng nhập mới nhắn tin được cho người bán hoặc xem số điện thoại của họ. Xóa một tin nhắn chỉ ẩn nó khỏi cuộc trò chuyện: tin nhắn vẫn được lưu, và đội ngũ của chúng tôi vẫn đọc được, chẳng hạn khi cuộc trò chuyện bị báo cáo.',
  ],
  ['Reports and evidence', 'Báo cáo và bằng chứng'],
  [
    'A report opens a private case between you, the seller and our team, which you can follow under Disputes. You can send one statement with up to 6 photos before the deadline shown on the case. If the seller has an account, they’re told about the case and can do the same, but we never tell them who reported it.',
    'Báo cáo sẽ mở một hồ sơ riêng giữa bạn, người bán và đội ngũ của chúng tôi, và bạn theo dõi được trong mục Khiếu nại. Bạn được gửi một lần trình bày, kèm tối đa 6 ảnh, trước hạn chót ghi trên hồ sơ. Nếu người bán có tài khoản, họ được thông báo về hồ sơ và cũng được gửi như vậy, nhưng chúng tôi không bao giờ cho họ biết ai đã báo cáo.',
  ],
  ['Our team decides', 'Đội ngũ của chúng tôi quyết định'],
  [
    'Decisions are made by a person on our team, not automatically. If a report is upheld, we can take the listing down, lower the seller’s Trust score, and warn, restrict or suspend their account. If it isn’t, the case is closed with no action against the seller.',
    'Quyết định do một người trong đội ngũ của chúng tôi đưa ra, không phải tự động. Nếu báo cáo có căn cứ, chúng tôi có thể gỡ tin đăng, trừ điểm uy tín của người bán, và cảnh cáo, hạn chế hoặc khoá tài khoản của họ. Nếu không, hồ sơ được đóng và người bán không bị xử lý.',
  ],
  ['We don’t handle your money', 'Chúng tôi không giữ tiền của bạn'],
  [
    'You pay the seller directly. We take no payment and hold no escrow, so we can’t refund you or reverse a payment. That’s why the habits above matter: check the item before any money moves.',
    'Bạn trả tiền trực tiếp cho người bán. Chúng tôi không thu tiền và không giữ tiền ký quỹ, nên không thể hoàn tiền hay huỷ một khoản thanh toán. Vì vậy, những thói quen ở trên rất quan trọng: hãy kiểm tra món hàng trước khi trả bất kỳ khoản tiền nào.',
  ],
  // The section heading, approved with CS-0 (decision P0-b) and pinned by protections-row.test.ts too.
  ['What we do — and what we don’t', 'Những gì chúng tôi làm — và không làm'],
  ['Report the seller or listing', 'Báo cáo người bán hoặc tin đăng'],
  [
    'Use the Report button on the listing, the seller’s page or the chat. It opens a private case where you can describe what happened and add photos, such as screenshots and receipts.',
    'Dùng nút Báo cáo trên tin đăng, trang người bán hoặc trong cuộc trò chuyện. Báo cáo sẽ mở một hồ sơ riêng, nơi bạn trình bày sự việc và đính kèm ảnh, chẳng hạn ảnh chụp màn hình hay ảnh biên lai.',
  ],
  [
    'New listings go through automatic checks, and decisions on reports are made by our team. But the deal closes between you and the other person, so the last few metres are up to you. These habits make each deal safer.',
    'Tin đăng mới được kiểm tra tự động, và quyết định về các báo cáo do đội ngũ của chúng tôi đưa ra. Nhưng việc chốt giao dịch là giữa bạn và đối phương, nên những bước cuối cùng tùy thuộc vào bạn. Những thói quen này giúp mỗi giao dịch an toàn hơn.',
  ],
]

/**
 * THE ADVICE TIPS' AUTHORED VIETNAMESE (B5-HELP-VI, auth-02, 2026-10-04) — drafted under copy sheet CS-3
 * (Claude drafts, the owner approves before deploy). Advice, not claims about the platform, so it is a
 * separate sheet from CS-0b; the forbidden/deadline/removed-claim checks below still run over it. Pinned
 * in source order like CS-0b, so an edit to either language is a deliberate change to this list. Pairs
 * whose English carries `${…}` (the deposit red flag, the support email) are templates and are not
 * listed — enViPairs reads plain literals only; content-page-vi-contract.test.ts holds their shape.
 */
const CS3_ADVICE: [string, string][] = [
  ['Read the whole listing', 'Đọc kỹ toàn bộ tin đăng'],
  [
    'Check the photos actually match the item and description. Ask for extra photos or a short video of the things that matter — the serial number, the odometer, the room in daylight. Vague answers or recycled stock photos are a warning sign.',
    'Kiểm tra xem ảnh có thật sự khớp với món hàng và phần mô tả không. Hãy xin thêm ảnh hoặc một video ngắn về những điểm quan trọng — số sê-ri, đồng hồ công-tơ-mét, căn phòng lúc ban ngày. Câu trả lời mập mờ hoặc ảnh mạng dùng lại là dấu hiệu cảnh báo.',
  ],
  ['Agree the details in writing', 'Thỏa thuận chi tiết bằng văn bản'],
  [
    'Before you travel, confirm the final price, the condition, what’s included, and the exact time and public place to meet. A seller who won’t commit to specifics in writing may not be serious.',
    'Trước khi đi, hãy xác nhận giá cuối cùng, tình trạng món hàng, những gì đi kèm, cùng thời gian và địa điểm công cộng cụ thể để gặp. Người bán không chịu xác nhận rõ ràng bằng văn bản có thể không thật lòng muốn bán.',
  ],
  ['Meet in a busy public place, in daylight', 'Gặp ở nơi công cộng đông người, vào ban ngày'],
  [
    'A crowded café, a shopping mall, or a bank lobby is ideal — somewhere with people and cameras. Avoid alleys, private homes, and late-night handovers. For a room or vehicle you must view on-site, don’t go alone.',
    'Quán cà phê đông khách, trung tâm thương mại hay sảnh ngân hàng là lý tưởng — nơi có người qua lại và có camera. Tránh hẻm vắng, nhà riêng và giao nhận lúc đêm muộn. Nếu phải đến tận nơi xem phòng hoặc xem xe, đừng đi một mình.',
  ],
  ['Tell someone where you’re going', 'Báo cho người thân biết bạn đi đâu'],
  [
    'Share the meeting place and time with a friend or family member, and bring them along for higher-value items. There’s real safety in not arriving alone.',
    'Chia sẻ địa điểm và thời gian gặp với bạn bè hoặc người nhà, và rủ họ đi cùng khi mua món đồ giá trị cao. Không đến một mình sẽ an toàn hơn hẳn.',
  ],
  ['Inspect fully before any money moves', 'Kiểm tra kỹ trước khi trả bất kỳ khoản tiền nào'],
  [
    'Test it properly: power on electronics and check every port, start the motorbike and read the papers and chassis number, view the room and the actual contract. Confirm serial numbers match the receipt or box.',
    'Hãy thử cho kỹ: bật nguồn đồ điện tử và kiểm tra từng cổng kết nối, nổ máy xe và đối chiếu giấy tờ với số khung, xem tận mắt căn phòng và bản hợp đồng thật. Kiểm tra số sê-ri có khớp với hóa đơn hoặc vỏ hộp không.',
  ],
  ['Renting? Check the papers, not just the room', 'Thuê nhà? Hãy xem giấy tờ, không chỉ xem phòng'],
  [
    'Ask to see the owner’s ID and the ownership certificate (sổ đỏ / sổ hồng), and check the name on them matches the person signing. Insist on a written contract and a receipt for every payment. Confirm the landlord will register your stay with the local police — for a foreign tenant that is the landlord’s legal duty, and one who refuses is usually not the owner.',
    'Hãy yêu cầu xem giấy tờ tùy thân của chủ nhà và giấy chứng nhận quyền sở hữu (sổ đỏ / sổ hồng), và kiểm tra tên trên giấy tờ có trùng với người ký hợp đồng không. Yêu cầu hợp đồng bằng văn bản và biên nhận cho mỗi lần thanh toán. Xác nhận chủ nhà sẽ khai báo tạm trú cho bạn với công an địa phương — với người thuê là người nước ngoài, đó là nghĩa vụ pháp lý của chủ nhà, và người từ chối thường không phải chủ nhà thật.',
  ],
  ['Pay once, in person, at handover', 'Trả tiền một lần, trực tiếp, khi nhận hàng'],
  [
    'Hand over cash — or transfer — only when the item is in your hands and matches what was agreed. Never send money ahead to “hold” an item. If you transfer, confirm it truly landed in the seller’s account before you leave; screenshots can be faked.',
    'Chỉ đưa tiền mặt — hoặc chuyển khoản — khi món hàng đã ở trong tay bạn và đúng như đã thỏa thuận. Đừng bao giờ chuyển tiền trước để “giữ” hàng. Nếu chuyển khoản, hãy xác nhận tiền đã thật sự vào tài khoản người bán trước khi rời đi; ảnh chụp màn hình có thể bị làm giả.',
  ],
  ['“Send a deposit first”', '“Chuyển cọc trước đi”'],
  ['A price too good to be true', 'Giá rẻ đến khó tin'],
  [
    'If it’s dramatically cheaper than everything comparable, assume it’s bait — for a fake sale, a stolen item, or an account that vanishes the moment you pay.',
    'Nếu rẻ hơn hẳn mọi món tương tự, hãy coi đó là mồi nhử — cho một vụ bán hàng giả, một món đồ trộm cắp, hoặc một tài khoản biến mất ngay khi bạn trả tiền.',
  ],
  ['Pressure and urgency', 'Hối thúc và gây áp lực'],
  [
    '“Lots of people are asking”, “transfer in 10 minutes or I’ll sell to someone else” — rushing you past a proper inspection is the oldest trick there is.',
    '“Nhiều người đang hỏi lắm”, “chuyển khoản trong 10 phút không thì tôi bán cho người khác” — hối thúc để bạn bỏ qua bước kiểm tra kỹ là chiêu lừa lâu đời nhất.',
  ],
  ['“Ship it before you see it”', '“Gửi hàng trước, xem hàng sau”'],
  [
    'A seller who refuses to meet in public and wants money up front for delivery is a risk you don’t need to take. Walk away.',
    'Người bán từ chối gặp ở nơi công cộng và đòi tiền trước để giao hàng là rủi ro bạn không cần chấp nhận. Hãy bỏ qua.',
  ],
  ['“I’m abroad — I’ll courier it to you”', '“Tôi đang ở nước ngoài — tôi sẽ gửi chuyển phát cho bạn”'],
  [
    'The standard rental and vehicle scam: the “owner” is overseas, the price is excellent, and all you have to do is transfer a deposit so the keys or the bike can be sent. Nothing ever arrives. If the person cannot meet you, there is no deal.',
    'Chiêu lừa quen thuộc khi thuê nhà và mua xe: “chủ” đang ở nước ngoài, giá rất hời, và bạn chỉ cần chuyển tiền cọc để họ gửi chìa khóa hoặc chiếc xe. Không bao giờ có gì được gửi đến. Nếu người đó không thể gặp bạn, thì không có giao dịch nào cả.',
  ],
  ['“Read me the code”', '“Đọc mã cho tôi”'],
  [
    'No legitimate trade ever needs an OTP, a bank password, a card number, or a code sent to your phone. Never read one out — that’s how accounts and money get taken.',
    'Không giao dịch chính đáng nào cần mã OTP, mật khẩu ngân hàng, số thẻ hay mã được gửi đến điện thoại của bạn. Đừng bao giờ đọc những mã đó cho ai — đó chính là cách tài khoản và tiền bị chiếm đoạt.',
  ],
  ['A brand-new, empty account', 'Tài khoản mới tinh, chưa có gì'],
  [
    'No listing history, no reviews, no trust — selling high-value goods cheap. On its own it’s a caution; combined with anything above, it’s your cue to stop.',
    'Không có lịch sử đăng tin, không có đánh giá, không có uy tín — lại bán hàng giá trị cao với giá rẻ. Chỉ riêng điều này là lý do để cẩn trọng; đi kèm bất kỳ dấu hiệu nào ở trên, đó là lúc bạn nên dừng lại.',
  ],
  ['Stop contact and keep everything', 'Ngừng liên lạc và giữ lại mọi thứ'],
  [
    'Don’t delete the conversation. Screenshots, receipts, and transfer records are your evidence — save them all.',
    'Đừng xóa cuộc trò chuyện. Ảnh chụp màn hình, biên lai và lịch sử chuyển khoản là bằng chứng của bạn — hãy lưu lại tất cả.',
  ],
  ['If money was lost, act fast', 'Nếu đã mất tiền, hãy hành động ngay'],
  [
    'Contact your bank immediately to try to reverse or freeze the transfer, and report the fraud to your local police (in Vietnam, the nearest công an phường).',
    'Liên hệ ngay với ngân hàng để thử hoàn lại hoặc phong tỏa khoản chuyển khoản, và trình báo vụ lừa đảo với công an phường gần nhất.',
  ],
  ['Reach eno support', 'Liên hệ bộ phận hỗ trợ của eno'],
]

/**
 * Sentences /safety takes word for word from the listing page's dialog (CS-0). Each must appear in
 * ONE dialog pair and ONE page pair — English in the English, Vietnamese in the Vietnamese of the
 * same pair — so editing either surface alone fails here.
 */
const FROM_CS0: [string, string][] = [
  ['Automatic checks on new listings', 'Kiểm tra tự động tin mới'],
  [
    "Before a listing goes live, its text is checked for banned items and contact details, it must have enough photos, and it's compared with the seller's other live listings to catch duplicates. After it goes live, some listings are checked again and can be hidden for review. Checks can miss things, so judge each listing yourself.",
    'Trước khi tin được đăng, nội dung được kiểm tra hàng cấm và thông tin liên hệ, tin phải có đủ ảnh, và được so với các tin đang đăng khác của người bán để phát hiện tin trùng. Sau khi đăng, một số tin được kiểm tra lại và có thể bị ẩn để xem xét. Việc kiểm tra có thể bỏ sót, nên hãy tự đánh giá từng tin.',
  ],
  [
    'A report opens a private case between you, the seller and our team, which you can follow under Disputes.',
    'Báo cáo sẽ mở một hồ sơ riêng giữa bạn, người bán và đội ngũ của chúng tôi, và bạn theo dõi được trong mục Khiếu nại.',
  ],
  [
    "You can send one statement with up to 6 photos before the deadline shown on the case. If the seller has an account, they're told about the case and can do the same, but we never tell them who reported it.",
    'Bạn được gửi một lần trình bày, kèm tối đa 6 ảnh, trước hạn chót ghi trên hồ sơ. Nếu người bán có tài khoản, họ được thông báo về hồ sơ và cũng được gửi như vậy, nhưng chúng tôi không bao giờ cho họ biết ai đã báo cáo.',
  ],
  ['Our team decides', 'Đội ngũ của chúng tôi quyết định'],
  ['Decisions are made by a person on our team, not automatically.', 'Quyết định do một người trong đội ngũ của chúng tôi đưa ra, không phải tự động.'],
  [
    "If a report is upheld, we can take the listing down, lower the seller's Trust score, and warn, restrict or suspend their account. If it isn't, the case is closed with no action against the seller.",
    'Nếu báo cáo có căn cứ, chúng tôi có thể gỡ tin đăng, trừ điểm uy tín của người bán, và cảnh cáo, hạn chế hoặc khoá tài khoản của họ. Nếu không, hồ sơ được đóng và người bán không bị xử lý.',
  ],
  ["We don't handle your money", 'Chúng tôi không giữ tiền của bạn'],
  [
    "You pay the seller directly. We take no payment and hold no escrow, so we can't refund you or reverse a payment.",
    'Bạn trả tiền trực tiếp cho người bán. Chúng tôi không thu tiền và không giữ tiền ký quỹ, nên không thể hoàn tiền hay huỷ một khoản thanh toán.',
  ],
]

describe('/safety: what the platform does (CS-0b)', () => {
  const pairs = enViPairs(PAGE)

  // ⚠️ TWO SHEETS, ONE PAGE: every pair is on exactly one of them, each in source order. A pair on
  // neither (a new sentence) lands in the CS-0b comparison and fails it.
  const advice = new Set(CS3_ADVICE.map(([en]) => en))

  it('renders exactly the approved EN/VI pairs, in order', () => {
    expect(pairs.filter(([en]) => !advice.has(en))).toEqual(CS0B)
  })

  it('renders exactly the drafted advice pairs (CS-3), in order', () => {
    expect(pairs.filter(([en]) => advice.has(en))).toEqual(CS3_ADVICE)
  })

  it("repeats the listing page's approved sentences word for word, in both languages", () => {
    const dialog = trPairs(ROW)
    expect(dialog.length).toBeGreaterThan(0)
    const holds = (list: [string, string][], [en, vi]: [string, string]) =>
      list.some(([e, v]) => norm(e).includes(en) && v.includes(vi))
    for (const sentence of FROM_CS0) {
      expect(holds(dialog, sentence), `dialog: ${sentence[0]}`).toBe(true)
      expect(holds(pairs, sentence), `/safety: ${sentence[0]}`).toBe(true)
    }
  })

  it('makes none of the removed claims, and no protection, screening or deadline claim, anywhere in its copy', () => {
    const text = prose(PAGE)
    // The page's copy is these literals; a short list would mean the extraction broke.
    expect(text.length).toBeGreaterThan(40)
    for (const s of text) {
      expect(s, s).not.toMatch(FORBIDDEN)
      expect(s, s).not.toMatch(DEADLINE)
      for (const re of REMOVED) expect(s, s).not.toMatch(re)
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

  it('gives every "what we do" tip an authored Vietnamese title and body', () => {
    const decl = nodes(PAGE).find(variable('protection'))
    const list = decl && ts.isVariableDeclaration(decl) ? decl.initializer : undefined
    expect(list && ts.isArrayLiteralExpression(list)).toBe(true)
    const tips = (list as ts.ArrayLiteralExpression).elements
    expect(tips).toHaveLength(6)
    for (const tip of tips) {
      // [icon, title, body]: both text slots are { en, vi } objects, never a plain string.
      expect(ts.isArrayLiteralExpression(tip) && tip.elements.length === 3).toBe(true)
      const [, title, body] = (tip as ts.ArrayLiteralExpression).elements
      expect(enViPairs(PAGE, title)).toHaveLength(1)
      expect(enViPairs(PAGE, body)).toHaveLength(1)
      expect(ts.isObjectLiteralExpression(title) && ts.isObjectLiteralExpression(body)).toBe(true)
    }
  })

  it('renders a pair through <Bilingual>, and the intro too', () => {
    expect(find(PAGE, fn('CopyText'))).toMatch(/typeof copy === 'string' \? <Tr text=\{copy\} \/> : <Bilingual en=\{copy\.en\} vi=\{copy\.vi\} \/>/)
    // The two renderers that take a pair: the tip grid and the if-it-goes-wrong steps.
    const tipGrid = find(PAGE, fn('TipGrid'))
    const steps = find(PAGE, (n) => ts.isCallExpression(n) && n.expression.getText(PAGE) === 'recovery.map')
    for (const block of [tipGrid, steps]) {
      expect(block.match(/<CopyText copy=\{(title|body)\} \/>/g)).toHaveLength(2)
      expect(block).not.toMatch(/<Tr\b/)
    }
    const intro = find(PAGE, (n) => ts.isJsxAttribute(n) && n.name.getText(PAGE) === 'intro')
    expect(intro).toMatch(/^intro=\{\s*<Bilingual en=\{INTRO\.en\} vi=\{INTRO\.vi\} \/>\s*\}$/)
  })

  it('makes no protection or screening claim in the meta description', () => {
    expect(find(PAGE, variable('DESCRIPTION'))).toBe(
      'DESCRIPTION =\n  `How to trade safely on ${SITE_NAME}: vet the seller, meet in public, inspect before paying, spot red flags, and how reports and our listing checks work.`',
    )
  })
})

describe('/safety on eno.forum: the services section', () => {
  // The provider-of-record disclosure has a hand-written Vietnamese (visa-provider.ts) because a
  // mistranslated "who is legally responsible" is a legal defect; <Tr> machine-translated the English.
  it('renders the disclosure with its authored Vietnamese', () => {
    const uses = nodes(PAGE)
      .filter((n) => (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.getText(PAGE).includes('PROVIDER_OF_RECORD'))
      .map((n) => n.getText(PAGE))
    expect(uses).toEqual(['<Bilingual en={PROVIDER_OF_RECORD.en} vi={PROVIDER_OF_RECORD.vi} />'])
  })

  // A licensed partner sells e-visa listings on eno.vn, by the owner's decision (edition-scope.ts), so
  // the cross-link may not describe eno.vn as having none.
  it('does not tell readers eno.vn has no visa services', () => {
    const after = find(SERVICES, (n) => ts.isPropertyAssignment(n) && n.name.getText(SERVICES) === 'after')
    expect(after).toContain("'— a related site in the same brand family, with its own operator details and its own terms.")
    for (const s of prose(SERVICES)) expect(s, s).not.toMatch(/no visa services/i)
  })

  // The services module's copy renders on eno.forum's /safety too, so the deadline and removed-claim
  // checks run over it as well (second-opinion finding). FORBIDDEN does not: that copy denies cover on
  // purpose — "the meet-in-person habits above do not protect you here", "Nobody can guarantee
  // approval" — and its own header lists what it may never say.
  it('names no deadline and makes none of the removed claims', () => {
    const text = prose(SERVICES)
    expect(text.length).toBeGreaterThan(20)
    for (const s of text) {
      expect(s, s).not.toMatch(DEADLINE)
      for (const re of REMOVED) expect(s, s).not.toMatch(re)
    }
  })
})
