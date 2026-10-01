import { VISA_PROVIDER, PROVIDER_OF_RECORD } from '@/lib/visa-provider'

/**
 * SERVICES-EDITION-ONLY PRIVACY COPY — the paragraphs of /privacy that describe visa-applicant data.
 *
 * ⚠️ WHY THIS IS A MODULE AND NOT A BRANCH INSIDE THE PAGE. src/app/[lang]/privacy/page.tsx is ONE file
 * rendered by BOTH editions (a privacy policy cannot 404 on the licensed marketplace), so a
 * marketplace build compiles it. `IS_SERVICES ? a : b` inside that page stops the RENDER but leaves
 * every literal in the artifact — measured in src/lib/edition.ts. Moving the literals behind a
 * module boundary lets next.config.ts alias the lot to an empty stub on a marketplace build, which
 * is the only mechanism that removes strings rather than declining to render them. Same pattern,
 * same reason, as src/lib/edition-services-copy.ts.
 *
 * ⚠️ AND THERE IS A SECOND PATH OUT THAT IS EASY TO WALK INTO. scripts/gen-ui-strings.mjs harvests
 * `<Tr text="…">` JSX literals into src/generated/ui-strings.ts, which is SHIPPED TO THE BROWSER to
 * pre-warm translations. /privacy happens to render its paragraphs from an array (`<Tr text={p} />`),
 * which the harvester does not match — measured 2026-08-01: not one of that page's paragraphs is in
 * the catalogue. So that path is not open TODAY. It opens the moment somebody adds a sentence the
 * obvious way, as a `<Tr text="…">` literal in the JSX, and then the words are in the one file every
 * eno.vn visitor downloads on every page. Keeping the vocabulary in an aliased module closes both
 * paths and does not depend on anyone remembering which shape is safe.
 *
 * ⚠️ THE HARVESTER DOES NOT SEE THESE STRINGS EITHER, and that is the intended trade: they are plain
 * `{ en, vi }` object fields, so they enter NEITHER catalogue. Since 2026-10-01 every paragraph carries
 * an AUTHORED Vietnamese beside the English, and the page renders the pair with tr(en, vi)
 * (src/components/legal/legal-text.tsx) — a Vietnamese reader gets this text, never a machine
 * translation of it. Do NOT "simplify" that by wrapping them in tr('…', '…') literals here; that would
 * put the vocabulary straight back into the catalogue the alias exists to keep it out of.
 * ⚠️ The Vietnamese is a reviewed-translation draft until counsel signs it off (LEGAL_VI_APPROVED in
 * site-legal.ts); change both languages together.
 *
 * ⚠️ EVERY EXPORT IS AN ARRAY, DELIBERATELY. The page splices them in with
 * `...(IS_SERVICES ? X : [])`, so if a gate is ever dropped, the marketplace build renders the STUB's
 * empty arrays — nothing appears rather than an empty heading. Belt and braces: the alias controls
 * the artifact, the gate controls behaviour, and neither is trusted alone.
 *
 * ⚠️ THE STUB IS NOT TYPE-CHECKED AGAINST THIS FILE. An alias is a bundler resolution; `tsc` only
 * ever sees this module. Adding an export here and using it in the page is a green typecheck and a
 * crash on eno.vn. src/components/marketplace/edition-stubs.test.ts pins the two export surfaces
 * together — add an export here, add it there.
 *
 * ⚠️ ACCURACY NOTES, so nobody softens or hardens these claims by guesswork. Each of the factual
 * statements below was read out of the code, not assumed:
 *   · encryption — src/lib/visa/crypto.ts stores applicant payloads as AES-256-GCM envelopes and
 *     FAILS CLOSED (`visa_encryption_not_configured`) when the key is absent, so "stored encrypted"
 *     has no plaintext fallback path to be wrong about;
 *   · private storage — src/lib/visa/storage.ts uploads to a private bucket and hands out 300-second
 *     signed URLs to owner/admin-gated callers only;
 *   · automated checks — src/lib/visa/image-quality.ts, image-normalization.ts and mrz.ts, AND an AI read:
 *     src/app/api/visa/applications/[id]/extract/route.svc.ts:241-244 sends the passport-page or portrait
 *     image bytes (inlineData) to Gemini through getGemini() — src/lib/gemini.ts:60, location 'global',
 *     i.e. OUTSIDE Vietnam. Only kinds 'passport' | 'portrait' (route :33); supporting documents are not
 *     sent. That is why PRIVACY_SERVICES_RECIPIENTS names Google and the checks paragraph names Gemini;
 *     the marketplace Google row cannot say it (this module is the only place the words may live);
 *   · retention — src/app/api/cron/visa-retention writes nothing itself: `retention_until` is set on
 *     the TERMINAL transitions only, and the sweep deletes objects fail-closed before the row. That
 *     is why the copy says the window starts at the final outcome and DOES NOT NAME A NUMBER OF
 *     DAYS. Do not add one here — the number lives in the data, changes without touching this file,
 *     and a policy that promises the wrong one is a false statement rather than a stale comment.
 */

/** One paragraph, authored in both languages. */
export type PrivacyText = { en: string; vi: string }

/**
 * A section of the policy, in the page's own shape: [anchor id, title, paragraphs].
 *
 * ⚠️ THE ID IS CARRIED, NOT DERIVED FROM POSITION. /privacy used to build anchors as `s${index}`,
 * and this array is spliced into the MIDDLE of the page on the services edition — so `#s5` pointed
 * at a different section on each edition and re-pointed again whenever a section was added. Privacy
 * anchors get quoted in rights requests and complaint threads; they have to keep meaning the same
 * thing. /terms carries its ids for the same reason.
 */
export type PrivacySection = [string, PrivacyText, PrivacyText[]]

const B = VISA_PROVIDER.brand

/** Appended to "Who is responsible for your data" — the one place eno is a PROCESSOR, not a controller. */
export const PRIVACY_SERVICES_CONTROLLER: PrivacyText[] = [
  {
    en: `There is one exception to the paragraph above. For a Vietnam e-visa application, ${B} — the licensed travel company that actually performs the service — is the data controller for the application dossier, and we act as its data processor: we collect and check the documents on its instructions and pass them on. What that means in practice is set out under “Visa applications” below.`,
    vi: `Có một ngoại lệ đối với đoạn trên. Với hồ sơ xin e-visa Việt Nam, ${B} — doanh nghiệp lữ hành có giấy phép, là bên trực tiếp thực hiện dịch vụ — là bên kiểm soát dữ liệu đối với hồ sơ đó, còn chúng tôi là bên xử lý dữ liệu cho ${B}: chúng tôi thu thập, kiểm tra giấy tờ theo chỉ dẫn của ${B} và chuyển giao lại. Nội dung cụ thể được trình bày tại mục “Hồ sơ thị thực” bên dưới.`,
  },
]

/** Appended to "What personal data we collect". */
export const PRIVACY_SERVICES_COLLECT: PrivacyText[] = [
  {
    en: 'Visa application information: if you apply for a Vietnam e-visa through this site, we collect the applicant’s identity documents and the details the application requires. Some of that is sensitive personal data under Vietnamese law, so it is described separately in the next section rather than buried in this list.',
    vi: 'Thông tin hồ sơ thị thực: nếu bạn xin e-visa Việt Nam qua website này, chúng tôi thu thập giấy tờ tùy thân của người xin thị thực và các thông tin mà hồ sơ yêu cầu. Một phần trong đó là dữ liệu cá nhân nhạy cảm theo pháp luật Việt Nam, nên được trình bày riêng ở mục tiếp theo thay vì gộp vào danh sách này.',
  },
]

/** Appended to "Why we use your data, and on what basis". */
export const PRIVACY_SERVICES_PURPOSES: PrivacyText[] = [
  {
    en: `To collect, check and hand over a visa application dossier to ${B} so the service you asked for can be performed — on your express consent, and on that company’s instructions as the controller of that dossier.`,
    vi: `Để thu thập, kiểm tra và chuyển hồ sơ xin thị thực cho ${B} nhằm thực hiện dịch vụ bạn yêu cầu — trên cơ sở sự đồng ý rõ ràng của bạn, và theo chỉ dẫn của doanh nghiệp đó với tư cách bên kiểm soát hồ sơ.`,
  },
]

/** Appended to "Who else receives your data" (after the recipients table). */
export const PRIVACY_SERVICES_RECIPIENTS: PrivacyText[] = [
  {
    en: `${B}, the licensed Vietnamese travel company that provides the e-visa service listed on this site, receives the applicant’s documents and application details so it can prepare and submit the application. It is the controller for that dossier and handles it under its own privacy policy and its own obligations under Vietnamese law. We pass it nothing else about you — not your listings, your messages, or your activity on the site.`,
    vi: `${B} — doanh nghiệp lữ hành Việt Nam có giấy phép, cung cấp dịch vụ e-visa niêm yết trên website này — nhận giấy tờ và thông tin hồ sơ của người xin thị thực để chuẩn bị và nộp hồ sơ. ${B} là bên kiểm soát đối với hồ sơ đó và xử lý hồ sơ theo chính sách quyền riêng tư cũng như nghĩa vụ pháp lý của chính mình theo pháp luật Việt Nam. Chúng tôi không chuyển cho ${B} bất kỳ thông tin nào khác về bạn — không tin đăng, không tin nhắn, không hoạt động của bạn trên website.`,
  },
  {
    // extract/route.svc.ts:241-244 (inlineData → generateContent) · gemini.ts:60 (location 'global')
    en: 'Google (Vertex AI, Gemini — Google’s global endpoint, outside Vietnam) receives the image of the passport data page and the portrait photograph you upload, to check image quality and read the form fields.',
    vi: 'Google (Vertex AI, Gemini — điểm truy cập toàn cầu, ngoài Việt Nam) nhận ảnh trang thông tin hộ chiếu và ảnh chân dung bạn tải lên để kiểm tra chất lượng ảnh và đọc các trường thông tin.',
  },
  {
    // ⛔ THE ONE META CONVERSIONS API EVENT THE SHARED RECIPIENTS ROW CANNOT NAME (edition boundary).
    // api/visa/applications/start/route.svc.ts:113-120 → sendMetaCapiEvent('InitiateCheckout') with
    // custom_data { content_category: 'evisa', content_name: 'Vietnam e-Visa application' } and
    // user_data from metaUserDataFromHeaders(req.headers, { externalId: profile.id }) — NO email, NO phone.
    // meta-capi.ts:59-68 hashes external_id (SHA-256) and adds client_ip_address, client_user_agent and
    // fbp/fbc raw from the request cookies (:81-89); event_source_url = the Referer. It fires once
    // startVisaDmFlow succeeds — a case created, or the caller's own open case reused (same event_id
    // `visa-start-<applicationId>`, so Meta dedups) — past auth, encryption gate and rate limit; meta-capi.ts:112-114
    // makes it a no-op unless the request carried consent v2 `d` (Advertising). Nothing from the dossier
    // is in the payload. Change the route's payload → change this paragraph.
    en: 'Meta (Conversions API) — only if you switch on Advertising: when you start a Vietnam e-visa application, or open again one you already started, Meta is told that an application was started, with your account identifier scrambled (hashed), your IP address and browser details, the address of the page you were on, and Meta’s own browser cookies (_fbp, _fbc) if your browser already holds them — never the application details or documents.',
    vi: 'Meta (Conversions API) — chỉ khi bạn bật Quảng cáo: khi bạn bắt đầu một hồ sơ xin e-visa Việt Nam, hoặc mở lại một hồ sơ bạn đã bắt đầu trước đó, Meta được thông báo rằng một hồ sơ đã được bắt đầu, kèm mã tài khoản của bạn đã được xáo trộn (băm), địa chỉ IP và thông tin trình duyệt, địa chỉ trang bạn đang xem, và cookie trình duyệt của chính Meta (_fbp, _fbc) nếu trình duyệt của bạn đã có sẵn — không bao giờ kèm thông tin hồ sơ hay giấy tờ.',
  },
]

/** Appended to "How long we keep your data". */
export const PRIVACY_SERVICES_RETENTION: PrivacyText[] = [
  {
    en: 'Visa application data follows the separate schedule described under “Visa applications”: a retention window starts when the application reaches a final outcome, and at the end of it the documents, the application details and the issued visa file are deleted automatically. Identity documents are not kept indefinitely.',
    vi: 'Dữ liệu hồ sơ thị thực theo lịch lưu trữ riêng được trình bày tại mục “Hồ sơ thị thực”: thời hạn lưu trữ bắt đầu khi hồ sơ có kết quả cuối cùng, và khi hết thời hạn, giấy tờ, thông tin hồ sơ và tệp thị thực đã cấp được xóa tự động. Giấy tờ tùy thân không được lưu giữ vô thời hạn.',
  },
]

/**
 * Whole sections spliced into the policy, services edition only.
 *
 * Placed after "What personal data we collect" by the page, because it is the detail that section
 * points at. The first paragraph is PROVIDER_OF_RECORD so the "who is answerable" sentence is
 * authored once, in src/lib/visa-provider.ts, and cannot drift between the legal pages.
 */
export const PRIVACY_SERVICES_SECTIONS: PrivacySection[] = [
  [
    'visa-applications',
    { en: 'Visa applications: documents, consent and the provider', vi: 'Hồ sơ thị thực: giấy tờ, sự đồng ý và đơn vị cung cấp' },
    [
      { en: PROVIDER_OF_RECORD.en, vi: PROVIDER_OF_RECORD.vi },
      {
        en: 'To prepare a Vietnam e-visa application we collect: an image of the applicant’s passport data page, a portrait photograph, and the details the immigration authorities require on the form — full name, date and place of birth, sex, nationality, passport number with its issue and expiry dates, intended dates and port of entry and exit, address in Vietnam, and contact details. Where the application type calls for them, we also collect supporting documents you upload.',
        vi: 'Để chuẩn bị hồ sơ xin e-visa Việt Nam, chúng tôi thu thập: ảnh trang thông tin hộ chiếu của người xin thị thực, ảnh chân dung, và các thông tin cơ quan quản lý xuất nhập cảnh yêu cầu trên tờ khai — họ và tên, ngày và nơi sinh, giới tính, quốc tịch, số hộ chiếu cùng ngày cấp và ngày hết hạn, thời gian và cửa khẩu dự kiến nhập cảnh, xuất cảnh, địa chỉ tại Việt Nam và thông tin liên hệ. Khi loại hồ sơ yêu cầu, chúng tôi cũng thu thập các giấy tờ bổ sung do bạn tải lên.',
      },
      {
        en: 'Identity-document images and a portrait photograph used to identify a person are sensitive personal data under Vietnamese law. We process them only on your express consent, given separately for this purpose and before anything is uploaded, and only to prepare and submit the application. You can withdraw that consent at any time; if you withdraw it while an application is in progress, we and the provider stop processing the dossier, which means the application cannot be completed.',
        vi: 'Ảnh giấy tờ tùy thân và ảnh chân dung dùng để nhận dạng một người là dữ liệu cá nhân nhạy cảm theo pháp luật Việt Nam. Chúng tôi chỉ xử lý các dữ liệu này khi có sự đồng ý rõ ràng của bạn, được đưa ra riêng cho mục đích này và trước khi tải lên bất kỳ tệp nào, và chỉ để chuẩn bị và nộp hồ sơ. Bạn có thể rút lại sự đồng ý bất cứ lúc nào; nếu rút lại khi hồ sơ đang được xử lý, chúng tôi và đơn vị cung cấp sẽ ngừng xử lý hồ sơ, đồng nghĩa với việc hồ sơ không thể hoàn tất.',
      },
      {
        en: `Application details are stored in encrypted form, and document images are held in private storage that is not reachable from the internet — they can only be opened through short-lived links issued to you, to our reviewers, and to ${B}. What is handed to ${B} is limited to what the application needs: the passport image, the portrait, and a data sheet of the form fields.`,
        vi: `Thông tin hồ sơ được lưu trữ dưới dạng mã hóa, và ảnh giấy tờ được lưu trong kho lưu trữ riêng không truy cập được từ internet — chỉ có thể mở qua đường dẫn ngắn hạn cấp cho bạn, cho người rà soát của chúng tôi và cho ${B}. Những gì chuyển cho ${B} chỉ giới hạn ở mức hồ sơ cần: ảnh hộ chiếu, ảnh chân dung và bảng dữ liệu các trường của tờ khai.`,
      },
      {
        en: 'Uploaded documents are checked automatically before they are handed over — the passport page and the portrait using Google’s Gemini AI model as well as our own checks — for readability, image quality, portrait requirements, and consistency between the photo of the passport and the details on the form. A check can block or flag an upload. If you think an automated check has got it wrong, write to us and a person will review it.',
        vi: 'Giấy tờ tải lên được kiểm tra tự động trước khi chuyển giao — ảnh trang hộ chiếu và ảnh chân dung được kiểm tra bằng mô hình AI Gemini của Google cùng các bước kiểm tra của chính chúng tôi — về độ rõ, chất lượng ảnh, yêu cầu đối với ảnh chân dung, và sự khớp nhau giữa ảnh hộ chiếu và thông tin trên tờ khai. Một bước kiểm tra có thể chặn hoặc gắn cờ tệp tải lên. Nếu bạn cho rằng việc kiểm tra tự động bị sai, hãy viết cho chúng tôi và một nhân viên sẽ xem xét lại.',
      },
      {
        en: `Payment for the visa service is taken by ${B} on its own systems. We never receive or store your card or bank details.`,
        vi: `Việc thanh toán phí dịch vụ thị thực do ${B} thực hiện trên hệ thống của mình. Chúng tôi không bao giờ nhận hay lưu thông tin thẻ hoặc tài khoản ngân hàng của bạn.`,
      },
      {
        en: 'When the application reaches a final outcome — issued, refused or cancelled — a retention window starts. At the end of it the documents, the application details and the issued visa file are deleted from our systems automatically, and the download link stops working. That deletion is the point: we do not hold identity documents longer than the service needs them. Copies held by the provider after the handover are governed by its own retention obligations as controller.',
        vi: 'Khi hồ sơ có kết quả cuối cùng — được cấp, bị từ chối hoặc bị hủy — thời hạn lưu trữ bắt đầu. Khi hết thời hạn, giấy tờ, thông tin hồ sơ và tệp thị thực đã cấp được xóa tự động khỏi hệ thống của chúng tôi, và đường dẫn tải xuống ngừng hoạt động. Việc xóa đó chính là mục đích: chúng tôi không giữ giấy tờ tùy thân lâu hơn mức dịch vụ cần. Bản sao do đơn vị cung cấp lưu giữ sau khi chuyển giao chịu sự điều chỉnh của nghĩa vụ lưu trữ của chính đơn vị đó với tư cách bên kiểm soát.',
      },
    ],
  ],
]
