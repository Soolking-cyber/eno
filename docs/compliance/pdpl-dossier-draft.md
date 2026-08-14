<!--
⚠️ DRAFT — NOT FILED, NOT LEGAL ADVICE. Prepared 2026-08-14 from the live codebase and the
production database, for review by Vietnamese counsel before lodgement with A05, Bộ Công an.

Three [OWNER INPUT] fields cannot be filled until the ERC is issued (expected week of 2026-08-21).
Section 7 lists what blocks filing. The owner deferred those to nearer MOIT issuance (2026-08-14):
the 14 VietKite e-visa listings stay visible for now, and the pre-launch purge runs later.
-->

# HỒ SƠ BẢO VỆ DỮ LIỆU CÁ NHÂN — eno.vn
### Personal Data Protection filing pack · sàn giao dịch thương mại điện tử (classified-ads marketplace)
**Bản thảo ngày 14/08/2026 · Draft of 14 August 2026 · For Vietnamese counsel review before lodgement**

---

# 0. HƯỚNG DẪN SỬ DỤNG
## How to use this

**What this is.** A filled factual dossier for two filings under Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15: the **processing impact assessment** (Điều 21) and the **cross-border transfer impact assessment** (Điều 20). Every factual field is filled from the live system, measured against the code and the production database on 14/08/2026. Three fields are `[OWNER INPUT]` placeholders because the legal entity does not exist yet.

**What this is not.** It is not the official form. **⚠️ The form set changed.** The prompt for this work named Mẫu số 03 and Mẫu số 04 of Nghị định 13/2023/NĐ-CP. Verification (secondary sources, 14/08/2026) says those are **superseded**: Nghị định **356/2025/NĐ-CP** of 31/12/2025 — 5 chương, 42 điều, 1 phụ lục with 10 forms — replaces Decree 13's form system entirely, and the operative templates are now:

| Filing | Form under NĐ 356/2025 | Article | Deadline |
|---|---|---|---|
| Đánh giá tác động xử lý DLCN | **Mẫu số 10** + submission notice **Mẫu số 02a/02b** | Điều 19 | 60 ngày kể từ ngày tiến hành xử lý |
| Đánh giá tác động chuyển DLCN ra nước ngoài | **Mẫu số 09** + submission notice **Mẫu số 01a/01b** | Điều 18 | 60 ngày kể từ ngày tiến hành chuyển |
| Cập nhật hồ sơ / update | both | Điều 20 | định kỳ 06 tháng; **10 ngày** khi có thay đổi bên kiểm soát/xử lý |

Each dossier is **01 bộ bản gốc** to **Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao (A05), Bộ Công an**, online / bưu chính / trực tiếp. Each also requires two attachments beyond the report: **bản sao hợp đồng hoặc thỏa thuận về việc xử lý dữ liệu cá nhân** (the DPAs) and **chính sách, quy trình, quy định về bảo vệ dữ liệu cá nhân**. See §7 gap 5 — the DPAs are the component most likely to be missing.

**[COUNSEL] — confirm the article numbers and form numbers against the Công báo text of NĐ 356/2025 before transcription.** Sources consulted disagreed between Điều 17 and Điều 19 for the processing dossier. Everything below is written so it can be transcribed into whichever template is authoritative; the content, not the layout, is the work product.

**Who does what next.**

| Step | Owner | Blocking |
|---|---|---|
| 1. Issue ERC (Giấy CN ĐKKD) | Owner — expected week of 21/08/2026 | Everything |
| 2. Fill the three `[OWNER INPUT]` fields; flip `OPERATOR_REGISTERED` in `src/lib/site-legal.ts:…` so /privacy stops saying "not yet filed" | Owner + engineering | §1, §2, §3 |
| 3. Run `node scripts/purge-pre-launch-data.mjs --execute --with-storage`; keep `purge-receipt-YYYY-MM-DD.json` | Engineering | §2.7 evidence |
| 4. Close the §7 blockers | Engineering | Lodgement |
| 5. Countersign DPAs with each recipient in Appendix B | Counsel | Dossier attachment |
| 6. Transcribe §2 into Mẫu số 10, §3 into Mẫu số 09; sign + seal by người đại diện theo pháp luật | Counsel | Lodgement |
| 7. Lodge with A05 within 60 days of the first real-user processing / first transfer | Counsel | — |

**Filing window.** ERC ~21/08/2026. Real-user processing begins ≈40 days after ERC, i.e. **≈ end of September 2026** (after MOIT registration). The 60-day clock runs from **the date processing actually starts**, so the outer deadline is **≈ end of November 2026**. The pre-launch data purge is what makes "processing started on <date>" a defensible statement rather than an assertion — see §2.7. **[COUNSEL] — does today's pre-launch working data (measured below) already start the clock? The purge limits ongoing processing; it does not un-transfer what already crossed a border.**

**Reading convention.** *MEASURED* = read from the code or from the production database on 13–14/08/2026, with `file:line` or `table.column`. *INFERRED* = derived, not directly observed. `[COUNSEL]` = needs a legal judgement. `[OWNER INPUT]` = a fact only the owner has. `[VERIFY]` = a fact we could not observe from this checkout (production environment variables, provider retention settings).

---

# 1. THÔNG TIN BÊN KIỂM SOÁT DỮ LIỆU
## Controller details — common header for both dossiers

### 1.1 Bên Kiểm soát dữ liệu cá nhân / Personal data controller

| Trường / Field | Nội dung / Content |
|---|---|
| Tên tổ chức (tiếng Việt) | **[OWNER INPUT — tên công ty đúng như trên ĐKKD]** *(currently `Công ty TNHH ENO (đang đăng ký thành lập)` as a placeholder in `src/lib/site-legal.ts`)* |
| Tên tiếng Anh | **[OWNER INPUT — English rendering of the same legal entity]** |
| Số ĐKKD / mã số doanh nghiệp | **[OWNER INPUT — ERC number]** |
| Nơi cấp, ngày cấp | **[OWNER INPUT — issuing authority and date]** |
| Địa chỉ trụ sở chính | **[OWNER INPUT — registered head office address]** *(placeholder: TP. Hồ Chí Minh, Việt Nam)* |
| Website | https://eno.vn |
| Điện thoại | **[OWNER INPUT]** |
| Email liên hệ | support@eno.vn |
| Lĩnh vực hoạt động | Sàn giao dịch thương mại điện tử — nền tảng đăng tin rao vặt kết nối người mua và người bán (classified-ads marketplace). **Không thu hộ, không giữ tiền, không xử lý thanh toán.** |
| Loại hình vai trò | **Bên Kiểm soát và xử lý dữ liệu cá nhân** (controller-and-processor) — eno both decides purposes and carries out the processing itself. Users' listings and messages are processed on their behalf on the platform. **[COUNSEL] — confirm the role label the form expects.** |

### 1.2 Người đại diện theo pháp luật / Legal representative

| Trường | Nội dung |
|---|---|
| Họ và tên | **Shanazar Babakulyyev** |
| Chức vụ | Giám đốc / Director; Người đại diện theo pháp luật |
| Quốc tịch | **[OWNER INPUT]** |
| Số giấy tờ tùy thân | **[OWNER INPUT]** |
| Điện thoại | **[OWNER INPUT]** |
| Email | support@eno.vn |
| Quan hệ với chủ sở hữu | Employee. The company is owned by a Vietnamese entity; Mr Babakulyyev is an employee, director and legal representative. |

### 1.3 Bộ phận / nhân sự bảo vệ dữ liệu cá nhân (DPO)

| Trường | Nội dung |
|---|---|
| Họ và tên | **Shanazar Babakulyyev** |
| Chức vụ | Nhân sự bảo vệ dữ liệu cá nhân (kiêm nhiệm) |
| Điện thoại / Email | **[OWNER INPUT]** / support@eno.vn |
| Kênh tiếp nhận yêu cầu của chủ thể dữ liệu | support@eno.vn — published at /privacy, /terms and the site footer. Acknowledged within 2 working days. |

> **⚠️ [COUNSEL] — the DPO designation is the most likely bounce in §1.** Nghị định 356/2025/NĐ-CP **Điều 13** sets qualification conditions for nhân sự bảo vệ dữ liệu: *"có trình độ cao đẳng trở lên"*, *"ít nhất 02 năm kinh nghiệm"* in pháp chế / CNTT / an ninh dữ liệu, and *"đã được đào tạo kiến thức pháp luật và kỹ năng chuyên môn về bảo vệ dữ liệu"*. Two questions follow:
> 1. Does Mr Babakulyyev's record evidence the degree, the two years, and the training? If the training certificate is missing, obtain it before lodging — it is a documentary condition, not a judgement call.
> 2. **Is it acceptable for the same natural person to be director, legal representative and DPO?** A DPO who reports to himself has no independence. The law does not obviously prohibit it for an SME, but a reviewing officer may read the combination as a defect. If the answer is no, the smallest fix is to name a second employee as DPO with Mr Babakulyyev remaining legal representative.

---

# 2. HỒ SƠ ĐÁNH GIÁ TÁC ĐỘNG XỬ LÝ DỮ LIỆU CÁ NHÂN
## Processing impact assessment — Điều 21 Luật 91/2025 · Mẫu số 10, Điều 19 NĐ 356/2025

### 2.1 Thông tin các bên liên quan / Parties

- **Bên Kiểm soát và xử lý dữ liệu cá nhân:** as §1.1.
- **Bên Xử lý dữ liệu cá nhân (processors acting for eno):** Google Cloud (Google Asia Pacific Pte. Ltd.), Supabase Inc. (on AWS ap-southeast-1), Cloudflare Inc., Microsoft (Azure Translator), Resend Inc., Telegram Gateway, Meta Platforms (WhatsApp Business), VNG Corporation (Zalo ZNS). Full detail, per-recipient, in **Phụ lục B**.
- **Bên thứ ba (independent controllers receiving data with consent only):** Google LLC (Google Analytics 4), Meta Platforms Inc. (Conversions API). Both are switched off unless the user selects the "Allow all" consent tier.
- **Chủ thể dữ liệu / data subjects:** registered users of eno.vn (buyers, sellers, both — the same account can be either), and non-registered visitors whose technical data reaches the edge and the logs. eno.vn serves the Vietnamese market with a substantial foreign-resident audience; the majority of subjects are expected to be **công dân Việt Nam**.

### 2.2 Mục đích xử lý dữ liệu cá nhân / Purposes

| # | Mục đích | Căn cứ pháp lý / Basis |
|---|---|---|
| 1 | Tạo và bảo vệ tài khoản, xác thực đăng nhập (email magic link, mật khẩu, Google OAuth, OTP qua Zalo / WhatsApp / Telegram) | Thực hiện hợp đồng + sự đồng ý |
| 2 | Đăng tải, kiểm duyệt tự động và hiển thị tin rao vặt; tìm kiếm và duyệt tin | Thực hiện hợp đồng |
| 3 | Kết nối người mua với người bán: trò chuyện 1:1 trong ứng dụng, chào giá (offer), tiết lộ số điện thoại người bán theo yêu cầu | Thực hiện hợp đồng |
| 4 | Xác nhận giao dịch hai chiều (người bán đánh dấu đã bán, người mua xác nhận) và lưu hồ sơ giao dịch | Nghĩa vụ pháp lý (Luật TMĐT 122/2025 — lưu trữ dữ liệu hợp đồng 3 năm) |
| 5 | Đánh giá người bán, điểm tin nhiệm (trust score), thứ hạng hiển thị | Lợi ích chính đáng / thực hiện hợp đồng — **[COUNSEL]** |
| 6 | Phòng chống gian lận và lạm dụng: báo cáo vi phạm, phòng tranh chấp, chế tài, chống né lệnh cấm, giới hạn tần suất | Nghĩa vụ pháp lý + bảo vệ quyền lợi chủ thể khác |
| 7 | Thu thập danh tính pháp lý người bán (họ tên, địa chỉ, số CCCD/ĐKKD, mã số thuế) và cung cấp cho người mua khi được yêu cầu và cho cơ quan nhà nước | Nghĩa vụ pháp lý (NĐ 52/2013 Đ.29; Luật TMĐT 122/2025) |
| 8 | Xác minh doanh nghiệp (tải lên giấy tờ định danh + giấy tờ ngân hàng để nhân viên xét duyệt) | Sự đồng ý rõ ràng, có ghi nhận `SellerVerification.consentAt` + `consentVersion` |
| 9 | Thông báo: trong ứng dụng, web push, email (thư tóm tắt hằng tuần, nhắc tin còn hàng, cảnh báo tìm kiếm đã lưu) — mỗi luồng có cơ chế từ chối riêng | Sự đồng ý, rút lại bất kỳ lúc nào |
| 10 | Dịch máy nội dung tin đăng và giao diện sang ngôn ngữ người dùng chọn | Thực hiện hợp đồng |
| 11 | Trợ lý AI: phân loại ảnh, chỉnh sửa mô tả, tìm kiếm bằng hình ảnh, trợ lý mua sắm (Google Vertex AI / Gemini; Vertex AI Search) | Sự đồng ý — đăng nhập bắt buộc, có hạn mức |
| 12 | Xác định vị trí để sắp xếp tin theo khoảng cách và hiển thị bản đồ | **Sự đồng ý rõ ràng** (quyền của trình duyệt) — dữ liệu vị trí là DLCN **nhạy cảm** |
| 13 | Trung tâm trợ giúp: hỏi–đáp có thể bình chọn, bình luận, lưu và báo cáo | Thực hiện hợp đồng |
| 14 | Đo lường và quảng cáo: Google Analytics 4, Meta Conversions API (server-side) | **Chỉ khi có sự đồng ý ở mức "Allow all"**; mặc định TẮT, kể cả phía máy chủ |
| 15 | Nhật ký kỹ thuật (IP, user-agent) để giới hạn tần suất và chặn lạm dụng | Lợi ích chính đáng / an ninh hệ thống |

**Không bán, không trao đổi dữ liệu cá nhân.** eno does not sell personal data and operates no data brokerage. Ranking is disclosed in full at `/legal/ranking` and **does not use** the reader's personal data, browsing history, demographics, nationality or device to reorder results — two people running the same search see the same order (MEASURED: `docs/compliance-2026.md §4.1`, generated from `src/lib/ranking-formula.ts`).

### 2.3 Xử lý dự kiến trong tương lai / Planned future processing

> Bên Kiểm soát dự kiến, sau khi hoàn tất hồ sơ này, kết nối lại một mô-đun dịch vụ thị thực điện tử (e-Visa) do đối tác được cấp phép vận hành, trong đó sẽ phát sinh việc xử lý dữ liệu định danh và giấy tờ xuất nhập cảnh của người nộp đơn. Việc này **chưa được triển khai tại thời điểm nộp hồ sơ**, và sẽ được khai báo bổ sung bằng hồ sơ cập nhật theo Điều 20 NĐ 356/2025 trước khi bắt đầu xử lý.
>
> *(The controller intends, after this filing, to reconnect an e-visa module operated by a licensed partner, which will involve processing applicant identity and travel-document data. It is not deployed at the time of filing and will be disclosed by dossier amendment before processing begins.)*

### 2.4 Các loại dữ liệu cá nhân được xử lý / Categories of personal data

Full inventory with `table.column`, classification, retention and controls: **Phụ lục A**. Summary:

**Dữ liệu cá nhân cơ bản / Basic personal data.** Email; số điện thoại; họ tên hiển thị và ảnh đại diện; @handle công khai; ngôn ngữ và tiền tệ ưa dùng; nội dung tin đăng (tiêu đề, mô tả, giá, ảnh, video, khu vực); nội dung tin nhắn 1:1 và chào giá; đánh giá và phản hồi; hồ sơ báo cáo, khiếu nại và tranh chấp; điểm tin nhiệm và toàn bộ nhật ký sự kiện tạo ra nó; tìm kiếm đã lưu; thông báo; đăng ký web push; nội dung hỏi–đáp tại Trung tâm trợ giúp; dữ liệu quy kết nguồn truy cập lần đầu (utm/referrer).

**Danh tính pháp lý người bán / Seller legal identity.** Họ tên pháp lý, địa chỉ, **số CCCD (cá nhân) hoặc số ĐKKD (doanh nghiệp)**, mã số thuế. MEASURED: `Seller.legalName` 4 rows, `Seller.idNumber` 4 rows, `Seller.legalAddress` 4 rows, `Seller.taxCode` 0 rows (14/08/2026). ⚠️ `Seller.idNumber` is stored **in plaintext** — see §7 gap 2.

**Dữ liệu cá nhân nhạy cảm / Sensitive personal data.**
- **Dữ liệu vị trí** — `Listing.lat` / `Listing.lng` (seller-declared listing location) and, with the browser permission only, the visitor's device location used to sort by distance. Never shared with advertisers; collection stops the moment the browser permission is withdrawn.
- **Giấy tờ định danh và giấy tờ ngân hàng trong hồ sơ xác minh doanh nghiệp** — `SellerVerification.documents`, private bucket `business-verification`. MEASURED: 0 rows today; the endpoints (`/api/seller/verification`, `/api/seller/verification/documents`) are live.
- **Dữ liệu hành vi trên không gian mạng** — searches, listing views, contact reveals, saved items. Classified as sensitive in the controller's own 06/07/2026 compliance assessment and treated as opt-in. **[COUNSEL] — confirm this classification under Luật 91/2025; it drives whether the first-party "For You" rail may stay on by default.**

**Không xử lý / Not processed:** payment card or bank account data of buyers (no payment processing of any kind on eno.vn); biometric data; health data; political or religious views; criminal record data; genetic data; children's data (service is 18+; a child account is removed on notice).

### 2.5 Luồng dữ liệu / Data flow

```
Người dùng (trình duyệt / ứng dụng Capacitor)
  │  HTTPS, HSTS preload
  ▼
Cloudflare (biên toàn cầu · WAF · Turnstile · cache)      ← thấy IP, user-agent, cookie
  │
  ▼
Google Cloud Load Balancer → Cloud Run  (asia-southeast1 · SINGAPORE)   ← nơi ứng dụng chạy
  │           │                    │                  │
  │           │                    │                  └→ Cloud Logging (nhật ký truy cập)
  │           │                    └→ Secret Manager (eno-root-env)
  │           │
  │           ├→ Vertex AI · Gemini 3.7 Flash   (endpoint "global")
  │           ├→ Vertex AI Search               (location "global") — CHỈ trường công khai
  │           ├→ Cloud Translation API
  │           ├→ Azure Translator               (region southeastasia)
  │           ├→ Google/OSM geocoding
  │           ├→ Resend (email) · Telegram / WhatsApp / Zalo (OTP)
  │           ├→ Web Push (FCM / Mozilla / Apple)
  │           └→ Meta CAPI · Google Analytics   ⟨CHỈ KHI CÓ ĐỒNG Ý "Allow all"⟩
  ▼
Supabase — PostgreSQL 17.6 + Auth + Storage
   aws-1-ap-southeast-1  (AWS · SINGAPORE)
```

MEASURED: `cloudbuild.yaml:91` `--region=asia-southeast1`; DB host `aws-1-ap-southeast-1.pooler.supabase.com`; `src/lib/gemini.ts:70` `location = process.env.GEMINI_LOCATION || 'global'`; `.env` `VERTEX_SEARCH_LOCATION=global`, `AZURE_TRANSLATOR_REGION=southeastasia`.

**⚠️ Every storage and compute location is outside Vietnam.** The only Vietnam-domiciled recipient is VNG Corporation (Zalo ZNS), and it receives a phone number and a one-time code, nothing else. This is the central fact of §3 and of §8 question 2.

### 2.6 Tổ chức, cá nhân được nhận dữ liệu cá nhân / Recipients

**Phụ lục B** — one row per recipient, with country, data received, purpose, controller/processor role, safeguard and DPA status.

Beyond Appendix B, personal data is disclosed **to a competent state authority acting within its powers**, and where the law requires reporting about sellers (e.g. to the tax authority). Where permitted, the subject is told. No other disclosure occurs.

### 2.7 Thời gian bắt đầu, thời gian kết thúc xử lý / Processing period

| | |
|---|---|
| **Thời gian bắt đầu** | **[OWNER INPUT — the date real-user processing begins]**, being the date the platform opens to real users after MOIT registration (≈40 days after ERC; expected late September 2026). |
| **Thời gian kết thúc** | Không xác định — processing continues while the platform operates. Per-category retention is in Phụ lục A; deletion on request is executed within 20 days and, for the two most common rights, immediately by self-service. |

**Evidence of the pre-launch state.** All data in the production database on 14/08/2026 is pre-launch working data created by the operator and test accounts, not by real data subjects. It is purged before launch by `scripts/purge-pre-launch-data.mjs`, which writes a dated JSON receipt (`purge-receipt-YYYY-MM-DD.json`) recording per-table counts before and after, the storage objects removed, the operator and the timestamp. **That receipt is the attachment that supports "thời gian bắt đầu".**

MEASURED state to be purged, 14/08/2026:

| `auth.users` 22 | `Profile` 20 | `Seller` 12 | `Listing` 50 | `Conversation` 30 |
|---|---|---|---|---|
| `Message` 472 | `Notification` 141 | `TrustEvent` 50 | `ContactReveal` 23 | `Handle` 19 |
| `Review` 5 | `Report` 5 | `DisputeMessage` 7 | `SavedSearch` 5 | `PushSubscription` 1 |
| `Feedback` 1 | `ForumPost` 44 | `ForumProfile` 1 | `storage.objects` 242 | `publish_funnel` 9 |

Empty today, and to remain so at filing: `EnforcementAction`, `BannedIdentity`, `SellerVerification`, `identity_verifications`, `compliance_audit`, `takedown_orders`, `NativePushToken`, `identity_claim`.

⚠️ The purge **keeps** four infrastructure accounts by design: `support@eno.forum`, `support@eno.vn`, `info@vietkite.com.vn`, `info@giacmobayre.com`. See §7 gap 1 — one of those accounts owns listings that must not be live at filing.

### 2.8 Biện pháp bảo vệ dữ liệu cá nhân được áp dụng / Protection measures

Full control table with evidence: **Phụ lục C**. Headline measures, all MEASURED in the codebase:

1. **Mã hóa đường truyền.** HTTPS everywhere; `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (`next.config.ts:553`).
2. **Content-Security-Policy** with `object-src 'none'`, `frame-ancestors 'self'`, `form-action 'self'`, the Supabase host pinned to the exact project rather than a wildcard, and violation reporting to `/api/csp-report` (`next.config.ts:514–551`). Plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), payment=()`.
3. **Row Level Security bật trên toàn bộ 74 bảng của schema `public`** (MEASURED: `pg_tables.rowsecurity = true` for every row).
4. **Phân tách kho lưu trữ công khai / riêng tư.** Public: `listings`, `listing-videos`, `forum-media`. Private, unreachable from the internet and opened only by short-lived admin-gated signed URLs: `business-verification`, `evidence` (MEASURED: `storage.buckets`).
5. **Xóa siêu dữ liệu ảnh.** Every uploaded image is decoded, auto-oriented, and **all metadata including GPS is dropped** (`src/lib/core/media.ts:86`, `:230`).
6. **Không lưu IP thô cho mục đích phân tích.** Contact reveals store a salted hash and store **NULL** rather than a guessable digest when the salt is unconfigured (`src/app/api/listings/[id]/contact/route.ts:52,178`). Trending-search dedup uses a truncated SHA-1 of the IP with a ~3-day TTL (`src/app/api/search/trending/route.ts:53`). The true client IP is taken from `cf-connecting-ip` only, never a client-supplied `X-Forwarded-For` (`src/lib/client-ip.ts`).
7. **Giới hạn tần suất trên mọi điểm cuối nhạy cảm**, implemented as `SECURITY DEFINER` SQL over UNLOGGED tables with a `pg_cron` sweep every 15 minutes (MEASURED: `cron.job` id 1 = `select rl_sweep()`), and **fail-closed** on security and paid routes (`src/lib/ratelimit.ts`).
8. **AI chỉ dành cho người đã đăng nhập**, with a per-account hourly cap and a global daily ceiling, fail-closed (`src/lib/ai-guard.ts`).
9. **Chỉ mục tìm kiếm AI chứa trường công khai.** The Vertex AI Search document deliberately omits seller phone and contact data (`src/lib/vertex-search.ts:262,271`).
10. **CAPTCHA (Cloudflare Turnstile)** on OTP and magic-link send (`src/lib/turnstile-verify.ts`).
11. **Chống CSRF** — same-origin gate plus `SameSite=Lax` cookies on destructive routes; the account-deletion route additionally requires a typed confirmation.
12. **Quản lý bí mật** in GCP Secret Manager (`eno-root-env`); `.env` is never committed.
13. **Nguyên tắc tối thiểu trong nhật ký** — email addresses in application logs are masked to `a…e@domain` (`src/lib/mail.ts`).

### 2.9 Quyền của chủ thể dữ liệu / Data subject rights, and the clocks

Published at `/privacy` and implemented, not merely promised:

| Quyền | Cơ chế | Thời hạn công bố |
|---|---|---|
| Được biết | /privacy, /terms, /legal/ranking, in-product consent dialog | — |
| Đồng ý / rút lại đồng ý | Three-tier consent dialog, per-purpose, never bundled; mirrored into a cookie so **server-side** ad events obey it and fail closed without it (`src/lib/consent.ts`) | Thực hiện trong **15 ngày** |
| Truy cập / nhận bản sao | **Self-service instant JSON export** — `GET /api/account/export`, returns account, storefront, listings, saved searches, notifications, reviews written, trust events (described in plain language), conversations and messages sent; rate-limited 5/h | **10 ngày** theo luật; thực tế: tức thì |
| Chỉnh sửa | Profile and storefront editors | — |
| Xóa | **Self-service deletion** — `POST /api/account/delete`, typed `DELETE` confirmation, 3/h, deletes listings, storefront, conversations and messages, notifications, trust events, saved searches, push subscriptions, the profile and the Supabase auth user; reviews the user *wrote* are anonymised; storage objects purged best-effort with a cross-tenant guard | **20 ngày** theo luật; thực tế: tức thì |
| Hạn chế / phản đối, kể cả xử lý tự động | support@eno.vn; trust events are itemised and disputable in the dashboard | **15 ngày** |
| Được biết bên nhận dữ liệu | Phụ lục B, published in /privacy §recipients | — |
| Khiếu nại, tố cáo, khởi kiện, yêu cầu bồi thường | Stated at /privacy, including the right to go directly to A05 without contacting eno first | — |

**Giới hạn có chủ ý / deliberate limitation:** self-deletion is **blocked** while the account is `held`/`suspended` or is the target of an open report, and those users are routed to the manual support path. Rationale: evidence destruction by a party under investigation. **[COUNSEL] — confirm this is a permissible restriction and that the manual path still meets the 20-day clock.**

### 2.10 Đánh giá mức độ ảnh hưởng; hậu quả và biện pháp giảm thiểu / Impact assessment

| Rủi ro | Mức độ | Hậu quả không mong muốn | Biện pháp giảm thiểu / loại bỏ |
|---|---|---|---|
| Lộ số CCCD/ĐKKD của người bán do lưu dạng rõ | **Cao** | A national ID number is low-entropy and structured; disclosure enables impersonation and cannot be revoked | RLS; never rendered in public serialisations; **⚠️ chưa mã hóa** — see §7 gap 2. Target state: keyed HMAC with a pepper in Secret Manager, per the design already written for `identity_verifications` |
| Rò rỉ nội dung trò chuyện 1:1 | Cao | Chat may contain addresses, phone numbers and negotiation detail | RLS + participant-scoped reads; per-user hide is non-destructive; safety notes in-thread; report-from-chat path; message bodies never enter the translation cache (by-ID endpoint with `skipWrite` + 24h ephemeral cache) |
| Đánh cắp phiên / chiếm đoạt tài khoản | Cao | Full account takeover; ability to message and transact as the victim | Supabase Auth with PKCE; magic links minted server-side and pinned to the canonical origin; Turnstile on send; strict rate limits; `SameSite=Lax`; HSTS preload |
| Lạm dụng để thu thập số điện thoại người bán | Trung bình–cao | Bulk harvesting of seller phone numbers for spam or fraud | Contact reveal requires authentication; one row per (listing, viewer); **fail-closed** rate limit; official-partner storefronts share no phone at all, enforced in the single contact helper rather than at one route |
| Lộ vị trí qua siêu dữ liệu ảnh | Trung bình | A seller's home coordinates leak from an uploaded photo | **All EXIF including GPS stripped at upload** (`src/lib/core/media.ts:86`) |
| Dữ liệu bị chuyển cho bên quảng cáo ngoài ý muốn | Trung bình | Behavioural data reaching Meta/Google without consent | Browser pixel removed entirely; the only ad path is server-side CAPI, gated on a consent **cookie** the server can read, failing closed when absent |
| Quyết định tự động (điểm tin nhiệm, thứ hạng) gây bất lợi | Trung bình | A seller loses visibility or is restricted by an automated score | Ranking formula published at /legal/ranking with exact weights; every trust event is itemised and disputable; enforcement is a ladder with a one-shot appeal and a documented outcome; drift-based score decay was **removed** so a score only moves on evidence |
| Ảnh tin đăng chứa dữ liệu của người thứ ba | Thấp–trung bình | Faces, plates, house numbers of people who never used the service | Publication is the seller's own act, disclosed at post time ("what you put in a listing is published"); report-and-takedown path; ≥3 different-angle photo requirement is a quality rule, not a data rule — **[COUNSEL] on whether a face-blur duty applies** |
| Mất mát do sự cố nhà cung cấp | Thấp | Availability loss, potential data loss | Managed Postgres with provider backups **[VERIFY — confirm the Supabase plan's backup/PITR retention and record it]** |
| Vi phạm dữ liệu | — | Statutory notification duty | **Thông báo A05 trong 72 giờ** kể từ khi phát hiện, và thông báo trực tiếp cho chủ thể khi luật yêu cầu hoặc khi rủi ro thực sự tồn tại (published at /privacy; NĐ 356/2025 Điều 29) |

### 2.11 Cam kết / Commitments

Bên Kiểm soát cam kết: xử lý dữ liệu cá nhân đúng mục đích đã khai báo; áp dụng đầy đủ các biện pháp bảo vệ tại §2.8 và Phụ lục C; bảo đảm thực hiện quyền của chủ thể dữ liệu theo các mốc thời gian tại §2.9; **thông báo vi phạm cho A05 trong 72 giờ**; **cập nhật hồ sơ định kỳ 06 tháng và trong 10 ngày khi có thay đổi bên kiểm soát hoặc bên xử lý dữ liệu** (Điều 20 NĐ 356/2025); không mua bán dữ liệu cá nhân; lưu giữ hồ sơ này để phục vụ kiểm tra của cơ quan có thẩm quyền.

### 2.12 Hồ sơ kèm theo / Attachments

1. Thông báo nộp hồ sơ theo **Mẫu số 02a/02b**.
2. Bản sao **hợp đồng / thỏa thuận xử lý dữ liệu cá nhân (DPA)** với từng bên tại Phụ lục B — ⚠️ see §7 gap 5.
3. Chính sách bảo vệ dữ liệu cá nhân — bản in của https://eno.vn/privacy.
4. Điều khoản sử dụng — https://eno.vn/terms; Quy chế hoạt động sàn — https://eno.vn/regulations.
5. Công bố tiêu chí xếp hạng — https://eno.vn/legal/ranking.
6. **Biên nhận xóa dữ liệu tiền vận hành** — `purge-receipt-YYYY-MM-DD.json`.
7. Sơ đồ luồng dữ liệu (§2.5) và danh mục dữ liệu (Phụ lục A).
8. Giấy chứng nhận ĐKKD — **[OWNER INPUT]**.
9. Quyết định bổ nhiệm nhân sự bảo vệ dữ liệu cá nhân và hồ sơ chứng minh điều kiện theo Điều 13 — **[OWNER INPUT]**.

---

# 3. HỒ SƠ ĐÁNH GIÁ TÁC ĐỘNG CHUYỂN DỮ LIỆU CÁ NHÂN RA NƯỚC NGOÀI
## Cross-border transfer impact assessment — Điều 20 Luật 91/2025 · Mẫu số 09, Điều 18 NĐ 356/2025

### 3.1 Bên chuyển dữ liệu / Transferor

As §1.1. Đầu mối phụ trách việc chuyển và tiếp nhận dữ liệu: **Shanazar Babakulyyev**, contact as §1.3.

### 3.2 Bên tiếp nhận dữ liệu / Transferees

**Bảng chuyển dữ liệu đầy đủ — full transfer table.** Every row is a transfer of personal data of Vietnamese citizens outside Vietnam. All are MEASURED from the code unless marked.

| # | Bên tiếp nhận | Quốc gia / vùng lưu trữ | Loại dữ liệu chuyển | Mục đích | Vai trò | Cơ chế bảo đảm | Bằng chứng trong mã nguồn |
|---|---|---|---|---|---|---|---|
| 1 | **Supabase Inc.** (hạ tầng AWS) | **Singapore** — `aws-1-ap-southeast-1` | Toàn bộ cơ sở dữ liệu ứng dụng và kho tệp: tài khoản, mật khẩu đã băm, số điện thoại, tin đăng, ảnh, tin nhắn, đánh giá, báo cáo, danh tính pháp lý người bán | Cơ sở dữ liệu, xác thực, lưu trữ tệp | Bên Xử lý | DPA + RLS toàn bộ bảng + kho riêng tư | `DIRECT_URL` host; `storage.buckets` |
| 2 | **Google Asia Pacific Pte. Ltd. — Cloud Run** | **Singapore** — `asia-southeast1` | Mọi dữ liệu đi qua ứng dụng khi xử lý (in transit / in memory) | Máy chủ ứng dụng | Bên Xử lý | DPA | `cloudbuild.yaml:91` |
| 3 | **Google — Cloud Logging** | Singapore (cùng dự án) | Nhật ký yêu cầu: IP, user-agent, đường dẫn | Vận hành, gỡ lỗi, an ninh | Bên Xử lý | DPA; giữ **12 tháng** *(INFERRED từ `docs/compliance-2026.md §4.2`)* **[VERIFY]** | — |
| 4 | **Google — Secret Manager, Artifact Registry** | asia-southeast1 (registry), europe-west1 (build) | Không chứa dữ liệu cá nhân | Bí mật cấu hình; ảnh container | Bên Xử lý | DPA | `cloudbuild.yaml:77,157` |
| 5 | **Cloudflare, Inc.** | **Toàn cầu (anycast)** | IP, user-agent, cookie, siêu dữ liệu TLS của **mọi** yêu cầu; token Turnstile; định tuyến email đến | CDN, WAF, chống DDoS, CAPTCHA, chuyển tiếp email vào | Bên Xử lý | DPA | `src/lib/turnstile-verify.ts`; `src/lib/email-alias.ts` |
| 6 | **Google — Vertex AI (Gemini 3.7 Flash)** | **Endpoint "global"** — Google có thể xử lý tại nhiều vùng | Ảnh và mô tả tin đăng do người bán gửi; câu hỏi người dùng nhập cho trợ lý mua sắm | Phân loại ảnh, chỉnh sửa mô tả, tìm bằng hình ảnh, trợ lý mua sắm | Bên Xử lý | DPA; đăng nhập bắt buộc + hạn mức | `src/lib/gemini.ts:70,113` |
| 7 | **Google — Vertex AI Search** | **location "global"** | **Chỉ trường công khai của tin đăng** — tiêu đề, mô tả, danh mục, giá, thành phố, điểm tin nhiệm. **Không có số điện thoại người bán** | Tìm kiếm ngữ nghĩa | Bên Xử lý | DPA; tài liệu chỉ mục do mã nguồn dựng, loại trừ PII | `src/lib/vertex-search.ts:262,271` |
| 8 | **Google — Cloud Translation API** | Toàn cầu | Văn bản tin đăng và chuỗi giao diện | Dịch nội dung | Bên Xử lý | DPA; kết quả lưu đệm nội bộ (`Translation`) | `src/lib/translate.ts:27` |
| 9 | **Microsoft (Azure AI Translator)** | Endpoint toàn cầu, region **southeastasia** | Như trên (nhà cung cấp dự phòng) | Dịch nội dung | Bên Xử lý | DPA | `src/lib/translate.ts:23,187` |
| 10 | **Google — Geocoding API** *(khi có khóa)* | Toàn cầu | Tọa độ hoặc chuỗi địa chỉ do người dùng cung cấp | Chuyển tọa độ ⇄ quận/phường | Bên Xử lý | DPA; chỉ chạy khi khóa được cấu hình | `src/app/api/reverse-geocode/route.ts` |
| 11 | **OpenStreetMap Foundation (Nominatim)** | **Vương quốc Anh / EU** | Như trên — dùng khi không có khóa Google | Dự phòng chuyển tọa độ | Bên Thứ ba (dịch vụ công) | ⚠️ **Không có DPA** — dịch vụ công cộng miễn phí. **[COUNSEL]** | `src/app/api/reverse-geocode/route.ts:74` |
| 12 | **Resend, Inc.** | Hoa Kỳ / EU **[VERIFY]** | Địa chỉ email người nhận, nội dung thư (liên kết đăng nhập, thông báo, bản tin) | Gửi email giao dịch | Bên Xử lý | DPA; địa chỉ trong nhật ký được che | `src/lib/mail.ts:1` |
| 13 | **Telegram Gateway** | Ngoài Việt Nam | **Số điện thoại + mã OTP** | Gửi mã đăng nhập | Bên Xử lý | DPA **[VERIFY tồn tại]**; không bao giờ ghi log OTP | `src/lib/otp-channels.ts:84` |
| 14 | **Meta Platforms (WhatsApp Business)** | Hoa Kỳ / Ireland | **Số điện thoại + mã OTP** | Gửi mã đăng nhập cho số nước ngoài | Bên Xử lý | DPA **[VERIFY]** | `src/lib/otp-channels.ts:116` |
| 15 | **VNG Corporation (Zalo ZNS)** | **VIỆT NAM** | Số điện thoại + mã OTP | Gửi mã đăng nhập cho số Việt Nam | Bên Xử lý | Trong nước — **không phải chuyển ra nước ngoài** | `src/lib/zalo-zns.ts` |
| 16 | **Meta Platforms, Inc. — Conversions API** | Hoa Kỳ | `sha256(email)`, `sha256(số điện thoại)`, `sha256(id nội bộ)`, **IP thô**, user-agent, cookie `_fbp`/`_fbc` | Đo lường chuyển đổi quảng cáo | **Bên Thứ ba / Bên Kiểm soát độc lập** | **CHỈ khi có đồng ý "Allow all"**; máy chủ fail-closed khi không có cookie đồng ý | `src/lib/meta-capi.ts:23,44–50` |
| 17 | **Google LLC — Analytics 4** (`G-CKTZK62B0X`) | Hoa Kỳ | Client-id, lượt xem trang, sự kiện, IP | Đo lường sử dụng | **Bên Thứ ba** | **CHỈ khi có đồng ý "Allow all"**; không nạp mã cho đến khi người dùng tương tác | `src/components/marketplace/analytics-tags.tsx:22,70` |
| 18 | **Google / Mozilla / Apple — dịch vụ Web Push** | Hoa Kỳ, toàn cầu | URL endpoint đẩy + khóa `p256dh`/`auth` + nội dung thông báo | Gửi thông báo đẩy | Bên Xử lý (theo tiêu chuẩn Web Push) | VAPID; nội dung mã hóa đầu-cuối theo chuẩn | `src/lib/push.ts` |
| 19 | **Google — Firebase Cloud Messaging + Apple APNs** | Hoa Kỳ | Token thiết bị + nội dung thông báo | Đẩy thông báo cho ứng dụng gốc | Bên Xử lý | DPA. **Trạng thái: chưa hoạt động — `NativePushToken` = 0 dòng** | `src/lib/native-push.ts:63` |
| 20 | **Google — Identity Services / OAuth** | Hoa Kỳ | Email, họ tên, ảnh đại diện từ tài khoản Google | Đăng nhập bằng Google — **13/22 danh tính hiện dùng Google** | Bên Thứ ba | Người dùng chủ động chọn; phạm vi tối thiểu | `auth.identities` MEASURED |
| 21 | **Telegram / Meta (đăng bài tự động)** | Ngoài Việt Nam | Nội dung tin đăng công khai + ảnh | Phân phối tin đăng lên kênh mạng xã hội | Bên Thứ ba | Chỉ chạy khi biến môi trường được đặt. **[VERIFY trạng thái trong môi trường sản xuất]** | `src/lib/syndicate.ts:49,68` |

### 3.3 Mô tả và luận giải mục tiêu xử lý sau khi chuyển ra nước ngoài

The transfers are **infrastructural, not commercial**. eno.vn does not send personal data abroad in order to have it exploited there; it runs on managed infrastructure whose nearest regions are in Singapore, and the data is processed abroad only to deliver the service the user asked for:

- **Rows 1–4 (hosting and database)** exist because there is no Vietnam region for the managed Postgres and container platform in use. The data does not leave the operator's control: it sits in the operator's own project, under the operator's own credentials, with row-level security on every table.
- **Rows 6–9 (AI and translation)** are per-request calls, not bulk exports. The AI search index carries **public listing fields only, with seller contact data deliberately excluded at the document-mapping layer**.
- **Rows 12–14 (email and OTP)** transfer the minimum needed to deliver a message: an address or a phone number and the message body. The OTP is never logged.
- **Rows 16–17 (advertising and analytics)** are the only transfers made for a purpose the user could reasonably decline, and they are the only ones that require explicit opt-in. Without the "Allow all" tier **nothing is sent, server-side included**.

### 3.4 Loại dữ liệu cá nhân chuyển ra nước ngoài

Per row in §3.2. In aggregate: **the entire Appendix A inventory is transferred to Singapore** by virtue of rows 1–2; a strictly narrower subset reaches rows 5–21. **Sensitive personal data transferred:** location (`Listing.lat/lng`) as part of row 1; identity and bank documents in the private `business-verification` bucket as part of row 1; behavioural data as part of rows 1, 16 and 17 (the last two only with consent).

### 3.5 Sự tuân thủ và biện pháp bảo vệ áp dụng cho việc chuyển

- Chuyển qua kênh mã hóa TLS; không có kênh truyền dữ liệu cá nhân nào không mã hóa.
- Từng bên nhận bị ràng buộc bằng **hợp đồng xử lý dữ liệu (DPA)** — ⚠️ §7 gap 5.
- Nguyên tắc tối thiểu hóa được thực thi trong mã nguồn, không chỉ trong chính sách: chỉ mục AI loại trừ số điện thoại; định danh gửi cho Meta được băm SHA-256 tại nguồn; địa chỉ email trong nhật ký được che.
- Không chuyển dữ liệu cho bên quảng cáo khi chưa có đồng ý, **kể cả từ phía máy chủ** — đây là điểm khác biệt so với thực tế phổ biến và được kiểm tra bằng cookie đồng ý mà máy chủ đọc được, mặc định từ chối.
- Toàn bộ nội dung §2.8 và Phụ lục C áp dụng như nhau cho dữ liệu sau khi chuyển, vì hạ tầng đó chính là nơi dữ liệu cư trú.

### 3.6 Sự đồng ý của chủ thể dữ liệu và cơ chế phản hồi, khiếu nại

- Việc chuyển dữ liệu ra nước ngoài được thông báo rõ ràng tại mục **"Processing outside Vietnam"** của https://eno.vn/privacy, trong đó nêu: các nhà cung cấp vận hành máy chủ ngoài Việt Nam, chủ yếu tại **Singapore**; đây là hoạt động chuyển dữ liệu xuyên biên giới theo pháp luật Việt Nam; hồ sơ đánh giá tác động phải được lập, nộp Bộ Công an và cập nhật.
- ⚠️ Trang đó hiện nêu rõ hồ sơ **đang được chuẩn bị và chưa nộp**, và tự động chuyển sang câu khẳng định đã nộp khi cờ `OPERATOR_REGISTERED` được bật (`src/lib/site-legal.ts`). Bật cờ này là một bước bắt buộc sau khi có ĐKKD — §7 gap 8.
- Cơ chế phản hồi, khiếu nại: **support@eno.vn**, xác nhận trong 2 ngày làm việc; các mốc 10/15/20 ngày như §2.9; chủ thể có quyền khiếu nại thẳng tới **A05** mà không cần liên hệ eno trước, và điều này được nói rõ trên trang chính sách.

### 3.7 Văn bản ràng buộc trách nhiệm giữa bên chuyển và bên nhận

Bản sao DPA của từng bên tại §3.2 là thành phần bắt buộc của hồ sơ theo Điều 18 NĐ 356/2025. **Trạng thái hiện tại: chưa tập hợp** — xem §7 gap 5 và cột "DPA status" tại **Phụ lục B**.

### 3.8 Đánh giá mức độ ảnh hưởng của việc chuyển

The incremental risk of the transfer over the risk already assessed in §2.10 is: (a) the data sits under a foreign provider's operational control and a foreign legal system's compulsory-process powers; (b) an authority request served on the provider may not reach the controller. Mitigations: contractual restrictions on provider access and on disclosure without notice where the DPA allows it; encryption in transit; row-level security so a provider-side operator cannot trivially read across tenants; keeping the data footprint at each recipient as small as the function allows (rows 6–19 receive a fraction of Appendix A, not the whole of it). Residual risk assessed as **medium**, and inherent to using managed infrastructure that has no Vietnam region.

---

# 4. PHỤ LỤC A — DANH MỤC DỮ LIỆU CÁ NHÂN
## Appendix A — Personal data inventory

All rows MEASURED against `prisma/schema.prisma` and `information_schema` on 14/08/2026. "Cơ bản" = basic; "Nhạy cảm" = sensitive. Retention marked **⚠ chưa tự động** has no implemented deletion job — see §7 gap 3.

| # | Nhóm dữ liệu | `bảng.cột` | Phân loại | Chủ thể | Mục đích | Lưu trữ | Bảo vệ |
|---|---|---|---|---|---|---|---|
| A1 | Định danh tài khoản | `auth.users.email`, `.encrypted_password`, `.phone`, `.raw_user_meta_data`, `.last_sign_in_at`, `.confirmed_at`, `.banned_until`; `Profile.email`, `.phone`, `.displayName`, `.avatarUrl`, `.locale`, `.accountType`, `.businessName`, `.lastSeenAt`; `Handle.handle` | Cơ bản | Mọi người dùng đăng ký | Tạo tài khoản, đăng nhập, hiển thị, liên hệ | Suốt vòng đời tài khoản; xóa ngay khi người dùng tự xóa | Supabase Auth (mật khẩu băm); RLS; TLS; `lastSeenAt` chỉ rời máy chủ ở mức **ngày** |
| A2 | Ghi nhận chấp thuận điều khoản | `Profile.tosAcceptedAt`, `.tosVersion`, `.unsubscribeToken` | Cơ bản | Người dùng đã onboard | Bằng chứng click-wrap (Luật Giao dịch điện tử); hủy đăng ký email 1 chạm không cần đăng nhập | Suốt vòng đời tài khoản | RLS; token bất khả đoán |
| A3 | Danh tính pháp lý người bán | `Seller.legalName`, `.legalAddress`, **`.idNumber`**, `.taxCode`, `.identityUpdatedAt`, `.taxRegisteredName`, `.taxActive`, `.taxCheckedAt`, `.phone` | Cơ bản; **`idNumber` [COUNSEL]** | Người bán (cá nhân & doanh nghiệp) | Nghĩa vụ định danh người bán (NĐ 52/2013 Đ.29; Luật TMĐT 122/2025); cung cấp cho người mua khi được yêu cầu và cho cơ quan nhà nước | Trong thời gian còn gian hàng + **3 năm** | RLS; **không bao giờ xuất hiện trong dữ liệu công khai**; ⚠️ **lưu dạng rõ** — §7 gap 2. MEASURED: 4/12 gian hàng có `idNumber` |
| A4 | Hồ sơ xác minh doanh nghiệp | `SellerVerification.documents` (đường dẫn kho **riêng tư** `business-verification`), `.identityHash`, `.bankNameSeen`, `.consentAt`, `.consentVersion`, `.reviewedBy`, `.note`, `.retentionUntil` | **Nhạy cảm** | Người bán xin huy hiệu | Xét duyệt thủ công giấy tờ định danh + giấy tờ ngân hàng | Xóa đối tượng lưu trữ sau `retentionUntil` (sau quyết định + cửa sổ khiếu nại) | Kho **riêng tư**; kiểm tra magic-byte khi tải lên; chỉ truy cập qua URL ký ngắn hạn có kiểm soát admin; đóng băng khi rời trạng thái `draft`; **có ghi nhận đồng ý** |
| A5 | Nội dung tin đăng | `Listing.title`, `.description`, `.images`, `.video`, `.location`, `.district`, `.city`, `.price`, `.attributes`, `.searchText`, `.brandSlug`, `.model`, `.year`, `.mileageKm`, `.areaM2`, `.salaryM`; kho công khai `listings`, `listing-videos` | Cơ bản — **công khai theo thiết kế** | Người bán; **có thể chứa dữ liệu của bên thứ ba trong ảnh** | Đăng tin, tìm kiếm, hiển thị | Khi còn đăng; tin đã bán được giữ (trang 200 + noindex); **3 năm** cho hồ sơ giao dịch | **Xóa toàn bộ EXIF/GPS khi tải lên**; kiểm duyệt tự động trước khi lên sóng; đóng dấu chìm |
| A6 | **Vị trí** | `Listing.lat`, `.lng`; vị trí thiết bị của người xem (chỉ dùng tạm thời để sắp xếp theo khoảng cách, **[VERIFY: xác nhận không lưu]**) | **Nhạy cảm** | Người bán; người xem cho phép | Sắp xếp theo khoảng cách; bản đồ | Cùng vòng đời tin đăng | Đồng ý qua quyền trình duyệt; không chia sẻ cho bên quảng cáo; dừng thu thập ngay khi rút quyền |
| A7 | Tin nhắn 1:1 và chào giá | `Conversation.buyerProfileId`, `.sellerProfileId`, `.lastMessageText`, `.buyerDeletedAt`, `.sellerDeletedAt`; `Message.senderProfileId`, `.body`, `.kind`, `.offerAmount`, `.offerStatus`, `.metaJson` | Cơ bản — nội dung do người dùng nhập, **có thể chứa dữ liệu nhạy cảm** | Người mua và người bán | Liên lạc; bằng chứng khi có báo cáo/tranh chấp | Hiện **không giới hạn** ⚠ chưa tự động | RLS; đọc theo phạm vi bên tham gia; "xóa hội thoại" là ẩn phía mình, không phá hủy phía kia; **nội dung chat không vào bộ đệm dịch bền vững** |
| A8 | Vòng giao dịch | `Listing.soldChannel`, `.soldToProfileId`, `.soldPlatform`, `.soldAt`, `.salePrice`, `.saleConfirmedAt`, `.saleDeclinedAt`, `.saleBuyerHistory`, `.saleConfirmPromptedAt`; `PriceChange.oldPrice`, `.newPrice` | Cơ bản | Người mua, người bán | Xác nhận giao dịch hai chiều; tính tin nhiệm; hướng dẫn giá; chống quấy rối lặp lại | **3 năm** (Luật TMĐT 122/2025) | RLS; `saleBuyerHistory` do một module duy nhất sở hữu; bản ghi mỗi người mua tồn tại qua mọi lần gán lại để quy tắc chống quấy rối là thật |
| A9 | Đánh giá | `Review.author`, `.rating`, `.text`, `.authorProfileId`, `.listingId`, `.conversationId` | Cơ bản — công khai | Người mua đã giao dịch | Uy tín người bán | Cùng vòng đời gian hàng | Một đánh giá / một hội thoại; khi xóa tài khoản: **ẩn danh hóa** (xóa tên, `authorProfileId → null`) |
| A10 | Tin nhiệm và chế tài | `Profile.trustScore`, `.trustTier`, `.positiveInteractions`, `.falseReportStrikes`, `.reportCooldownUntil`, `.enforcementState`, `.enforcementUntil`, `.goodStandingSince`; `TrustEvent.subjectProfileId`, `.type`, `.delta`, `.reason`, `.actorId`, `.reportId`; `EnforcementAction.*`; `Seller.trustScore`, `.trustTier`, `.responseRate`, `.responseTime`, `.responseMetricAt` | Cơ bản — **quyết định tự động** | Mọi người dùng | An toàn sàn; xếp hạng hiển thị | Suốt vòng đời tài khoản ⚠ chưa tự động | Sổ cái chỉ ghi thêm; mọi sự kiện hiển thị và có thể khiếu nại trong dashboard; công thức công bố tại /legal/ranking; `responseRate` chỉ hiển thị khi **đã đo thật** (`responseMetricAt`) |
| A11 | Báo cáo và tranh chấp | `Report.reporterProfileId`, `.targetProfileId`, `.targetSellerId`, `.conversationId`, `.reason`, `.detail`, `.severity`, `.status`, `.resolvedBy`, `.internalNote`, `.appealNote`, `.appealImages`, `.sellerResponse`, `.decisionNote`, `.aiAnalysis`; `DisputeMessage.senderProfileId`, `.senderRole`, `.body`, `.images` (kho **riêng tư** `evidence`) | Cơ bản — **có thể chứa cáo buộc nhạy cảm** | Người báo cáo, bên bị báo cáo | Cơ chế giải quyết khiếu nại bắt buộc (NĐ 52/85) | **3 năm**; sống sót qua việc xóa tài khoản bằng id trần (cố ý không có khóa ngoại) | Kho bằng chứng riêng tư; **bên bị báo cáo không bao giờ biết danh tính người báo cáo**; ghi chú nội bộ không hiển thị cho người dùng |
| A12 | Chống né lệnh cấm | `BannedIdentity.phone`, `.email`, `.sourceProfileId` | Cơ bản | Tài khoản bị đình chỉ | Ngăn tạo tài khoản mới để né chế tài | Đến khi lệnh đình chỉ được gỡ / lật ngược | **Cố ý sống sót qua việc xóa tài khoản** — **[COUNSEL]**. Không tự động cấm: trùng số chỉ đưa vào diện xem xét (gia đình Việt dùng chung số); **không liên kết theo IP** (CGNAT gây dương tính giả) |
| A13 | Thông báo | `Notification.recipientId`, `.title`, `.body`, `.actorName`, `.conversationId`, `.listingId`, `.url`, `.read` | Cơ bản | Người nhận | Thông báo trong ứng dụng | ⚠ chưa tự động | RLS |
| A14 | Đăng ký đẩy | `PushSubscription.endpoint`, `.p256dh`, `.auth`, `.userAgent`; `NativePushToken.token`, `.platform` | Cơ bản — **định danh của bên thứ ba** | Người dùng bật thông báo | Gửi thông báo đẩy | Xóa khi endpoint chết (404/410); còn lại ⚠ chưa tự động | VAPID; nội dung mã hóa; `NativePushToken` = 0 dòng (chưa hoạt động) |
| A15 | Tìm kiếm đã lưu và hành vi | `SavedSearch.params`, `.label`, `.notify`, `.lastNotifiedAt`; `ContactReveal.viewerId`, **`.ipHash`**; `Listing.views`, `.savedCount`, `.contactCount`; `ListingDailyStat.views`, `.leads`; `search_trend(day, term, count)`; `search_trend_seen(day, actor, term)` | Cơ bản; **[COUNSEL] có thể là nhạy cảm (dữ liệu hành vi)** | Người mua | Cảnh báo tin mới; đo lường quan tâm; xu hướng tìm kiếm | ⚠ chưa tự động; `search_trend_seen` TTL ~3 ngày | **`ContactReveal.ipHash` là băm có muối và bằng NULL nếu chưa cấu hình muối**; `search_trend_seen.actor` = SHA-1 của IP cắt còn 16 ký tự |
| A16 | Quy kết nguồn truy cập | `Profile.attrSource`, `.attrMedium`, `.attrCampaign`, `.attrReferrer`, `.attrLandingAt` | Cơ bản | Người dùng đăng ký | Đo chi phí thu hút theo kênh (first-touch) | Suốt vòng đời tài khoản | First-party; không rời máy chủ |
| A17 | Hỏi–đáp Trung tâm trợ giúp *(live trên eno.vn qua `/help`)* | `ForumProfile.bio`, `.homeBase`, `.residentSince`, `.reputation`, `.lastSeenAt`; `ForumPost.authorProfileId`, `.authorName`, `.title`, `.body`, `.location`; `ForumComment.*`; `ForumPostVote`, `ForumCommentVote`, `ForumBookmark`, `ForumPostSubscription`, `ForumUserBlock`, `ForumReport`, `ForumModerationAction`, `ForumPostRevision`, `ForumCommentRevision`; `ForumPostMedia.storagePath` (kho công khai `forum-media`) | Cơ bản — công khai | Người dùng hỏi/đáp | Trung tâm trợ giúp có bình chọn, bình luận, lưu và báo cáo | ⚠ chưa tự động | RLS; tác giả cascade `SetNull` khi xóa tài khoản; có chặn người dùng và báo cáo |
| A18 | Phản hồi và báo lỗi | `Feedback.message`, `.email`, `.profileId`, `.url`, `.userAgent` | Cơ bản | Bất kỳ ai (không cần đăng nhập) | Hỗ trợ | ⚠ chưa tự động | RLS |
| A19 | Khóa API và webhook đối tác | `ApiKey.hashedKey`, `.prefix`, `.profileId`, `.scopes`, `.lastUsedAt`, `.revokedAt`; `WebhookEndpoint.url`, `.secret` | Cơ bản | Người bán dùng Partner API | Truy cập API cho gian hàng | Đến khi thu hồi | **Chỉ lưu băm SHA-256**, bí mật hiện một lần khi tạo; URL webhook được kiểm tra chống SSRF khi đăng ký |
| A20 | Phiên và hạ tầng xác thực | `auth.sessions`, `auth.refresh_tokens`, `auth.one_time_tokens`, `auth.flow_state`, `auth.identities` (MEASURED: google 13, email 10); `auth_handoff.nonce_hash`, `.pair_hmac`, `.browser_hash`, `.code`; `identity_claim`; `rl_window`, `rl_cooldown`, `kv_store` | Cơ bản | Người dùng đăng nhập | Duy trì phiên; SSO cho ứng dụng gốc; giới hạn tần suất | TTL ngắn; quét bằng `pg_cron` mỗi 15 phút | Toàn bộ giá trị nhạy cảm được **băm**; `auth_handoff` có hạn dùng và số lần thử |
| A21 | Bộ đệm dịch máy | `Translation.hash`, `.target`, `.value`; `forum_translations.source_text`, `.translated_text` | Suy dẫn từ nội dung; không khóa theo chủ thể | — | Tránh trả phí dịch lại | Không giới hạn ⚠ | **Nội dung chat không được ghi vào đây** (endpoint theo id với `skipWrite` + bộ đệm tạm 24h) |
| A22 | Nhật ký máy chủ và biên | Google Cloud Logging (IP, user-agent, đường dẫn); nhật ký Cloudflare; `/api/csp-report` | Cơ bản | Mọi khách truy cập | Vận hành, an ninh, chống lạm dụng | **12 tháng** *(INFERRED — **[VERIFY]** cấu hình thực tế)* | Chỉ dùng `cf-connecting-ip`; email trong nhật ký ứng dụng được che |
| — | **Ngoài phạm vi hồ sơ này — sẽ xóa trước khi nộp** | `visa_applications`, `visa_documents`, `visa_events`, `visa_payments`, `visa_prefill_sessions`, `vnpt_access_token`, `vnpt_quota`; `Itinerary*`, `TripAssistance*`; kho `visa-documents` | — | — | — | Xóa bằng `scripts/purge-pre-launch-data.mjs --execute --with-storage` | Biên nhận xóa là bằng chứng — §2.7 |
| — | **Có lược đồ nhưng CHƯA ĐƯỢC ĐẤU NỐI — không mô tả là đang vận hành** | `identity_verifications`, `takedown_orders`, `compliance_audit` | — | — | — | 0 dòng | MEASURED: không có route API hay trang nào ghi vào ba bảng này |

---

# 5. PHỤ LỤC B — BÊN NHẬN DỮ LIỆU
## Appendix B — Data recipients

| # | Tổ chức | Quốc gia | Dữ liệu nhận | Mục đích | Vai trò | Biện pháp bảo đảm | DPA |
|---|---|---|---|---|---|---|---|
| B1 | Supabase Inc. (AWS ap-southeast-1) | **Singapore** | Toàn bộ Phụ lục A | CSDL, xác thực, lưu trữ tệp | Bên Xử lý | RLS mọi bảng; kho riêng tư; TLS | ☐ **cần thu thập** |
| B2 | Google Asia Pacific Pte. Ltd. (Cloud Run, asia-southeast1) | **Singapore** | Toàn bộ Phụ lục A khi xử lý | Máy chủ ứng dụng | Bên Xử lý | Cloud Data Processing Addendum | ☐ **cần lưu bản sao** |
| B3 | Google (Cloud Logging, Secret Manager, Artifact Registry) | Singapore / europe-west1 (build) | IP, user-agent, đường dẫn | Vận hành, an ninh | Bên Xử lý | Nằm trong CDPA của B2 | ☐ |
| B4 | Cloudflare, Inc. | Toàn cầu | IP, user-agent, cookie, siêu dữ liệu TLS mọi yêu cầu; Turnstile; email đến | CDN, WAF, chống DDoS, CAPTCHA, định tuyến email | Bên Xử lý | Cloudflare DPA | ☐ **cần thu thập** |
| B5 | Google — Vertex AI (Gemini) | **"global"** | Ảnh/mô tả tin đăng; câu hỏi trợ lý | AI hỗ trợ đăng tin và mua sắm | Bên Xử lý | Nằm trong CDPA của B2; đăng nhập + hạn mức | ☐ |
| B6 | Google — Vertex AI Search | **"global"** | **Chỉ trường công khai của tin đăng** | Tìm kiếm ngữ nghĩa | Bên Xử lý | Loại trừ PII ở tầng dựng tài liệu | ☐ |
| B7 | Google — Cloud Translation | Toàn cầu | Văn bản tin đăng, chuỗi giao diện | Dịch nội dung | Bên Xử lý | CDPA | ☐ |
| B8 | Microsoft — Azure AI Translator | southeastasia | Như B7 | Dịch dự phòng | Bên Xử lý | Microsoft DPA | ☐ **cần thu thập** |
| B9 | Google — Geocoding API | Toàn cầu | Tọa độ / chuỗi địa chỉ | Chuyển đổi địa chỉ | Bên Xử lý | CDPA; chỉ chạy khi có khóa | ☐ |
| B10 | OpenStreetMap Foundation (Nominatim) | UK/EU | Tọa độ / chuỗi địa chỉ | Dự phòng địa chỉ | Bên Thứ ba (dịch vụ công) | **Không có DPA** — cân nhắc bỏ hoặc tự vận hành | ✗ **[COUNSEL]** |
| B11 | Resend, Inc. | US/EU **[VERIFY]** | Email người nhận + nội dung thư | Email giao dịch | Bên Xử lý | Resend DPA | ☐ **cần thu thập** |
| B12 | Telegram Gateway | Ngoài VN | Số điện thoại + OTP | Gửi mã đăng nhập | Bên Xử lý | Không ghi log OTP | ☐ **[VERIFY có DPA]** |
| B13 | Meta Platforms (WhatsApp Business) | US/IE | Số điện thoại + OTP | Gửi mã đăng nhập (số nước ngoài) | Bên Xử lý | Meta DPA | ☐ **[VERIFY]** |
| B14 | VNG Corporation (Zalo ZNS) | **Việt Nam** | Số điện thoại + OTP | Gửi mã đăng nhập (số VN) | Bên Xử lý | **Trong nước — không phải chuyển ra nước ngoài** | ☐ |
| B15 | Meta Platforms, Inc. — Conversions API | US | `sha256(email/phone/id)`, IP, user-agent, `_fbp`, `_fbc` | Đo lường quảng cáo | **Bên Kiểm soát độc lập** | **Chỉ khi đồng ý "Allow all"**; máy chủ fail-closed | ☐ **[VERIFY khóa có được đặt trong môi trường sản xuất không]** |
| B16 | Google LLC — Analytics 4 (`G-CKTZK62B0X`) | US | Client-id, lượt xem, sự kiện, IP | Đo lường sử dụng | **Bên Kiểm soát độc lập** | **Chỉ khi đồng ý "Allow all"**; chỉ nạp sau khi người dùng tương tác | ☐ |
| B17 | Google / Mozilla / Apple — Web Push | US, toàn cầu | Endpoint đẩy + khóa + nội dung | Thông báo đẩy | Bên Xử lý (theo chuẩn) | VAPID; nội dung mã hóa | n/a — dịch vụ chuẩn |
| B18 | Google FCM + Apple APNs | US | Token thiết bị + nội dung | Đẩy cho ứng dụng gốc | Bên Xử lý | **CHƯA HOẠT ĐỘNG — 0 token** | ☐ |
| B19 | Google — Identity Services / OAuth | US | Email, họ tên, ảnh từ tài khoản Google | Đăng nhập bằng Google (13/22 danh tính) | Bên Thứ ba | Người dùng chủ động; phạm vi tối thiểu | n/a |
| B20 | Telegram / Meta — đăng bài tự động | Ngoài VN | Nội dung tin đăng công khai + ảnh | Phân phối tin đăng | Bên Thứ ba | Chỉ chạy khi biến môi trường được đặt | ☐ **[VERIFY trạng thái]** |
| B21 | Cơ quan nhà nước có thẩm quyền | Việt Nam | Theo yêu cầu hợp pháp | Nghĩa vụ pháp lý | — | Chỉ trong phạm vi thẩm quyền; thông báo cho chủ thể khi được phép | n/a |

---

# 6. PHỤ LỤC C — BIỆN PHÁP BẢO VỆ
## Appendix C — Control table

| # | Nhóm | Biện pháp | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| C1 | Kỹ thuật · truyền | TLS toàn bộ; HSTS `max-age=63072000; includeSubDomains; preload` | ✅ | `next.config.ts:553` |
| C2 | Kỹ thuật · trình duyệt | CSP: `object-src 'none'`, `frame-ancestors 'self'`, `form-action 'self'`, host Supabase ghim chính xác (không dùng ký tự đại diện), báo cáo vi phạm | ✅ | `next.config.ts:514–551` |
| C3 | Kỹ thuật · trình duyệt | `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), payment=()` | ✅ | `next.config.ts:554–557` |
| C4 | Kỹ thuật · CSDL | **Row Level Security bật trên 74/74 bảng schema `public`** | ✅ MEASURED | `pg_tables.rowsecurity` |
| C5 | Kỹ thuật · lưu trữ | Tách kho công khai / riêng tư; kho riêng chỉ mở qua URL ký ngắn hạn có kiểm soát admin | ✅ MEASURED | `storage.buckets` |
| C6 | Tối thiểu hóa | Xóa toàn bộ EXIF/GPS khi tải ảnh | ✅ | `src/lib/core/media.ts:86,230` |
| C7 | Tối thiểu hóa | Không lưu IP thô: băm có muối, NULL khi thiếu muối; dedup xu hướng dùng băm cắt ngắn TTL ~3 ngày | ✅ | `.../contact/route.ts:52,178`; `.../trending/route.ts:53` |
| C8 | Tối thiểu hóa | IP thật chỉ lấy từ `cf-connecting-ip`, không tin `X-Forwarded-For` do client gửi | ✅ | `src/lib/client-ip.ts` |
| C9 | Tối thiểu hóa | Chỉ mục tìm kiếm AI loại trừ số điện thoại và dữ liệu liên hệ người bán | ✅ | `src/lib/vertex-search.ts:262,271` |
| C10 | Tối thiểu hóa | Email trong nhật ký ứng dụng được che thành `a…e@domain` | ✅ | `src/lib/mail.ts` |
| C11 | Chống lạm dụng | Giới hạn tần suất bằng hàm `SECURITY DEFINER` trên bảng UNLOGGED, quét `pg_cron` 15 phút; **fail-closed** trên route bảo mật và tính phí | ✅ MEASURED | `src/lib/ratelimit.ts`; `cron.job` id 1 |
| C12 | Chống lạm dụng | AI chỉ cho người đăng nhập + hạn mức giờ theo tài khoản + trần ngày toàn cục, fail-closed | ✅ | `src/lib/ai-guard.ts` |
| C13 | Chống lạm dụng | Cloudflare Turnstile trên gửi OTP và magic link | ✅ | `src/lib/turnstile-verify.ts` |
| C14 | Chống CSRF | Kiểm tra same-origin + `SameSite=Lax` + xác nhận gõ tay trên route xóa tài khoản | ✅ | `/api/account/delete/route.ts` |
| C15 | Chống SSRF | Xác thực URL webhook đối tác khi đăng ký | ✅ | `src/lib/ssrf.ts` |
| C16 | Bí mật | Toàn bộ khóa trong GCP Secret Manager (`eno-root-env`); `.env` không bao giờ được commit | ✅ | `CLAUDE.md`; `cloudbuild.yaml` |
| C17 | Bí mật | Khóa API đối tác chỉ lưu băm SHA-256; bí mật hiện một lần khi tạo | ✅ | `ApiKey.hashedKey` |
| C18 | Đồng ý | Ba mức đồng ý, theo từng mục đích, không gộp; **được phản chiếu sang cookie để máy chủ đọc**, mặc định từ chối | ✅ | `src/lib/consent.ts` |
| C19 | Đồng ý | Pixel trình duyệt của Meta đã **gỡ bỏ hoàn toàn**; chỉ còn CAPI phía máy chủ có kiểm soát đồng ý | ✅ | `analytics-tags.tsx:24–28` |
| C20 | Quyền chủ thể | Xuất dữ liệu tự phục vụ, tức thì, giới hạn 5/h | ✅ | `/api/account/export/route.ts` |
| C21 | Quyền chủ thể | Xóa tài khoản tự phục vụ, tức thì, có xác nhận gõ tay, giới hạn 3/h, kèm bảo vệ chống xóa xuyên chủ thể khi dọn kho ảnh | ✅ | `/api/account/delete/route.ts` |
| C22 | Quyền chủ thể | Ẩn danh hóa thay vì xóa với đánh giá đã viết; hồ sơ báo cáo tách khỏi tin đăng để tồn tại theo thời hạn luật định | ✅ | `/api/account/delete/route.ts` |
| C23 | Minh bạch | Công bố công thức xếp hạng với trọng số chính xác; cam kết không dùng dữ liệu cá nhân để sắp xếp lại kết quả | ✅ | `/legal/ranking`; `docs/compliance-2026.md §4.1` |
| C24 | Minh bạch | Mỗi sự kiện tin nhiệm hiển thị cho chủ thể bằng ngôn ngữ đời thường và có thể khiếu nại | ✅ | `describeTrustEvent()` trong bản xuất dữ liệu |
| C25 | Vòng đời | Xóa đăng ký đẩy chết (404/410); TTL cho `kv_store`, `next_cache`, `auth_handoff`, `rl_*`; cron dọn video mồ côi | ✅ | `src/lib/push.ts`; `/api/cron/video-gc` |
| C26 | Vòng đời | **Không có tác vụ lưu trữ/xóa cho dữ liệu marketplace** (`Profile`, `Message`, `Notification`, `Report`, `TrustEvent`, `ContactReveal`, `search_trend`, `Translation`) | ❌ **THIẾU** | §7 gap 3 |
| C27 | Mã hóa khi lưu | `Seller.idNumber` (CCCD/ĐKKD) lưu **dạng rõ** | ❌ **THIẾU** | `src/lib/core/seller.ts:71–75` |
| C28 | Sự cố | Quy trình thông báo A05 trong 72 giờ — đã công bố; **chưa có runbook nội bộ** | ⚠ một phần | `/privacy` §security |
| C29 | Sao lưu | Sao lưu do nhà cung cấp thực hiện; **thời hạn và PITR chưa được xác minh** | ⚠ **[VERIFY]** | — |
| C30 | Hợp đồng | DPA với từng bên nhận tại Phụ lục B | ❌ **CHƯA THU THẬP** | §7 gap 5 |

---

# 7. TRƯỚC KHI NỘP
## Fix before filing — ranked

### 1. ⛔ 14 tin dịch vụ e-Visa đang HIỂN THỊ CÔNG KHAI trên eno.vn
**MEASURED 14/08/2026.** `info@vietkite.com.vn` sở hữu 14 tin, tất cả `status='active' AND verified=true`, tiêu đề "Vietnam E-Visa — Single/Multiple Entry — …", danh mục `services`, `listingType='service'`. Danh sách loại trừ của phiên bản marketplace (`HIDDEN_DESK_OWNER_EMAILS` trong `src/lib/edition-scope.ts`) mặc định **chỉ chứa `support@eno.forum`**, nên các tin này không bị lọc khỏi browse, search, sitemap, JSON-LD và các nguồn cấp Google/Meta.

**Vì sao bị trả hồ sơ:** hồ sơ mô tả một sàn rao vặt **không có dịch vụ thị thực**. Một cán bộ mở eno.vn và thấy 14 tin bán dịch vụ e-Visa sẽ kết luận hồ sơ mô tả sai hoạt động đang diễn ra — điều tệ hơn một hồ sơ nộp muộn.

**Cách sửa nhỏ nhất:** đặt `status='hidden'` cho 14 tin đó, **hoặc** thêm địa chỉ của gian hàng vận hành desk vào `HIDDEN_DESK_OWNER_EMAILS`. ⚠️ Đọc cảnh báo trong `edition-scope.ts` trước: biến đó là **công cụ cấp phép, không phải định tuyến** — đặt địa chỉ của một đối tác được cấp phép vào đó sẽ xóa toàn bộ gian hàng của họ khỏi sàn. Cách an toàn hơn là ẩn từng tin.
**Chặn nộp hồ sơ: CÓ.**

### 2. ⛔ Số CCCD/ĐKKD của người bán lưu dạng rõ
**MEASURED:** `Seller.idNumber` nhận chuỗi chữ số và ghi thẳng (`src/lib/core/seller.ts:71–75`); 4/12 gian hàng đang có giá trị. Thiết kế `identity_verifications` trong chính repo này ghi rõ lý do không được làm thế: *"a national ID is low-entropy and structured, so a leaked plain sha256 column is equivalent to leaking the numbers themselves"* — rồi cột bên cạnh lại lưu số gốc.

**Vì sao bị trả hồ sơ:** đây là câu hỏi đầu tiên một cán bộ đọc Phụ lục A sẽ đặt, và nó cũng là điểm yếu thật.
**Cách sửa nhỏ nhất trước khi nộp:** vì bảng sẽ bị xóa sạch trong đợt purge, chỉ cần **quyết định trạng thái đích trước khi có người dùng thật**: (a) bỏ cột và chỉ thu thập khi có yêu cầu hợp pháp, hoặc (b) lưu HMAC-SHA256 với pepper trong Secret Manager cộng 4 số cuối để hiển thị. Nếu chưa kịp, ghi rõ trong §2.10 là rủi ro đã nhận diện kèm mốc khắc phục.
**Chặn nộp hồ sơ: KHÔNG — nhưng gần như chắc chắn bị hỏi.**

### 3. ⛔ Không có tác vụ lưu trữ/xóa cho dữ liệu marketplace
**MEASURED:** `src/app/api/cron/` chỉ có `daily-reminders`, `price-stats`, `saved-search-alerts`, `video-gc`, `visa-retention`, `warm-translations`, `weekly-digest`. Không có tác vụ nào xóa `Message`, `Conversation`, `Notification`, `TrustEvent`, `ContactReveal`, `search_trend`, `Translation`, hay hồ sơ đã ngừng hoạt động.

**Vì sao bị trả hồ sơ:** Mẫu số 10 yêu cầu **"thời gian bắt đầu, thời gian kết thúc xử lý"** và chính sách lưu trữ/xóa. "Giữ vô thời hạn" cho tin nhắn tư nhân trên một sàn không giữ tiền là câu trả lời khó bảo vệ.
**Cách sửa nhỏ nhất:** một cron duy nhất áp lịch của Phụ lục A: xóa `Notification` > 12 tháng; `search_trend`/`search_trend_seen` > 90 ngày; `Translation` > 12 tháng; và **quyết định một thời hạn cho `Message`** (gợi ý: 3 năm, khớp Luật TMĐT 122/2025, có tạm dừng khi đang có báo cáo mở). Viết thời hạn đó vào hồ sơ.
**Chặn nộp hồ sơ: MỀM — biểu mẫu cần một câu trả lời.**

### 4. ⛔ Chạy đợt purge KÈM `--with-storage`, và giữ biên nhận
**MEASURED:** `scripts/purge-pre-launch-data.mjs` mặc định là dry-run; nếu chạy `--execute` mà **không** kèm `--with-storage`, các tệp ảnh hộ chiếu/chân dung **sống sót** sau khi dòng dữ liệu trỏ tới chúng đã bị xóa — trạng thái tệ nhất của cả hai phía. `storage.objects` = 242 dòng hôm nay.
**Cách sửa:** `node scripts/purge-pre-launch-data.mjs` (đọc kế hoạch) → `node scripts/purge-pre-launch-data.mjs --execute --with-storage` → lưu `purge-receipt-YYYY-MM-DD.json` làm tài liệu đính kèm §2.12(6). Kiểm tra lại `storage.objects` và cả ba kho riêng tư sau khi chạy.
**Chặn nộp hồ sơ: CÓ.**

### 5. ⛔ Chưa có bản sao DPA của bất kỳ bên nhận nào
Điều 18(2) và Điều 19 NĐ 356/2025 liệt kê **"bản sao hợp đồng hoặc thỏa thuận về việc xử lý dữ liệu cá nhân"** là **thành phần hồ sơ**, không phải tài liệu tham khảo. Hồ sơ thiếu một thành phần bắt buộc sẽ bị trả về mà không cần đọc nội dung.
**Cách sửa nhỏ nhất:** với Google, Cloudflare, Microsoft và Meta, DPA là điều khoản tiêu chuẩn có thể chấp nhận và tải xuống trong bảng điều khiển — làm được trong một buổi chiều. Supabase, Resend và Telegram Gateway cần yêu cầu riêng. **OpenStreetMap Nominatim không có DPA và không thể có** — hoặc bỏ nhánh dự phòng đó, hoặc tự vận hành, hoặc để counsel giải trình.
**Chặn nộp hồ sơ: CÓ.**

### 6. ⛔ Ba trường `[OWNER INPUT]` và cờ `OPERATOR_REGISTERED`
Tên công ty, số ĐKKD, địa chỉ trụ sở. Sau khi có ĐKKD, cập nhật `src/lib/site-legal.ts` (một chỗ duy nhất — footer, /signin, /terms, /privacy, /regulations đều đọc từ đó) và bật `registered: true`, điều này cũng làm trang /privacy chuyển từ *"hồ sơ đang được chuẩn bị, chưa nộp"* sang câu khẳng định đã nộp. **Đừng bật trước khi giấy chứng nhận đã ở trong tay.**
**Chặn nộp hồ sơ: CÓ.**

### 7. ⚠️ Điều kiện của nhân sự bảo vệ dữ liệu (Điều 13 NĐ 356/2025)
Bằng cao đẳng trở lên, ≥02 năm kinh nghiệm pháp chế/CNTT/an ninh dữ liệu, và **đã được đào tạo** về bảo vệ dữ liệu. Thêm câu hỏi độc lập: một người vừa là giám đốc, vừa là đại diện pháp luật, vừa là DPO.
**Cách sửa nhỏ nhất:** thu thập hồ sơ chứng minh; nếu thiếu chứng chỉ đào tạo, đăng ký một khóa trước khi nộp; nếu counsel cho rằng việc kiêm nhiệm là khiếm khuyết, bổ nhiệm một nhân sự thứ hai làm DPO.
**Chặn nộp hồ sơ: KHÔNG — nhưng dễ bị trả về.**

### 8. ⚠️ Xác minh trạng thái môi trường sản xuất cho ba bên nhận
`RESEND_API_KEY`, `META_PIXEL_ID`/`META_CAPI_TOKEN`, `NEXT_PUBLIC_GA_ID`, `TELEGRAM_BOT_TOKEN`/`FB_PAGE_*`, `GOOGLE_MAPS_API_KEY` — không thể đọc từ checkout này (chúng nằm trong GCP Secret Manager `eno-root-env`). Một bên nhận được liệt kê nhưng thực tế chưa bật khiến hồ sơ **quá rộng**; một bên đang bật mà không liệt kê khiến hồ sơ **sai**.
**Cách sửa nhỏ nhất:** đọc `eno-root-env` một lần và đánh dấu Phụ lục B thành "đang hoạt động" / "đã cấu hình nhưng chưa bật" / "chưa cấu hình".
**Chặn nộp hồ sơ: KHÔNG — nhưng ảnh hưởng độ chính xác của Phụ lục B.**

### 9. ⚠️ Không mô tả ba mô-đun chưa đấu nối là đang vận hành
`identity_verifications`, `takedown_orders`, `compliance_audit` có lược đồ đầy đủ, tài liệu thiết kế đầy đủ, 0 dòng dữ liệu và **không có route API hay trang nào ghi vào chúng** (MEASURED). Liệt kê chúng như một biện pháp bảo vệ đang hoạt động là một tuyên bố sai dễ bị kiểm chứng.
**Cách sửa:** giữ nguyên như đã viết trong Phụ lục A — ghi rõ là "có lược đồ, chưa đấu nối".
**Chặn nộp hồ sơ: KHÔNG.**

### 10. ⚠️ Xác nhận chính sách sao lưu và thời hạn nhật ký
Con số "12 tháng" cho Cloud Logging đến từ tài liệu thiết kế nội bộ, không phải từ cấu hình đã đo. Thời hạn sao lưu / PITR của Supabase chưa biết.
**Cách sửa nhỏ nhất:** đọc cấu hình `_Default` log bucket và gói Supabase; ghi con số thật vào Phụ lục A22 và C29.
**Chặn nộp hồ sơ: KHÔNG.**

---

# 8. CÂU HỎI CHO LUẬT SƯ
## Questions for counsel

1. **Bộ biểu mẫu.** Xác nhận NĐ 356/2025 (Mẫu 09 + 01a/b cho chuyển ra nước ngoài; Mẫu 10 + 02a/b cho xử lý) đã thay thế hoàn toàn Mẫu 03/04 của NĐ 13/2023, và xác nhận số điều (17 hay 19 cho hồ sơ xử lý — nguồn thứ cấp mâu thuẫn).

2. **NĐ 53/2022 Điều 26 — lưu trữ dữ liệu tại Việt Nam.** Toàn bộ dữ liệu của eno.vn nằm ở Singapore; không có gì lưu tại Việt Nam. Một sàn TMĐT trong nước có bị buộc lưu trữ trong nước không, và có nên chủ động chuẩn bị trước một yêu cầu như vậy thay vì chờ quyết định?

3. **Kiêm nhiệm DPO.** Giám đốc kiêm đại diện pháp luật kiêm DPO có được chấp nhận không, và cần bằng chứng gì cho điều kiện Điều 13?

4. **Mốc "thời gian bắt đầu xử lý".** Đồng hồ 60 ngày chạy từ ngày mở cho người dùng thật, hay dữ liệu vận hành tiền ra mắt hiện có đã kích hoạt nó? Biên nhận purge là bằng chứng cho phương án nào?

5. **Số CCCD người bán.** Có thuộc dữ liệu nhạy cảm theo Luật 91/2025 không? Lưu dạng rõ có chấp nhận được không? Có thể **không thu thập** cho tới thời hạn xác minh danh tính người bán 01/01/2027 không?

6. **Căn cứ pháp lý.** Chính sách hiện tuyên bố sự đồng ý là căn cứ cho gần như toàn bộ hoạt động. Với việc lưu giữ tin nhắn, tính điểm tin nhiệm và hồ sơ chế tài, "thực hiện hợp đồng" và "nghĩa vụ pháp lý" có phải căn cứ đúng hơn không — và việc chọn sai căn cứ có làm hỏng phần còn lại của hồ sơ không?

7. **Dữ liệu hành vi là dữ liệu nhạy cảm.** Nếu đúng, hàng "For You" dựa trên hoạt động của chính người dùng — hiện **bật mặc định** trừ khi chọn "Essential only" — có cần chuyển sang opt-in rõ ràng không?

8. **Ngôn ngữ có hiệu lực.** Chính sách bảo mật hiện tuyên bố **bản tiếng Anh là bản có hiệu lực**, với bản tiếng Việt là bản dịch tiện lợi. Điều này có chấp nhận được với một pháp nhân Việt Nam phục vụ người dùng Việt Nam không?

9. **Ẩn danh sau khi xóa tài khoản.** `BannedIdentity` cố ý giữ số điện thoại và email của tài khoản bị đình chỉ **sau khi** tài khoản bị xóa, để ngăn né lệnh cấm. Có bảo vệ được trước quyền xóa không, và trong bao lâu?

10. **Tái kết nối mô-đun thị thực.** Khi mô-đun e-Visa do đối tác vận hành được đấu nối lại, đó là **hồ sơ cập nhật trong 10 ngày** theo Điều 20, hay một hồ sơ mới? Và điều đó có ảnh hưởng tới trạng thái giấy phép sàn TMĐT không?

11. **Mức phạt.** Xác nhận Điều 8(4) Luật 91/2025 (đến 5% doanh thu năm trước) và Điều 8(5) (đến 3 tỷ đồng) — hai con số này do chủ sở hữu cung cấp và **chưa được kiểm chứng độc lập** trong quá trình lập hồ sơ này.

---

**Sources for the legal-frame verification performed on 14/08/2026:**
[Nghị định 356/2025/NĐ-CP — thuvienphapluat.vn](https://thuvienphapluat.vn/van-ban/Quyen-dan-su/Nghi-dinh-356-2025-ND-CP-huong-dan-Luat-Bao-ve-du-lieu-ca-nhan-687428.aspx) · [Quy định chi tiết Luật BVDLCN — luatvietnam.vn](https://luatvietnam.vn/thong-tin/nghi-dinh-356-2025-nd-cp-quy-dinh-chi-tiet-luat-bao-ve-du-lieu-ca-nhan-422896-d1.html) · [Hồ sơ đánh giá tác động chuyển DLCN xuyên biên giới — thuvienphapluat.vn](https://thuvienphapluat.vn/phap-luat/ho-so-danh-gia-tac-dong-chuyen-du-lieu-ca-nhan-xuyen-bien-gioi-theo-nghi-dinh-3562025ndcp-chi-tiet-260885.html) · [EY Vietnam legal alert on Decree 356/2025/ND-CP](https://www.ey.com/content/dam/ey-unified-site/ey-com/vi-vn/technical/tax/documents/ey-vietnam-legal-alert-march-2026-decree-no356-2025-nd-cp-providing-detailed-guidance-for-implementation-of-personal-data-protection-law-viet.pdf) · [Nghị định hướng dẫn Luật BVDLCN — luatthanhdo.com.vn](https://luatthanhdo.com.vn/nghi-dinh-huong-dan-luat-bao-ve-du-lieu-ca-nhan)

**System evidence base:** `/Users/mk1e3/eno.vn/prisma/schema.prisma`, `/Users/mk1e3/eno.vn/src/app/privacy/page.tsx`, `/Users/mk1e3/eno.vn/src/lib/site-legal.ts`, `/Users/mk1e3/eno.vn/src/lib/edition-scope.ts`, `/Users/mk1e3/eno.vn/src/lib/core/seller.ts`, `/Users/mk1e3/eno.vn/src/lib/gemini.ts`, `/Users/mk1e3/eno.vn/src/lib/vertex-search.ts`, `/Users/mk1e3/eno.vn/src/lib/meta-capi.ts`, `/Users/mk1e3/eno.vn/src/lib/consent.ts`, `/Users/mk1e3/eno.vn/src/lib/ratelimit.ts`, `/Users/mk1e3/eno.vn/src/lib/ai-guard.ts`, `/Users/mk1e3/eno.vn/src/lib/core/media.ts`, `/Users/mk1e3/eno.vn/src/lib/otp-channels.ts`, `/Users/mk1e3/eno.vn/src/lib/mail.ts`, `/Users/mk1e3/eno.vn/src/app/api/account/export/route.ts`, `/Users/mk1e3/eno.vn/src/app/api/account/delete/route.ts`, `/Users/mk1e3/eno.vn/src/app/api/listings/[id]/contact/route.ts`, `/Users/mk1e3/eno.vn/next.config.ts`, `/Users/mk1e3/eno.vn/cloudbuild.yaml`, `/Users/mk1e3/eno.vn/docs/compliance-2026.md`, `/Users/mk1e3/eno.vn/scripts/purge-pre-launch-data.mjs`; production database read-only queries against `information_schema`, `pg_tables`, `cron.job`, `storage.buckets`, `auth.identities` on 13–14/08/2026. No code was modified.