import { SITE_NAME, IS_SERVICES } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Bilingual } from '@/components/marketplace/bilingual'
import { CookieSettingsButton } from '@/components/marketplace/cookie-settings-button'
import { LegalLanguageNote } from '@/components/legal/legal-language-note'
import { LegalTable, LegalText, type LegalCopy } from '@/components/legal/legal-text'
import { AFFILIATION, COMPANY, PDP_DOSSIERS_FILED } from '@/lib/site-legal'
import { AMENDED } from '@/lib/compliance/legal-amendment'
import {
  PRIVACY_SERVICES_COLLECT,
  PRIVACY_SERVICES_CONTROLLER,
  PRIVACY_SERVICES_PURPOSES,
  PRIVACY_SERVICES_RECIPIENTS,
  PRIVACY_SERVICES_RETENTION,
  PRIVACY_SERVICES_SECTIONS,
} from '@/lib/privacy-services-copy'

export const metadata: Metadata = withShare({
  title: `Privacy Policy | ${SITE_NAME}`,
  description: `How ${SITE_NAME} collects, uses, shares and protects personal data under Vietnam’s Personal Data Protection Law 91/2025 — where it is stored, who receives it, sensitive data, processing outside Vietnam, and the rights you can exercise.`,
  alternates: { canonical: '/privacy' },
})

// ── Privacy policy — Personal Data Protection Law 91/2025/QH15 + Decree 356/2025/ND-CP ──────────
//
// What the law demands of this page, and where each demand is answered:
//   · controller identity + contact                    → "Who is responsible" (COMPANY, per edition)
//   · categories of data, sensitive data called out    → "What personal data we collect"
//   · purpose AND legal basis, per purpose             → "Why we use your data…"
//   · automated processing + the right to a person     → "Automated decisions…"
//   · where data is stored                             → "Where your data is stored"
//   · recipients, per recipient                        → "Who else receives your data" (a table)
//   · cross-border transfer notice + the MPS dossiers  → "Processing outside Vietnam" (PDP_DOSSIERS_FILED)
//   · consent: express, per-purpose, withdrawable      → "Cookies, tracking and your device"
//   · rights WITH the statutory clocks                 → "Your rights…" (2 / 10 / 15 / 20 days)
//   · retention limited to purpose                     → "How long we keep your data"
//   · 72-hour breach notification                      → "Security…"
//
// ⛔ EVERY PARAGRAPH IS A { en, vi } PAIR AND THE VIETNAMESE IS AUTHORED, NOT MACHINE-TRANSLATED
// (2026-10-01). It used to be English strings through <Tr>, so the Vietnamese a Vietnamese reader got
// was whatever the MT provider returned, and the page declared the English authoritative — for a
// Vietnamese-market platform under Law 122/2025. Now `LegalText` renders tr(en, vi): the curated
// Vietnamese for `vi`, the English for `en`, MT of the English for the nine other languages. Which
// language governs is said ONLY by <LegalLanguageNote> (LEGAL_VI_APPROVED in site-legal.ts): while
// counsel has not signed the Vietnamese off, NO language is declared authoritative. Change both
// languages of a paragraph together, in one edit.
//
// ⚠️ THIS ONE FILE IS SERVED BY BOTH EDITIONS and must be complete and true on each. A privacy policy
// cannot 404 on the licensed marketplace, so eno.vn compiles every string below. That is why the
// services-only paragraphs are IMPORTED from @/lib/privacy-services-copy rather than written inline
// behind an `IS_SERVICES ?` ternary: next.config.ts aliases that module to an empty stub on a
// marketplace build, which is the only thing that removes the words from the artifact. The gates
// here control what RENDERS; the alias controls what SHIPS. Nothing below may name that service.
//
// ⚠️ AND KEEP THE COPY OUT OF tr('…') / <Tr text="…"> LITERALS. scripts/gen-ui-strings.mjs harvests
// those into src/generated/ui-strings.ts, which ships to every browser. Data fields rendered through
// LegalText are not harvested — that is deliberate, not an oversight.
//
// ⚠️ KEEP IN SYNC WITH WHAT THIS PAGE DESCRIBES — a privacy policy goes stale silently. Each fact was
// read out of the code on 2026-10-01; the file each one rests on is named beside its paragraph.
//
// ⚠️ NO NUMBER OF DAYS FOR RETENTION OF ACCOUNT DATA, deliberately. The statutory RESPONSE clocks are
// fixed by law and safe to print; a retention period lives in the data and changes without this file.
// The on-device lifetimes in the storage table are different: each is a constant in the code that
// writes it, cited beside the row.

type Table = { caption: LegalCopy; head: LegalCopy[]; rows: LegalCopy[][] }
type Block = LegalCopy | { table: Table }
type Section = { id: string; title: LegalCopy; blocks: Block[] }

const S = SITE_NAME
const PRIVACY_EMAIL = COMPANY.privacyEmail
/** The operator's phone, only when the operator has a real one (eno.forum's is still "đang cập nhật"). */
const PHONE = /\d/.test(COMPANY.phone) ? COMPANY.phone : null

/** The data-protection contact — site-legal's COMPANY fields, never an invented person or title. */
const CONTACT: LegalCopy = PHONE
  ? {
      en: `Data protection contact: for anything about your personal data — a question, a request to exercise your rights, or a complaint — write to ${PRIVACY_EMAIL} or call ${PHONE}.`,
      vi: `Đầu mối bảo vệ dữ liệu cá nhân: mọi vấn đề về dữ liệu cá nhân của bạn — câu hỏi, yêu cầu thực hiện quyền hoặc khiếu nại — vui lòng gửi email tới ${PRIVACY_EMAIL} hoặc gọi ${PHONE}.`,
    }
  : {
      en: `Data protection contact: for anything about your personal data — a question, a request to exercise your rights, or a complaint — write to ${PRIVACY_EMAIL}.`,
      vi: `Đầu mối bảo vệ dữ liệu cá nhân: mọi vấn đề về dữ liệu cá nhân của bạn — câu hỏi, yêu cầu thực hiện quyền hoặc khiếu nại — vui lòng gửi email tới ${PRIVACY_EMAIL}.`,
    }

/**
 * WHO ELSE RECEIVES DATA — built ONLY from integrations present in the code (2026-10-01). Each row
 * names the file that sends it. Not listed, on purpose: Supabase and Google Cloud as HOSTS (the
 * database is self-hosted on our own server since the 2026-08-23 cutover — infra/vn-node/cutover.md;
 * Cloud Run was deleted), Google Cloud Translation (removed 2026-09-19, src/lib/translate.ts:26), the
 * Cloudflare Web Analytics beacon (blocked by the CSP — next.config.ts), and any eKYC provider (the
 * VNPT adapter is a placeholder that is not live — src/lib/identity/provider.ts:8).
 * ⛔ NO "BOUND BY A DATA-PROCESSING AGREEMENT" CLAIM: the dossier records those agreements as still
 * to be collected (docs/compliance/pdpl-dossier-draft.md, Phụ lục B). Say it when the copies exist.
 */
const RECIPIENTS: Table = {
  caption: { en: 'Recipients of personal data', vi: 'Các bên nhận dữ liệu cá nhân' },
  head: [
    { en: 'Recipient', vi: 'Bên nhận' },
    { en: 'Where', vi: 'Ở đâu' },
    { en: 'What it receives', vi: 'Nhận dữ liệu gì' },
    { en: 'Why', vi: 'Để làm gì' },
  ],
  rows: [
    [
      // proxied DNS: infra/vn-node/aop-runbook.md:15-18 (every eno.vn / eno.forum / sb.eno.vn record proxied,
      // ssl mode `full`: Cloudflare terminates TLS, so it processes the WHOLE request and response — form
      // posts, chat, uploads — not just headers) · Turnstile: src/components/marketplace/turnstile.tsx,
      // src/lib/turnstile-verify.ts. ⚠️ Support-mailbox routing is NOT claimed here: support@eno.vn is a
      // Cloudflare Email Routing redirect (src/lib/email-alias.ts:3-4) but the mailbox it lands in, and
      // eno.forum's own routing, are not recorded in the repo — add the row when they are.
      { en: 'Cloudflare', vi: 'Cloudflare' },
      { en: 'Global network, outside Vietnam', vi: 'Mạng toàn cầu, ngoài Việt Nam' },
      { en: 'Everything sent between your device and this site passes through Cloudflare’s network, encrypted in transit; Cloudflare processes it — including your IP address, browser details and the pages you request — to deliver it and to block attacks. The result of the sign-in check (Turnstile).', vi: 'Mọi dữ liệu truyền giữa thiết bị của bạn và website này đều đi qua mạng lưới của Cloudflare, được mã hóa trên đường truyền; Cloudflare xử lý dữ liệu đó — bao gồm địa chỉ IP, thông tin trình duyệt và các trang bạn yêu cầu — để truyền tải và chặn tấn công. Kết quả bước kiểm tra khi đăng nhập (Turnstile).' },
      { en: 'Delivering the site securely, and blocking attacks and automated abuse.', vi: 'Truyền tải website an toàn, chặn tấn công và truy cập tự động gây hại.' },
    ],
    [
      // src/lib/translate.ts:22-35 (Azure is the only paid provider; the self-hosted model is
      // src/lib/mt-local.ts) · chat: src/app/api/messages/translate/route.ts:220 translates the CALLER's
      // INCOMING messages (route.ts:22-24), and src/hooks/use-chat-translation.ts:101-104 starts it ON
      // whenever the two languages differ — so a sender's text goes out on the RECIPIENT's switch.
      { en: 'Microsoft (Azure AI Translator)', vi: 'Microsoft (Azure AI Translator)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Text to translate: listing text, interface text and chat messages, when the two people in a conversation use different languages: translation starts switched on in that case, each of you can switch it off for your own view, and the messages you send are translated for the other person while their translation is on. Part of our translation runs on our own server instead.', vi: 'Văn bản cần dịch: nội dung tin đăng, chữ trên giao diện và tin nhắn trò chuyện, khi hai bên dùng ngôn ngữ khác nhau: khi đó tính năng dịch được bật sẵn, mỗi bên có thể tắt cho phần hiển thị của mình, và tin nhắn bạn gửi được dịch cho bên kia khi họ đang bật dịch. Một phần việc dịch chạy trên máy chủ của chính chúng tôi.' },
      { en: 'Translating content into the language you choose.', vi: 'Dịch nội dung sang ngôn ngữ bạn chọn.' },
    ],
    [
      // src/lib/gemini.ts:60 (location 'global') · src/lib/ai-moderation.ts · src/lib/vertex-search.ts:43
      // · src/app/api/ai/concierge/route.ts · search terms: src/app/api/listings/semantic-rank.ts:54-78 →
      // vertexSearchListingIds (vertex-search.ts:255-257) · photo search: api/ai/visual-search/route.ts:81-83
      // (inlineData) · rephrase: api/ai/rephrase/route.ts:39-61
      { en: 'Google (Vertex AI, Gemini)', vi: 'Google (Vertex AI, Gemini)' },
      { en: 'Outside Vietnam (Google’s global endpoint)', vi: 'Ngoài Việt Nam (điểm truy cập toàn cầu của Google)' },
      { en: 'Listing photos and text sent for AI features and automated moderation; what you type to the AI assistant; where AI search is switched on, public listing details and the words you search for; a photo you choose to search by; text you ask us to rephrase.', vi: 'Ảnh và nội dung tin đăng được gửi cho các tính năng AI và kiểm duyệt tự động; nội dung bạn nhập cho trợ lý AI; khi tìm kiếm bằng AI được bật, thông tin công khai của tin đăng và từ khóa bạn tìm kiếm; ảnh bạn chọn để tìm kiếm bằng hình ảnh; văn bản bạn nhờ chúng tôi viết lại.' },
      { en: 'Describing and classifying listings, checking them for prohibited goods, search, search by photo, writing help and the shopping assistant.', vi: 'Mô tả và phân loại tin đăng, kiểm tra hàng hóa bị cấm, tìm kiếm, tìm kiếm bằng hình ảnh, hỗ trợ viết nội dung và trợ lý mua sắm.' },
    ],
    [
      // src/lib/google-identity.ts · next.config.ts gsiScript
      { en: 'Google (Sign in with Google)', vi: 'Google (Đăng nhập bằng Google)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Only if you choose it: Google learns that you are signing in here, and sends us your name, email address and profile picture.', vi: 'Chỉ khi bạn chọn: Google biết bạn đang đăng nhập vào website này và gửi cho chúng tôi tên, địa chỉ email và ảnh hồ sơ của bạn.' },
      { en: 'Signing in.', vi: 'Đăng nhập.' },
    ],
    [
      // src/lib/tax-lookup.ts:25 (server-side fetch, URL only, no headers) · called from
      // src/lib/core/seller.ts:130 when a business profile is saved with a tax code · operator: Casso,
      // a Vietnamese company (docs/business-verification-vn.md:213-216). ⚠️ Where its SERVERS run is not
      // recorded here, so the cell names only the operator and says the server location is unconfirmed.
      { en: 'VietQR (api.vietqr.io)', vi: 'VietQR (api.vietqr.io)' },
      { en: 'Operated by Casso, a Vietnamese company (we have not confirmed where its servers are)', vi: 'Do Casso, một doanh nghiệp Việt Nam, vận hành (chúng tôi chưa xác nhận nơi đặt máy chủ)' },
      { en: 'Only if you enter a business tax code: that tax code, sent by our server without your account or your IP address.', vi: 'Chỉ khi bạn nhập mã số thuế doanh nghiệp: mã số thuế đó, do máy chủ của chúng tôi gửi, không kèm tài khoản hay địa chỉ IP của bạn.' },
      { en: 'Checking that the business is registered and active.', vi: 'Kiểm tra doanh nghiệp đã đăng ký và đang hoạt động.' },
    ],
    [
      // src/app/api/reverse-geocode/route.ts:38 (Google, only when a key is set), :74 (Nominatim) —
      // called from OUR server with lat/lng (and the page language) only. Callers: the address pickers
      // (post-wizard, business profile, chat location) AND the area filter's "Use my current location"
      // (src/components/marketplace/area-filter.tsx:206 fetch, :434 shows the resolved address).
      { en: 'Google Maps geocoding, or OpenStreetMap (Nominatim)', vi: 'Google Maps (chuyển đổi tọa độ) hoặc OpenStreetMap (Nominatim)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Map coordinates only — sent by our server, without your account or your IP address — when you use your location to fill in an address, or to show the area you searched near.', vi: 'Chỉ tọa độ bản đồ — do máy chủ của chúng tôi gửi, không kèm tài khoản hay địa chỉ IP của bạn — khi bạn dùng vị trí của mình để điền địa chỉ, hoặc để hiển thị khu vực bạn đang tìm kiếm xung quanh.' },
      { en: 'Turning a location into an address.', vi: 'Chuyển vị trí thành địa chỉ.' },
    ],
    [
      // src/lib/basemap.ts:30 (tiles load in the visitor's browser)
      { en: 'CARTO', vi: 'CARTO' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'When a map is shown, your browser loads the map images from CARTO, which sees your IP address and the area of the map.', vi: 'Khi bản đồ được hiển thị, trình duyệt của bạn tải hình ảnh bản đồ từ CARTO; CARTO thấy địa chỉ IP của bạn và khu vực bản đồ.' },
      { en: 'Showing maps.', vi: 'Hiển thị bản đồ.' },
    ],
    [
      // src/lib/mail.ts:1-17 · src/app/api/auth/email-link/route.ts:206 · cron/weekly-digest
      { en: 'Resend', vi: 'Resend' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Your email address and the content of each email we send you: sign-in links and codes, notifications and digests.', vi: 'Địa chỉ email của bạn và nội dung từng email chúng tôi gửi bạn: đường dẫn và mã đăng nhập, thông báo và bản tin tổng hợp.' },
      { en: 'Sending email.', vi: 'Gửi email.' },
    ],
    [
      // src/lib/otp-channels.ts:84 (Telegram Gateway), :119 (WhatsApp) · src/lib/zalo-zns.ts:213
      // (business.openapi.zalo.me). ⛔ NO "Zalo: Vietnam": where Zalo's SERVERS run is not recorded
      // anywhere in the repo. Like the VietQR row, the cell names the OPERATOR's country only — say
      // where the data is processed when VNG confirms it.
      { en: 'Telegram, Meta (WhatsApp) or VNG (Zalo)', vi: 'Telegram, Meta (WhatsApp) hoặc VNG (Zalo)' },
      { en: 'Telegram and Meta: outside Vietnam. Zalo: operated by VNG, a Vietnamese company.', vi: 'Telegram và Meta: ngoài Việt Nam. Zalo: do VNG, một doanh nghiệp Việt Nam, vận hành.' },
      { en: 'Your phone number and the one-time code, when you sign in with your phone.', vi: 'Số điện thoại và mã dùng một lần, khi bạn đăng nhập bằng số điện thoại.' },
      { en: 'Delivering sign-in codes.', vi: 'Gửi mã đăng nhập.' },
    ],
    [
      // src/lib/whatsapp.ts:4-10 · src/lib/whatsapp-bridge.ts
      { en: 'Meta (WhatsApp Business)', vi: 'Meta (WhatsApp Business)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Your phone number and the messages you exchange with our support team over WhatsApp.', vi: 'Số điện thoại và các tin nhắn bạn trao đổi với bộ phận hỗ trợ của chúng tôi qua WhatsApp.' },
      { en: 'Support conversations over WhatsApp.', vi: 'Trao đổi hỗ trợ qua WhatsApp.' },
    ],
    [
      // src/lib/push.ts (Web Push) · src/lib/native-push.ts:63 (FCM), :91 (APNs)
      { en: 'Push-notification services (your browser’s, Google Firebase, Apple)', vi: 'Dịch vụ thông báo đẩy (của trình duyệt, Google Firebase, Apple)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Only if you turn notifications on: a device address and the text of each notification.', vi: 'Chỉ khi bạn bật thông báo: địa chỉ thiết bị và nội dung từng thông báo.' },
      { en: 'Delivering notifications.', vi: 'Gửi thông báo.' },
    ],
    [
      // TWO POSTERS, EVERY CHANNEL ENV-GATED (dormant until its credentials are set):
      // · at publish — src/lib/syndicate.ts:113-114: Telegram channel + Facebook Page
      // · daily cron (marketplace only, api/cron/social-daily/route.ts:26) — src/lib/social/channels.ts:
      //   Facebook :30, LinkedIn :53, Instagram :85, Threads :105, Reddit :137 (CHANNELS :163-169);
      //   listings up to 120 days old (social/daily.ts MAX_AGE_DAYS), so "a recent listing", not "new".
      // · what goes out — social/caption.ts:61-69 (category + area opener, title, price, area, link) and
      //   the cover photo; syndicate.ts:38-47 the same without the opener.
      // ⚠️ Which are LIVE is env state, not code: channels.ts:29 says only the Facebook Page is, and
      // social-daily/route.ts:21 that four of the five daily channels await app approval. The row lists
      // every channel the code can post to, under "where a channel is switched on".
      { en: 'Facebook, Instagram, Threads, LinkedIn, Reddit and Telegram (our own pages and channels)', vi: 'Facebook, Instagram, Threads, LinkedIn, Reddit và Telegram (trang và kênh của chính chúng tôi)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Where a channel is switched on: a recent listing’s title, category, price, area, photo and link — content already published on this site.', vi: 'Khi kênh được bật: tiêu đề, danh mục, giá, khu vực, ảnh và đường dẫn của một tin đăng gần đây — nội dung đã được công khai trên website.' },
      { en: 'Sharing new listings on our social channels.', vi: 'Chia sẻ tin đăng mới trên các kênh mạng xã hội của chúng tôi.' },
    ],
    [
      // src/lib/affiliate-deeplink.ts (a plain link the visitor clicks; no account data is added)
      { en: 'Linked shops and affiliate networks (for example AccessTrade)', vi: 'Cửa hàng liên kết và mạng tiếp thị liên kết (ví dụ AccessTrade)' },
      { en: 'Where that shop or network operates', vi: 'Nơi cửa hàng hoặc mạng đó hoạt động' },
      { en: 'Only what your browser sends when you choose to open their link: your visit, and the cookies they set under their own policies. We add none of your account data.', vi: 'Chỉ những gì trình duyệt của bạn gửi khi bạn chọn mở đường dẫn của họ: lượt truy cập, và cookie họ đặt theo chính sách của họ. Chúng tôi không gửi kèm dữ liệu tài khoản nào của bạn.' },
      { en: 'Buying from a linked shop.', vi: 'Mua hàng tại cửa hàng liên kết.' },
    ],
    [
      // src/components/marketplace/analytics-tags.tsx (GA loads only with consent `a`)
      { en: 'Google (Google Analytics) — only if you switch on Analytics', vi: 'Google (Google Analytics) — chỉ khi bạn bật Phân tích' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'The pages you visit and actions on them, a browser identifier, your IP address and browser details.', vi: 'Các trang bạn xem và thao tác trên đó, mã định danh trình duyệt, địa chỉ IP và thông tin trình duyệt.' },
      { en: 'Measuring how the site is used.', vi: 'Đo lường cách website được sử dụng.' },
    ],
    [
      // src/lib/meta-capi.ts:112-114 (no-op unless configured AND serverConsent().d) · user_data
      // :59-68 — em/ph/external_id SHA-256, client_ip_address, client_user_agent, fbp/fbc RAW from the
      // request cookies (:81-89) · event_source_url = the Referer (:122). Call sites and custom_data:
      // api/track/view/route.ts:49-58 ViewContent (listing id, price, currency) · api/listings/[id]/
      // contact/route.ts:187-190 Contact (listing id; email, phone, account id) · lib/core/listings.ts
      // :1138-1144 Lead (listing id, category, price; seller phone + id) · api/profile/account-type/
      // route.ts:234-242 CompleteRegistration (account type; first-visit source/medium/campaign ONLY when
      // `a` is on too — :206). Nothing on the site sets _fbp/_fbc (no pixel loads; next.config.ts CSP),
      // so they are sent only if the browser already holds them.
      // ⚠️ The services edition has ONE MORE call site (InitiateCheckout). It cannot be named in this shared
      // row (edition boundary), so it is disclosed in PRIVACY_SERVICES_RECIPIENTS — see the note there.
      { en: 'Meta (Conversions API) — only if you switch on Advertising', vi: 'Meta (Conversions API) — chỉ khi bạn bật Quảng cáo' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Actions such as viewing a listing, contacting a seller, posting a listing and signing up, with the listing involved (its identifier and, when you view or post one, its price; when you post, its category); the address of the page you were on; at sign-up, the type of account you chose and — only if Analytics is on as well — the link or campaign that first brought you here; your email address, phone number and account identifier, each scrambled (hashed) first; your IP address and browser details; and Meta’s own browser cookies (_fbp, _fbc), if your browser already holds them.', vi: 'Các hành động như xem tin đăng, liên hệ người bán, đăng tin và đăng ký, kèm thông tin về tin đăng liên quan (mã tin đăng và, khi bạn xem hoặc đăng tin, giá của tin; khi bạn đăng tin, danh mục của tin); địa chỉ trang bạn đang xem; khi đăng ký, loại tài khoản bạn chọn và — chỉ khi Phân tích cũng được bật — đường dẫn hoặc chiến dịch đã đưa bạn đến đây lần đầu; email, số điện thoại và mã tài khoản của bạn, mỗi thông tin đều được xáo trộn (băm) trước; địa chỉ IP và thông tin trình duyệt; và cookie trình duyệt của chính Meta (_fbp, _fbc), nếu trình duyệt của bạn đã có sẵn.' },
      { en: 'Measuring our advertising.', vi: 'Đo lường hiệu quả quảng cáo của chúng tôi.' },
    ],
  ],
}

/**
 * WHAT THIS SITE KEEPS ON YOUR DEVICE — every localStorage / sessionStorage / IndexedDB key and every
 * cookie the code writes, grouped (grep of src/, 2026-10-01). The "removed" column cites the constant.
 * Sign-out clears the per-account rows: src/lib/sign-out-storage.ts, held to these names by its test.
 */
const ON_DEVICE: Table = {
  caption: { en: 'What this site keeps on your device', vi: 'Những gì website lưu trên thiết bị của bạn' },
  head: [
    { en: 'Item', vi: 'Mục' },
    { en: 'What it holds', vi: 'Nội dung' },
    { en: 'When it is removed', vi: 'Khi nào bị xóa' },
  ],
  rows: [
    [
      { en: 'Sign-in session (cookies)', vi: 'Phiên đăng nhập (cookie)' },
      { en: 'Proof that you are signed in, and short-lived cookies used while you sign in.', vi: 'Thông tin xác nhận bạn đang đăng nhập, và các cookie ngắn hạn dùng trong lúc đăng nhập.' },
      { en: 'When you sign out or the session expires; the sign-in cookies once sign-in completes or times out.', vi: 'Khi bạn đăng xuất hoặc phiên hết hạn; cookie đăng nhập khi việc đăng nhập hoàn tất hoặc hết hạn.' },
    ],
    [
      // consent.ts persist(): CONSENT_MAX_AGE_S = 12 months (consent-value.ts)
      { en: 'Cookie choice (eno-consent-v2)', vi: 'Lựa chọn cookie (eno-consent-v2)' },
      { en: 'Which of the three optional uses you allowed, when, and the random identifier its record is filed under.', vi: 'Bạn đã cho phép mục nào trong ba mục tùy chọn, vào thời điểm nào, và mã ngẫu nhiên dùng để lưu bản ghi lựa chọn đó.' },
      { en: 'After 12 months, when we ask again.', vi: 'Sau 12 tháng, khi chúng tôi hỏi lại.' },
    ],
    [
      // layout.tsx 'eno-theme' / 'lang' · currency-context.tsx eno-currency, eno-fx · language-context ui-dict:*
      { en: 'Preferences', vi: 'Tùy chọn hiển thị' },
      { en: 'Your language, light or dark theme and currency; today’s exchange rates; cached interface translations.', vi: 'Ngôn ngữ, giao diện sáng hoặc tối và đơn vị tiền tệ; tỷ giá trong ngày; bản dịch giao diện đã lưu đệm.' },
      { en: 'When you change them or clear this site’s data in your browser.', vi: 'Khi bạn thay đổi hoặc xóa dữ liệu của website trong trình duyệt.' },
    ],
    [
      // reco-signals.ts RECENT_SEARCHES_KEY · use-search-box.ts RECENT_LOCATIONS_KEY · header.tsx removeItem
      { en: 'Recent searches and areas', vi: 'Tìm kiếm và khu vực gần đây' },
      { en: 'What you searched for and the areas you used, so the search box can offer them again.', vi: 'Những gì bạn đã tìm và các khu vực bạn đã dùng, để ô tìm kiếm gợi ý lại.' },
      { en: 'When you clear them from the search box.', vi: 'Khi bạn xóa chúng trong ô tìm kiếm.' },
    ],
    [
      // reco-signals.ts recordView / recordViewedListing (need `p`) · consent-runtime.ts clearViewHistory
      { en: 'Viewing history — only with Personalisation', vi: 'Lịch sử xem — chỉ khi bật Cá nhân hóa' },
      { en: 'The categories, brands and listings you viewed here.', vi: 'Các danh mục, thương hiệu và tin đăng bạn đã xem tại đây.' },
      { en: 'Not kept at all without Personalisation; deleted as soon as it is off.', vi: 'Không được lưu nếu chưa bật Cá nhân hóa; bị xóa ngay khi tắt.' },
    ],
    [
      // favorites-context.tsx KEY 'eno:favorites', SAVED_KEY 'eno-saved-cache'
      { en: 'Saved listings', vi: 'Tin đã lưu' },
      { en: 'The listings you saved on this device, and a copy of your account’s saved list.', vi: 'Các tin bạn đã lưu trên thiết bị này, và bản sao danh sách tin đã lưu của tài khoản.' },
      { en: 'The account copy when you sign out; the device list when you unsave items or clear site data.', vi: 'Bản sao của tài khoản khi bạn đăng xuất; danh sách trên thiết bị khi bạn bỏ lưu hoặc xóa dữ liệu website.' },
    ],
    [
      // post-wizard.tsx 'eno-listing-draft', DRAFT_TTL_MS 15 min (:347, removed on next open :377; photos
      // cleared with it :406) · cleared on publish :946-947 and at sign-out (auth-context.tsx:627-628)
      // · post-draft-photos.ts IndexedDB 'eno-post-draft', PHOTO_TTL_MS 24h (:106), checked ONLY inside
      // loadDraftPhotos (:156-162). ⛔ NO TIMER SWEEPS EITHER — both TTLs apply when /post is opened
      // again, so the copy says "the next time you open the form", never "after N hours".
      { en: 'Unfinished listing', vi: 'Tin đăng chưa hoàn tất' },
      { en: 'The text of a listing you have not published yet, and its photos (in the browser’s database).', vi: 'Nội dung tin đăng bạn chưa đăng, và ảnh của tin đó (trong cơ sở dữ liệu của trình duyệt).' },
      { en: 'When you publish or sign out, or the next time you open the form if your last edit was more than 15 minutes earlier; the photos go with the text, and are also discarded the next time the form opens if they are more than 24 hours old. Nothing removes them before the form is opened again.', vi: 'Khi bạn đăng tin hoặc đăng xuất, hoặc vào lần mở biểu mẫu tiếp theo nếu lần sửa cuối đã quá 15 phút; ảnh bị xóa cùng nội dung, và cũng bị xóa vào lần mở biểu mẫu tiếp theo nếu đã quá 24 giờ. Trước khi biểu mẫu được mở lại, không có gì tự động xóa chúng.' },
    ],
    [
      // chat-context.tsx CONVOS_KEY 'eno-convos-v2', THREAD_PREFIX 'eno-thr2:' · notifications-context.tsx
      // 'eno-notifs' · use-dashboard.ts 'eno-dashboard' · cleared by sign-out-storage.ts
      { en: 'Inbox, notifications and dashboard', vi: 'Hộp thư, thông báo và trang quản lý' },
      { en: 'A copy of your conversations, notifications and seller dashboard, so they open instantly.', vi: 'Bản sao các cuộc trò chuyện, thông báo và trang quản lý người bán, để mở được ngay.' },
      { en: 'When you sign out.', vi: 'Khi bạn đăng xuất.' },
    ],
    [
      // messages/ai/page.tsx STORE_KEY 'eno:ai_chat_v1', last 30 (:68) · sign-out-storage.ts
      { en: 'AI assistant conversation', vi: 'Cuộc trò chuyện với trợ lý AI' },
      { en: 'Your last 30 messages with the AI assistant.', vi: '30 tin nhắn gần nhất giữa bạn và trợ lý AI.' },
      { en: 'When you sign out.', vi: 'Khi bạn đăng xuất.' },
    ],
    [
      // rental-check/store.ts BASKET_KEY, DRAFT_KEY (DRAFT_TTL_MS 7 days :37), HINT_KEY (session)
      // · cleared on send (rentals/check/rental-check-view.tsx:316) and at sign-out · ⛔ the 7-day TTL
      // is applied ONLY in readDraft (store.ts:271-282), called only when /rentals/check opens (view :135)
      { en: 'Rental availability list', vi: 'Danh sách kiểm tra phòng trống' },
      { en: 'The rentals you asked us to check, and your unfinished request.', vi: 'Các bất động sản cho thuê bạn nhờ chúng tôi kiểm tra, và yêu cầu bạn đang soạn dở.' },
      { en: 'When you send the request or sign out; an unfinished request is discarded the next time you open the list if it is more than 7 days old.', vi: 'Khi bạn gửi yêu cầu hoặc đăng xuất; yêu cầu soạn dở bị hủy vào lần mở danh sách tiếp theo nếu đã quá 7 ngày.' },
    ],
    [
      // teacher-form.tsx DRAFT_KEY 'eno.teacherDraft.v1' (clearStored :317) · sign-out-storage.ts
      { en: 'Unfinished teacher profile', vi: 'Hồ sơ giáo viên chưa hoàn tất' },
      { en: 'The teacher profile you are filling in.', vi: 'Hồ sơ giáo viên bạn đang điền.' },
      { en: 'When you submit it or sign out.', vi: 'Khi bạn gửi hồ sơ hoặc đăng xuất.' },
    ],
    [
      // attribution.ts ATTR_COOKIE 'eno_attr', MAX_AGE_DAYS 180 (:19) · consent-runtime.ts deletes without `a`
      { en: 'First-visit link (eno_attr) — only with Analytics', vi: 'Nguồn truy cập đầu tiên (eno_attr) — chỉ khi bật Phân tích' },
      { en: 'Which link or campaign first brought you here.', vi: 'Đường dẫn hoặc chiến dịch đã đưa bạn đến đây lần đầu.' },
      { en: 'After 180 days; deleted at once if Analytics is off.', vi: 'Sau 180 ngày; bị xóa ngay nếu Phân tích bị tắt.' },
    ],
    [
      // consent-runtime.ts isAnalyticsCookie / isAdCookie + enforceConsentCleanup
      { en: 'Google Analytics and advertising cookies — only with Analytics or Advertising', vi: 'Cookie của Google Analytics và cookie quảng cáo — chỉ khi bật Phân tích hoặc Quảng cáo' },
      { en: 'Identifiers set by Google and Meta.', vi: 'Mã định danh do Google và Meta đặt.' },
      { en: 'Deleted at once when the matching switch is off.', vi: 'Bị xóa ngay khi tắt mục tương ứng.' },
    ],
    [
      // track-view.tsx VIEW_DEDUP_KEY · quick-contact.ts COMPOSE_KEY · listings-explorer.tsx eno:feed-snap
      // · attribution.ts ATTR_SESSION_KEY · affiliate-product-step.tsx eno_aff_opened_* (all sessionStorage)
      // ⛔ COMPOSE_KEY IS WRITTEN ONLY WHEN SIGNED IN (contact-composer.tsx:100-109 opens sign-in for a
      // guest instead; quick-contact.ts:12 "Caller must be AUTHED") — never "a message you started
      // before signing in". /messages/pending removes it, and re-stashes it when the send fails
      // (messages/pending/page.tsx:63, :81); sign-out removes it (sign-out-storage.ts SIGN_OUT_SESSION_KEYS).
      { en: 'Notes for the current tab', vi: 'Ghi chú cho thẻ trình duyệt hiện tại' },
      { en: 'Which listings you opened (so a reload is not counted as a second view), a message you were sending while the conversation opens (kept if sending fails, so it is not lost), where you were in the feed, and similar short-lived notes.', vi: 'Các tin bạn đã mở (để tải lại trang không bị tính là một lượt xem mới), tin nhắn bạn đang gửi trong lúc cuộc trò chuyện được mở (được giữ lại nếu gửi không thành công, để không bị mất), vị trí của bạn trong danh sách tin, và các ghi chú ngắn hạn tương tự.' },
      { en: 'When you close the tab; the message you were sending also when you sign out.', vi: 'Khi bạn đóng thẻ; tin nhắn bạn đang gửi cũng bị xóa khi bạn đăng xuất.' },
    ],
    [
      // signup-prompt.ts DEVICE_KEY 'eno:signup-prompt' (localStorage: dismissals, pausedUntil, lastShownAt,
      // member, methodAt) · TAB_KEY 'eno:signup-prompt-tab' (sessionStorage: ms, shown, nextAt, cont). ⛔ NO TIMER CLEARS
      // THE DEVICE KEY AND SIGN-OUT DOES NOT EITHER (it is not in sign-out-storage.ts, on purpose: `member`
      // is what keeps "Join eno" away from someone who already has an account) — so the copy says so.
      { en: 'Sign-up reminder (eno:signup-prompt, eno:signup-prompt-tab)', vi: 'Lời nhắc đăng ký (eno:signup-prompt, eno:signup-prompt-tab)' },
      { en: 'For the “Join eno” reminder: how long you have browsed in the current tab, how many times it has asked there, and whether you closed it and have not yet opened another page; how many times you closed it, when it last asked and until when it is paused; when you last chose Google or email in it (so a sign-in soon after can be counted once, anonymously); and whether someone has signed in on this device, so it never asks here again. Timings, counts and that one yes/no — no page, listing or identifier.', vi: 'Cho lời nhắc “Tham gia eno”: bạn đã xem trang bao lâu trong thẻ hiện tại, lời nhắc đã hiện mấy lần trong thẻ đó, và bạn đã đóng lời nhắc mà chưa mở trang khác hay chưa; bạn đã đóng lời nhắc mấy lần, lần cuối lời nhắc hiện và lời nhắc tạm dừng đến khi nào; lần cuối bạn chọn Google hoặc email trong lời nhắc (để một lần đăng nhập ngay sau đó được đếm một lần, ẩn danh); và đã có ai đăng nhập trên thiết bị này chưa, để lời nhắc không bao giờ hiện lại tại đây. Chỉ gồm thời lượng, số lần và một mục có/không đó — không có trang, tin đăng hay mã định danh nào.' },
      { en: 'The browsing time when you close the tab; the rest when you clear this site’s data in your browser (signing out does not remove it).', vi: 'Thời lượng xem trang khi bạn đóng thẻ; phần còn lại khi bạn xóa dữ liệu của website trong trình duyệt (đăng xuất không xóa mục này).' },
    ],
    [
      // install-hint.tsx · save-signup-sheet.tsx · post-wizard.tsx eno-posted-before · use-chat-translation.ts
      // chat-tr:* · auth-context.tsx eno-signup-fired:* · availability-client.tsx eno-avail:* · auth/handoff-client.ts
      // eno:handoff:next
      { en: 'Small reminders', vi: 'Ghi nhớ nhỏ' },
      { en: 'Whether you dismissed a prompt or already saw it, whether chat translation is on for a conversation, where to take you back to after signing in, and similar flags.', vi: 'Bạn đã đóng hay đã xem một lời nhắc chưa, dịch tin nhắn có đang bật cho từng cuộc trò chuyện không, trang cần đưa bạn quay lại sau khi đăng nhập, và các ghi nhớ tương tự.' },
      { en: 'When you clear this site’s data in your browser.', vi: 'Khi bạn xóa dữ liệu của website trong trình duyệt.' },
    ],
  ],
}

const SECTIONS: Section[] = [
  {
    id: 'controller',
    title: { en: 'Who is responsible for your data', vi: 'Ai chịu trách nhiệm về dữ liệu của bạn' },
    blocks: [
      {
        en: 'This policy explains what personal data we process, why, where it is kept, who else receives it, and the rights Vietnamese law gives you. It is written to the Personal Data Protection Law 91/2025/QH15 and Decree 356/2025/ND-CP. Those use “personal data” for anything that identifies you, and “sensitive personal data” for a narrower set the law protects more strictly — we use the same words here, and say which is which.',
        vi: 'Chính sách này giải thích chúng tôi xử lý dữ liệu cá nhân nào, vì sao, lưu ở đâu, những ai khác nhận dữ liệu, và các quyền pháp luật Việt Nam dành cho bạn. Chính sách được xây dựng theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định 356/2025/NĐ-CP. Các văn bản này dùng khái niệm “dữ liệu cá nhân” cho mọi thông tin giúp xác định bạn, và “dữ liệu cá nhân nhạy cảm” cho một nhóm hẹp hơn được pháp luật bảo vệ chặt chẽ hơn — chúng tôi dùng đúng các khái niệm đó và nói rõ dữ liệu nào thuộc nhóm nào.',
      },
      {
        en: `The data controller — the party that decides why and how your data is processed — is ${COMPANY.name}, ${COMPANY.address}. We acknowledge every request about your personal data within 2 working days.`,
        vi: `Bên kiểm soát dữ liệu cá nhân — bên quyết định mục đích và cách thức xử lý dữ liệu của bạn — là ${COMPANY.name}, ${COMPANY.address}. Chúng tôi xác nhận đã nhận mọi yêu cầu liên quan đến dữ liệu cá nhân của bạn trong vòng 2 ngày làm việc.`,
      },
      CONTACT,
      { en: AFFILIATION.en, vi: AFFILIATION.vi },
      ...(IS_SERVICES ? PRIVACY_SERVICES_CONTROLLER : []),
    ],
  },
  {
    id: 'what-we-collect',
    title: { en: 'What personal data we collect', vi: 'Chúng tôi thu thập dữ liệu cá nhân nào' },
    blocks: [
      {
        en: 'Account information: when you sign in we receive your email address and/or phone number, and — if you use Google sign-in — your name and profile picture from Google.',
        vi: 'Thông tin tài khoản: khi bạn đăng nhập, chúng tôi nhận địa chỉ email và/hoặc số điện thoại của bạn, và — nếu bạn đăng nhập bằng Google — tên và ảnh hồ sơ của bạn từ Google.',
      },
      {
        en: 'Listing information: the title, description, price, photos, location and contact phone number you choose to include when you post a listing. What you put in a listing is published, so treat that field as public.',
        vi: 'Thông tin tin đăng: tiêu đề, mô tả, giá, ảnh, vị trí và số điện thoại liên hệ bạn chọn đưa vào khi đăng tin. Nội dung tin đăng được công khai, vì vậy hãy coi đó là thông tin công khai.',
      },
      {
        en: 'Messages: conversations you have with other users through the on-platform chat, and with our support team (including over WhatsApp, if you write to us there). We keep them so both sides have a record and so a report of fraud or abuse can be reviewed fairly.',
        vi: 'Tin nhắn: các cuộc trò chuyện của bạn với người dùng khác qua tính năng chat trên nền tảng, và với bộ phận hỗ trợ của chúng tôi (kể cả qua WhatsApp nếu bạn nhắn cho chúng tôi ở đó). Chúng tôi lưu giữ để cả hai bên có bằng chứng và để báo cáo gian lận hay lạm dụng được xem xét công bằng.',
      },
      {
        // KYC: src/lib/kyc/service.ts (kycSubmitSchema — tier A/B, challenge selfie, MRZ fields, consentVersion;
        // never returns `verified`, an admin reviews) · src/lib/kyc/store.ts (private bucket) · business:
        // src/lib/business-verification-store.ts:12 ('identity' | 'bank' | 'authorization') · tax code →
        // VietQR: src/lib/tax-lookup.ts:25 (a third party, NOT the tax authority — see its recipients row) · MRZ read on
        // device: src/lib/identity/mrz-ocr-tesseract.ts (next.config.ts CSP note)
        en: 'Identity verification (sellers): to verify a seller we ask for a photo of an identity document — for example a Vietnamese citizen identity card or a passport — and a selfie holding a one-time code, together with the details printed on the document (name, document number, nationality and expiry date). To verify a business we also ask for documents showing the business’s identity, its bank account and, where someone acts for the business, their authorisation, and we look the business tax code up in VietQR’s public business-register service (api.vietqr.io, which republishes the tax authority’s business-register data). These are sensitive personal data: we collect them only with your express consent, given when you submit them; we keep them in private storage that cannot be reached from the internet; and a member of our team reviews them — they are never approved automatically. The machine-readable lines of a passport are read on your own device to fill in the form.',
        vi: 'Xác minh danh tính (người bán): để xác minh người bán, chúng tôi yêu cầu ảnh chụp giấy tờ tùy thân — ví dụ căn cước công dân hoặc hộ chiếu — và một ảnh chân dung cầm mã dùng một lần, cùng các thông tin in trên giấy tờ (họ tên, số giấy tờ, quốc tịch và ngày hết hạn). Để xác minh doanh nghiệp, chúng tôi còn yêu cầu giấy tờ thể hiện thông tin doanh nghiệp, tài khoản ngân hàng của doanh nghiệp và, khi có người đại diện thực hiện, giấy ủy quyền của người đó; mã số thuế doanh nghiệp được tra cứu qua dịch vụ tra cứu đăng ký doanh nghiệp công khai của VietQR (api.vietqr.io, nơi công bố lại dữ liệu đăng ký doanh nghiệp của cơ quan thuế). Đây là dữ liệu cá nhân nhạy cảm: chúng tôi chỉ thu thập khi có sự đồng ý rõ ràng của bạn tại thời điểm gửi; lưu trong kho lưu trữ riêng không truy cập được từ internet; và một nhân viên của chúng tôi trực tiếp xem xét — không bao giờ được duyệt tự động. Các dòng mã đọc máy trên hộ chiếu được đọc ngay trên thiết bị của bạn để điền vào biểu mẫu.',
      },
      {
        en: 'Usage information: device type, language and currency preference, pages viewed, and on-site activity such as searches and listing views. We also keep a limited technical log, including IP address, to apply rate limits and block abuse — that log lives in our own database and is not sent to a third party.',
        vi: 'Thông tin sử dụng: loại thiết bị, ngôn ngữ và đơn vị tiền tệ bạn chọn, các trang đã xem, và hoạt động trên website như tìm kiếm và xem tin đăng. Chúng tôi cũng lưu một nhật ký kỹ thuật có giới hạn, bao gồm địa chỉ IP, để áp dụng giới hạn tần suất truy cập và chặn hành vi lạm dụng — nhật ký này nằm trong cơ sở dữ liệu của chính chúng tôi và không được gửi cho bên thứ ba.',
      },
      {
        // ⛔ NO "SORTS LISTINGS BY DISTANCE": buildFeedOrderBy (api/listings/feed-query.ts:639) has no
        // distance sort. Location FILTERS by radius (feed-query.ts:353, lib/geo-radius.ts), gives the map
        // popup's travel estimate (listings-map.tsx:438), and fills an address (post-wizard.tsx:257,
        // business-profile-editor.tsx:56, quick-reply-chips.tsx:68 → api/reverse-geocode). The control's real
        // label is "Use my current location" / "Dùng vị trí hiện tại" (area-filter.tsx:421, :462) — there is
        // no "Search near you" anywhere in the UI.
        // ⛔ NOT "WE HOLD YOUR ON-SITE BEHAVIOURAL DATA TO THE SAME STANDARD". The standard above is "used only for
        // that feature, never shared with advertisers", and with Advertising on, on-site behaviour DOES go to
        // Meta (the Meta CAPI row in RECIPIENTS). The last sentence says only what the code bounds: each of the
        // three optional uses runs only on its own switch (consent-value.ts p/a/d · reco-signals.ts ·
        // analytics-tags.tsx · attribution.ts · meta-capi.ts:112-114) — and on eno.forum the cookies section
        // states the tag-manager exception, which is why this sentence points there.
        en: 'Location: if you allow it, your device location is used only for the feature you asked for at that moment — showing listings within a distance of you (the “Use my current location” button in the area filter), showing how far away a listing is on the map, or filling in an address when you post a listing, set up a business profile or share where you are in a chat. Location data is sensitive personal data under Vietnamese law, so we use it only for that feature, never share it with advertisers, and stop collecting it the moment you withdraw the browser permission. The location you set for a listing is published with it. We treat your activity on this site as sensitive personal data too: it is used for Personalisation, Analytics or Advertising only when you switch that use on (see “Cookies, tracking and your device”).',
        vi: 'Vị trí: nếu bạn cho phép, vị trí thiết bị chỉ được dùng cho đúng tính năng bạn yêu cầu lúc đó — hiển thị tin đăng trong một khoảng cách quanh bạn (nút “Dùng vị trí hiện tại” trong bộ lọc khu vực), cho biết tin đăng cách bạn bao xa trên bản đồ, hoặc điền địa chỉ khi bạn đăng tin, thiết lập hồ sơ doanh nghiệp hay chia sẻ vị trí trong cuộc trò chuyện. Dữ liệu vị trí là dữ liệu cá nhân nhạy cảm theo pháp luật Việt Nam, nên chúng tôi chỉ dùng cho tính năng đó, không bao giờ chia sẻ cho bên quảng cáo, và ngừng thu thập ngay khi bạn thu hồi quyền truy cập vị trí trên trình duyệt. Vị trí bạn đặt cho một tin đăng được công khai cùng tin đăng đó. Hoạt động của bạn trên website cũng được coi là dữ liệu cá nhân nhạy cảm: chỉ được dùng cho Cá nhân hóa, Phân tích hoặc Quảng cáo khi bạn bật mục tương ứng (xem mục “Cookie, theo dõi và thiết bị của bạn”).',
      },
      ...(IS_SERVICES ? PRIVACY_SERVICES_COLLECT : []),
    ],
  },
  ...(IS_SERVICES ? PRIVACY_SERVICES_SECTIONS.map(([id, title, blocks]): Section => ({ id, title, blocks })) : []),
  {
    id: 'why-and-basis',
    title: { en: 'Why we use your data, and on what legal basis', vi: 'Vì sao chúng tôi sử dụng dữ liệu của bạn và trên cơ sở pháp lý nào' },
    blocks: [
      { en: 'To create and secure your account and let you sign in.', vi: 'Để tạo và bảo vệ tài khoản của bạn và cho phép bạn đăng nhập.' },
      { en: 'To publish your listings after automated checks, and to connect buyers with sellers.', vi: 'Để đăng tin của bạn sau các bước kiểm tra tự động, và kết nối người mua với người bán.' },
      { en: 'To verify sellers and businesses, prevent fraud and abuse, run the trust-score system, handle reports and disputes, and keep the marketplace safe for everyone using it.', vi: 'Để xác minh người bán và doanh nghiệp, ngăn chặn gian lận và lạm dụng, vận hành hệ thống điểm tín nhiệm, xử lý báo cáo và tranh chấp, và giữ an toàn cho mọi người sử dụng sàn.' },
      { en: 'To translate listing and interface content into the language you choose.', vi: 'Để dịch nội dung tin đăng và giao diện sang ngôn ngữ bạn chọn.' },
      { en: 'To answer your questions, reports and support requests.', vi: 'Để trả lời câu hỏi, báo cáo và yêu cầu hỗ trợ của bạn.' },
      {
        en: 'With your consent only, asked for separately: to personalise what you see using your own activity on this site; to measure the service with Google Analytics; and to send advertising measurement signals to Meta (and to Google, when Analytics is on as well). Those three are described under “Cookies, tracking and your device”.',
        vi: 'Chỉ khi có sự đồng ý của bạn, được hỏi riêng cho từng mục: cá nhân hóa nội dung bạn thấy dựa trên chính hoạt động của bạn trên website; đo lường dịch vụ bằng Google Analytics; và gửi tín hiệu đo lường quảng cáo cho Meta (và cho Google, khi Phân tích cũng được bật). Ba mục này được trình bày tại phần “Cookie, theo dõi và thiết bị của bạn”.',
      },
      ...(IS_SERVICES ? PRIVACY_SERVICES_PURPOSES : []),
      {
        en: 'The basis for all of this is your consent: expressed by a clear action, asked for separately for each purpose that needs it — each optional use has its own switch, and each is off until you turn it on — and withdrawable at any time without losing access to the parts of the service that do not depend on it. Where Vietnamese law allows processing without consent we rely only on the narrow grounds it lists — performing a contract you asked us to perform, meeting a legal obligation such as keeping e-commerce records, protecting someone’s life or health in an emergency, and answering a lawful request from a competent state authority. We do not sell personal data and we do not trade in it: Vietnamese law prohibits it, and so do our own rules.',
        vi: 'Cơ sở cho tất cả các hoạt động trên là sự đồng ý của bạn: được thể hiện bằng một hành động rõ ràng, được hỏi riêng cho từng mục đích cần đồng ý — mỗi mục tùy chọn có công tắc riêng và đều tắt cho đến khi bạn bật — và có thể rút lại bất cứ lúc nào mà không mất quyền sử dụng những phần dịch vụ không phụ thuộc vào sự đồng ý đó. Trong những trường hợp pháp luật Việt Nam cho phép xử lý không cần sự đồng ý, chúng tôi chỉ dựa vào các căn cứ hẹp được pháp luật liệt kê — thực hiện hợp đồng bạn yêu cầu, thực hiện nghĩa vụ pháp lý như lưu trữ dữ liệu giao dịch thương mại điện tử, bảo vệ tính mạng, sức khỏe của một người trong tình huống khẩn cấp, và đáp ứng yêu cầu hợp pháp của cơ quan nhà nước có thẩm quyền. Chúng tôi không bán và không mua bán dữ liệu cá nhân: pháp luật Việt Nam cấm hành vi này, và quy định của chính chúng tôi cũng cấm.',
      },
    ],
  },
  {
    id: 'automated',
    title: { en: 'Automated decisions, and how to ask for a person', vi: 'Quyết định tự động và cách yêu cầu người xem xét' },
    blocks: [
      {
        en: 'Some decisions on this platform are made, or first made, by automated systems. You have the right to object to automated processing and to ask for a person to review a decision that affects you.',
        vi: 'Một số quyết định trên nền tảng được đưa ra, hoặc đưa ra trước tiên, bởi hệ thống tự động. Bạn có quyền phản đối việc xử lý tự động và yêu cầu một người xem xét lại quyết định ảnh hưởng đến bạn.',
      },
      {
        // src/lib/publish-guard.ts:42 PublishBlockCode — identity_*, account_restricted, photos_min, banned_words,
        // contact_in_text, contact_in_name, duplicate_listing (src/lib/duplicate-guard.ts), location_required
        en: 'Publish checks: before a listing goes live, automated checks look for prohibited words, contact details placed in the listing text or your display name, too few distinct photos for the category, a missing location, a copy of a listing you already have live, and whether your account may publish. A listing that fails is not published, and you are told why so you can fix it.',
        vi: 'Kiểm tra khi đăng tin: trước khi tin đăng được hiển thị, hệ thống tự động kiểm tra từ ngữ bị cấm, thông tin liên hệ đặt trong nội dung tin hoặc tên hiển thị, số ảnh khác nhau chưa đủ theo danh mục, thiếu vị trí, tin trùng với tin bạn đang hiển thị, và việc tài khoản của bạn có được phép đăng tin hay không. Tin không đạt sẽ không được đăng và bạn được thông báo lý do để chỉnh sửa.',
      },
      {
        // src/lib/ai-moderation.ts:13-21 — auto-HIDES on a high-confidence hit, files an admin report,
        // notifies the seller, never moves trust on its own
        en: 'AI moderation: after a listing is published, an AI model (Google Gemini) may check its text and photos for prohibited goods. A high-confidence match hides the listing at once, opens a report for our team and notifies the seller. It does not change anyone’s trust score by itself — only a report our team confirms does.',
        vi: 'Kiểm duyệt bằng AI: sau khi tin được đăng, một mô hình AI (Google Gemini) có thể kiểm tra nội dung và ảnh của tin để phát hiện hàng hóa bị cấm. Khi kết quả khớp với độ tin cậy cao, tin đăng bị ẩn ngay, một báo cáo được mở cho đội ngũ của chúng tôi và người bán được thông báo. Việc này tự nó không làm thay đổi điểm tín nhiệm của ai — chỉ báo cáo đã được đội ngũ của chúng tôi xác nhận mới có tác động đó.',
      },
      {
        // src/lib/trust-math.ts:15-45 (V: phone, business verification, age · Q: reviews, responsiveness,
        // freshness · T: transactions · C: confirmed reports) · publish-guard.ts:218 (Restricted can't post)
        en: 'Trust score: every seller has a trust score calculated automatically from a verified phone number, business verification, account age, reviews, how quickly they reply, whether their listings are kept up to date, completed transactions and confirmed reports. It is shown on listings and is one of the factors in the order of browse results (see /legal/ranking and /trust). An account whose score falls into the lowest band cannot publish new listings until it recovers.',
        vi: 'Điểm tín nhiệm: mỗi người bán có một điểm tín nhiệm được tính tự động dựa trên số điện thoại đã xác minh, việc xác minh doanh nghiệp, thời gian sử dụng tài khoản, đánh giá, tốc độ phản hồi, việc cập nhật tin đăng, số giao dịch đã hoàn tất và các báo cáo đã được xác nhận. Điểm được hiển thị trên tin đăng và là một trong các yếu tố sắp xếp kết quả khi duyệt tin (xem /legal/ranking và /trust). Tài khoản có điểm rơi vào nhóm thấp nhất không thể đăng tin mới cho đến khi điểm được phục hồi.',
      },
      PHONE
        ? {
            en: `To ask for a person to review any of these decisions, write to ${PRIVACY_EMAIL} or call ${PHONE}, and say which listing or decision you mean. A member of our team will look at it and tell you the outcome.`,
            vi: `Để yêu cầu một người xem xét lại bất kỳ quyết định nào ở trên, vui lòng gửi email tới ${PRIVACY_EMAIL} hoặc gọi ${PHONE} và cho biết tin đăng hoặc quyết định liên quan. Một nhân viên của chúng tôi sẽ xem xét và thông báo kết quả cho bạn.`,
          }
        : {
            en: `To ask for a person to review any of these decisions, write to ${PRIVACY_EMAIL} and say which listing or decision you mean. A member of our team will look at it and tell you the outcome.`,
            vi: `Để yêu cầu một người xem xét lại bất kỳ quyết định nào ở trên, vui lòng gửi email tới ${PRIVACY_EMAIL} và cho biết tin đăng hoặc quyết định liên quan. Một nhân viên của chúng tôi sẽ xem xét và thông báo kết quả cho bạn.`,
          },
    ],
  },
  {
    id: 'where-stored',
    title: { en: 'Where your data is stored', vi: 'Dữ liệu của bạn được lưu ở đâu' },
    blocks: [
      {
        // Self-hosted on the VN origin: infra/vn-node/apps.compose.yml:2, nginx/eno.conf:2, bootstrap.sh:3-11
        // · DB + storage on the box: infra/vn-node/eno-backup.README.md, eno-storage-backup.sh:12-14
        // · backups: eno-backup.sh:101 ("Bizfly Simple Storage HCM1"), save-bizfly-keys.sh:25
        // (hcm.ss.bfcplatform.vn), eno-backup.README.md:5 ("VN-resident"). ⚠️ The CITY of the primary
        // server is not recorded in the repo — only "Vietnam" is said for it.
        en: 'The database behind this site, the files you upload — listing photos and videos, and the private documents described above — and the servers that run the site are on our own server in Vietnam. Every night the database and those files are backed up to a storage provider in Vietnam (Bizfly Simple Storage, in Ho Chi Minh City).',
        vi: 'Cơ sở dữ liệu của website, các tệp bạn tải lên — ảnh và video tin đăng, cùng các giấy tờ riêng tư nêu trên — và các máy chủ vận hành website đều đặt trên máy chủ của chính chúng tôi tại Việt Nam. Hằng đêm, cơ sở dữ liệu và các tệp đó được sao lưu sang một nhà cung cấp lưu trữ tại Việt Nam (Bizfly Simple Storage, tại Thành phố Hồ Chí Minh).',
      },
      {
        en: 'Some of the services listed under “Who else receives your data” work outside Vietnam; what that means is set out under “Processing outside Vietnam”.',
        vi: 'Một số dịch vụ được liệt kê tại phần “Những ai khác nhận dữ liệu của bạn” hoạt động ngoài Việt Nam; ý nghĩa của việc này được trình bày tại phần “Xử lý dữ liệu ngoài Việt Nam”.',
      },
    ],
  },
  {
    id: 'recipients',
    title: { en: 'Who else receives your data', vi: 'Những ai khác nhận dữ liệu của bạn' },
    blocks: [
      {
        en: 'We use a small number of providers to run this service. Each receives the data described for it below, and only for the purpose listed. Some of them are used only if you choose the feature they serve.',
        vi: 'Chúng tôi sử dụng một số ít nhà cung cấp để vận hành dịch vụ. Mỗi bên nhận dữ liệu được mô tả cho bên đó dưới đây, và chỉ cho đúng mục đích đã nêu. Một số bên chỉ được sử dụng khi bạn chọn tính năng tương ứng.',
      },
      { table: RECIPIENTS },
      ...(IS_SERVICES ? PRIVACY_SERVICES_RECIPIENTS : []),
      {
        en: 'We also disclose data when Vietnamese law requires it: to a competent state authority acting within its powers, and where we must report information about sellers (for example to the tax authority). Where we are permitted to tell you about such a disclosure, we will.',
        vi: 'Chúng tôi cũng cung cấp dữ liệu khi pháp luật Việt Nam yêu cầu: cho cơ quan nhà nước có thẩm quyền trong phạm vi thẩm quyền của cơ quan đó, và khi chúng tôi phải báo cáo thông tin về người bán (ví dụ cho cơ quan thuế). Khi được phép thông báo cho bạn về việc cung cấp đó, chúng tôi sẽ thông báo.',
      },
    ],
  },
  {
    id: 'cross-border',
    title: { en: 'Processing outside Vietnam', vi: 'Xử lý dữ liệu ngoài Việt Nam' },
    blocks: [
      {
        en: 'Our own systems are in Vietnam, but several of the recipients above work outside Vietnam — Cloudflare, Microsoft, Google, Resend, Telegram, Meta, LinkedIn, Reddit, CARTO, OpenStreetMap and the push-notification services. Sending them personal data is a cross-border transfer under Vietnamese law, and it carries its own duties: the transfer must be documented and assessed, the assessment must be filed with the Ministry of Public Security and kept current, and you must be told the transfer is happening. This paragraph is that notice.',
        vi: 'Hệ thống của chính chúng tôi đặt tại Việt Nam, nhưng một số bên nhận nêu trên hoạt động ngoài Việt Nam — Cloudflare, Microsoft, Google, Resend, Telegram, Meta, LinkedIn, Reddit, CARTO, OpenStreetMap và các dịch vụ thông báo đẩy. Việc gửi dữ liệu cá nhân cho các bên này là chuyển dữ liệu cá nhân ra nước ngoài theo pháp luật Việt Nam và kèm theo các nghĩa vụ riêng: việc chuyển dữ liệu phải được ghi nhận và đánh giá, hồ sơ đánh giá phải được nộp cho Bộ Công an và cập nhật kịp thời, và bạn phải được thông báo về việc chuyển dữ liệu. Đoạn này là thông báo đó.',
      },
      // ⛔ GATED ON PDP_DOSSIERS_FILED, NOT OPERATOR_REGISTERED (2026-10-01). It used to assert "we … file
      // them with the Ministry of Public Security" whenever the company certificate existed — which says
      // nothing about the dossiers — so the notice claimed a filing that had not happened. The flag and
      // its rule (flip only on A05's acknowledgement of BOTH dossiers) live in src/lib/site-legal.ts.
      // ⚠️ Two whole literals rather than one sentence with a swapped clause: legal copy is approved as
      // a paragraph.
      PDP_DOSSIERS_FILED
        ? {
            en: 'We maintain a processing impact assessment and a cross-border transfer impact assessment, have filed both with the Ministry of Public Security (Department of Cybersecurity and High-Tech Crime Prevention, A05), and update them as our providers change.',
            vi: 'Chúng tôi lập và duy trì hồ sơ đánh giá tác động xử lý dữ liệu cá nhân và hồ sơ đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài, đã nộp cả hai hồ sơ cho Bộ Công an (Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao — A05), và cập nhật khi các nhà cung cấp của chúng tôi thay đổi.',
          }
        : {
            en: 'The processing impact assessment and the cross-border transfer impact assessment are being prepared for filing with the Ministry of Public Security (Department of Cybersecurity and High-Tech Crime Prevention, A05). They have not been filed yet, and we will update this notice when they have been. We would rather tell you exactly where this stands than claim a filing that has not happened.',
            vi: 'Hồ sơ đánh giá tác động xử lý dữ liệu cá nhân và hồ sơ đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài đang được chuẩn bị để nộp cho Bộ Công an (Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao — A05). Các hồ sơ này chưa được nộp, và chúng tôi sẽ cập nhật thông báo này khi đã nộp. Chúng tôi muốn cho bạn biết chính xác tình trạng hiện tại thay vì tuyên bố một việc nộp hồ sơ chưa diễn ra.',
          },
    ],
  },
  {
    id: 'cookies',
    title: { en: 'Cookies, tracking and your device', vi: 'Cookie, theo dõi và thiết bị của bạn' },
    blocks: [
      {
        // ⛔ NOT "TWO MORE THINGS STAY ON YOUR DEVICE ONLY" — the table at the end of this section lists
        // fifteen kinds of item, and recent searches DO leave the device with Personalisation
        // (for-you-rail.tsx sends them to /api/recommendations). This paragraph names two examples and
        // points at the table; it must never read as the complete list.
        en: 'Essential storage keeps you signed in and remembers your language, your currency, your saved listings and your cookie choice. It always works, and it tracks nothing about you across other sites. It is not all this site keeps on your device: the table at the end of this section lists every item and when it is removed. Two of them are worth knowing about here: your recent searches and recently used areas, so the search box can offer them again (you can clear them from the search box at any time), and, for the current browser tab only, a short note of which listings you opened, so that reloading a page does not count as a second view.',
        vi: 'Lưu trữ thiết yếu giúp bạn duy trì đăng nhập và ghi nhớ ngôn ngữ, đơn vị tiền tệ, tin đã lưu và lựa chọn cookie của bạn. Phần này luôn hoạt động và không theo dõi bạn trên các website khác. Đó không phải là tất cả những gì website lưu trên thiết bị của bạn: bảng ở cuối mục này liệt kê từng mục và thời điểm mục đó bị xóa. Có hai mục bạn nên biết ngay tại đây: các tìm kiếm và khu vực bạn dùng gần đây, để ô tìm kiếm gợi ý lại (bạn có thể xóa trong ô tìm kiếm bất cứ lúc nào), và, chỉ trong thẻ trình duyệt hiện tại, một ghi chú ngắn về các tin bạn đã mở, để việc tải lại trang không bị tính là lượt xem thứ hai.',
      },
      {
        // consent-value.ts (p/a/d) · reco-signals.ts (history only with p) · for-you-rail.tsx ·
        // attribution.ts + api/profile/account-type (first-touch copied only with a) · meta-capi.ts (d)
        en: 'Beyond that we ask separately for three optional uses, and each stays off until you switch it on. Personalisation: your device keeps a list of the categories, brands and listings you view here, and we use it, with your recent searches, to suggest listings in the “For you” and “Recently viewed” rows, using our own servers; it is never shared with advertisers. Analytics: Google Analytics counts visits and the pages people use, and we note which link or campaign first brought you here, and keep that with your account if you sign up. Advertising: we send Meta signals about actions such as viewing a listing, contacting a seller, posting a listing and signing up, so our ads can be measured — with your email address, phone number and account identifier scrambled (hashed) first, together with the listing and page involved, your IP address and browser details (“Who else receives your data” above lists all of it) — and, if Analytics is on as well, Google Analytics may share advertising signals with Google’s ad products.',
        vi: 'Ngoài ra, chúng tôi hỏi riêng về ba mục sử dụng tùy chọn, và mỗi mục đều tắt cho đến khi bạn bật. Cá nhân hóa: thiết bị của bạn lưu danh sách các danh mục, thương hiệu và tin đăng bạn xem tại đây, và chúng tôi dùng danh sách đó cùng các tìm kiếm gần đây của bạn để gợi ý tin đăng ở mục “Dành cho bạn” và “Đã xem gần đây”, bằng máy chủ của chính chúng tôi; dữ liệu này không bao giờ được chia sẻ cho bên quảng cáo. Phân tích: Google Analytics đếm lượt truy cập và các trang được sử dụng, và chúng tôi ghi nhận đường dẫn hoặc chiến dịch đã đưa bạn đến đây lần đầu, lưu thông tin đó cùng tài khoản nếu bạn đăng ký. Quảng cáo: chúng tôi gửi cho Meta tín hiệu về các hành động như xem tin đăng, liên hệ người bán, đăng tin và đăng ký, để đo lường quảng cáo — email, số điện thoại và mã tài khoản của bạn được xáo trộn (băm) trước, kèm tin đăng và trang liên quan, địa chỉ IP và thông tin trình duyệt (mục “Những ai khác nhận dữ liệu của bạn” ở trên liệt kê đầy đủ) — và, nếu Phân tích cũng được bật, Google Analytics có thể chia sẻ tín hiệu quảng cáo với các sản phẩm quảng cáo của Google.',
      },
      {
        en: 'Under Vietnamese law, data that tracks your behaviour and activity online is sensitive personal data. That is why none of these three runs until you choose it, and why declining costs you nothing: search, messaging, posting and sign-in all work exactly the same.',
        vi: 'Theo pháp luật Việt Nam, dữ liệu theo dõi hành vi và hoạt động trực tuyến của bạn là dữ liệu cá nhân nhạy cảm. Vì vậy cả ba mục này đều không chạy cho đến khi bạn chọn, và việc từ chối không làm bạn mất gì: tìm kiếm, nhắn tin, đăng tin và đăng nhập đều hoạt động như nhau.',
      },
      {
        // api/consent/route.ts:127-150 (actorIp: null; purposes, version, copyVersion, surface, action,
        // edition, locale, native, clientTs; profile when signed in) · consent-value.ts CONSENT_MAX_AGE_S
        en: 'When you make or change a choice we keep a record of it as evidence of what you agreed to: which switches were on, the version of the notice you saw, whether you chose on the first screen or in the settings, the site and language, the time, and your account if you were signed in. The record is linked to a random identifier kept with your choice on your device — not to your IP address. Your choice is remembered for 12 months; after that we ask again. Inside the eno mobile app, Analytics and Advertising are always off, whatever is stored.',
        vi: 'Khi bạn chọn hoặc thay đổi lựa chọn, chúng tôi lưu một bản ghi làm bằng chứng về những gì bạn đã đồng ý: các công tắc được bật, phiên bản thông báo bạn đã xem, bạn chọn ở màn hình đầu tiên hay trong phần cài đặt, website và ngôn ngữ, thời điểm, và tài khoản của bạn nếu bạn đang đăng nhập. Bản ghi được gắn với một mã ngẫu nhiên lưu cùng lựa chọn trên thiết bị của bạn — không gắn với địa chỉ IP. Lựa chọn của bạn được ghi nhớ trong 12 tháng; sau đó chúng tôi hỏi lại. Trong ứng dụng di động eno, Phân tích và Quảng cáo luôn tắt, bất kể lựa chọn đã lưu.',
      },
      /**
       * ⛔ THIS PARAGRAPH IS PER-EDITION BECAUSE THE BEHAVIOUR IS. On eno.forum the Google Tag Manager
       * container loads for every visitor (owner, 2026-08-18; analytics-tags.tsx renders it under
       * IS_SERVICES above the consent gate). eno.vn carries no container at all. Since consent v2 the
       * container starts with Google's consent signals "denied" and is told the choice — but a
       * non-Google tag in it is not bound by those signals, so the forum sentence does not claim it is.
       * ⚠️ eno.vn IS UNCHANGED AND MUST STAY UNCHANGED. Do not "unify" these two literals.
       */
      IS_SERVICES
        ? {
            en: 'Google Analytics runs only if you switch on Analytics, and the Meta and Google advertising signals — including the ones our server sends — only if you switch on Advertising. One exception, stated plainly: our tag manager (Google Tag Manager) loads for every visitor to this site; it starts with Google’s consent signals set to “denied” and is told your choice, but any measurement tag configured inside it may run before you choose. You can change your mind at any time with the button at the end of this page or the Cookie settings link. Turning a use off takes effect immediately on this device — its tracking stops, and the cookies and on-device history it used (the Google Analytics cookies, the first-visit link cookie, the Meta and Google advertising cookies, your viewing history) are deleted — and it does not cost you any part of the service.',
            vi: 'Google Analytics chỉ chạy khi bạn bật Phân tích, và tín hiệu quảng cáo của Meta và Google — kể cả tín hiệu do máy chủ của chúng tôi gửi — chỉ chạy khi bạn bật Quảng cáo. Có một ngoại lệ, xin nói rõ: trình quản lý thẻ của chúng tôi (Google Tag Manager) được tải cho mọi khách truy cập website này; trình quản lý này khởi đầu với tín hiệu đồng ý của Google ở trạng thái “từ chối” và được báo lựa chọn của bạn, nhưng bất kỳ thẻ đo lường nào được cấu hình bên trong vẫn có thể chạy trước khi bạn chọn. Bạn có thể thay đổi lựa chọn bất cứ lúc nào bằng nút ở cuối trang này hoặc liên kết Cài đặt cookie. Việc tắt một mục có hiệu lực ngay trên thiết bị này — việc theo dõi dừng lại, và cookie cũng như lịch sử trên thiết bị mà mục đó sử dụng (cookie Google Analytics, cookie nguồn truy cập đầu tiên, cookie quảng cáo của Meta và Google, lịch sử xem của bạn) bị xóa — và bạn không mất bất kỳ phần nào của dịch vụ.',
          }
        : {
            en: 'Google Analytics runs only if you switch on Analytics, and the Meta and Google advertising signals — including the ones our server sends — only if you switch on Advertising. Decline and no third-party tracking runs, server-side included. You can change your mind at any time with the button at the end of this page or the Cookie settings link. Turning a use off takes effect immediately on this device — its tracking stops, and the cookies and on-device history it used (the Google Analytics cookies, the first-visit link cookie, the Meta and Google advertising cookies, your viewing history) are deleted — and it does not cost you any part of the service.',
            vi: 'Google Analytics chỉ chạy khi bạn bật Phân tích, và tín hiệu quảng cáo của Meta và Google — kể cả tín hiệu do máy chủ của chúng tôi gửi — chỉ chạy khi bạn bật Quảng cáo. Nếu bạn từ chối, không có hoạt động theo dõi nào của bên thứ ba được chạy, kể cả từ phía máy chủ. Bạn có thể thay đổi lựa chọn bất cứ lúc nào bằng nút ở cuối trang này hoặc liên kết Cài đặt cookie. Việc tắt một mục có hiệu lực ngay trên thiết bị này — việc theo dõi dừng lại, và cookie cũng như lịch sử trên thiết bị mà mục đó sử dụng (cookie Google Analytics, cookie nguồn truy cập đầu tiên, cookie quảng cáo của Meta và Google, lịch sử xem của bạn) bị xóa — và bạn không mất bất kỳ phần nào của dịch vụ.',
          },
      {
        // ⛔ BEFORE ANY CHOICE, AND STATED AS NARROWLY AS THE CODE: Cloudflare proxies every request
        // (aop-runbook.md:15) and Turnstile guards sign-in (turnstile-verify.ts) — no claim of a
        // site-wide bot challenge, which the repo does not show · rate limits: lib/ratelimit.ts +
        // lib/client-ip.ts · counters: lib/site-stats.ts:12-16 (sha256(ip + coarse UA + daily salt kept 36h))
        en: 'A few things happen before you make any choice, because the site cannot run safely without them. Every request passes through Cloudflare, which uses your IP address and request details to block attacks and abusive traffic, and the sign-in forms use Cloudflare Turnstile to check that a person, not a script, is signing in. Our own server uses your IP address to apply rate limits. And to show the visitor counters at the foot of each page, it keeps a one-way digest of your IP address and a coarse browser type, mixed with a key that changes every day and is deleted after 36 hours; no cookie is set, and once that key is gone the digest cannot be traced back to you or linked across days.',
        vi: 'Một số việc diễn ra trước khi bạn đưa ra bất kỳ lựa chọn nào, vì website không thể vận hành an toàn nếu thiếu chúng. Mọi yêu cầu truy cập đều đi qua Cloudflare, nơi sử dụng địa chỉ IP và thông tin yêu cầu của bạn để chặn tấn công và truy cập gây hại, và các biểu mẫu đăng nhập dùng Cloudflare Turnstile để kiểm tra rằng người đăng nhập là con người chứ không phải chương trình tự động. Máy chủ của chúng tôi dùng địa chỉ IP của bạn để áp dụng giới hạn tần suất truy cập. Và để hiển thị bộ đếm lượt truy cập ở cuối mỗi trang, máy chủ lưu một chuỗi băm một chiều từ địa chỉ IP và loại trình duyệt (ở mức khái quát) của bạn, trộn với một khóa thay đổi mỗi ngày và bị xóa sau 36 giờ; không có cookie nào được đặt, và khi khóa đó bị xóa thì chuỗi băm không thể truy ngược về bạn hay liên kết giữa các ngày.',
      },
      {
        // signup-prompt.tsx countSignupPrompt → api/signup-prompt/route.ts → lib/signup-prompt-counter.ts:
        // kv_store key `signup-prompt:<VN day>:<edition>:<event>`, an integer, 400-day TTL. Body = the event
        // name only; the route reads the IP for its rate limit (rl_window) and stores none of it there.
        en: 'Sign-up reminder counts: to learn whether the “Join eno” reminder helps or annoys, our server keeps a daily total of how many times it was shown, closed, followed by another page after closing, answered with Google or email, and followed by a sign-in. Each time one of those happens your browser tells our server which event it was, and the server adds one to that day’s total. Like every request, it arrives with your IP address, which is used only by our abuse rate limit (kept briefly, as for any request) and is never stored with the totals; the totals hold no IP address, account, cookie, browser details or page, so a total cannot be traced back to anyone. These totals are counted whatever you choose for Analytics, and are deleted after about 13 months.',
        vi: 'Số liệu lời nhắc đăng ký: để biết lời nhắc “Tham gia eno” có ích hay gây phiền, máy chủ của chúng tôi lưu tổng số theo ngày về số lần lời nhắc được hiển thị, bị đóng, được tiếp nối bằng một trang khác sau khi đóng, được trả lời bằng Google hoặc email, và được tiếp nối bằng một lần đăng nhập. Mỗi khi một trong các việc đó xảy ra, trình duyệt của bạn báo cho máy chủ biết đó là sự kiện nào, và máy chủ cộng thêm một vào tổng số của ngày đó. Như mọi yêu cầu khác, yêu cầu này kèm địa chỉ IP của bạn, chỉ được dùng cho giới hạn tần suất chống lạm dụng (lưu trong thời gian ngắn như mọi yêu cầu) và không bao giờ được lưu cùng các tổng số; các tổng số không chứa địa chỉ IP, tài khoản, cookie, thông tin trình duyệt hay trang, nên không thể truy ngược về bất kỳ ai. Các tổng số này được đếm bất kể bạn chọn gì cho Phân tích, và bị xóa sau khoảng 13 tháng.',
      },
      {
        en: 'The table below lists everything this site keeps on your device, and when each item is removed. Signing out removes your inbox, your drafts, your AI conversation and the other copies of account data marked “when you sign out”.',
        vi: 'Bảng dưới đây liệt kê mọi thứ website lưu trên thiết bị của bạn và thời điểm từng mục bị xóa. Khi đăng xuất, hộp thư, các bản nháp, cuộc trò chuyện với trợ lý AI và các bản sao dữ liệu tài khoản khác được ghi “khi bạn đăng xuất” đều bị xóa.',
      },
      { table: ON_DEVICE },
    ],
  },
  {
    id: 'your-rights',
    title: { en: 'Your rights, and how long we take', vi: 'Quyền của bạn và thời hạn chúng tôi xử lý' },
    blocks: [
      {
        en: 'Vietnamese law gives you the right to know what is done with your data; to give consent and to withdraw it; to access your data and receive a copy; to correct it; to delete it; to restrict processing; to object to processing, including processing carried out automatically; to be told who your data has been shared with; to complain to the authorities and to take legal action; and to claim compensation for a violation.',
        vi: 'Pháp luật Việt Nam cho bạn quyền được biết dữ liệu của mình được xử lý thế nào; quyền đồng ý và rút lại sự đồng ý; quyền truy cập và nhận bản sao dữ liệu; quyền chỉnh sửa; quyền xóa; quyền hạn chế xử lý; quyền phản đối việc xử lý, kể cả xử lý tự động; quyền được biết dữ liệu của mình đã được chia sẻ cho ai; quyền khiếu nại với cơ quan có thẩm quyền và khởi kiện; và quyền yêu cầu bồi thường khi có vi phạm.',
      },
      {
        en: `You do not have to ask us for the two most common ones: your account settings let you export your data and delete your account yourself, at any time. For anything else, write to ${PRIVACY_EMAIL} from the email address or phone number linked to your account so we can be sure it is you.`,
        vi: `Bạn không cần yêu cầu chúng tôi với hai quyền phổ biến nhất: phần cài đặt tài khoản cho phép bạn tự xuất dữ liệu và tự xóa tài khoản bất cứ lúc nào. Với các yêu cầu khác, vui lòng gửi email tới ${PRIVACY_EMAIL} từ địa chỉ email hoặc số điện thoại gắn với tài khoản để chúng tôi xác nhận đúng là bạn.`,
      },
      {
        en: 'The law sets the clocks and we work to them. We acknowledge a request within 2 working days. We provide access, or a copy of your data, within 10 days. We act on a withdrawal of consent, a restriction, or an objection within 15 days. We delete data within 20 days. Each of those periods may be extended once where a request is genuinely complex — if we need to extend one, we will tell you before the original period runs out, and why.',
        vi: 'Pháp luật quy định thời hạn và chúng tôi tuân thủ. Chúng tôi xác nhận đã nhận yêu cầu trong vòng 2 ngày làm việc. Chúng tôi cung cấp quyền truy cập hoặc bản sao dữ liệu trong vòng 10 ngày. Chúng tôi thực hiện việc rút lại sự đồng ý, hạn chế xử lý hoặc phản đối xử lý trong vòng 15 ngày. Chúng tôi xóa dữ liệu trong vòng 20 ngày. Mỗi thời hạn có thể được gia hạn một lần khi yêu cầu thực sự phức tạp — nếu cần gia hạn, chúng tôi sẽ thông báo cho bạn trước khi thời hạn ban đầu kết thúc, kèm lý do.',
      },
      {
        en: 'Deleting your account removes your profile, your listings and your personal identifiers from the live service, and they fall out of backups as those backups roll over. What we keep after that is only what the law obliges us to keep — for example transaction records and reports already made to state authorities.',
        vi: 'Việc xóa tài khoản sẽ xóa hồ sơ, tin đăng và các thông tin định danh cá nhân của bạn khỏi hệ thống đang hoạt động, và các dữ liệu này được loại khỏi bản sao lưu khi bản sao lưu được thay thế theo chu kỳ. Sau đó chúng tôi chỉ giữ những gì pháp luật bắt buộc — ví dụ dữ liệu giao dịch và các báo cáo đã gửi cơ quan nhà nước.',
      },
      {
        en: 'If you think we have mishandled your data, tell us and we will look into it. You can also complain to the Ministry of Public Security (Department of Cybersecurity and High-Tech Crime Prevention, A05) at any point. You are not required to come to us first.',
        vi: 'Nếu bạn cho rằng chúng tôi đã xử lý dữ liệu của bạn không đúng, hãy cho chúng tôi biết và chúng tôi sẽ xem xét. Bạn cũng có thể khiếu nại với Bộ Công an (Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao — A05) bất cứ lúc nào. Bạn không bắt buộc phải liên hệ với chúng tôi trước.',
      },
    ],
  },
  {
    id: 'retention',
    title: { en: 'How long we keep your data', vi: 'Chúng tôi lưu giữ dữ liệu của bạn trong bao lâu' },
    blocks: [
      {
        en: 'We keep personal data only while the purpose it was collected for still exists, and delete it when that purpose is fulfilled. Different data therefore has different lifetimes: account data lasts as long as your account; messages are kept while they are still a useful record for both sides and for resolving a report; identity-verification documents are deleted after a review window once the review is decided; e-commerce records are kept for the minimum period Vietnamese law requires (at least 3 years); records of consent are kept as evidence of what you agreed to and when you withdrew it.',
        vi: 'Chúng tôi chỉ lưu giữ dữ liệu cá nhân khi mục đích thu thập vẫn còn, và xóa khi mục đích đã hoàn thành. Vì vậy mỗi loại dữ liệu có thời hạn khác nhau: dữ liệu tài khoản tồn tại cùng tài khoản; tin nhắn được giữ khi vẫn còn là bằng chứng hữu ích cho cả hai bên và cho việc giải quyết báo cáo; giấy tờ xác minh danh tính được xóa sau một thời hạn kể từ khi việc xem xét có kết quả; dữ liệu giao dịch thương mại điện tử được lưu tối thiểu theo thời hạn pháp luật Việt Nam yêu cầu (ít nhất 3 năm); bản ghi sự đồng ý được lưu làm bằng chứng về những gì bạn đã đồng ý và thời điểm bạn rút lại.',
      },
      ...(IS_SERVICES ? PRIVACY_SERVICES_RETENTION : []),
      {
        en: 'We publish this as a principle rather than a table of exact day counts for data on our servers, because those counts live in the systems that apply them and a number printed here would be wrong the first time one changed. If you want to know how long a specific piece of your data will be kept, ask us and we will tell you.',
        vi: 'Chúng tôi công bố nội dung này dưới dạng nguyên tắc thay vì một bảng số ngày cụ thể cho dữ liệu trên máy chủ, vì các con số đó nằm trong chính hệ thống áp dụng chúng và một con số in ở đây sẽ sai ngay lần đầu thay đổi. Nếu bạn muốn biết một dữ liệu cụ thể của mình được lưu trong bao lâu, hãy hỏi và chúng tôi sẽ trả lời.',
      },
    ],
  },
  {
    id: 'security',
    title: { en: 'Security, and what happens if there is a breach', vi: 'Bảo mật và xử lý khi có sự cố lộ lọt dữ liệu' },
    blocks: [
      {
        en: 'Data travels over encrypted connections. Files that are not meant to be public are held in private storage that cannot be reached from the internet and is opened only through short-lived links issued to people entitled to see them. Sensitive payloads are stored encrypted. Access is limited to the people whose role needs it, and rate limits and abuse controls run on every sensitive endpoint.',
        vi: 'Dữ liệu được truyền qua kết nối mã hóa. Các tệp không nhằm mục đích công khai được lưu trong kho lưu trữ riêng không truy cập được từ internet và chỉ được mở qua đường dẫn ngắn hạn cấp cho người có quyền xem. Dữ liệu nhạy cảm được lưu ở dạng mã hóa. Quyền truy cập chỉ dành cho những người có nhiệm vụ cần đến, và giới hạn tần suất cùng các biện pháp chống lạm dụng được áp dụng ở mọi điểm truy cập nhạy cảm.',
      },
      {
        en: 'If a breach affects personal data, we notify the Ministry of Public Security within 72 hours of becoming aware of it, as the law requires — with what we know at the time, and the rest as we learn it. We notify you directly whenever the law requires it, and whenever the risk to you is real even if the obligation is arguable.',
        vi: 'Nếu có sự cố ảnh hưởng đến dữ liệu cá nhân, chúng tôi thông báo cho Bộ Công an trong vòng 72 giờ kể từ khi biết, theo quy định của pháp luật — với những thông tin có tại thời điểm đó, và bổ sung khi có thêm thông tin. Chúng tôi thông báo trực tiếp cho bạn bất cứ khi nào pháp luật yêu cầu, và cả khi rủi ro đối với bạn là có thật dù nghĩa vụ thông báo còn chưa rõ ràng.',
      },
    ],
  },
  {
    id: 'children',
    title: { en: 'Children', vi: 'Trẻ em' },
    blocks: [
      {
        en: 'This service is for adults (18 and over). We do not knowingly process the data of a child under 16. The law would require a parent’s or guardian’s verified consent for that, and we do not seek it, because children should not be using the service at all. If you believe a child has an account, tell us and we will remove it.',
        vi: 'Dịch vụ này dành cho người trưởng thành (từ đủ 18 tuổi). Chúng tôi không chủ ý xử lý dữ liệu của trẻ em dưới 16 tuổi. Pháp luật sẽ yêu cầu sự đồng ý đã được xác minh của cha mẹ hoặc người giám hộ cho việc đó, và chúng tôi không thu thập sự đồng ý này vì trẻ em hoàn toàn không nên sử dụng dịch vụ. Nếu bạn cho rằng một trẻ em đang có tài khoản, hãy báo cho chúng tôi và chúng tôi sẽ xóa tài khoản đó.',
      },
    ],
  },
  {
    id: 'changes',
    title: { en: 'Changes to this policy, and how to reach us', vi: 'Thay đổi chính sách và cách liên hệ với chúng tôi' },
    blocks: [
      {
        en: 'We may update this policy. Material changes are announced on the platform at least 5 days before they take effect, so you have time to read them and to object or withdraw consent before they apply.',
        vi: 'Chúng tôi có thể cập nhật chính sách này. Các thay đổi quan trọng được thông báo trên nền tảng ít nhất 5 ngày trước khi có hiệu lực, để bạn có thời gian đọc, phản đối hoặc rút lại sự đồng ý trước khi thay đổi được áp dụng.',
      },
      CONTACT,
    ],
  },
]

const isTable = (b: Block): b is { table: Table } => 'table' in b

/**
 * ⚠️ "LAST UPDATED" IS THE AMENDMENT'S PUBLICATION DATE, ON BOTH EDITIONS. This text changed on both
 * builds (the curated Vietnamese, Consent v2, and the cross-border paragraph that no longer claims a
 * dossier filing — PDP_DOSSIERS_FILED), and it ships in the deploy that publishes the October legal
 * amendment, so it carries that deploy's date: LEGAL_AMENDMENT.published
 * (src/lib/compliance/legal-amendment.ts; infra/vn-node/legal-amendment-gate.sh holds it to the real
 * deploy day). A typed "October 2026" would silently go wrong if the deploy slipped.
 * ⚠️ Both dates are passed as authored strings rather than a {date} placeholder: the page stays a
 * synchronous component with no `lang` param, so <Bilingual> picks the language and each side carries
 * its own date format (01/10/2026 vs 1 October 2026).
 * Flipping PDP_DOSSIERS_FILED changes the text again: give this its new date in the same commit.
 */
const LAST_UPDATED = {
  en: `Last updated: ${AMENDED.publishedEn}`,
  vi: `Cập nhật lần cuối: ${AMENDED.publishedVi}`,
}

export default function PrivacyPage() {
  return (
    <ContentPage
      title="Privacy Policy"
      titleVi="Chính sách bảo vệ dữ liệu cá nhân"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4"><Bilingual en={LAST_UPDATED.en} vi={LAST_UPDATED.vi} /></p>
          <LegalLanguageNote />
        </>
      }
      sections={SECTIONS.map((s) => ({ id: s.id, label: s.title.en, labelVi: s.title.vi }))}
    >
      {SECTIONS.map((s) => (
        <ContentSection key={s.id} id={s.id} title={s.title.en} titleVi={s.title.vi}>
          <div className="space-y-2">
            {s.blocks.map((b, j) =>
              isTable(b) ? (
                <div key={j} className="py-2">
                  <LegalTable caption={b.table.caption} head={b.table.head} rows={b.table.rows} />
                </div>
              ) : (
                <p key={j} className="text-base leading-relaxed text-body"><LegalText en={b.en} vi={b.vi} /></p>
              ),
            )}
          </div>
        </ContentSection>
      ))}
      <div className="pt-2">
        <CookieSettingsButton />
      </div>
    </ContentPage>
  )
}
