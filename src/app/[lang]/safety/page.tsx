import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import type { IconComponent } from '@/components/ui/icons'
import {
  Images, MessageSquare, ClipboardCheck,
  Sun, Users, SearchCheck, Banknote, FileText,
  AlertTriangle, BadgeCheck, ScanLine, Lock, Flag, UserRound, Wallet, Info,
  Landmark, Globe, Receipt, Ban, Upload, Check, X, ShieldCheck,
} from '@/components/ui/icons'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Bilingual } from '@/components/marketplace/bilingual'
import { COMPANY } from '@/lib/site-legal'
import { SERVICES_SAFETY } from '@/lib/edition-services-copy'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { CROSS_SITE_REL } from '@/lib/cross-site-links'

// ── /safety — ONE FILE, BOTH EDITIONS ───────────────────────────────────────────────
// Everything above the "visa services" section is marketplace guidance and renders on
// eno.vn AND eno.forum, because both are the same classifieds marketplace. The visa
// section renders ONLY on the services edition.
//
// ⚠️ THE VISA COPY IS NOT IN THIS FILE, AND THAT IS THE POINT. eno.vn is a licensed sàn
// TMĐT that may not so much as mention the service, and a runtime `IS_SERVICES &&` gate
// stops the RENDER while leaving the words in the artifact (measured — see
// src/lib/edition.ts). So the strings live in @/lib/edition-services-copy and
// @/lib/visa-provider, both of which next.config.ts aliases to empty stubs on a
// marketplace build. Keep BOTH: the gate controls behaviour, the alias controls the
// bundle. Adding a visa sentence directly to this file defeats the alias entirely.
//
// ⚠️ NAME THE SITE VIA `SITE_NAME`, NEVER "eno.vn". This page used to hardcode the
// marketplace domain in five places, which on eno.forum told visitors that a different
// website was the one protecting them and the one to email.

// ⛔ EVERY SENTENCE ON THIS PAGE THAT SAYS WHAT eno DOES IS A CLAIM ABOUT CODE (copy sheet CS-0b, SEO
// wave B, 2026-09-28). The page used to say listings were "screened" and "held for review before they
// go live", that phone numbers were "stripped from public text", that sellers "verify a real phone
// number" and that every report was "acknowledged within 3 working days". None of it was true: listings
// go live on creation once the automatic checks pass (src/lib/core/listings.ts, `verified: true`), a
// post carrying a phone number is REFUSED rather than edited (src/lib/publish-guard.ts,
// assertCleanTexts), phone verification is optional and only adds to the Trust score
// (src/lib/trust-math.ts, V_PHONE), and nothing in the code tracks a reply time. Each replacement was
// checked against the line that makes it true, and where it says the same thing as the listing page's
// reports-and-disputes dialog it uses that dialog's approved sentence (CS-0, protections-row.tsx).
// safety-copy.test.ts pins the pairs below. Before adding a sentence about the platform, find the code
// that makes it true; if there is none, it does not ship. The advice (meet in public, inspect first,
// the red flags) is advice, not a claim, and stays as it was.
//
// ⚠️ A SENTENCE WITH AN AUTHORED VIETNAMESE IS A `{ en, vi }` PAIR, rendered through <Bilingual>. A
// plain string goes through <Tr>, whose Vietnamese comes from the generated vi-overrides file or, for
// most of this page, from machine translation after hydration — so a corrected English sentence
// rendered that way would reach Vietnamese readers as a machine translation of a claim about what the
// platform does, and would be in English in the server HTML.
type Copy = string | { en: string; vi: string }

const DESCRIPTION =
  `How to trade safely on ${SITE_NAME}: vet the seller, meet in public, inspect before paying, spot red flags, and how reports and our listing checks work.`

// Both link-preview cards come from withShare() and stay ENGLISH on both variants: a share scraper
// sends no language, so the card must not depend on which variant it happened to hit.
const METADATA: Metadata = withShare({
  title: `Safe trading | ${SITE_NAME}`,
  // The services build swaps the whole description rather than appending to it — an
  // appended clause pushes the useful half past the ~160 chars a result actually shows.
  description: IS_SERVICES && SERVICES_SAFETY.metaDescription ? SERVICES_SAFETY.metaDescription : DESCRIPTION,
  alternates: { canonical: '/safety' },
})

// The <title> follows the `[lang]` variant the proxy served (L-CONTENT-VI, 2026-09-29): a Vietnamese
// reader's tab and history said "Safe trading". The description stays one string for both.
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return lang === 'vi' ? { ...METADATA, title: `Giao dịch an toàn | ${SITE_NAME}` } : METADATA
}

// A tip's glyph is a lucide icon OR the eno seal. The seal is bespoke first-party art, not
// lucide, and icon-language §0b makes it the required mark wherever eno's OWN trust is the
// subject — so the type has to admit it. Both take the `className`/`strokeWidth` TipGrid
// passes, so every tip still renders at one size and one weight.
type TipGlyph = (props: { className?: string; strokeWidth?: number }) => React.ReactNode
type Tip = [icon: IconComponent | TipGlyph, title: Copy, body: Copy]
// ⛔ EVERY MARKETPLACE TIP BELOW IS AN AUTHORED `{ en, vi }` PAIR (B5-HELP-VI, auth-02, 2026-10-04): as plain
// strings the advice tips went through <Tr>, had no curated Vietnamese, and reached the vi server HTML in
// English. content-page-vi-contract.test.ts fails on a plain-string slot in any `Tip[]` array. Only
// `servicesTips` stays `Copy`: its strings come from the aliased services module (eno.forum only).

// ⚠️ SOLAR'S shield-check, NOT THE HAND-DRAWN eno SEAL (owner, 2026-08-13, pointing at this exact
// glyph on this page: "sill old icons … use solar"). The wrapper that used to sit here rendered
// <EnoSeal variant="line"> purely to get the seal's silhouette into a grid of ~22 Solar line
// glyphs — and the note it carried was already arguing itself out of the mark: it chose `line`
// over the default wash because "one brand-100 chief among twenty-two lines is the single filled
// thing on the page". Once the fill is gone, what is left is a hand-maintained shield-and-tick
// standing in for the one the icon set already draws, at a slightly different weight from every
// neighbour. The seal still means something where it is a CLAIM (a verified badge, eno's own voice
// in a notification); as a topic glyph beside "Prefer trusted sellers" it was decoration.
// No wrapper needed either: Solar's shim accepts `strokeWidth` (inert) and hardcodes aria-hidden,
// so it satisfies TipGlyph's shape directly and TipGrid keeps passing what it always passed.

// Vet the listing + seller before you spend time or travel.
const before: Tip[] = [
  // The eno seal replaces lucide ShieldCheck (§0b): trust badges ARE the first-party trust
  // signal this whole page is explaining, so the mark beside it must be the one the badges
  // themselves wear — the same silhouette a reader sees on every card's trust chip.
  // The score's inputs are stated once, in the "Trust is earned" tip below. "A blue Trusted badge means
  // real history" was not provable: the blue band starts at a score of 85 (trust-score.ts), and a
  // verified phone, account age, fresh listings and quick replies reach it without a single sale or
  // review (trust-math.ts: 60 + V_PHONE 10 + V_AGE 5 + FRESH_MAX 5 + RESPONSE_MAX 10).
  [ShieldCheck,
    { en: 'Prefer trusted sellers', vi: 'Ưu tiên người bán uy tín' },
    {
      en: 'Check the seller’s Trust score — how it works is explained below. A high score is a good sign, not a promise. Be extra careful with a brand-new account selling something valuable far below market.',
      vi: 'Hãy xem điểm uy tín của người bán — cách tính điểm được giải thích ở phần dưới. Điểm cao là dấu hiệu tốt chứ không phải lời cam kết. Hãy đặc biệt thận trọng với tài khoản mới lập bán món đồ giá trị với giá rẻ hơn hẳn thị trường.',
    }],
  [Images,
    { en: 'Read the whole listing', vi: 'Đọc kỹ toàn bộ tin đăng' },
    {
      en: 'Check the photos actually match the item and description. Ask for extra photos or a short video of the things that matter — the serial number, the odometer, the room in daylight. Vague answers or recycled stock photos are a warning sign.',
      vi: 'Kiểm tra xem ảnh có thật sự khớp với món hàng và phần mô tả không. Hãy xin thêm ảnh hoặc một video ngắn về những điểm quan trọng — số sê-ri, đồng hồ công-tơ-mét, căn phòng lúc ban ngày. Câu trả lời mập mờ hoặc ảnh mạng dùng lại là dấu hiệu cảnh báo.',
    }],
  // "…no way for us to help" off-platform was not true: a report needs no chat, and its evidence can be
  // screenshots (api/report/route.ts; dispute photos, dispute.ts DISPUTE_IMAGES_MAX). What is lost is
  // the record our team can read (admin/conversation/[id]/page.tsx).
  [MessageSquare,
    { en: 'Keep every chat on eno', vi: 'Giữ mọi cuộc trò chuyện trên eno' },
    {
      en: 'Message through eno so there’s a record of exactly what was agreed. If a seller rushes you onto Zalo, Messenger or Telegram before the basics are settled, slow down — off-platform there’s no record for our team to check.',
      vi: 'Nhắn tin qua eno để có bản lưu chính xác những gì hai bên đã thỏa thuận. Nếu người bán hối thúc bạn chuyển sang Zalo, Messenger hay Telegram khi chưa thống nhất những điều cơ bản, hãy chậm lại — ngoài eno sẽ không có bản lưu nào để đội ngũ của chúng tôi kiểm tra.',
    }],
  [ClipboardCheck,
    { en: 'Agree the details in writing', vi: 'Thỏa thuận chi tiết bằng văn bản' },
    {
      en: 'Before you travel, confirm the final price, the condition, what’s included, and the exact time and public place to meet. A seller who won’t commit to specifics in writing may not be serious.',
      vi: 'Trước khi đi, hãy xác nhận giá cuối cùng, tình trạng món hàng, những gì đi kèm, cùng thời gian và địa điểm công cộng cụ thể để gặp. Người bán không chịu xác nhận rõ ràng bằng văn bản có thể không thật lòng muốn bán.',
    }],
]

// The handover itself — where money and goods change hands.
const meeting: Tip[] = [
  [Sun,
    { en: 'Meet in a busy public place, in daylight', vi: 'Gặp ở nơi công cộng đông người, vào ban ngày' },
    {
      en: 'A crowded café, a shopping mall, or a bank lobby is ideal — somewhere with people and cameras. Avoid alleys, private homes, and late-night handovers. For a room or vehicle you must view on-site, don’t go alone.',
      vi: 'Quán cà phê đông khách, trung tâm thương mại hay sảnh ngân hàng là lý tưởng — nơi có người qua lại và có camera. Tránh hẻm vắng, nhà riêng và giao nhận lúc đêm muộn. Nếu phải đến tận nơi xem phòng hoặc xem xe, đừng đi một mình.',
    }],
  [Users,
    { en: 'Tell someone where you’re going', vi: 'Báo cho người thân biết bạn đi đâu' },
    {
      en: 'Share the meeting place and time with a friend or family member, and bring them along for higher-value items. There’s real safety in not arriving alone.',
      vi: 'Chia sẻ địa điểm và thời gian gặp với bạn bè hoặc người nhà, và rủ họ đi cùng khi mua món đồ giá trị cao. Không đến một mình sẽ an toàn hơn hẳn.',
    }],
  [SearchCheck,
    { en: 'Inspect fully before any money moves', vi: 'Kiểm tra kỹ trước khi trả bất kỳ khoản tiền nào' },
    {
      en: 'Test it properly: power on electronics and check every port, start the motorbike and read the papers and chassis number, view the room and the actual contract. Confirm serial numbers match the receipt or box.',
      vi: 'Hãy thử cho kỹ: bật nguồn đồ điện tử và kiểm tra từng cổng kết nối, nổ máy xe và đối chiếu giấy tờ với số khung, xem tận mắt căn phòng và bản hợp đồng thật. Kiểm tra số sê-ri có khớp với hóa đơn hoặc vỏ hộp không.',
    }],
  // Housing is the category where an expat loses the most money in one go, and the loss is
  // almost always a deposit paid to somebody who does not own the place.
  [FileText,
    { en: 'Renting? Check the papers, not just the room', vi: 'Thuê nhà? Hãy xem giấy tờ, không chỉ xem phòng' },
    {
      en: 'Ask to see the owner’s ID and the ownership certificate (sổ đỏ / sổ hồng), and check the name on them matches the person signing. Insist on a written contract and a receipt for every payment. Confirm the landlord will register your stay with the local police — for a foreign tenant that is the landlord’s legal duty, and one who refuses is usually not the owner.',
      vi: 'Hãy yêu cầu xem giấy tờ tùy thân của chủ nhà và giấy chứng nhận quyền sở hữu (sổ đỏ / sổ hồng), và kiểm tra tên trên giấy tờ có trùng với người ký hợp đồng không. Yêu cầu hợp đồng bằng văn bản và biên nhận cho mỗi lần thanh toán. Xác nhận chủ nhà sẽ khai báo tạm trú cho bạn với công an địa phương — với người thuê là người nước ngoài, đó là nghĩa vụ pháp lý của chủ nhà, và người từ chối thường không phải chủ nhà thật.',
    }],
  [Banknote,
    { en: 'Pay once, in person, at handover', vi: 'Trả tiền một lần, trực tiếp, khi nhận hàng' },
    {
      en: 'Hand over cash — or transfer — only when the item is in your hands and matches what was agreed. Never send money ahead to “hold” an item. If you transfer, confirm it truly landed in the seller’s account before you leave; screenshots can be faked.',
      vi: 'Chỉ đưa tiền mặt — hoặc chuyển khoản — khi món hàng đã ở trong tay bạn và đúng như đã thỏa thuận. Đừng bao giờ chuyển tiền trước để “giữ” hàng. Nếu chuyển khoản, hãy xác nhận tiền đã thật sự vào tài khoản người bán trước khi rời đi; ảnh chụp màn hình có thể bị làm giả.',
    }],
]

// The patterns that mean: stop, don’t pay, walk away.
const redFlags: Tip[] = [
  [AlertTriangle,
    { en: '“Send a deposit first”', vi: '“Chuyển cọc trước đi”' },
    {
      en: `${SITE_NAME} never asks you to send a deposit to another user, and no honest seller needs one through a chat link. Any “pay to reserve”, “pay a shipping fee” or “pay a verification fee” request is a scam.`,
      vi: `${SITE_NAME} không bao giờ yêu cầu bạn chuyển tiền cọc cho người dùng khác, và không người bán ngay thẳng nào cần bạn đặt cọc qua một đường link trong tin nhắn. Mọi yêu cầu “trả tiền để giữ hàng”, “trả phí vận chuyển” hay “trả phí xác minh” đều là lừa đảo.`,
    }],
  [AlertTriangle,
    { en: 'A price too good to be true', vi: 'Giá rẻ đến khó tin' },
    {
      en: 'If it’s dramatically cheaper than everything comparable, assume it’s bait — for a fake sale, a stolen item, or an account that vanishes the moment you pay.',
      vi: 'Nếu rẻ hơn hẳn mọi món tương tự, hãy coi đó là mồi nhử — cho một vụ bán hàng giả, một món đồ trộm cắp, hoặc một tài khoản biến mất ngay khi bạn trả tiền.',
    }],
  [AlertTriangle,
    { en: 'Pressure and urgency', vi: 'Hối thúc và gây áp lực' },
    {
      en: '“Lots of people are asking”, “transfer in 10 minutes or I’ll sell to someone else” — rushing you past a proper inspection is the oldest trick there is.',
      vi: '“Nhiều người đang hỏi lắm”, “chuyển khoản trong 10 phút không thì tôi bán cho người khác” — hối thúc để bạn bỏ qua bước kiểm tra kỹ là chiêu lừa lâu đời nhất.',
    }],
  [AlertTriangle,
    { en: '“Ship it before you see it”', vi: '“Gửi hàng trước, xem hàng sau”' },
    {
      en: 'A seller who refuses to meet in public and wants money up front for delivery is a risk you don’t need to take. Walk away.',
      vi: 'Người bán từ chối gặp ở nơi công cộng và đòi tiền trước để giao hàng là rủi ro bạn không cần chấp nhận. Hãy bỏ qua.',
    }],
  [AlertTriangle,
    { en: '“I’m abroad — I’ll courier it to you”', vi: '“Tôi đang ở nước ngoài — tôi sẽ gửi chuyển phát cho bạn”' },
    {
      en: 'The standard rental and vehicle scam: the “owner” is overseas, the price is excellent, and all you have to do is transfer a deposit so the keys or the bike can be sent. Nothing ever arrives. If the person cannot meet you, there is no deal.',
      vi: 'Chiêu lừa quen thuộc khi thuê nhà và mua xe: “chủ” đang ở nước ngoài, giá rất hời, và bạn chỉ cần chuyển tiền cọc để họ gửi chìa khóa hoặc chiếc xe. Không bao giờ có gì được gửi đến. Nếu người đó không thể gặp bạn, thì không có giao dịch nào cả.',
    }],
  [AlertTriangle,
    { en: '“Read me the code”', vi: '“Đọc mã cho tôi”' },
    {
      en: 'No legitimate trade ever needs an OTP, a bank password, a card number, or a code sent to your phone. Never read one out — that’s how accounts and money get taken.',
      vi: 'Không giao dịch chính đáng nào cần mã OTP, mật khẩu ngân hàng, số thẻ hay mã được gửi đến điện thoại của bạn. Đừng bao giờ đọc những mã đó cho ai — đó chính là cách tài khoản và tiền bị chiếm đoạt.',
    }],
  [AlertTriangle,
    { en: 'A brand-new, empty account', vi: 'Tài khoản mới tinh, chưa có gì' },
    {
      en: 'No listing history, no reviews, no trust — selling high-value goods cheap. On its own it’s a caution; combined with anything above, it’s your cue to stop.',
      vi: 'Không có lịch sử đăng tin, không có đánh giá, không có uy tín — lại bán hàng giá trị cao với giá rẻ. Chỉ riêng điều này là lý do để cẩn trọng; đi kèm bất kỳ dấu hiệu nào ở trên, đó là lúc bạn nên dừng lại.',
    }],
]

// What the platform itself does — every sentence cited in CS-0b; no promises the code does not keep.
// The glyphs match the listing page's dialog for the same subjects (protections-row.tsx).
const protection: Tip[] = [
  // Inputs: V_PHONE, verified (conversation-backed) reviews, the reply-rate Wilson bound and completed
  // sales (trust-math.ts; trust.ts computeTrustV2); an upheld report is a report_confirmed event
  // (admin/moderate/route.ts). "Can't post new listings": tierFor gives 'restricted' below 60 or on a
  // scam hold, and assertPublishable refuses it on every publish path (publish-guard.ts). "Unless the
  // score recovers" (minor and moderate charges decay, trust-math.ts) "or our team allows it" (an
  // admin release of a scam charge lets the account post up to a cap, released-charge-gate.ts).
  // Phone verification is OPTIONAL — the old "Sellers verify a real phone number" was false.
  [BadgeCheck,
    { en: 'Trust is earned, and can be lost', vi: 'Uy tín phải tích lũy, và có thể mất đi' },
    {
      en: 'A seller’s Trust score goes up with a verified phone number, verified reviews, quick replies and completed sales, and goes down when a report against them is upheld. If it falls too low, the account can’t post new listings unless the score recovers or our team allows it.',
      vi: 'Điểm uy tín của người bán tăng nhờ số điện thoại đã xác minh, đánh giá đã xác minh, trả lời tin nhắn nhanh và các lần bán thành công, và giảm khi một báo cáo về họ có căn cứ. Nếu điểm xuống quá thấp, tài khoản không thể đăng tin mới trừ khi điểm phục hồi hoặc đội ngũ của chúng tôi cho phép.',
    }],
  // CS-0 item 6, verbatim: the old tip said phone numbers were "stripped" (a post carrying one is
  // refused, publish-guard.ts assertCleanTexts) and low-trust posts "held for review" (a restricted
  // account is refused; nothing is held — core/listings.ts goes live with `verified: true`).
  [ScanLine,
    { en: 'Automatic checks on new listings', vi: 'Kiểm tra tự động tin mới' },
    {
      en: 'Before a listing goes live, its text is checked for banned items and contact details, it must have enough photos, and it’s compared with the seller’s other live listings to catch duplicates. After it goes live, some listings are checked again and can be hidden for review. Checks can miss things, so judge each listing yourself.',
      vi: 'Trước khi tin được đăng, nội dung được kiểm tra hàng cấm và thông tin liên hệ, tin phải có đủ ảnh, và được so với các tin đang đăng khác của người bán để phát hiện tin trùng. Sau khi đăng, một số tin được kiểm tra lại và có thể bị ẩn để xem xét. Việc kiểm tra có thể bỏ sót, nên hãy tự đánh giá từng tin.',
    }],
  // Signed in to message (api/conversations/route.ts, auth: 'profile') and to see a phone number
  // (api/listings/[id]/contact/route.ts). "Delete" on a message stamps deletedAt and keeps the body
  // (api/conversations/[id]/messages/[mid]/route.ts); the admin conversation view reads every message
  // with no deletedAt filter (admin/conversation/[id]/page.tsx). That view opens ANY conversation for
  // an admin — it is not gated on a report — so a report is named as an example, never as the
  // condition (second-opinion finding: "if it's reported, our team can read it" implied the reverse).
  // "Chats", not "contact": a phone call is not on any record.
  [Lock,
    { en: 'Chats stay on the record', vi: 'Tin nhắn được lưu lại' },
    {
      en: 'You must be signed in to message a seller or see their phone number. Deleting a message only hides it from the chat: it’s kept, and our team can still read it, for example when a conversation is reported.',
      vi: 'Bạn phải đăng nhập mới nhắn tin được cho người bán hoặc xem số điện thoại của họ. Xóa một tin nhắn chỉ ẩn nó khỏi cuộc trò chuyện: tin nhắn vẫn được lưu, và đội ngũ của chúng tôi vẫn đọc được, chẳng hạn khi cuộc trò chuyện bị báo cáo.',
    }],
  // CS-0 items 1 and 2, verbatim sentences. The old tip quoted a 72-hour window (only the evidence
  // window, and no deadline number ships while decision P0-a is open) and "we review both sides",
  // which no code proves. The photo count is DISPUTE_IMAGES_MAX; safety-copy.test.ts pins it.
  [Flag,
    { en: 'Reports and evidence', vi: 'Báo cáo và bằng chứng' },
    {
      en: 'A report opens a private case between you, the seller and our team, which you can follow under Disputes. You can send one statement with up to 6 photos before the deadline shown on the case. If the seller has an account, they’re told about the case and can do the same, but we never tell them who reported it.',
      vi: 'Báo cáo sẽ mở một hồ sơ riêng giữa bạn, người bán và đội ngũ của chúng tôi, và bạn theo dõi được trong mục Khiếu nại. Bạn được gửi một lần trình bày, kèm tối đa 6 ảnh, trước hạn chót ghi trên hồ sơ. Nếu người bán có tài khoản, họ được thông báo về hồ sơ và cũng được gửi như vậy, nhưng chúng tôi không bao giờ cho họ biết ai đã báo cáo.',
    }],
  // CS-0 items 3 and 4, verbatim sentences. The old tip promised every report an acknowledgement
  // "within 3 working days" (nothing in the code tracks it) and that offenders are "removed", which
  // CS-0 already dropped as unprovable; what the code does is warn, restrict or suspend.
  [UserRound,
    { en: 'Our team decides', vi: 'Đội ngũ của chúng tôi quyết định' },
    {
      en: 'Decisions are made by a person on our team, not automatically. If a report is upheld, we can take the listing down, lower the seller’s Trust score, and warn, restrict or suspend their account. If it isn’t, the case is closed with no action against the seller.',
      vi: 'Quyết định do một người trong đội ngũ của chúng tôi đưa ra, không phải tự động. Nếu báo cáo có căn cứ, chúng tôi có thể gỡ tin đăng, trừ điểm uy tín của người bán, và cảnh cáo, hạn chế hoặc khoá tài khoản của họ. Nếu không, hồ sơ được đóng và người bán không bị xử lý.',
    }],
  // CS-0 item 5's title and first two sentences, verbatim (terms/page.tsx: no payment taken, no
  // escrow; no listing checkout exists — payments/orders.ts createOrder has no caller). The old "you pay
  // the seller directly, in person" stated a habit as a fact.
  [Wallet,
    { en: 'We don’t handle your money', vi: 'Chúng tôi không giữ tiền của bạn' },
    {
      en: 'You pay the seller directly. We take no payment and hold no escrow, so we can’t refund you or reverse a payment. That’s why the habits above matter: check the item before any money moves.',
      vi: 'Bạn trả tiền trực tiếp cho người bán. Chúng tôi không thu tiền và không giữ tiền ký quỹ, nên không thể hoàn tiền hay huỷ một khoản thanh toán. Vì vậy, những thói quen ở trên rất quan trọng: hãy kiểm tra món hàng trước khi trả bất kỳ khoản tiền nào.',
    }],
]

// The protection section's heading. It used to promise that eno protects the reader, which is cover
// the platform cannot give: it takes no payment, holds no escrow and does not guarantee how a case ends
// (terms, "a platform, not a party to the deal"). Renamed together with the listing page's
// reports-and-disputes row (copy sheet CS-0, decision P0-b; see protections-row.tsx). The anchor id
// stays `protection` so existing links keep landing here. The Vietnamese is authored, so it renders
// through ContentSection's `titleVi` rather than the translation layer.
const PROTECTION_HEADING = { en: 'What we do — and what we don’t', vi: 'Những gì chúng tôi làm — và không làm' }

// If it goes wrong — ordered, do-this-now steps.
const recovery: [title: Copy, body: Copy][] = [
  [
    { en: 'Stop contact and keep everything', vi: 'Ngừng liên lạc và giữ lại mọi thứ' },
    {
      en: 'Don’t delete the conversation. Screenshots, receipts, and transfer records are your evidence — save them all.',
      vi: 'Đừng xóa cuộc trò chuyện. Ảnh chụp màn hình, biên lai và lịch sử chuyển khoản là bằng chứng của bạn — hãy lưu lại tất cả.',
    }],
  // The three Report buttons: the listing, the seller's page and the chat ((pdp)/page.tsx,
  // seller-storefront.tsx, messages/[id]/page.tsx). "Any proof" overstated it: a case takes one
  // written statement and photos, nothing else (api/disputes/[id]/messages/route.ts).
  [
    { en: 'Report the seller or listing', vi: 'Báo cáo người bán hoặc tin đăng' },
    {
      en: 'Use the Report button on the listing, the seller’s page or the chat. It opens a private case where you can describe what happened and add photos, such as screenshots and receipts.',
      vi: 'Dùng nút Báo cáo trên tin đăng, trang người bán hoặc trong cuộc trò chuyện. Báo cáo sẽ mở một hồ sơ riêng, nơi bạn trình bày sự việc và đính kèm ảnh, chẳng hạn ảnh chụp màn hình hay ảnh biên lai.',
    }],
  [
    { en: 'If money was lost, act fast', vi: 'Nếu đã mất tiền, hãy hành động ngay' },
    {
      en: 'Contact your bank immediately to try to reverse or freeze the transfer, and report the fraud to your local police (in Vietnam, the nearest công an phường).',
      vi: 'Liên hệ ngay với ngân hàng để thử hoàn lại hoặc phong tỏa khoản chuyển khoản, và trình báo vụ lừa đảo với công an phường gần nhất.',
    }],
  [
    { en: 'Reach eno support', vi: 'Liên hệ bộ phận hỗ trợ của eno' },
    {
      en: `Email ${COMPANY.email} with your case details and we’ll help however we can.`,
      vi: `Gửi email đến ${COMPANY.email} kèm chi tiết sự việc, chúng tôi sẽ hỗ trợ trong khả năng có thể.`,
    }],
]

// Icon NAMES come from the aliased services module (a module of copy may not import
// components), so they are resolved here. Unknown name → Info rather than a crash.
const SERVICES_ICONS: Record<string, IconComponent> = { Landmark, Globe, Receipt, Ban, Upload, SearchCheck }
const servicesTips: Tip[] = SERVICES_SAFETY.tips.map((t) => [SERVICES_ICONS[t.icon] ?? Info, t.title, t.body])

// The intro. It said "Most trades on eno go smoothly — accounts are verified, listings are screened, and
// higher-trust sellers rank first … These habits keep every one of them safe": no code records how
// trades go, phone verification is optional, "screened" is the claim CS-0 removed, the Trust score is
// one bounded term of the ranking rather than first place (ranking-formula.ts), and "keep … safe" is a
// promise. The middle sentence and its Vietnamese are unchanged (they were the curated vi-overrides pair).
const INTRO = {
  en: 'New listings go through automatic checks, and decisions on reports are made by our team. But the deal closes between you and the other person, so the last few metres are up to you. These habits make each deal safer.',
  vi: 'Tin đăng mới được kiểm tra tự động, và quyết định về các báo cáo do đội ngũ của chúng tôi đưa ra. Nhưng việc chốt giao dịch là giữa bạn và đối phương, nên những bước cuối cùng tùy thuộc vào bạn. Những thói quen này giúp mỗi giao dịch an toàn hơn.',
}

/** A `{ en, vi }` pair renders its authored Vietnamese; a plain string goes to the translation layer. */
function CopyText({ copy }: { copy: Copy }) {
  return typeof copy === 'string' ? <Tr text={copy} /> : <Bilingual en={copy.en} vi={copy.vi} />
}

// ⚠️ TWO COLUMNS AT EVERY WIDTH ABOVE sm, NEVER THREE (C-SAFETY, 2026-09-29). Beside the 210px rail
// a 3-up grid gave 298px tiles — ~40-character lines — and 3 divides none of the tip counts (4, 5, 7,
// 6), so every grid ended on an orphan row. Two ~455px columns read at ~58 characters and fill 4 and
// 6 evenly; 5 and 7 leave one tile on the last row, which a two-up list carries fine.
function TipGrid({ tips, danger = false }: { tips: Tip[]; danger?: boolean }) {
  return (
    <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
      {tips.map(([Icon, title, body], i) => (
        <div key={i}>
          <Icon className={danger ? 'h-5 w-5 text-destructive' : 'h-5 w-5 text-accent-foreground'} strokeWidth={2} aria-hidden />
          <h3 className="mt-2 text-base font-bold text-foreground"><CopyText copy={title} /></h3>
          <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-body"><CopyText copy={body} /></p>
        </div>
      ))}
    </div>
  )
}

// The will-ask / will-never-ask pair. Two lists side by side, no boxes — the content-page
// design language separates chunks with spacing and headings only.
function AskList({ title, items, ok }: { title: string; items: string[]; ok: boolean }) {
  const Icon = ok ? Check : X
  return (
    <div>
      <h3 className="text-base font-bold text-foreground"><Tr text={title} /></h3>
      <ul className="mt-3 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <Icon
              className={ok ? 'mt-0.5 h-4 w-4 shrink-0 text-success' : 'mt-0.5 h-4 w-4 shrink-0 text-destructive'}
              strokeWidth={2.5}
              aria-hidden
            />
            <span className="text-sm leading-relaxed text-body"><Tr text={item} /></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SafetyPage() {
  // `labelVi`/`titleVi` are AUTHORED Vietnamese (L-CONTENT-VI): these headings reach ContentPage as
  // string props, which the ui-strings harvester never sees, so the vi server HTML carried them in
  // English until client machine translation swapped them.
  const sections = [
    { id: 'before', label: 'Before you meet', labelVi: 'Trước khi gặp mặt' },
    { id: 'meeting', label: 'Meeting in person', labelVi: 'Khi gặp trực tiếp' },
    { id: 'red-flags', label: 'Red flags', labelVi: 'Dấu hiệu lừa đảo' },
    // Gated AND aliased: the anchor id and the label are both services-only copy, so neither
    // string exists in a marketplace build.
    ...(IS_SERVICES && SERVICES_SAFETY.navId ? [{ id: SERVICES_SAFETY.navId, label: SERVICES_SAFETY.navLabel }] : []),
    { id: 'protection', label: PROTECTION_HEADING.en, labelVi: PROTECTION_HEADING.vi },
    { id: 'help', label: 'If something goes wrong', labelVi: 'Nếu có sự cố' },
  ]

  return (
    <ContentPage
      title="Trade with confidence."
      intro={
        <Bilingual en={INTRO.en} vi={INTRO.vi} />
      }
      sections={sections}
    >
      <ContentSection id="before" title="Before you meet" titleVi="Trước khi gặp mặt" wide>
        <TipGrid tips={before} />
      </ContentSection>

      <ContentSection id="meeting" title="Meeting in person" titleVi="Khi gặp trực tiếp" wide>
        <TipGrid tips={meeting} />
      </ContentSection>

      <ContentSection id="red-flags" title="Red flags — stop and walk away" titleVi="Dấu hiệu lừa đảo — dừng lại và rời đi" wide>
        <p className="mb-6 max-w-[70ch] text-sm leading-relaxed text-body">
          <Tr text="Almost every scam shows one of these signs. If you see even one, don’t pay — pause, and report it." />
        </p>
        <TipGrid tips={redFlags} danger />
      </ContentSection>

      {IS_SERVICES && servicesTips.length > 0 && (
        <ContentSection id={SERVICES_SAFETY.navId} title={SERVICES_SAFETY.sectionTitle} wide>
          <p className="max-w-[70ch] text-sm leading-relaxed text-body">
            <Tr text={SERVICES_SAFETY.intro} />
          </p>
          {/* The provider-of-record disclosure, from the single source that owns it. Who does the
              work, who is answerable for it, and what this site is NOT — stated before the advice,
              because a visitor who reads nothing else must still leave with this.
              ⚠️ THROUGH <Bilingual>, WITH ITS OWN VIETNAMESE. It carries a hand-written Vietnamese
              pass because a mistranslated "who is legally responsible" is a legal defect
              (visa-provider.ts; bilingual.tsx), and /about already renders it that way. <Tr> sent
              the English to machine translation instead. */}
          <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-foreground">
            <Bilingual en={PROVIDER_OF_RECORD.en} vi={PROVIDER_OF_RECORD.vi} />
          </p>
          <div className="mt-8">
            <TipGrid tips={servicesTips} />
          </div>
          <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2">
            <AskList title={SERVICES_SAFETY.willTitle} items={SERVICES_SAFETY.will} ok />
            <AskList title={SERVICES_SAFETY.wontTitle} items={SERVICES_SAFETY.wont} ok={false} />
          </div>
          {/* The contextual cross-link. `rel` comes from cross-site-links.ts — noopener and
              deliberately NOT nofollow; read the constant before changing it. Plain text rather
              than an empty anchor if the href is ever missing. */}
          <p className="mt-10 max-w-[70ch] text-sm leading-relaxed text-body">
            <Tr text={SERVICES_SAFETY.crossLink.before} />{' '}
            {SERVICES_SAFETY.crossLink.href ? (
              <a
                href={SERVICES_SAFETY.crossLink.href}
                rel={CROSS_SITE_REL}
                className="font-semibold text-accent-foreground hover:underline"
              >
                {SERVICES_SAFETY.crossLink.label}
              </a>
            ) : (
              <span className="font-semibold text-accent-foreground">{SERVICES_SAFETY.crossLink.label}</span>
            )}{' '}
            <Tr text={SERVICES_SAFETY.crossLink.after} />
          </p>
        </ContentSection>
      )}

      <ContentSection id="protection" title={PROTECTION_HEADING.en} titleVi={PROTECTION_HEADING.vi} wide>
        <TipGrid tips={protection} />
      </ContentSection>

      <ContentSection id="help" title="If something goes wrong" titleVi="Nếu có sự cố">
        <ol className="space-y-5">
          {recovery.map(([title, body], i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-accent-foreground tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-foreground"><CopyText copy={title} /></h3>
                <p className="mt-1 text-sm leading-relaxed text-body"><CopyText copy={body} /></p>
              </div>
            </li>
          ))}
        </ol>
      </ContentSection>
    </ContentPage>
  )
}
