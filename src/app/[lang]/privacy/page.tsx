import { SITE_NAME, IS_SERVICES } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Bilingual } from '@/components/marketplace/bilingual'
import { CookieSettingsButton } from '@/components/marketplace/cookie-settings-button'
import { LegalLanguageNote } from '@/components/legal/legal-language-note'
import { LegalTable, LegalText, type LegalCopy } from '@/components/legal/legal-text'
import { AFFILIATION, COMPANY, PDP_DOSSIERS_FILED } from '@/lib/site-legal'
import { appReviewGate } from '@/lib/app-review-gates'
import { LEGAL_AMENDMENT, dateEn, dateVi } from '@/lib/compliance/legal-amendment'
import { PRIVACY_TEXT_PUBLISHED } from '@/lib/compliance/privacy-updated'
import {
  PRIVACY_SERVICES_COLLECT,
  PRIVACY_SERVICES_CONTROLLER,
  PRIVACY_SERVICES_PURPOSES,
  PRIVACY_SERVICES_RECIPIENTS,
  PRIVACY_SERVICES_RETENTION,
  PRIVACY_SERVICES_SECTIONS,
} from '@/lib/privacy-services-copy'
// eno.vn's own section for the PARTNER e-Visa flow (2026-10-06) — aliased like the module above; rendered only on eno.vn.
import { PRIVACY_PARTNER_VISA_RECIPIENTS, PRIVACY_PARTNER_VISA_SECTIONS } from '@/lib/privacy-partner-visa-copy'

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
// ⚠️ ONE EXCEPTION (owner, 2026-10-14 — the e-Visa subcategory is open to any seller on BOTH editions, live after
// eno's licence check; CLAUDE.md): the shared "Messages to e-Visa sellers" paragraph in "What personal data we
// collect". It names no desk, partner, site or flow; eno's own desk and the partner flow stay in the aliased modules.
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
      // INCOMING messages (route.ts:22-24), and src/hooks/use-chat-translation.ts:126-130 starts it ON
      // whenever the two languages differ — so a sender's text goes out on the RECIPIENT's switch.
      // (App Store gate `app-ai-notice`, off by default: in the apps the first request waits for a
      // one-time notice, and "Turn off translation" stops them — src/lib/chat-translation-consent.ts.)
      { en: 'Microsoft (Azure AI Translator)', vi: 'Microsoft (Azure AI Translator)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      // ⚠️ App Store gate `app-ai-notice` (R8, D14): with it on, the apps ASK before the first chat translation, so the
      // policy says so (codex, review of that change: "starts switched on" alone no longer described the apps). Literal
      // on both branches so the copy harvest keeps them; eno.forum only — the apps load nothing else.
      appReviewGate('app-ai-notice') && IS_SERVICES
        ? { en: 'Text to translate: listing text, interface text and chat messages, when the two people in a conversation use different languages: translation starts switched on in that case, each of you can switch it off for your own view, and the messages you send are translated for the other person while their translation is on. In our apps, you are asked before your chats are first translated, and you can turn chat translation off in Settings → Preferences. Part of our translation runs on our own server instead.', vi: 'Văn bản cần dịch: nội dung tin đăng, chữ trên giao diện và tin nhắn trò chuyện, khi hai bên dùng ngôn ngữ khác nhau: khi đó tính năng dịch được bật sẵn, mỗi bên có thể tắt cho phần hiển thị của mình, và tin nhắn bạn gửi được dịch cho bên kia khi họ đang bật dịch. Trong ứng dụng của chúng tôi, bạn sẽ được hỏi trước khi các cuộc trò chuyện được dịch lần đầu, và bạn có thể tắt dịch tin nhắn trong Cài đặt → Tùy chọn. Một phần việc dịch chạy trên máy chủ của chính chúng tôi.' }
        : { en: 'Text to translate: listing text, interface text and chat messages, when the two people in a conversation use different languages: translation starts switched on in that case, each of you can switch it off for your own view, and the messages you send are translated for the other person while their translation is on. Part of our translation runs on our own server instead.', vi: 'Văn bản cần dịch: nội dung tin đăng, chữ trên giao diện và tin nhắn trò chuyện, khi hai bên dùng ngôn ngữ khác nhau: khi đó tính năng dịch được bật sẵn, mỗi bên có thể tắt cho phần hiển thị của mình, và tin nhắn bạn gửi được dịch cho bên kia khi họ đang bật dịch. Một phần việc dịch chạy trên máy chủ của chính chúng tôi.' },
      { en: 'Translating content into the language you choose.', vi: 'Dịch nội dung sang ngôn ngữ bạn chọn.' },
    ],
    [
      // src/lib/gemini.ts:60 (location 'global') · src/lib/ai-moderation.ts · src/lib/vertex-search.ts:43
      // · src/app/api/ai/concierge/route.ts · search terms: src/app/api/listings/semantic-rank.ts:54-78 →
      // vertexSearchListingIds (vertex-search.ts:255-257) · photo search: api/ai/visual-search/route.ts:81-83
      // (inlineData) · rephrase: api/ai/rephrase/route.ts:39-61 · report review (2026-10-06): a moderator's
      // "AI review" button (components/admin/moderation-client.tsx, dispute-room-client.tsx) →
      // api/admin/ai-review/route.ts — the report, reply and appeal, the dispute thread (:198), the parties'
      // last 40 messages (:218), the listing (:293), display names + trust/age/report counts, MAX_IMAGES 4 (:25)
      // inlineData; no account email or phone (:172); advisory, nothing mutates the case (:16-20). · Teacher CV reading
      // (2026-10-15): api/teachers/me/import/route.ts → src/lib/teachers/import-ai.ts — the file the teacher chooses (PDF or
      // photo inline; a Word file as the text read in the browser), never stored (no write anywhere in the route); the
      // consent recorded first (teacher.import.consent). Google's terms: no training on it; abuse logging ≤ 90 days. A PDF
      // is attached client-side as the private CV (teacher-form.tsx applyImport, uploaded by Publish). · Teacher photo check
      // (2026-10-16): src/lib/teachers/photo-verdict.ts — the photo re-encoded ≤768 px JPEG without metadata, three facts
      // (photograph / faceVisible / onlyYoungChildren); only the verdict is cached (kv, ≤180 days); asks, refusals and
      // admin overrides are audit rows (teacher.photo.ask / .refused / .override).
      { en: 'Google (Vertex AI, Gemini)', vi: 'Google (Vertex AI, Gemini)' },
      { en: 'Outside Vietnam (Google’s global endpoint)', vi: 'Ngoài Việt Nam (điểm truy cập toàn cầu của Google)' },
      { en: 'Listing photos and text sent for AI features and automated moderation; what you type to the AI assistant; where AI search is switched on, public listing details and the words you search for; a photo you choose to search by; text you ask us to rephrase; and, when our team reviews a report or a dispute and asks the AI for a suggestion, that case: the report, any reply and appeal, the statements and messages in the dispute case, the last 40 messages of the conversation between the two parties, the listing concerned, each party’s display name, trust score, account age and record of past reports, and up to 4 photos (evidence from the dispute, appeal proof or listing photos) — not the email address or phone number of either account. And, only when you choose “Fill it in from my CV” in the teacher profile form, the CV you choose — for a Word file, the text your browser reads from it — which the AI reads in full; we never keep its text (a PDF is kept only as the private CV attached to your profile, which you can remove), Google does not use it to train its AI, and Google may hold it briefly to answer, and for up to 90 days if its automated checks flag a request as misuse. And the profile photo you choose for a teacher profile — and, once, the photos already on teacher profiles — to check that it is a real photo showing a face — on the same terms.', vi: 'Ảnh và nội dung tin đăng được gửi cho các tính năng AI và kiểm duyệt tự động; nội dung bạn nhập cho trợ lý AI; khi tìm kiếm bằng AI được bật, thông tin công khai của tin đăng và từ khóa bạn tìm kiếm; ảnh bạn chọn để tìm kiếm bằng hình ảnh; văn bản bạn nhờ chúng tôi viết lại; và, khi đội ngũ của chúng tôi xem xét một báo cáo hoặc tranh chấp và nhờ AI gợi ý, hồ sơ vụ việc đó: nội dung báo cáo, phản hồi và khiếu nại đối với quyết định (nếu có), các lời trình bày và tin nhắn trong hồ sơ tranh chấp, 40 tin nhắn gần nhất trong cuộc trò chuyện giữa hai bên, tin đăng liên quan, tên hiển thị, điểm uy tín, thời gian sử dụng tài khoản và lịch sử báo cáo của mỗi bên, cùng tối đa 4 ảnh (ảnh bằng chứng trong tranh chấp, ảnh kèm khiếu nại hoặc ảnh tin đăng) — không kèm địa chỉ email hay số điện thoại của tài khoản nào. Và, chỉ khi bạn chọn “Điền tự động từ CV của tôi” trong biểu mẫu hồ sơ giáo viên, CV bạn chọn — với tệp Word, phần văn bản do trình duyệt của bạn đọc từ tệp — được AI đọc toàn bộ; chúng tôi không bao giờ lưu nội dung của tệp (tệp PDF chỉ được lưu dưới dạng CV riêng tư đính kèm hồ sơ của bạn, và bạn có thể xóa), Google không dùng tệp để huấn luyện AI, và Google có thể giữ tệp trong thời gian ngắn để trả kết quả, và tối đa 90 ngày nếu hệ thống tự động của Google đánh dấu yêu cầu là lạm dụng. Và ảnh hồ sơ bạn chọn cho hồ sơ giáo viên — cùng, một lần, các ảnh đã có trên hồ sơ giáo viên — để kiểm tra đó là ảnh thật có khuôn mặt — với cùng các điều kiện trên.' },
      { en: 'Describing and classifying listings, checking them for prohibited goods, search, search by photo, writing help, the shopping assistant, filling in a teacher profile from a CV you choose, checking that a teacher’s profile photo is a real photo showing a face, and suggesting an outcome to our team when it reviews a report or dispute (a member of our team decides).', vi: 'Mô tả và phân loại tin đăng, kiểm tra hàng hóa bị cấm, tìm kiếm, tìm kiếm bằng hình ảnh, hỗ trợ viết nội dung, trợ lý mua sắm, điền hồ sơ giáo viên từ CV bạn chọn, kiểm tra ảnh hồ sơ giáo viên là ảnh thật có khuôn mặt, và gợi ý hướng xử lý cho đội ngũ của chúng tôi khi xem xét báo cáo hoặc tranh chấp (một nhân viên của chúng tôi đưa ra quyết định).' },
    ],
    [
      // TEACHER JOB MATCHING (owner, 2026-10-08 — Claude Haiku 5.5, never Gemini). THE SENDER: ~/eno-lead-pipeline
      // src/cli/teachersMatch.ts → src/claudeFallback.ts (the pinned judge path, run by the /teachers skill through the
      // owner's Claude subscription). WHAT IT GETS: eno.vn scripts/teachers-match.ts `export` — only teachers whose opt-in
      // carries the CURRENT AI notice (src/lib/teachers/profile.ts aiMatchConsented), the MatchTeacher fields of
      // src/lib/teachers/match-io.ts with the name's words taken out of the free text (stripNameWords), plus the public
      // job fields (MatchJob); no name, photo, video, phone, email or CV field is selected for it. WHAT COMES BACK:
      // TeacherJobMatch rows → the job-match emails (api/cron/teacher-match-emails) and, for staff-call opt-ins, the
      // staff's local list. ⛔ The pipeline's privacy gate requires this exact label, 'Anthropic (Claude)'.
      { en: 'Anthropic (Claude)', vi: 'Anthropic (Claude)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Only for teachers who ask for job matches (by email, or through a call from our staff): the headline and about text of the teacher profile as the teacher wrote them, with the teacher’s own name taken out wherever we can detect it; the teacher’s nationality and whether they are a native speaker, the city they live in and the cities they can teach in (and whether online), subjects, age groups, job types, years of experience, degree, certificate types, expected salary and start date — together with the public details of teaching jobs. Never the name, photo, video, phone number, email address or CV fields of the profile.', vi: 'Chỉ với giáo viên yêu cầu gợi ý việc làm (qua email, hoặc qua cuộc gọi từ nhân viên của chúng tôi): tiêu đề và phần giới thiệu trong hồ sơ giáo viên đúng như giáo viên đã viết, trong đó tên của chính giáo viên được lược bỏ ở những chỗ chúng tôi nhận ra được; quốc tịch và việc giáo viên có phải người bản ngữ hay không, thành phố giáo viên đang sống và các thành phố giáo viên có thể dạy (và có dạy trực tuyến hay không), môn dạy, độ tuổi học viên, loại công việc, số năm kinh nghiệm, bằng cấp, loại chứng chỉ, mức lương mong muốn và ngày có thể bắt đầu — cùng thông tin công khai của các việc làm giảng dạy. Không bao giờ gồm các mục tên, ảnh, video, số điện thoại, địa chỉ email hay CV trong hồ sơ.' },
      { en: 'Comparing teacher profiles with teaching jobs, to suggest jobs to the teacher and, where the teacher agreed, to our staff.', vi: 'So sánh hồ sơ giáo viên với các việc làm giảng dạy, để gợi ý việc làm cho giáo viên và, khi giáo viên đồng ý, cho nhân viên của chúng tôi.' },
    ],
    [
      // src/lib/google-identity.ts · next.config.ts gsiScript
      { en: 'Google (Sign in with Google)', vi: 'Google (Đăng nhập bằng Google)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Only if you choose it: Google learns that you are signing in here, and sends us your name, email address and profile picture.', vi: 'Chỉ khi bạn chọn: Google biết bạn đang đăng nhập vào website này và gửi cho chúng tôi tên, địa chỉ email và ảnh hồ sơ của bạn.' },
      { en: 'Signing in.', vi: 'Đăng nhập.' },
    ],
    [
      // Sign in with Apple (2026-10-08, dated with this text — LAST_UPDATED below). What arrives: Apple's identity
      // token (sub, email, is_private_email — GoTrue's Apple provider and src/app/api/auth/apple/native/route.ts),
      // the name only on the FIRST authorization and only if shared (native-sign-in-plugin.ts AppleCredential;
      // written to the account by the native route's updateUser). What we keep: Apple's refresh token, AES-256-GCM
      // sealed (src/lib/auth/apple-siwa.ts, table apple_siwa_token — scripts/apple-siwa-ddl.mjs), used ONLY to
      // revoke at deletion (src/lib/core/account-erasure.ts, api/cron/apple-revocations — daily retries, 14 days
      // at most; TN3194). Private relay: mail to a privaterelay.appleid.com / private.icloud.com address passes
      // through Apple's relay (APPLE_RELAY_DOMAINS, src/lib/apple-signin.ts). Meta never receives an email hash for
      // these accounts (meta-capi.ts — see its row).
      { en: 'Apple (Sign in with Apple)', vi: 'Apple (Đăng nhập bằng Apple)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Only if you choose it: Apple learns that you are signing in here, and sends us an identifier for your Apple Account, your email address — or, if you choose to hide it, a private relay address that forwards to it — and, the first time only and only if you share it, your name. We keep a sign-in token from Apple, stored encrypted, only so that when you delete your account we can ask Apple to end this site’s access to your Apple Account. Emails we send to a private relay address pass through Apple’s relay service on their way to you.', vi: 'Chỉ khi bạn chọn: Apple biết bạn đang đăng nhập vào website này và gửi cho chúng tôi mã định danh Tài khoản Apple của bạn, địa chỉ email của bạn — hoặc, nếu bạn chọn ẩn email, một địa chỉ chuyển tiếp riêng sẽ chuyển thư đến email đó — và, chỉ trong lần đầu và chỉ khi bạn chia sẻ, tên của bạn. Chúng tôi lưu một mã đăng nhập do Apple cấp, ở dạng mã hóa, chỉ để khi bạn xóa tài khoản, chúng tôi có thể yêu cầu Apple chấm dứt quyền truy cập của website này vào Tài khoản Apple của bạn. Email chúng tôi gửi tới địa chỉ chuyển tiếp riêng sẽ đi qua dịch vụ chuyển tiếp của Apple trước khi đến bạn.' },
      { en: 'Signing in, and ending this site’s access when you delete your account.', vi: 'Đăng nhập, và chấm dứt quyền truy cập của website khi bạn xóa tài khoản.' },
    ],
    [
      // Continue with Facebook (2026-10-16 — owner: "if needed add sign in with facebook"): GoTrue's facebook provider
      // (infra/vn-node/facebook-signin.md), dark until GoTrue has it on (src/lib/auth/facebook.ts). GoTrue asks for `email`
      // and the public profile and reads /me?fields=email,first_name,last_name,name,picture. Kept: GoTrue's identity row
      // (auth.identities — Facebook's app-scoped id, name, email, the picture link) and the account's email and name
      // (src/lib/profile.ts). Never kept: Facebook's access token (the auth.flow_state trigger from apply-facebook-signin.sh,
      // and auth/callback stripFacebookToken). The picture is never shown or copied (profile.ts providerAvatarUrl — the
      // link expires). No email from Facebook → no account (GoTrue's default; auth/callback `no_email`). Never linked into
      // an existing account nor created for an operator's address (the auth.identities trigger; `facebook_linked`).
      { en: 'Meta (Continue with Facebook)', vi: 'Meta (Tiếp tục với Facebook)' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'Only if you choose it: Facebook learns that you are signing in here, and sends us an identifier for your Facebook account that only this site uses, your name, your email address and a link to your Facebook profile picture. We keep these with your sign-in record — never Facebook’s access token — and we never show or copy your Facebook picture or post anything to Facebook. If Facebook has no email address for you, no account is created: sign in with your email instead. And Facebook is never added to an account that already exists here — that account keeps the way in it was made with. You can remove eno from your Facebook settings (Apps and websites) at any time, and deleting your eno account deletes what Facebook sent us.', vi: 'Chỉ khi bạn chọn: Facebook biết bạn đang đăng nhập vào website này và gửi cho chúng tôi một mã định danh tài khoản Facebook chỉ dùng riêng cho website này, tên, địa chỉ email và liên kết ảnh đại diện Facebook của bạn. Chúng tôi lưu các thông tin này trong hồ sơ đăng nhập của bạn — không bao giờ lưu mã truy cập của Facebook — và không bao giờ hiển thị hay sao chép ảnh Facebook của bạn, hay đăng gì lên Facebook. Nếu Facebook không có địa chỉ email của bạn, tài khoản sẽ không được tạo: hãy đăng nhập bằng email. Facebook cũng không bao giờ được thêm vào một tài khoản đã có ở đây — tài khoản đó giữ cách đăng nhập ban đầu. Bạn có thể gỡ eno khỏi phần cài đặt Facebook (Ứng dụng và trang web) bất cứ lúc nào, và việc xóa tài khoản eno sẽ xóa những gì Facebook đã gửi cho chúng tôi.' },
      { en: 'Signing in. A new account made with Facebook takes its name and @handle from your Facebook name and its sign-in email from Facebook (you can change the name and handle in Settings).', vi: 'Đăng nhập. Tài khoản mới tạo bằng Facebook lấy tên và @tên người dùng từ tên Facebook của bạn và email đăng nhập từ Facebook (bạn có thể đổi tên và tên người dùng trong Cài đặt).' },
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
      // :1138-1144 Lead (listing id, category, price; seller phone + id) · api/teachers/me/route.ts PUT
      // Lead for a NEW teacher profile left public — it is a listing posted, and the row says so in words
      // (2026-10-11: a teacher does not read "profile" as "listing" — second opinion) (listing id, category,
      // value 0; email, phone, account id; the join page's address, named — never read with its query) ·
      // api/profile/account-type/
      // route.ts:234-242 CompleteRegistration (account type; first-visit source/medium/campaign ONLY when
      // `a` is on too — :206). Nothing on the site sets _fbp/_fbc (no pixel loads; next.config.ts CSP),
      // so they are sent only if the browser already holds them.
      // ⚠️ The services edition has ONE MORE call site (InitiateCheckout). It cannot be named in this shared
      // row (edition boundary), so it is disclosed in PRIVACY_SERVICES_RECIPIENTS — see the note there.
      { en: 'Meta (Conversions API) — only if you switch on Advertising', vi: 'Meta (Conversions API) — chỉ khi bạn bật Quảng cáo' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      // D14 (2026-10-08): no `em` for an Apple-linked account or a private relay address (meta-capi.ts userDataPayload).
      { en: 'Actions such as viewing a listing, contacting a seller, posting a listing (including publishing a teacher profile) and signing up, with the listing involved (its identifier and, when you view or post one, its price; when you post, its category); the address of the page you were on; at sign-up, the type of account you chose and — only if Analytics is on as well — the link or campaign that first brought you here; your email address, phone number and account identifier, each scrambled (hashed) first — never your email address if you use Sign in with Apple, or if it is an Apple private relay address; your IP address and browser details; and Meta’s own browser cookies (_fbp, _fbc), if your browser already holds them.', vi: 'Các hành động như xem tin đăng, liên hệ người bán, đăng tin (kể cả đăng hồ sơ giáo viên) và đăng ký, kèm thông tin về tin đăng liên quan (mã tin đăng và, khi bạn xem hoặc đăng tin, giá của tin; khi bạn đăng tin, danh mục của tin); địa chỉ trang bạn đang xem; khi đăng ký, loại tài khoản bạn chọn và — chỉ khi Phân tích cũng được bật — đường dẫn hoặc chiến dịch đã đưa bạn đến đây lần đầu; email, số điện thoại và mã tài khoản của bạn, mỗi thông tin đều được xáo trộn (băm) trước — không bao giờ gửi email của bạn nếu bạn dùng Đăng nhập bằng Apple, hoặc nếu đó là địa chỉ chuyển tiếp riêng của Apple; địa chỉ IP và thông tin trình duyệt; và cookie trình duyệt của chính Meta (_fbp, _fbc), nếu trình duyệt của bạn đã có sẵn.' },
      { en: 'Measuring our advertising.', vi: 'Đo lường hiệu quả quảng cáo của chúng tôi.' },
    ],
    [
      // src/lib/tiktok-events.ts (no-op unless configured AND tiktokConsent: Advertising on, answered on or after
      // TIKTOK_NAMED_FROM_S — src/lib/tiktok-consent.ts — AND the caller attests the consent RECORD of that answer names
      // TikTok: tiktok-consent-record.ts, TIKTOK_COPY_VERSION) · ONE call site: api/teachers/me/route.ts PUT, the first
      // save of a public teacher profile → CompleteRegistration: user { email / phone / external_id SHA-256 (no email
      // for an Apple-linked account or a relay address — D14), ip, user_agent } · page.url = the join page, named ·
      // properties: the listing id and its category. No pixel, no cookie, and no click id (not carried in this release).
      { en: 'TikTok (Events API) — only if you switch on Advertising', vi: 'TikTok (Events API) — chỉ khi bạn bật Quảng cáo' },
      { en: 'Outside Vietnam', vi: 'Ngoài Việt Nam' },
      { en: 'That you published a teacher profile, with the listing involved (its identifier and category) and the address of the sign-up page; your email address, phone number and account identifier, each scrambled (hashed) first — never your email address if you use Sign in with Apple or Continue with Facebook, or if it is an Apple private relay address; and your IP address and browser details. Only for an Advertising choice made on or after 13 October 2026, the first full day our consent question named TikTok.', vi: 'Việc bạn đã đăng hồ sơ giáo viên, kèm thông tin về tin đăng liên quan (mã tin đăng và danh mục) và địa chỉ trang đăng ký; email, số điện thoại và mã tài khoản của bạn, mỗi thông tin đều được xáo trộn (băm) trước — không bao giờ gửi email của bạn nếu bạn dùng Đăng nhập bằng Apple hoặc Tiếp tục với Facebook, hoặc nếu đó là địa chỉ chuyển tiếp riêng của Apple; và địa chỉ IP cùng thông tin trình duyệt. Chỉ áp dụng với lựa chọn Quảng cáo được thực hiện từ ngày 13 tháng 10 năm 2026, ngày trọn vẹn đầu tiên câu hỏi xin đồng ý của chúng tôi nêu tên TikTok.' },
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
      // Supabase session cookies (sb-*) and the PKCE verifier cookies (auth-pkce.ts) · Sign in with Apple's native
      // nonce cookie eno_apple_nonce (api/auth/apple/nonce — HttpOnly, 10 minutes, spent by api/auth/apple/native).
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
      // teacher-form.tsx DRAFT_KEY 'eno.teacherDraft.v1' — sessionStorage, DRAFT_TTL_MS 15 min · cleared on publish and at
      // sign-out (sign-out-storage.ts). The copy saved to the ACCOUNT is the server's (src/lib/teachers/draft.ts) — the
      // "Teacher profiles" paragraph above says what it holds and when it goes.
      { en: 'Unfinished teacher profile', vi: 'Hồ sơ giáo viên chưa hoàn tất' },
      { en: 'The teacher profile you are filling in, kept in this browser tab — while you are signed in it is also saved to your account (see “Teacher profiles” above).', vi: 'Hồ sơ giáo viên bạn đang điền, lưu trong thẻ trình duyệt này — khi bạn đã đăng nhập, hồ sơ cũng được lưu vào tài khoản của bạn (xem mục “Hồ sơ giáo viên” ở trên).' },
      { en: 'When you publish it, sign out or close the tab; a copy older than 15 minutes is discarded the next time the form opens.', vi: 'Khi bạn đăng hồ sơ, đăng xuất hoặc đóng thẻ; bản lưu cũ hơn 15 phút bị hủy vào lần mở biểu mẫu tiếp theo.' },
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
      // UX3 J1 (2026-10-05): + signin-gates.ts GATE_RECORD_KEY 'eno:signin-gate' (localStorage: { g: the gate
      // name, at: ms }) — written when Google, Apple, Facebook or email is chosen in any sign-in window, removed by the next
      // sign-in (settleGateSignIn), ignored after an hour. UX3 J5: + pending-intent.ts INTENT_KEY
      // 'eno:pending-intent' (sessionStorage: kind, the saved-search params / the offer amount / the opener and
      // its listing id, a timestamp and a nonce) — written when a gate opens sign-in, spent once it is finished,
      // dropped when that sign-in is closed, ignored after 15 minutes, removed at sign-out (sign-out-storage.ts).
      { en: 'Sign-up reminder (eno:signup-prompt, eno:signup-prompt-tab, eno:signin-gate, eno:pending-intent)', vi: 'Lời nhắc đăng ký (eno:signup-prompt, eno:signup-prompt-tab, eno:signin-gate, eno:pending-intent)' },
      { en: 'For the “Join eno” reminder: how long you have browsed in the current tab, how many times it has asked there, and whether you closed it and have not yet opened another page; how many times you closed it, when it last asked and until when it is paused; when you last chose Google, Apple, Facebook or email in it (so a sign-in soon after can be counted once, anonymously); and whether someone has signed in on this device, so it never asks here again. For any sign-in window: when you choose Google, Apple, Facebook or email in it, which kind of place it was opened from (such as a chat button or a saved search) and when, so the sign-in that follows can be counted once, anonymously, for that place. And when something you start needs an account (saving a search, an offer, a first message) and you are asked to sign in: that action — the search, the amount or the message and its listing — for this tab only, so it can be finished once you have signed in. Apart from that action: timings, counts, that one yes/no and the kind of place — no page, listing or identifier.', vi: 'Cho lời nhắc “Tham gia eno”: bạn đã xem trang bao lâu trong thẻ hiện tại, lời nhắc đã hiện mấy lần trong thẻ đó, và bạn đã đóng lời nhắc mà chưa mở trang khác hay chưa; bạn đã đóng lời nhắc mấy lần, lần cuối lời nhắc hiện và lời nhắc tạm dừng đến khi nào; lần cuối bạn chọn Google, Apple, Facebook hoặc email trong lời nhắc (để một lần đăng nhập ngay sau đó được đếm một lần, ẩn danh); và đã có ai đăng nhập trên thiết bị này chưa, để lời nhắc không bao giờ hiện lại tại đây. Với mọi khung đăng nhập: khi bạn chọn Google, Apple, Facebook hoặc email trong đó, loại chỗ đã mở khung (như nút nhắn tin hay lưu tìm kiếm) và thời điểm, để lần đăng nhập ngay sau đó được đếm một lần, ẩn danh, cho chỗ đó. Và khi một việc bạn bắt đầu cần có tài khoản (lưu tìm kiếm, trả giá, tin nhắn đầu tiên) và bạn được mời đăng nhập: việc đó — tìm kiếm, mức giá hoặc tin nhắn cùng tin đăng liên quan — chỉ trong thẻ này, để hoàn tất ngay khi bạn đã đăng nhập. Ngoài việc đó: chỉ gồm thời lượng, số lần, một mục có/không đó và loại chỗ — không có trang, tin đăng hay mã định danh nào.' },
      { en: 'The browsing time, and an action waiting for sign-in, when you close the tab (the action also once it is finished or when you sign out, and it is ignored after 15 minutes); the kind of place at your next sign-in; the rest when you clear this site’s data in your browser (signing out does not remove it).', vi: 'Thời lượng xem trang và việc đang chờ đăng nhập khi bạn đóng thẻ (việc đó cũng bị xóa khi đã hoàn tất hoặc khi bạn đăng xuất, và bị bỏ qua sau 15 phút); loại chỗ khi bạn đăng nhập lần tiếp theo; phần còn lại khi bạn xóa dữ liệu của website trong trình duyệt (đăng xuất không xóa mục này).' },
    ],
    [
      // install-hint.tsx · save-signup-sheet.tsx · post-wizard.tsx eno-posted-before · use-chat-translation.ts
      // chat-tr:* (incl. chat-tr:consent:<profile>, chat-translation-consent.ts) · auth-context.tsx eno-signup-fired:* · availability-client.tsx eno-avail:* · auth/handoff-client.ts
      // eno:handoff:next · apple-signin.ts SIWA_TEST_COOKIE 'eno-siwa-test' (a tester's opt-in to Sign in with Apple
      // before its release — written only while NEXT_PUBLIC_APPLE_SIGNIN has `web-test`, by ?siwa_test=1; 7 days)
      // · apple-deletion-notice.tsx APPLE_NOTICE_KEY 'eno:apple-deletion-notice' (sessionStorage: the Apple notice a
      // deletion hands to the page it lands on — 'queued' | 'manual'; removed when the notice is closed)
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
        // ⚠️ App Store gate `site-brand-copy` (R7): until eno.forum's operator is registered, COMPANY.name
        // is the VIETNAMESE placeholder "Đơn vị vận hành đang đăng ký thành lập" and the address is
        // "đang cập nhật" — untranslated, inside an English legal sentence the reviewer reads. With
        // the gate on, the English says in English what the Vietnamese already says ("Đơn vị vận hành
        // đang đăng ký thành lập, đang cập nhật" = the operating entity, registration in progress, details
        // to follow) — "entity", not "company", because nothing is incorporated yet. The Vietnamese is
        // unchanged.
        en: appReviewGate('site-brand-copy') && !COMPANY.registered
          ? 'The data controller — the party that decides why and how your data is processed — is the operating entity of this site, whose business registration is in progress; its name, address and registration number will be published here when they are issued. We acknowledge every request about your personal data within 2 working days.'
          : `The data controller — the party that decides why and how your data is processed — is ${COMPANY.name}, ${COMPANY.address}. We acknowledge every request about your personal data within 2 working days.`,
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
        // Sign in with Apple (2026-10-08): the email may be a private relay address (Hide My Email), and the name
        // comes only on the first authorization, only if shared — see the Apple row in RECIPIENTS.
        en: 'Account information: when you sign in we receive your email address and/or phone number; if you use Google sign-in, your name and profile picture from Google; if you use Continue with Facebook, your name and email address from Facebook; and if you use Sign in with Apple, your name from Apple — only the first time, and only if you choose to share it — with either your email address or, if you choose to hide it, a private relay address from Apple that forwards to it.',
        vi: 'Thông tin tài khoản: khi bạn đăng nhập, chúng tôi nhận địa chỉ email và/hoặc số điện thoại của bạn; nếu bạn đăng nhập bằng Google, tên và ảnh hồ sơ của bạn từ Google; nếu bạn dùng Tiếp tục với Facebook, tên và địa chỉ email của bạn từ Facebook; và nếu bạn dùng Đăng nhập bằng Apple, tên của bạn từ Apple — chỉ trong lần đầu và chỉ khi bạn chọn chia sẻ — cùng địa chỉ email của bạn hoặc, nếu bạn chọn ẩn email, một địa chỉ chuyển tiếp riêng do Apple cấp sẽ chuyển thư đến email đó.',
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
        // e-Visa SELLERS (owner, 2026-10-14: the e-Visa subcategory is open to any seller on both editions, live after
        // eno's licence check — taxonomy.ts licenceCheckHold). An ordinary thread carries no attachment (prisma Message:
        // a text body, no file column); the only upload in a thread is the in-chat e-Visa application
        // (messages/[id]/page.tsx uploadVisaDocument), on the visa-shop listings alone (thread-kind.ts). No pointer to
        // "the next section": a marketplace build without the partner flow has none (codex, commit gate). Deleting is
        // recall, not erasure (Message.deletedAt). Translation: the
        // Microsoft row. Report review: the Google row and "Automated decisions" — api/admin/ai-review reads the last 40
        // messages of the reporter↔seller thread for a report of the conversation, the listing or the seller, deleted
        // ones included (opus, plan review: not only "if the conversation is reported").
        en: 'Messages to e-Visa sellers: sellers on this site may offer help with a Vietnam e-Visa. Unless the listing offers an e-Visa application inside the chat, your conversation with its seller is an ordinary chat, which cannot carry photos or files. Whatever you choose to type in it — your passport details, for example — is handled like any other message: it is stored (see “Messages” above; deleting a message hides it from both of you but does not erase it), it may be machine-translated for the seller when the two of you use different languages, and if a report involves the conversation, the listing or the seller, our team can read it and may ask an AI model for a suggestion (see “Automated decisions”). The seller receives it and handles it under its own responsibility and its own obligations under Vietnamese law; anything you send a seller outside this site does not reach us. We are the marketplace — not a government agency — and do not decide visa applications. The official e-Visa portal is https://evisa.gov.vn.',
        vi: 'Tin nhắn với người bán dịch vụ e-Visa: người bán trên website này có thể cung cấp dịch vụ hỗ trợ xin e-Visa Việt Nam. Trừ khi tin đăng có quy trình nộp hồ sơ e-Visa ngay trong cuộc trò chuyện, cuộc trò chuyện của bạn với người bán là cuộc trò chuyện thông thường, không gửi được ảnh hay tệp. Những gì bạn chọn nhập vào đó — ví dụ thông tin hộ chiếu — được xử lý như mọi tin nhắn khác: được lưu (xem mục “Tin nhắn” ở trên; xóa một tin nhắn chỉ ẩn tin đó với cả hai bên chứ không xóa hẳn), có thể được dịch máy cho người bán khi hai bên dùng ngôn ngữ khác nhau, và nếu có báo cáo liên quan đến cuộc trò chuyện, tin đăng hoặc người bán đó, đội ngũ của chúng tôi có thể đọc nội dung này và có thể yêu cầu mô hình AI đưa ra gợi ý (xem mục “Quyết định tự động”). Người bán nhận và xử lý nội dung đó theo trách nhiệm và nghĩa vụ pháp lý của chính mình theo pháp luật Việt Nam; những gì bạn gửi cho người bán bên ngoài website này không đến tay chúng tôi. Chúng tôi là sàn giao dịch — không phải cơ quan nhà nước — và không quyết định kết quả hồ sơ thị thực. Cổng thông tin e-Visa chính thức là https://evisa.gov.vn.',
      },
      {
        // KYC: src/lib/kyc/service.ts (kycSubmitSchema — tier A/B, a plain selfie (the challenge is still issued as the
        // consent receipt, never shown or photographed since 2026-09-04 — review.test.ts), MRZ fields, consentVersion;
        // never returns `verified`, an admin reviews) · src/lib/kyc/store.ts (private bucket) · business:
        // src/lib/business-verification-store.ts:12 ('identity' | 'bank' | 'authorization') · tax code →
        // VietQR: src/lib/tax-lookup.ts:25 (a third party, NOT the tax authority — see its recipients row) · MRZ read on
        // device: src/lib/identity/mrz-ocr-tesseract.ts (next.config.ts CSP note)
        // Trust (owner, 2026-10-15): a LIVE verified identity is TRUST.V_KYC of the score for every account, both editions —
        // computeTrustV2 → verifiedProfileIds → deriveVerification over identity_verifications, never the Profile cache or
        // a ledger event; it lapses on expiry or revocation (the 09:05 ICT identity-reconcile recomputes every such
        // account). The teacher's "Identity verified" mark — AUTOMATIC since 2026-10-16, the teacher can hide it: see the
        // teacher paragraph below.
        en: 'Identity verification (sellers, and messaging teachers): to verify a seller we ask for a photo of an identity document — for example a Vietnamese citizen identity card or a passport — and a selfie, together with the details printed on the document (name, document number, nationality and expiry date). To verify a business we also ask for documents showing the business’s identity, its bank account and, where someone acts for the business, their authorisation, and we look the business tax code up in VietQR’s public business-register service (api.vietqr.io, which republishes the tax authority’s business-register data). These are sensitive personal data: we collect them only with your express consent, given when you submit them; we keep them in private storage that cannot be reached from the internet; and a member of our team reviews them — they are never approved automatically. The machine-readable lines of a passport are read on your own device to fill in the form. Any account may verify its identity, and a business account its business: the result — verified or not, never the document itself — also sets how many new teachers the account can start a chat with each day, and a teacher you message is shown whether your identity is verified or your business is. A verified identity also counts toward the account’s trust score for as long as it is current — until the document’s expiry date has passed or we withdraw the verification (see “Trust score”). The trust score is public and /trust explains how it is built, so a score can show that an account’s identity is verified even where nothing else says so. A teacher’s profile also shows “Identity verified” while their verification is current, unless they hide it (see “Teacher profiles”).',
        vi: 'Xác minh danh tính (người bán, và nhắn tin cho giáo viên): để xác minh người bán, chúng tôi yêu cầu ảnh chụp giấy tờ tùy thân — ví dụ căn cước công dân hoặc hộ chiếu — và một ảnh chân dung, cùng các thông tin in trên giấy tờ (họ tên, số giấy tờ, quốc tịch và ngày hết hạn). Để xác minh doanh nghiệp, chúng tôi còn yêu cầu giấy tờ thể hiện thông tin doanh nghiệp, tài khoản ngân hàng của doanh nghiệp và, khi có người đại diện thực hiện, giấy ủy quyền của người đó; mã số thuế doanh nghiệp được tra cứu qua dịch vụ tra cứu đăng ký doanh nghiệp công khai của VietQR (api.vietqr.io, nơi công bố lại dữ liệu đăng ký doanh nghiệp của cơ quan thuế). Đây là dữ liệu cá nhân nhạy cảm: chúng tôi chỉ thu thập khi có sự đồng ý rõ ràng của bạn tại thời điểm gửi; lưu trong kho lưu trữ riêng không truy cập được từ internet; và một nhân viên của chúng tôi trực tiếp xem xét — không bao giờ được duyệt tự động. Các dòng mã đọc máy trên hộ chiếu được đọc ngay trên thiết bị của bạn để điền vào biểu mẫu. Mọi tài khoản đều có thể xác minh danh tính, và tài khoản doanh nghiệp có thể xác minh doanh nghiệp: kết quả — đã xác minh hay chưa, không bao giờ là bản thân giấy tờ — còn được dùng để xác định số giáo viên mới mà tài khoản được bắt đầu trò chuyện mỗi ngày, và giáo viên bạn nhắn tin được biết danh tính của bạn hoặc doanh nghiệp của bạn đã được xác minh hay chưa. Danh tính đã xác minh còn được tính vào điểm uy tín của tài khoản trong thời gian còn hiệu lực — cho đến khi giấy tờ đã quá ngày hết hạn hoặc chúng tôi thu hồi kết quả xác minh (xem mục “Điểm uy tín”). Điểm uy tín được công khai và trang /trust giải thích cách tính, nên điểm số có thể cho thấy danh tính của tài khoản đã được xác minh, kể cả khi không có thông tin nào khác nói điều đó. Hồ sơ giáo viên cũng hiển thị “Đã xác minh danh tính” trong thời gian kết quả xác minh còn hiệu lực, trừ khi giáo viên ẩn nhãn (xem mục “Hồ sơ giáo viên”).',
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
      {
        // Teacher profiles: src/lib/teachers/profile.ts (the fields) · publish.ts (the listing, public + indexed —
        // owner, 2026-09-30) · TeacherPrivate + api/teachers/share (phone, email, CV only on the teacher's
        // Share tap). Cover lessons (2026-10-07): src/lib/teachers/cover.ts · publish.ts coverWrites (consent +
        // withdrawal timestamps, COVER_CONSENT_VERSION) · src/lib/teachers/notify.ts (bell + web push when a school
        // messages) · the "Teacher profile" row in the account menu (dashboard-nav.tsx) is the way to change it.
        // The unfinished profile saved to the account (2026-10-11): src/lib/teachers/draft.ts (draftDataOf — never the
        // phone, a photo or video, the cover switch or a consent; the 90-day retention, purgeStaleTeacherDrafts) · deleted
        // in the publish's transaction (publish.ts), by Start over (api/teachers/me/draft DELETE), with the account (FK) ·
        // in the account export (api/account/export teacherProfileDraft). Filling it in from a CV (2026-10-15):
        // api/teachers/me/import (the file read by Gemini, never stored; only EMPTY answers filled — import-map.ts
        // mergeImport; since the 2026-10-17 deploy the phone fills an EMPTY field and a PDF is attached as the private CV —
        // teacher-form.tsx applyImport), consent + outcome records
        // (teacher.import.consent / .result — field names only, never a value from the file).
        // "Identity verified" (owner, 2026-10-15; AUTOMATIC since 2026-10-16 — "if they verify it should be auto not need to
        // ask they consent by uploading kyc"): src/lib/teachers/identity-mark.ts identityMarkState — deriveVerification
        // 'verified' + the name within the document's + not hidden by the teacher. The consent is clause (5) of the identity
        // declaration, identity-v2 (src/lib/compliance/declaration-text.ts), kept per identity row as
        // identity_verifications.declarationVersion / declarationHash / declaredAt / declarationIp; the identity-v1 cohort,
        // whose declaration never mentioned it, shows on the same terms (owner: "Show theirs too" — an accepted risk,
        // docs/compliance/pdpl-dossier-draft.md purpose 8b) and the text says so. The hide: TeacherProfile.
        // identityMarkWithdrawnAt (the last hide) / identityMarkAt + identityMarkNoticeVersion (the last show-again and the
        // words beside the switch then) / identityMarkOn — exported with the row (teachers/export.ts); offered before
        // publishing too (the join form's create-only hide, publish.ts). The profile line, the card tick (listing-card.tsx,
        // from the Listing display cache identity-mark-card.ts keeps) and the writer's chip (api/conversations/[id] →
        // teacher-thread-strip.tsx); only a boolean leaves the server, nothing in JSON-LD; hiding purges the pages
        // (minutes, edge cache).
        en: 'Teacher profiles: if you create a teacher profile, we publish what you enter — your name, photo, intro video if you choose to show it, nationality, headline and bio, the cities you want to work in, the subjects and age groups you teach, your experience, degree and certificates, and an expected salary if you give one — so that schools and companies looking for teachers can find you. A teacher profile is public and can be indexed by search engines. If you also switch on cover lessons, your usual free periods (for example “Monday morning”), the areas you can travel to and your hourly rate are shown on the same profile and anyone browsing teachers can filter by them; we record when you agreed to show them and when you switched them off. If you keep your intro video private, it is stored privately and only an account you send it to in a conversation can watch it, through a link that expires after 10 minutes; you can stop sharing it at any time. Your phone number, email address and CV are never published: the account you are talking to receives them only if you tap “Share my phone, email & CV” in your conversation with it. Any signed-in account can message teachers: how many new teachers an account can start a chat with each day depends on whether it has verified its identity or its business, and an account can send a teacher at most two messages until the teacher replies. Until an account has verified its identity, the new chats started from one internet connection also share a daily limit; to count them we keep a one-way hash of the connection’s address — never the address itself — for two days. In a conversation we show you whether the account writing to you has verified its identity or is a verified business. If you have verified your identity, your profile shows “Identity verified” — on the profile, on your profile’s card wherever it appears in a list, and to the people who message you about your profile — while your verification is current and the name on your profile matches the name on your verified document; it never shows your document or anything printed on it. You agree to this in the declaration you confirm before you upload an identity document, and we keep a record of which version you confirmed, when, and the IP address you confirmed it from. If your identity was verified under the earlier declaration (used until 16 October 2026), which did not mention “Identity verified”, it shows on the same terms and you can hide it the same way. You can hide it at any time — before you publish your profile, too — and show it again later. Whether or not it shows, a verified identity counts toward your trust score, which is public (see “Trust score”). We record when you last hid it, and when you last showed it again together with the version of the words shown beside the switch at that time; hiding it takes it off your profile, your card and those conversations within a few minutes, though a search engine may show its old copy of your profile until it visits again. When someone starts a conversation with you, or writes again after a quiet spell, we notify you in the app (and by web push if you turned notifications on), and by email while a message stays unread — at most three emails about it, which you can turn off from any of them. While you are signed in, a profile you have not finished is saved to your account as you fill it in, so you can continue it later on any device: it is stored privately on our server in Vietnam, is never published, shown to anyone else or used for job matching, and never holds your phone number, photo, intro video or any consent you give. We delete it when you publish the profile, when you choose “Start over” (or undo a first reading from a file), when you delete your account, or 90 days after your last change, and it is included when you download your data. If you choose “Fill it in from my CV”, the CV you choose (for a Word file, the text your browser reads from it) is read by Google’s Gemini AI to fill in the answers you have not given yet (see Google under “Who else receives your data”): we keep the answers it filled in, saved to that unfinished profile for you to check and change, and a record of when you agreed and which answers it filled — never the text of the file. The phone number in your CV fills an empty phone field, and a CV that is a PDF is attached to your profile as your private CV unless you already have one; both stay private as described above, and you can change the number or remove the CV on the last step. A CV can hold sensitive personal data — about health, beliefs, ethnicity or a criminal record, ID or passport numbers — and other people’s details, such as referees’: the AI sees whatever the file holds, so remove what you would rather it did not see, or fill in the form yourself. Your profile photo is checked by Google’s Gemini AI when you choose it, to make sure it is a real photo showing a face (a photo of you with your class is fine): it does not identify you or judge your looks, Google does not use it to train its AI and keeps it only briefly — for up to 90 days if its automated checks flag the request as misuse — and we keep only the result, for up to 180 days. A photo that does not pass cannot be published — choose another, or tell us from the Help page if you think the check got it wrong, and a member of our team will look at it. If a photo already on a profile does not pass, we ask its teacher, in the app and by email, to change it. If your photo shows your students, make sure you have their or their parents’ permission. You can switch cover lessons off, hide “Identity verified”, hide your profile or delete it at any time from “Teacher profile” in your account.',
        vi: 'Hồ sơ giáo viên: nếu bạn tạo hồ sơ giáo viên, chúng tôi công khai những gì bạn nhập — họ tên, ảnh, video giới thiệu nếu bạn chọn hiển thị, quốc tịch, tiêu đề và phần giới thiệu, các thành phố bạn muốn làm việc, môn học và lứa tuổi bạn dạy, kinh nghiệm, bằng cấp và chứng chỉ, và mức lương mong muốn nếu bạn cung cấp — để các trường học và công ty đang tìm giáo viên có thể tìm thấy bạn. Hồ sơ giáo viên được công khai và có thể được công cụ tìm kiếm lập chỉ mục. Nếu bạn bật thêm dạy thay, các buổi bạn thường rảnh (ví dụ “sáng Thứ 2”), các khu vực bạn có thể đến và mức phí theo giờ được hiển thị trên cùng hồ sơ và bất kỳ ai xem danh sách giáo viên đều có thể lọc theo những thông tin này; chúng tôi ghi lại thời điểm bạn đồng ý hiển thị và thời điểm bạn tắt. Nếu bạn để video giới thiệu ở chế độ riêng tư, video được lưu riêng tư và chỉ tài khoản mà bạn gửi trong cuộc trò chuyện mới xem được, qua một liên kết hết hạn sau 10 phút; bạn có thể ngừng chia sẻ bất cứ lúc nào. Số điện thoại, email và CV của bạn không bao giờ được công khai: tài khoản bạn đang trò chuyện chỉ nhận được khi bạn bấm “Chia sẻ số điện thoại, email và CV” trong cuộc trò chuyện với họ. Mọi tài khoản đã đăng nhập đều có thể nhắn tin cho giáo viên: số giáo viên mới mà một tài khoản được bắt đầu trò chuyện mỗi ngày tùy thuộc vào việc tài khoản đó đã xác minh danh tính hoặc doanh nghiệp hay chưa, và một tài khoản chỉ được gửi tối đa hai tin nhắn cho giáo viên cho đến khi giáo viên trả lời. Cho đến khi tài khoản xác minh danh tính, các cuộc trò chuyện mới được bắt đầu từ cùng một kết nối internet còn dùng chung một giới hạn hằng ngày; để đếm, chúng tôi lưu một bản băm một chiều của địa chỉ kết nối — không bao giờ lưu chính địa chỉ đó — trong hai ngày. Trong cuộc trò chuyện, chúng tôi cho bạn biết tài khoản đang nhắn tin cho bạn đã xác minh danh tính hay là doanh nghiệp đã xác minh. Nếu bạn đã xác minh danh tính, hồ sơ của bạn hiển thị “Đã xác minh danh tính” — trên hồ sơ, trên thẻ hồ sơ ở mọi danh sách có hồ sơ của bạn, và với những người nhắn tin cho bạn về hồ sơ — trong thời gian việc xác minh của bạn còn hiệu lực và họ tên trên hồ sơ khớp với họ tên trên giấy tờ đã xác minh; nhãn không bao giờ hiển thị giấy tờ hay bất kỳ thông tin nào in trên đó. Bạn đồng ý với việc này trong bản cam đoan mà bạn xác nhận trước khi tải giấy tờ tùy thân lên, và chúng tôi lưu bản ghi về phiên bản bạn đã xác nhận, thời điểm xác nhận và địa chỉ IP bạn dùng khi xác nhận. Nếu danh tính của bạn được xác minh theo bản cam đoan trước đó (dùng đến ngày 16 tháng 10 năm 2026), vốn không đề cập đến nhãn “Đã xác minh danh tính”, nhãn vẫn hiển thị theo cùng điều kiện và bạn có thể ẩn nhãn theo cùng cách. Bạn có thể ẩn nhãn bất cứ lúc nào — kể cả trước khi đăng hồ sơ — và hiển thị lại sau đó. Dù nhãn có hiển thị hay không, danh tính đã xác minh vẫn được tính vào điểm uy tín của bạn, và điểm này được công khai (xem mục “Điểm uy tín”). Chúng tôi ghi lại thời điểm gần nhất bạn ẩn nhãn, và thời điểm gần nhất bạn hiển thị lại nhãn cùng phiên bản nội dung hiển thị cạnh công tắc lúc đó; khi bạn ẩn, nhãn được gỡ khỏi hồ sơ, thẻ hồ sơ và các cuộc trò chuyện đó trong vòng vài phút, dù công cụ tìm kiếm có thể vẫn hiển thị bản cũ của hồ sơ cho đến lần truy cập tiếp theo. Khi có người bắt đầu trò chuyện với bạn, hoặc nhắn lại sau một thời gian im lặng, chúng tôi thông báo cho bạn trong ứng dụng (và qua thông báo đẩy trên trình duyệt nếu bạn đã bật), và qua email khi tin nhắn vẫn chưa được đọc — tối đa ba email cho mỗi tin nhắn, bạn có thể tắt ngay trong bất kỳ email nào. Khi bạn đã đăng nhập, hồ sơ chưa hoàn tất được lưu vào tài khoản của bạn trong lúc bạn điền, để bạn có thể tiếp tục sau trên bất kỳ thiết bị nào: hồ sơ này được lưu riêng tư trên máy chủ của chúng tôi tại Việt Nam, không bao giờ được công khai, hiển thị cho người khác hay dùng để gợi ý việc làm, và không bao giờ chứa số điện thoại, ảnh, video giới thiệu hay bất kỳ sự đồng ý nào của bạn. Chúng tôi xóa hồ sơ này khi bạn đăng hồ sơ, khi bạn chọn “Bắt đầu lại” (hoặc hoàn tác lần đọc tệp đầu tiên), khi bạn xóa tài khoản, hoặc sau 90 ngày kể từ lần thay đổi cuối cùng, và hồ sơ này có trong dữ liệu bạn tải xuống. Nếu bạn chọn “Điền tự động từ CV của tôi”, CV bạn chọn (với tệp Word, phần văn bản do trình duyệt của bạn đọc từ tệp) được AI Gemini của Google đọc để điền các câu trả lời bạn chưa nhập (xem dòng Google trong mục “Những ai khác nhận dữ liệu của bạn”): chúng tôi lưu các câu trả lời được điền vào hồ sơ chưa hoàn tất đó để bạn kiểm tra và sửa, cùng bản ghi thời điểm bạn đồng ý và những câu trả lời đã được điền — không bao giờ lưu nội dung của tệp. Số điện thoại trong CV được điền vào ô số điện thoại nếu ô đang trống, và CV dạng PDF được đính kèm vào hồ sơ làm CV riêng tư của bạn, trừ khi bạn đã có CV; cả hai đều được giữ riêng tư như mô tả ở trên, và bạn có thể đổi số hoặc xóa CV ở bước cuối. CV có thể chứa dữ liệu cá nhân nhạy cảm — về sức khỏe, tín ngưỡng, dân tộc hoặc tiền án, số giấy tờ tùy thân hoặc hộ chiếu — và thông tin của người khác, như người giới thiệu: AI xem mọi thứ có trong tệp, vì vậy hãy xóa những gì bạn không muốn AI thấy, hoặc tự điền biểu mẫu. Ảnh hồ sơ của bạn được AI Gemini của Google kiểm tra khi bạn chọn, để bảo đảm đó là ảnh thật có khuôn mặt (ảnh bạn cùng lớp học cũng được): AI không nhận diện bạn là ai hay đánh giá ngoại hình của bạn, Google không dùng ảnh để huấn luyện AI và chỉ giữ ảnh trong thời gian ngắn — tối đa 90 ngày nếu hệ thống tự động của Google đánh dấu yêu cầu là lạm dụng — và chúng tôi chỉ lưu kết quả, tối đa 180 ngày. Ảnh không đạt không thể được đăng — hãy chọn ảnh khác, hoặc báo cho chúng tôi từ trang Trợ giúp nếu bạn cho rằng việc kiểm tra bị nhầm, và nhân viên của chúng tôi sẽ xem lại. Nếu ảnh đang có trên hồ sơ không đạt, chúng tôi đề nghị giáo viên đổi ảnh, qua ứng dụng và qua email. Nếu ảnh có học viên của bạn, hãy bảo đảm bạn đã được họ hoặc cha mẹ họ cho phép. Bạn có thể tắt dạy thay, ẩn nhãn “Đã xác minh danh tính”, ẩn hoặc xóa hồ sơ bất cứ lúc nào tại mục “Hồ sơ giáo viên” trong tài khoản.',
      },
      ...(IS_SERVICES ? PRIVACY_SERVICES_COLLECT : []),
    ],
  },
  ...(IS_SERVICES ? PRIVACY_SERVICES_SECTIONS.map(([id, title, blocks]): Section => ({ id, title, blocks })) : []),
  ...(!IS_SERVICES ? PRIVACY_PARTNER_VISA_SECTIONS.map(([id, title, blocks]): Section => ({ id, title, blocks })) : []),
  {
    id: 'why-and-basis',
    title: { en: 'Why we use your data, and on what legal basis', vi: 'Vì sao chúng tôi sử dụng dữ liệu của bạn và trên cơ sở pháp lý nào' },
    blocks: [
      { en: 'To create and secure your account and let you sign in.', vi: 'Để tạo và bảo vệ tài khoản của bạn và cho phép bạn đăng nhập.' },
      { en: 'To publish your listings after automated checks, and to connect buyers with sellers.', vi: 'Để đăng tin của bạn sau các bước kiểm tra tự động, và kết nối người mua với người bán.' },
      { en: 'To verify sellers and businesses, prevent fraud and abuse, run the trust-score system, handle reports and disputes, and keep the marketplace safe for everyone using it.', vi: 'Để xác minh người bán và doanh nghiệp, ngăn chặn gian lận và lạm dụng, vận hành hệ thống điểm uy tín, xử lý báo cáo và tranh chấp, và giữ an toàn cho mọi người sử dụng sàn.' },
      { en: 'To translate listing and interface content into the language you choose.', vi: 'Để dịch nội dung tin đăng và giao diện sang ngôn ngữ bạn chọn.' },
      { en: 'To answer your questions, reports and support requests.', vi: 'Để trả lời câu hỏi, báo cáo và yêu cầu hỗ trợ của bạn.' },
      {
        en: 'With your consent only, asked for separately: to personalise what you see using your own activity on this site; to measure the service with Google Analytics; and to send advertising measurement signals to Meta and TikTok (and to Google, when Analytics is on as well). Those three are described under “Cookies, tracking and your device”.',
        vi: 'Chỉ khi có sự đồng ý của bạn, được hỏi riêng cho từng mục: cá nhân hóa nội dung bạn thấy dựa trên chính hoạt động của bạn trên website; đo lường dịch vụ bằng Google Analytics; và gửi tín hiệu đo lường quảng cáo cho Meta và TikTok (và cho Google, khi Phân tích cũng được bật). Ba mục này được trình bày tại phần “Cookie, theo dõi và thiết bị của bạn”.',
      },
      ...(IS_SERVICES ? PRIVACY_SERVICES_PURPOSES : []),
      {
        // The two opt-ins of the teacher profile (TeacherProfile.matchEmailOptIn / staffContactOptIn), each stamped with
        // the AI notice it was given under (src/lib/teachers/publish.ts optInWrites) — both editions: one database.
        en: 'With a teacher’s consent only, given in the teacher profile: to compare the profile with teaching jobs and suggest the ones that fit, by email or through a call from our staff (see “Automated decisions”).',
        vi: 'Chỉ khi giáo viên đồng ý trong hồ sơ giáo viên: để so sánh hồ sơ với các việc làm giảng dạy và gợi ý những việc làm phù hợp, qua email hoặc qua cuộc gọi từ nhân viên của chúng tôi (xem mục “Quyết định tự động”).',
      },
      {
        // "Identity verified" (owner, 2026-10-15; AUTOMATIC since 2026-10-16): the consent is clause (5) of the identity
        // declaration, identity-v2 (src/lib/compliance/declaration-text.ts), affirmed before any document is uploaded and
        // kept per identity row — identity_verifications.declarationVersion / declarationHash / declaredAt / declarationIp.
        // No switch grants it any more; the teacher's switch HIDES it (TeacherProfile.identityMarkWithdrawnAt) and shows
        // it again (identityMarkAt + identityMarkNoticeVersion — src/lib/teachers/publish.ts saveTeacherIdentityMark).
        // ⚠️ The identity-v1 cohort never affirmed clause (5) and shows on the same terms (owner: "Show theirs too" — an
        // accepted risk, docs/compliance/pdpl-dossier-draft.md purpose 8b): the second sentence says so rather than
        // letting "with a teacher's consent" claim it for them.
        en: 'With a teacher’s consent, given in the declaration they confirm before uploading an identity document: to show “Identity verified” on their teacher profile, on its card in lists and to the people who message them about it, while their verification is current — they can hide it at any time in the teacher profile. Teachers whose identity was verified under the earlier declaration (used until 16 October 2026), which did not ask for this, show it on the same terms and can hide it the same way.',
        vi: 'Với sự đồng ý của giáo viên, được đưa ra trong bản cam đoan mà giáo viên xác nhận trước khi tải giấy tờ tùy thân lên: để hiển thị “Đã xác minh danh tính” trên hồ sơ giáo viên, trên thẻ hồ sơ trong các danh sách và với những người nhắn tin cho giáo viên về hồ sơ, trong thời gian việc xác minh còn hiệu lực — giáo viên có thể ẩn nhãn bất cứ lúc nào trong hồ sơ giáo viên. Với giáo viên có danh tính được xác minh theo bản cam đoan trước đó (dùng đến ngày 16 tháng 10 năm 2026), vốn không hỏi điều này, nhãn cũng hiển thị theo cùng điều kiện và có thể ẩn theo cùng cách.',
      },
      {
        // ⚠️ "EACH IS OFF UNTIL YOU TURN IT ON" STOPPED BEING TRUE OF EVERY OPTIONAL USE on 2026-10-16: "Identity verified"
        // shows once the identity is verified (the purpose above), so it is carved out by name — a general promise is the
        // sentence a reader holds us to, and nothing mark-specific would have flagged it (page.test.tsx pins the carve-out).
        en: 'The basis for all of this is your consent: expressed by a clear action, asked for separately for each purpose that needs it — each optional use has its own switch, and each is off until you turn it on — except “Identity verified” on a teacher profile: its consent is part of the identity declaration you confirm before uploading, together with the verification itself (an identity verified under the earlier declaration, which did not mention it, shows too — see “Teacher profiles”), so it shows once your identity is verified, and you can hide it at any time (see above). Consent is withdrawable at any time without losing access to the parts of the service that do not depend on it. Where Vietnamese law allows processing without consent we rely only on the narrow grounds it lists — performing a contract you asked us to perform, meeting a legal obligation such as keeping e-commerce records, protecting someone’s life or health in an emergency, and answering a lawful request from a competent state authority. We do not sell personal data and we do not trade in it: Vietnamese law prohibits it, and so do our own rules.',
        vi: 'Cơ sở cho tất cả các hoạt động trên là sự đồng ý của bạn: được thể hiện bằng một hành động rõ ràng, được hỏi riêng cho từng mục đích cần đồng ý — mỗi mục tùy chọn có công tắc riêng và đều tắt cho đến khi bạn bật — trừ nhãn “Đã xác minh danh tính” trên hồ sơ giáo viên: sự đồng ý cho nhãn này nằm trong bản cam đoan danh tính mà bạn xác nhận trước khi tải giấy tờ lên, cùng với việc xác minh (danh tính đã được xác minh theo bản cam đoan trước đây, vốn không nhắc đến nhãn này, cũng hiển thị — xem mục “Hồ sơ giáo viên”), nên nhãn hiển thị khi danh tính của bạn đã được xác minh, và bạn có thể ẩn nhãn bất cứ lúc nào (xem ở trên). Sự đồng ý có thể được rút lại bất cứ lúc nào mà không mất quyền sử dụng những phần dịch vụ không phụ thuộc vào sự đồng ý đó. Trong những trường hợp pháp luật Việt Nam cho phép xử lý không cần sự đồng ý, chúng tôi chỉ dựa vào các căn cứ hẹp được pháp luật liệt kê — thực hiện hợp đồng bạn yêu cầu, thực hiện nghĩa vụ pháp lý như lưu trữ dữ liệu giao dịch thương mại điện tử, bảo vệ tính mạng, sức khỏe của một người trong tình huống khẩn cấp, và đáp ứng yêu cầu hợp pháp của cơ quan nhà nước có thẩm quyền. Chúng tôi không bán và không mua bán dữ liệu cá nhân: pháp luật Việt Nam cấm hành vi này, và quy định của chính chúng tôi cũng cấm.',
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
        vi: 'Kiểm duyệt bằng AI: sau khi tin được đăng, một mô hình AI (Google Gemini) có thể kiểm tra nội dung và ảnh của tin để phát hiện hàng hóa bị cấm. Khi kết quả khớp với độ tin cậy cao, tin đăng bị ẩn ngay, một báo cáo được mở cho đội ngũ của chúng tôi và người bán được thông báo. Việc này tự nó không làm thay đổi điểm uy tín của ai — chỉ báo cáo đã được đội ngũ của chúng tôi xác nhận mới có tác động đó.',
      },
      {
        // src/app/api/admin/ai-review/route.ts:16-20 ("STRICTLY ADVISORY: nothing here mutates the case") — it
        // only caches its suggestion on the report; "Use suggestion" (components/admin/moderation-client.tsx:207)
        // pre-selects a severity and focuses a verdict button, which the moderator still has to press.
        en: 'AI review of reports: when our team reviews a report or a dispute, a moderator may ask an AI model (Google Gemini) to read the case — what is sent is listed for Google under “Who else receives your data” — and suggest an outcome. The suggestion is advisory only: it does not decide or change anything in the case by itself, and a member of our team reads the evidence and makes the decision.',
        vi: 'Hỗ trợ xem xét báo cáo bằng AI: khi đội ngũ của chúng tôi xem xét một báo cáo hoặc tranh chấp, người kiểm duyệt có thể nhờ một mô hình AI (Google Gemini) đọc hồ sơ vụ việc — dữ liệu được gửi đi được liệt kê ở dòng Google trong mục “Những ai khác nhận dữ liệu của bạn” — và gợi ý hướng xử lý. Gợi ý này chỉ mang tính tham khảo: tự nó không quyết định hay thay đổi điều gì trong vụ việc, và một nhân viên của chúng tôi xem xét bằng chứng và đưa ra quyết định.',
      },
      {
        // The bar: src/lib/teachers/match-io.ts MATCH_MIN_SCORE (70). The email: src/lib/teachers/match-emails.ts
        // MATCH_EMAIL_RULES (perEmail 5, cooldownMs 3 days). Who is matched: profile.ts aiMatchConsented. The staff list:
        // scripts/teachers-match.ts (staff-call opt-ins only). The unsubscribe: api/unsubscribe (list=teacher-matches).
        en: 'Teacher job matching: if a teacher asks for job matches, an AI model (Anthropic’s Claude) compares their profile with new teaching jobs and scores the fit. A job that scores 70 or more becomes a suggestion: it is emailed to the teacher (at most five jobs per email, at most one email every three days) and, if the teacher allowed our staff to call, listed for our staff. It only decides which jobs we suggest — schools never see the score, and no application is made on anyone’s behalf. Switching both choices off in the teacher profile stops it; the unsubscribe link in an email stops the emails.',
        vi: 'So khớp việc làm cho giáo viên: nếu giáo viên yêu cầu gợi ý việc làm, một mô hình AI (Claude của Anthropic) so sánh hồ sơ của giáo viên với các việc làm giảng dạy mới và chấm điểm mức độ phù hợp. Việc làm đạt từ 70 điểm trở lên trở thành một gợi ý: được gửi qua email cho giáo viên (tối đa năm việc làm mỗi email, tối đa một email mỗi ba ngày) và, nếu giáo viên cho phép nhân viên của chúng tôi gọi điện, được đưa vào danh sách cho nhân viên. Việc chấm điểm chỉ quyết định những việc làm chúng tôi gợi ý — trường học không bao giờ thấy điểm số, và không có đơn ứng tuyển nào được nộp thay cho bất kỳ ai. Tắt cả hai lựa chọn trong hồ sơ giáo viên sẽ dừng việc này; đường dẫn hủy đăng ký trong email sẽ dừng các email.',
      },
      {
        // api/teachers/me/import → import-map.ts mergeImport (fills only EMPTY answers of the unfinished profile; the
        // experience band is worked out from the dates and flagged "check it"); nothing is published by it.
        en: 'Filling in a teacher profile from a CV: when you ask, an AI model (Google Gemini) reads the CV you choose and suggests answers for your teacher profile. It decides nothing about you: its answers only fill questions you have not answered yet, you check and change them, and nothing is published until you publish your profile.',
        vi: 'Điền hồ sơ giáo viên từ CV: khi bạn yêu cầu, một mô hình AI (Google Gemini) đọc CV bạn chọn và gợi ý câu trả lời cho hồ sơ giáo viên của bạn. Mô hình không quyết định điều gì về bạn: các câu trả lời chỉ điền vào những câu hỏi bạn chưa trả lời, bạn kiểm tra và sửa, và không có gì được công khai cho đến khi bạn đăng hồ sơ.',
      },
      {
        // src/lib/teachers/photo-check.ts (the decision is code's, from three facts the model reports) → photo-verdict.ts;
        // the human route: Admin › Catalogue › Teacher photos "Photo is fine" (an audit row every check honours).
        en: 'Teacher profile photos: an AI model (Google Gemini) checks that the photo you choose for a teacher profile is a real photo showing a face — a photo of you with your class passes; a drawing, a game or film character, a logo, a picture with no face, or one where only young children can be seen does not. A photo that does not pass cannot be your profile photo; it decides nothing else about you. You can choose another, or ask from the Help page for a member of our team to look at it — they can approve it.',
        vi: 'Ảnh hồ sơ giáo viên: một mô hình AI (Google Gemini) kiểm tra ảnh bạn chọn cho hồ sơ giáo viên là ảnh thật có khuôn mặt — ảnh bạn cùng lớp học là đạt; hình vẽ, nhân vật trò chơi hoặc phim, logo, hình không có khuôn mặt, hay ảnh chỉ thấy trẻ nhỏ là không đạt. Ảnh không đạt không thể làm ảnh hồ sơ của bạn; việc kiểm tra không quyết định điều gì khác về bạn. Bạn có thể chọn ảnh khác, hoặc đề nghị từ trang Trợ giúp để nhân viên của chúng tôi xem lại — họ có thể chấp thuận ảnh.',
      },
      {
        // src/lib/trust-math.ts:15-45 (V: phone, a LIVE verified identity — deriveVerification over identity_verifications,
        // lapses on expiry/revocation — and age · Q: reviews, responsiveness,
        // freshness · T: transactions · C: confirmed reports) · publish-guard.ts:218 (Restricted can't post)
        en: 'Trust score: every seller has a trust score calculated automatically from a verified phone number, a verified identity (while it is current), account age, reviews, how quickly they reply, whether their listings are kept up to date, completed transactions and confirmed reports. It is shown on listings and is one of the factors in the order of browse results (see /legal/ranking and /trust). An account whose score falls into the lowest band cannot publish new listings until it recovers.',
        vi: 'Điểm uy tín: mỗi người bán có một điểm uy tín được tính tự động dựa trên số điện thoại đã xác minh, danh tính đã xác minh (khi còn hiệu lực), thời gian sử dụng tài khoản, đánh giá, tốc độ phản hồi, việc cập nhật tin đăng, số giao dịch đã hoàn tất và các báo cáo đã được xác nhận. Điểm được hiển thị trên tin đăng và là một trong các yếu tố sắp xếp kết quả khi duyệt tin (xem /legal/ranking và /trust). Tài khoản có điểm rơi vào nhóm thấp nhất không thể đăng tin mới cho đến khi điểm được phục hồi.',
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
      ...(!IS_SERVICES ? PRIVACY_PARTNER_VISA_RECIPIENTS : []),
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
        en: 'Our own systems are in Vietnam, but several of the recipients above work outside Vietnam — Cloudflare, Microsoft, Google, Apple, Anthropic, Resend, Telegram, Meta, TikTok, LinkedIn, Reddit, CARTO, OpenStreetMap and the push-notification services. Sending them personal data is a cross-border transfer under Vietnamese law, and it carries its own duties: the transfer must be documented and assessed, the assessment must be filed with the Ministry of Public Security and kept current, and you must be told the transfer is happening. This paragraph is that notice.',
        vi: 'Hệ thống của chính chúng tôi đặt tại Việt Nam, nhưng một số bên nhận nêu trên hoạt động ngoài Việt Nam — Cloudflare, Microsoft, Google, Apple, Anthropic, Resend, Telegram, Meta, TikTok, LinkedIn, Reddit, CARTO, OpenStreetMap và các dịch vụ thông báo đẩy. Việc gửi dữ liệu cá nhân cho các bên này là chuyển dữ liệu cá nhân ra nước ngoài theo pháp luật Việt Nam và kèm theo các nghĩa vụ riêng: việc chuyển dữ liệu phải được ghi nhận và đánh giá, hồ sơ đánh giá phải được nộp cho Bộ Công an và cập nhật kịp thời, và bạn phải được thông báo về việc chuyển dữ liệu. Đoạn này là thông báo đó.',
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
        en: 'Beyond that we ask separately for three optional uses, and each stays off until you switch it on. Personalisation: your device keeps a list of the categories, brands and listings you view here, and we use it, with your recent searches, to suggest listings in the “For you” and “Recently viewed” rows, using our own servers; it is never shared with advertisers. Analytics: Google Analytics counts visits and the pages people use, and we note which link or campaign first brought you here, and keep that with your account if you sign up. Advertising: we send Meta signals about actions such as viewing a listing, contacting a seller, posting a listing and signing up, so our ads can be measured — with your email address (never if you use Sign in with Apple, or for an Apple private relay address), phone number and account identifier scrambled (hashed) first, together with the listing and page involved, your IP address and browser details (“Who else receives your data” above lists all of it). If you publish a teacher profile, we also tell TikTok that a sign-up was completed, with the same scrambled identifiers (never the email address of an account you sign in to with Facebook), your IP address and browser details — but only for an Advertising choice you made on or after 13 October 2026, the first full day our consent question named TikTok. And, if Analytics is on as well, Google Analytics may share advertising signals with Google’s ad products.',
        vi: 'Ngoài ra, chúng tôi hỏi riêng về ba mục sử dụng tùy chọn, và mỗi mục đều tắt cho đến khi bạn bật. Cá nhân hóa: thiết bị của bạn lưu danh sách các danh mục, thương hiệu và tin đăng bạn xem tại đây, và chúng tôi dùng danh sách đó cùng các tìm kiếm gần đây của bạn để gợi ý tin đăng ở mục “Dành cho bạn” và “Đã xem gần đây”, bằng máy chủ của chính chúng tôi; dữ liệu này không bao giờ được chia sẻ cho bên quảng cáo. Phân tích: Google Analytics đếm lượt truy cập và các trang được sử dụng, và chúng tôi ghi nhận đường dẫn hoặc chiến dịch đã đưa bạn đến đây lần đầu, lưu thông tin đó cùng tài khoản nếu bạn đăng ký. Quảng cáo: chúng tôi gửi cho Meta tín hiệu về các hành động như xem tin đăng, liên hệ người bán, đăng tin và đăng ký, để đo lường quảng cáo — email (không bao giờ gửi nếu bạn dùng Đăng nhập bằng Apple, hoặc nếu đó là địa chỉ chuyển tiếp riêng của Apple), số điện thoại và mã tài khoản của bạn được xáo trộn (băm) trước, kèm tin đăng và trang liên quan, địa chỉ IP và thông tin trình duyệt (mục “Những ai khác nhận dữ liệu của bạn” ở trên liệt kê đầy đủ). Nếu bạn đăng hồ sơ giáo viên, chúng tôi cũng báo cho TikTok rằng một lượt đăng ký đã hoàn tất, kèm các mã định danh đã được xáo trộn như trên (không bao giờ gồm địa chỉ email của tài khoản bạn đăng nhập bằng Facebook), địa chỉ IP và thông tin trình duyệt — nhưng chỉ áp dụng với lựa chọn Quảng cáo bạn thực hiện từ ngày 13 tháng 10 năm 2026, ngày trọn vẹn đầu tiên câu hỏi xin đồng ý của chúng tôi nêu tên TikTok. Và, nếu Phân tích cũng được bật, Google Analytics có thể chia sẻ tín hiệu quảng cáo với các sản phẩm quảng cáo của Google.',
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
            en: 'Google Analytics runs only if you switch on Analytics, and the Meta, TikTok and Google advertising signals — including the ones our server sends — only if you switch on Advertising. One exception, stated plainly: our tag manager (Google Tag Manager) loads for every visitor to this site; it starts with Google’s consent signals set to “denied” and is told your choice, but any measurement tag configured inside it may run before you choose. You can change your mind at any time with the button at the end of this page or the Cookie settings link. Turning a use off takes effect immediately on this device — its tracking stops, and the cookies and on-device history it used (the Google Analytics cookies, the first-visit link cookie, the Meta and Google advertising cookies, your viewing history) are deleted — and it does not cost you any part of the service.',
            vi: 'Google Analytics chỉ chạy khi bạn bật Phân tích, và tín hiệu quảng cáo của Meta, TikTok và Google — kể cả tín hiệu do máy chủ của chúng tôi gửi — chỉ chạy khi bạn bật Quảng cáo. Có một ngoại lệ, xin nói rõ: trình quản lý thẻ của chúng tôi (Google Tag Manager) được tải cho mọi khách truy cập website này; trình quản lý này khởi đầu với tín hiệu đồng ý của Google ở trạng thái “từ chối” và được báo lựa chọn của bạn, nhưng bất kỳ thẻ đo lường nào được cấu hình bên trong vẫn có thể chạy trước khi bạn chọn. Bạn có thể thay đổi lựa chọn bất cứ lúc nào bằng nút ở cuối trang này hoặc liên kết Cài đặt cookie. Việc tắt một mục có hiệu lực ngay trên thiết bị này — việc theo dõi dừng lại, và cookie cũng như lịch sử trên thiết bị mà mục đó sử dụng (cookie Google Analytics, cookie nguồn truy cập đầu tiên, cookie quảng cáo của Meta và Google, lịch sử xem của bạn) bị xóa — và bạn không mất bất kỳ phần nào của dịch vụ.',
          }
        : {
            en: 'Google Analytics runs only if you switch on Analytics, and the Meta, TikTok and Google advertising signals — including the ones our server sends — only if you switch on Advertising. Decline and no third-party tracking runs, server-side included. You can change your mind at any time with the button at the end of this page or the Cookie settings link. Turning a use off takes effect immediately on this device — its tracking stops, and the cookies and on-device history it used (the Google Analytics cookies, the first-visit link cookie, the Meta and Google advertising cookies, your viewing history) are deleted — and it does not cost you any part of the service.',
            vi: 'Google Analytics chỉ chạy khi bạn bật Phân tích, và tín hiệu quảng cáo của Meta, TikTok và Google — kể cả tín hiệu do máy chủ của chúng tôi gửi — chỉ chạy khi bạn bật Quảng cáo. Nếu bạn từ chối, không có hoạt động theo dõi nào của bên thứ ba được chạy, kể cả từ phía máy chủ. Bạn có thể thay đổi lựa chọn bất cứ lúc nào bằng nút ở cuối trang này hoặc liên kết Cài đặt cookie. Việc tắt một mục có hiệu lực ngay trên thiết bị này — việc theo dõi dừng lại, và cookie cũng như lịch sử trên thiết bị mà mục đó sử dụng (cookie Google Analytics, cookie nguồn truy cập đầu tiên, cookie quảng cáo của Meta và Google, lịch sử xem của bạn) bị xóa — và bạn không mất bất kỳ phần nào của dịch vụ.',
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
        // signup-prompt.tsx countSignupPrompt / signin-gates.ts → lib/signup-counters.ts → api/signup-prompt/
        // route.ts → lib/signup-prompt-counter.ts: kv_store keys `signup-prompt:<VN day>:<edition>:<event>:<class>`
        // and (UX3 J1) `signin-gate:<VN day>:<edition>:<gate>:<action>:<class>`, integers, 400-day TTL. Body =
        // the event (or gate + action) and <class>, one of 24 fixed values (signup-prompt.ts CONTEXTS × DEVICES
        // × LANGS, validated server-side); the route reads the IP for its rate limit (rl_window) and stores
        // none of it there.
        en: 'Sign-up reminder counts: to learn whether the “Join eno” reminder and the other places that ask you to sign in help or annoy, our server keeps daily totals — for the reminder, how many times it was shown, closed, left open when the page was hidden or closed, followed by another page after closing, answered with Google, Apple, Facebook or email, and followed by a sign-in; for each place that asks (a first save, chat, an offer, the rental check, a saved search, posting, the teacher profile form, the header or tab bar, the sign-in page), how many times sign-in was opened there, Google, Apple, Facebook or email was chosen, and a sign-in followed; and for the teacher profile form, how many times its first step was ready to use, answered, and continued — or stopped by a missing answer — and, with each Continue, whether the link that brought you was an ad’s, a Facebook group’s, Zalo’s, another or none; how many times each later step was reached, an intro video was chosen, turned down by the check in your browser, could not be prepared or uploaded, or was uploaded, and Publish was tapped, refused for the video, the photo, the kind of work or another answer, or did not go through; how many times “Open in Safari” or “Open in your browser” was tapped; and how many new teacher profiles were published. With each one your browser sends the event and a coarse label: the kind of browser (a regular one, Facebook’s, Zalo’s or another app’s built-in browser, the home-screen app or the eno app), phone or computer, and Vietnamese or English. Like every request, it arrives with your IP address, which is used only by our abuse rate limit (kept briefly, as for any request) and is never stored with the totals; the totals hold no IP address, account, cookie, browser version or page, so a total cannot be traced back to anyone. These totals are counted whatever you choose for Analytics, and are deleted after about 13 months.',
        vi: 'Số liệu lời nhắc đăng ký: để biết lời nhắc “Tham gia eno” và những chỗ khác mời bạn đăng nhập có ích hay gây phiền, máy chủ của chúng tôi lưu các tổng số theo ngày — với lời nhắc: số lần hiển thị, bị đóng, vẫn đang mở khi trang bị ẩn hoặc đóng, được tiếp nối bằng một trang khác sau khi đóng, được trả lời bằng Google, Apple, Facebook hoặc email, và được tiếp nối bằng một lần đăng nhập; với từng chỗ mời đăng nhập (lần lưu tin đầu tiên, nhắn tin, trả giá, kiểm tra phòng trống, lưu tìm kiếm, đăng tin, biểu mẫu hồ sơ giáo viên, thanh đầu trang hoặc thanh điều hướng, trang đăng nhập): số lần mở đăng nhập tại đó, số lần chọn Google, Apple, Facebook hoặc email, và số lần đăng nhập sau đó; và với biểu mẫu hồ sơ giáo viên: số lần bước đầu tiên sẵn sàng để dùng, được trả lời, được tiếp tục — hoặc bị dừng vì thiếu câu trả lời — và, với mỗi lần tiếp tục, đường liên kết đưa bạn đến là của một quảng cáo, một nhóm Facebook, Zalo, nơi khác hay không có; số lần đến từng bước sau đó, chọn video giới thiệu, video bị bước kiểm tra trong trình duyệt của bạn từ chối, không chuẩn bị hoặc tải lên được, hoặc được tải lên, và số lần bấm Đăng, bị từ chối vì video, ảnh, loại công việc hoặc một câu trả lời khác, hoặc không thực hiện được; số lần bấm “Mở bằng Safari” hoặc “Mở bằng trình duyệt”; và số hồ sơ giáo viên mới được đăng. Mỗi lần như vậy, trình duyệt của bạn gửi tên sự kiện kèm một nhãn khái quát: loại trình duyệt (trình duyệt thông thường, trình duyệt trong Facebook, Zalo hoặc ứng dụng khác, ứng dụng trên màn hình chính hoặc ứng dụng eno), điện thoại hay máy tính, và tiếng Việt hay tiếng Anh. Như mọi yêu cầu khác, yêu cầu này kèm địa chỉ IP của bạn, chỉ được dùng cho giới hạn tần suất chống lạm dụng (lưu trong thời gian ngắn như mọi yêu cầu) và không bao giờ được lưu cùng các tổng số; các tổng số không chứa địa chỉ IP, tài khoản, cookie, phiên bản trình duyệt hay trang, nên không thể truy ngược về bất kỳ ai. Các tổng số này được đếm bất kể bạn chọn gì cho Phân tích, và bị xóa sau khoảng 13 tháng.',
      },
      {
        // Speed plan item 5 (owner 2026-10-16, "Anonymous, no consent" — the paragraph above's rule): instrumentation-
        // client.ts → lib/rum/early.ts (+ lib/rum/vitals.ts, web-vitals CLS/INP) → api/page-speed/route.ts →
        // lib/rum/ops.ts → lib/rum/store.ts → table rum_daily (scripts/rum-ddl.mjs): one count per (VN day, edition,
        // family, dims, bucket), 400 days. Labels are closed sets (lib/rum/shared.ts: page kind, the 24 classes, device
        // memory tier, colo HKG/SIN/SGN/HAN/BKK/KUL/TPE/NRT/other, edge state); every number becomes a bucket id
        // server-side. The route's rate limit is in memory (store.ts allowBeacon, ~1 min, pruned every 30 s); nginx
        // logs the request like any other — hence "handled as for any request", not "used only by the rate limit". Server-Timing (edge Worker + nginx) is what the browser reads for the data
        // centre, the stored copy and the server's time. Nothing is written to the device.
        en: 'Page speed measurements: to learn how quickly pages load and respond for real visitors, and whether our changes make them faster, your browser measures the page it has just shown you — how long it took to start arriving, to show its first and its largest content, and until its links worked; how far it shifted while loading; its slowest response to a tap or a key; and how long moving to another page of the site took — and sends those numbers with a coarse label: the kind of page (for example the home page, a category, a listing, a teacher profile or a search), the kind of browser (as above), phone or computer, Vietnamese or English, a rough memory class of the device when the browser reports one, which Cloudflare data centre carried the page and whether it was served from a stored copy, and how long our server took to answer. Like every request, it arrives with your IP address, which is handled as for any request — the technical log described above and our abuse rate limit — and is never stored with the totals. Our server turns each number into one more count in a daily total and keeps nothing else: the totals hold no IP address, account, cookie, browser version or page address, so they do not identify anyone. Nothing is stored on your device. These totals are counted whatever you choose for Analytics, and are deleted after about 13 months.',
        vi: 'Số liệu tốc độ trang: để biết các trang tải và phản hồi nhanh đến đâu với người truy cập thật, và các thay đổi của chúng tôi có giúp trang nhanh hơn không, trình duyệt của bạn đo trang vừa hiển thị cho bạn — mất bao lâu để trang bắt đầu được nhận, để hiện nội dung đầu tiên và nội dung lớn nhất, và đến khi các liên kết trên trang dùng được; trang bị xê dịch bao nhiêu khi đang tải; lần phản hồi chậm nhất của trang với một lần chạm hoặc một phím bấm; và chuyển sang một trang khác của website mất bao lâu — rồi gửi các con số đó kèm một nhãn khái quát: loại trang (ví dụ trang chủ, một danh mục, một tin đăng, một hồ sơ giáo viên hay một trang tìm kiếm), loại trình duyệt (như trên), điện thoại hay máy tính, tiếng Việt hay tiếng Anh, mức bộ nhớ ước lượng của thiết bị nếu trình duyệt cho biết, trung tâm dữ liệu Cloudflare nào đã chuyển trang và trang có được phục vụ từ bản lưu sẵn hay không, và máy chủ của chúng tôi mất bao lâu để trả lời. Như mọi yêu cầu khác, yêu cầu này kèm địa chỉ IP của bạn, được xử lý như với mọi yêu cầu — nhật ký kỹ thuật nêu ở trên và giới hạn tần suất chống lạm dụng — và không bao giờ được lưu cùng các tổng số. Máy chủ của chúng tôi biến mỗi con số thành thêm một lượt đếm trong một tổng số theo ngày và không lưu gì khác: các tổng số không chứa địa chỉ IP, tài khoản, cookie, phiên bản trình duyệt hay địa chỉ trang, nên không nhận diện được bất kỳ ai. Không có gì được lưu trên thiết bị của bạn. Các tổng số này được đếm bất kể bạn chọn gì cho Phân tích, và bị xóa sau khoảng 13 tháng.',
      },
      {
        en: 'The table below lists everything this site keeps on your device, and when each item is removed. Signing out removes your inbox, the drafts kept on this device, your AI conversation and the other copies of account data marked “when you sign out”; an unfinished teacher profile saved to your account stays there (see “Teacher profiles” above).',
        vi: 'Bảng dưới đây liệt kê mọi thứ website lưu trên thiết bị của bạn và thời điểm từng mục bị xóa. Khi đăng xuất, hộp thư, các bản nháp lưu trên thiết bị này, cuộc trò chuyện với trợ lý AI và các bản sao dữ liệu tài khoản khác được ghi “khi bạn đăng xuất” đều bị xóa; hồ sơ giáo viên chưa hoàn tất đã lưu vào tài khoản vẫn được giữ lại (xem mục “Hồ sơ giáo viên” ở trên).',
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
 * dossier filing — PDP_DOSSIERS_FILED), and it shipped in the deploy that published the October legal
 * amendment, so it carried that deploy's date: LEGAL_AMENDMENT.published
 * (src/lib/compliance/legal-amendment.ts; infra/vn-node/legal-amendment-gate.sh holds it to the real
 * deploy day). A typed "October 2026" would silently go wrong if the deploy slipped.
 * ⚠️ Both dates are passed as authored strings rather than a {date} placeholder: the page stays a
 * synchronous component with no `lang` param, so <Bilingual> picks the language and each side carries
 * its own date format (01/10/2026 vs 1 October 2026).
 * Flipping PDP_DOSSIERS_FILED changes the text again: give this its new date in the same commit.
 * ⚠️ THE TEXT CHANGED AGAIN WITH THE TERMS' VERSION 3 (2026-10-07): the moderators' AI review of reports —
 * the Google row and "Automated decisions", both editions — and, on eno.vn, the partner e-Visa section
 * (src/lib/privacy-partner-visa-copy.ts) with its row in "Who else receives your data". They ship in the
 * deploy that publishes that amendment, so LEGAL_AMENDMENT.published — version 3's since 2026-10-07 — dates
 * them, as the October amendment's dated the text before; the gate holds it to the real deploy day. Shipped
 * in any other deploy, a change here needs its own date in that commit.
 * ⚠️ COVER LESSONS (2026-10-07) added the "Teacher profiles" paragraph AFTER version 3 went out (c1e00b292), so
 * version 3's day does not date it: PRIVACY_TEXT_PUBLISHED below does (the owner decides whether it is a material
 * change under the 5-day notice below).
 *
 * ⛔ AND SO THIS TEXT NOW HAS ITS OWN DATE — PRIVACY_TEXT_PUBLISHED (src/lib/compliance/privacy-updated.ts; D12,
 * owner 2026-10-08: one dated /privacy update, shipped with the Sign in with Apple dark deploy). It dates the Apple
 * rows (the recipient, the account information, the email hash Meta no longer gets for Apple accounts, Apple among
 * the sign-in choices counted) AND the teacher paragraph above, which ride that deploy rather than an amendment's.
 * LAST_UPDATED prints the LATER of it and LEGAL_AMENDMENT.published, so a future Terms amendment that re-dates
 * /privacy still does. ⛔ THE GATE HOLDS THE DAY, NOT THE CHANGE (commit gate B1, opus): legal-amendment-gate.sh
 * refuses a deploy whose new PRIVACY_TEXT_PUBLISHED is not today in Vietnam, but nothing notices a later edit to this
 * text that leaves the date alone — so re-date it, in that deploy's commit, with any change here that ships outside
 * an amendment.
 * ⛔ TEACHER JOB MATCHING (2026-10-09) rides the same date: the Anthropic (Claude) recipient row, its purpose and the
 * automated-decisions paragraph shipped the same Vietnamese day as the Apple rows, so PRIVACY_TEXT_PUBLISHED
 * (2026-10-09) dates them too — the owner's call ("apply recommended": immediate). Its parallel record
 * (PRIVACY_AMENDMENT) was dropped for this one, already live.
 * ⛔ AND THE e-VISA SUBCATEGORY (owner, 2026-10-14) rides it too: the shared "Messages to e-Visa sellers" paragraph and
 * the partner e-Visa section's narrowed first sentence (src/lib/privacy-partner-visa-copy.ts), live with the deploy —
 * PRIVACY_TEXT_PUBLISHED is that deploy's day. (The /prohibited amendment in the same deploy has its own record and
 * window, PROHIBITED_AMENDMENT — it does not date this page.)
 * ⛔ AND THE IDENTITY CHANGE (owner, 2026-10-15 — not material: live with the deploy, no 5-day window): a verified
 * identity counts in the trust score while it is current, every account, both editions (the identity and trust
 * paragraphs; "a selfie" — the paper code went 2026-09-04; "điểm uy tín" throughout the Vietnamese), and in the same
 * deploy the teacher's "Identity verified" mark (the teacher paragraph and its consent purpose) — an OPT-IN in that
 * deploy (efc3e64c9), AUTOMATIC since the next one (below). PRIVACY_TEXT_PUBLISHED is that deploy's day.
 * ⛔ AND THE MARK BECAME AUTOMATIC (owner, 2026-10-16: "if they verify it should be auto not need to ask they consent by
 * uploading kyc"; the 5-day promise in "Changes to this policy": "On deploy" — treated as NOT material, the owner's call,
 * recorded with counsel's question in docs/compliance/pdpl-dossier-draft.md): the identity paragraph's pointer, the
 * teacher paragraph (shown while current and the name matches, never the document, hidden at any time — before
 * publishing too — the declaration as its record, and the identity-v1 cohort shown on the same terms), the consent
 * purpose, and the general basis's "off until you turn it on", which now carves the mark out. The date the text gives
 * for the earlier declaration's last day is identity-v2's `effective` (declaration-text.ts — page.test.tsx holds
 * them together). PRIVACY_TEXT_PUBLISHED is that deploy's day.
 */
// ISO dates compare as strings.
const LAST_UPDATED_ON = LEGAL_AMENDMENT.published > PRIVACY_TEXT_PUBLISHED ? LEGAL_AMENDMENT.published : PRIVACY_TEXT_PUBLISHED
const LAST_UPDATED = {
  en: `Last updated: ${dateEn(LAST_UPDATED_ON)}`,
  vi: `Cập nhật lần cuối: ${dateVi(LAST_UPDATED_ON)}`,
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
