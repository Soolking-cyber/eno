<!--
⚠️ DRAFT — NOT FILED, NOT LEGAL ADVICE. Prepared 2026-08-14 from the live codebase and the
production database, for review by Vietnamese counsel before lodgement with A05, Bộ Công an.

Three [OWNER INPUT] fields cannot be filled until the ERC is issued (expected week of 2026-08-21).
Section 7 lists what blocks filing. The owner deferred those to nearer MOIT issuance (2026-08-14):
the 14 VietKite e-visa listings stay visible for now, and the pre-launch purge runs later.

⛔ 2026-10-14 — OWNER DECISION THAT CHANGES §1, §2.3 AND §7.1 BEFORE FILING: eno.vn now has a dedicated e-Visa
subcategory (Services › e-Visa) open to ANY seller, each listing live only after eno's team has seen the provider's
licence ("Anyone posts, live after check"); /prohibited carries the visa listing rules on both sites (eno.vn's dated
amendment, PROHIBITED_AMENDMENT). eno itself still operates no visa service on eno.vn (HIDDEN_DESK_OWNER_EMAILS).
The dossier's description of a marketplace "with no visa services" is therefore no longer accurate, and the hiding fix
in §7.1 no longer applies: rewrite §1/§2.3 to describe third-party e-visa listings — counsel to review that wording.
The data that flows: (a) to an ORDINARY e-Visa seller, only what a buyer chooses to type in an ordinary chat, which
carries no photos or files (/privacy "Messages to e-Visa sellers"); (b) to the PARTNER listings with the in-chat
application (VietKite, MARKETPLACE_HOSTS_SERVICES), the passport and portrait photos /privacy's partner section
describes. ⚠️ From the amendment's in-force date /prohibited rule 1 wants the provider's licence on file before an
e-Visa listing is live — VietKite's is not yet (src/lib/visa-provider.ts PROVIDER_LICENCE_ON_FILE = false).
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
- **Bên Xử lý dữ liệu cá nhân (processors acting for eno):** Google Cloud (Google Asia Pacific Pte. Ltd.), Supabase Inc. (on AWS ap-southeast-1), Cloudflare Inc., Microsoft (Azure Translator), Resend Inc., Telegram Gateway, Meta Platforms (WhatsApp Business), VNG Corporation (Zalo ZNS); **Anthropic (Claude Haiku 5.5)** for teacher ↔ job matching, only for teachers who consent (added 08/10/2026 — §2.2 row 16, §3.2 row 22, B22; ⚠️ reached through the owner's Claude subscription, not under a DPA — **[COUNSEL]** on the role label). Full detail, per-recipient, in **Phụ lục B**.
- **Bên thứ ba (independent controllers receiving data with consent only):** Google LLC (Google Analytics 4), Meta Platforms Inc. (Conversions API). Both are switched off unless the user selects the "Allow all" consent tier. **TikTok (Events API; thêm 12/10/2026 — pháp nhân ký kết [VERIFY: TikTok Pte. Ltd.])** receives one event only — a teacher profile published for the first time — and only for an Advertising choice whose consent record shows it was made under a consent card that named TikTok (from 13/10/2026).
- **Chủ thể dữ liệu / data subjects:** registered users of eno.vn (buyers, sellers, both — the same account can be either), and non-registered visitors whose technical data reaches the edge and the logs. eno.vn serves the Vietnamese market with a substantial foreign-resident audience; the majority of subjects are expected to be **công dân Việt Nam**.

### 2.2 Mục đích xử lý dữ liệu cá nhân / Purposes

| # | Mục đích | Căn cứ pháp lý / Basis |
|---|---|---|
| 1 | Tạo và bảo vệ tài khoản, xác thực đăng nhập (email magic link, mật khẩu, Google OAuth, OTP qua Zalo / WhatsApp / Telegram) | Thực hiện hợp đồng + sự đồng ý |
| 2 | Đăng tải, kiểm duyệt tự động và hiển thị tin rao vặt; tìm kiếm và duyệt tin | Thực hiện hợp đồng |
| 3 | Kết nối người mua với người bán: trò chuyện 1:1 trong ứng dụng, chào giá (offer), tiết lộ số điện thoại người bán theo yêu cầu | Thực hiện hợp đồng |
| 4 | Xác nhận giao dịch hai chiều (người bán đánh dấu đã bán, người mua xác nhận) và lưu hồ sơ giao dịch | Nghĩa vụ pháp lý (Luật TMĐT 122/2025 — lưu trữ dữ liệu hợp đồng 3 năm) |
| 5 | Đánh giá người bán, điểm uy tín (trust score), thứ hạng hiển thị. Từ ngày triển khai (dự kiến 16/10/2026), đầu vào gồm KẾT QUẢ xác minh danh tính khi còn hiệu lực: +10 điểm (`TRUST.V_KYC`) cho mọi tài khoản trên cả hai phiên bản, suy ra trực tiếp từ `identity_verifications` bằng `deriveVerification` — không bao giờ từ bộ đệm `Profile` hay sự kiện sổ cái; mất khi giấy tờ hết hạn hoặc bị thu hồi (ở lần tính lại kế tiếp — tác vụ `identity-reconcile` lúc 09:05 ICT tính lại mọi tài khoản có hồ sơ xác minh). Chỉ dùng kết quả, không dùng giấy tờ | Lợi ích chính đáng / thực hiện hợp đồng — /legal/ranking và mục "Điểm uy tín" của Chính sách công bố danh tính đã xác minh là một đầu vào — **[COUNSEL]**: điểm hiển thị công khai trên tin đăng, nên mức tăng 10 điểm có thể cho thấy kết quả xác minh kể cả khi giáo viên không bật nhãn (mục 8b) — Chính sách nói rõ điều này (đoạn Xác minh danh tính và Hồ sơ giáo viên); và các tài khoản đã xác minh trước ngày triển khai (2 tài khoản, MEASURED 15/10/2026) đã đồng ý theo phiên bản đồng ý cũ (`consentVersion`), không nhắc đến điểm uy tín — chưa xin đồng ý lại: **[OWNER INPUT]** |
| 6 | Phòng chống gian lận và lạm dụng: báo cáo vi phạm, phòng tranh chấp, chế tài, chống né lệnh cấm, giới hạn tần suất | Nghĩa vụ pháp lý + bảo vệ quyền lợi chủ thể khác |
| 7 | Thu thập danh tính pháp lý người bán (họ tên, địa chỉ, số CCCD/ĐKKD, mã số thuế) và cung cấp cho người mua khi được yêu cầu và cho cơ quan nhà nước | Nghĩa vụ pháp lý (NĐ 52/2013 Đ.29; Luật TMĐT 122/2025) |
| 8 | Xác minh doanh nghiệp (tải lên giấy tờ định danh + giấy tờ ngân hàng để nhân viên xét duyệt) | Sự đồng ý rõ ràng, có ghi nhận `SellerVerification.consentAt` + `consentVersion` |
| 8a | Dùng KẾT QUẢ xác minh danh tính / doanh nghiệp (đã xác minh hay chưa — không dùng giấy tờ) để đặt hạn mức số giáo viên mới mà một tài khoản được nhắn tin mỗi ngày (3 / 10 / 30) và hiển thị cho giáo viên mức xác minh của người nhắn; với tài khoản chưa xác minh danh tính, các cuộc trò chuyện mới từ cùng một kết nối internet dùng chung hạn mức 6/ngày, đếm bằng bản băm một chiều của địa chỉ kết nối (không lưu địa chỉ), giữ 2 ngày — chống lạm dụng tin nhắn với giáo viên (chủ sở hữu, 2026-10-13; `src/lib/teachers/dm-quota.ts`) | Nghĩa vụ pháp lý + bảo vệ quyền lợi chủ thể khác — cùng cơ sở với mục 6 (chống lạm dụng); công bố trong Chính sách bảo vệ dữ liệu cá nhân (đoạn Xác minh danh tính và Hồ sơ giáo viên, 2026-10-13). Không xin thêm đồng ý, kể cả với tài khoản đã xác minh trước đó (quyết định của chủ sở hữu, 2026-10-13; chưa có ý kiến pháp lý). Người nhắn tin được thông báo qua Chính sách bảo vệ dữ liệu cá nhân (đoạn Xác minh danh tính: kết quả đặt hạn mức, và giáo viên được biết họ đã xác minh hay chưa); giáo viên qua Chính sách (đoạn Hồ sơ giáo viên) và một thông báo trong ứng dụng (không gửi email — chủ sở hữu), đã gửi một lần ngày 2026-10-13 tới 37 giáo viên |
| 8b | **Nhãn “Đã xác minh danh tính” của giáo viên** (thêm cùng đợt triển khai, dự kiến 16/10/2026): khi giáo viên tự bật, nhãn hiển thị trên hồ sơ công khai, trên thẻ hồ sơ trong các danh sách và với người nhắn tin cho giáo viên về hồ sơ — chỉ khi đồng thời (1) đồng ý theo `IDENTITY_MARK_NOTICE_VERSION` hiện hành, (2) `deriveVerification` = `verified`, (3) họ tên trên hồ sơ khớp với giấy tờ đã xác minh. Chỉ một giá trị đúng/sai rời máy chủ — không giấy tờ, số giấy tờ, quốc tịch, cấp xác minh hay ngày hết hạn; không có trong JSON-LD; không ảnh hưởng thứ hạng | **Sự đồng ý riêng, rõ ràng** — công tắc riêng ở bước "Ảnh & đăng", mặc định TẮT; ghi `identityMarkOn` / `identityMarkAt` / `identityMarkNoticeVersion` / `identityMarkWithdrawnAt`, không điền ngược; rút lại bằng cách tắt (gỡ khỏi hồ sơ, thẻ và các cuộc trò chuyện trong vòng vài phút; công cụ tìm kiếm có thể giữ bản cũ). Công bố trong Chính sách (đoạn Hồ sơ giáo viên và mục đích riêng); có trong dữ liệu tải xuống |
| 9 | Thông báo: trong ứng dụng, web push, email (thư tóm tắt hằng tuần, nhắc tin còn hàng, cảnh báo tìm kiếm đã lưu) — mỗi luồng có cơ chế từ chối riêng | Sự đồng ý, rút lại bất kỳ lúc nào |
| 10 | Dịch máy nội dung tin đăng và giao diện sang ngôn ngữ người dùng chọn | Thực hiện hợp đồng |
| 11 | Trợ lý AI: phân loại ảnh, chỉnh sửa mô tả, tìm kiếm bằng hình ảnh, trợ lý mua sắm (Google Vertex AI / Gemini; Vertex AI Search) | Sự đồng ý — đăng nhập bắt buộc, có hạn mức |
| 12 | Xác định vị trí để sắp xếp tin theo khoảng cách và hiển thị bản đồ | **Sự đồng ý rõ ràng** (quyền của trình duyệt) — dữ liệu vị trí là DLCN **nhạy cảm** |
| 13 | Trung tâm trợ giúp: hỏi–đáp có thể bình chọn, bình luận, lưu và báo cáo | Thực hiện hợp đồng |
| 14 | Đo lường và quảng cáo: Google Analytics 4, Meta Conversions API (server-side), TikTok Events API (server-side; chỉ sự kiện đăng hồ sơ giáo viên — triển khai 12/10/2026, áp dụng cho lựa chọn Quảng cáo từ 13/10/2026) | **Chỉ khi có sự đồng ý ở mức "Allow all"**; mặc định TẮT, kể cả phía máy chủ. Riêng TikTok: mục Quảng cáo được bật là đủ (không cần "Allow all"), kèm điều kiện bản ghi đồng ý theo thẻ có nêu tên TikTok (§3.2 dòng 23). Cách viết "Allow all" ở ô này đã cũ — §7 mục 11 |
| 15 | Nhật ký kỹ thuật (IP, user-agent) để giới hạn tần suất và chặn lạm dụng | Lợi ích chính đáng / an ninh hệ thống |
| 16 | **Gợi ý việc làm giảng dạy cho giáo viên** (thêm 08/10/2026): mô hình AI **Claude Haiku 5.5 của Anthropic** (mức suy luận trung bình) so khớp hồ sơ giáo viên với việc làm giảng dạy; việc làm đạt ≥ 70 điểm được gửi email cho giáo viên (tối đa 5 việc làm/email, tối đa 1 email/3 ngày) và, nếu giáo viên cho phép, đưa vào danh sách để nhân viên gọi điện. Chạy hằng ngày bằng kỹ năng /teachers trên máy của chủ sở hữu; chủ sở hữu duyệt từng kế hoạch trước khi ghi dữ liệu hay gửi email | **Sự đồng ý riêng, rõ ràng** — ô "Email me jobs that match my profile" và/hoặc "Our staff may call me" trong hồ sơ giáo viên, mặc định TẮT; mỗi ô ghi nhận thời điểm và phiên bản thông báo AI (`TeacherProfile.matchEmailOptInAt` / `matchEmailNoticeVersion`, `staffContactOptInAt` / `staffContactNoticeVersion`), và chỉ sự đồng ý theo phiên bản hiện hành (`AI_NOTICE_VERSION`, thông báo nêu tên Anthropic và việc chuyển ra nước ngoài) được tính; rút lại bằng cách tắt ô trong hồ sơ hoặc liên kết hủy đăng ký trong email (ghi `…WithdrawnAt`). **Lưu giữ:** khi cả hai ô đều tắt, mọi kết quả so khớp về giáo viên đó (`TeacherJobMatch`: điểm, lý do, lưu ý, trạng thái gọi điện) bị xóa ở lần nhập kế tiếp — trừ kết quả đã gửi email trong 3 ngày chờ (giữ đến hết 3 ngày để không gửi lại sớm, rồi xóa ở lần nhập sau); mẫu dưới ngưỡng và danh sách gọi điện cục bộ bị xóa sau 90 ngày (`src/lib/teachers/match-io.ts` `retentionWheres`) |
| 17 | **Lưu hồ sơ giáo viên chưa hoàn tất** (thêm 11/10/2026): khi giáo viên đã đăng nhập, các câu trả lời đang điền được lưu vào tài khoản để tiếp tục sau trên mọi thiết bị (bảng `TeacherDraft`, riêng tư — không công khai, không gửi trường học/công ty, không dùng cho gợi ý việc làm, không bao giờ chứa số điện thoại, ảnh, video hay sự đồng ý); xóa khi đăng hồ sơ, khi chọn "Bắt đầu lại", khi xóa tài khoản, hoặc sau 90 ngày không thay đổi (tác vụ hằng ngày) | Thực hiện hợp đồng (người dùng điền hồ sơ để đăng) — chủ sở hữu quyết định áp dụng cùng ngày triển khai, không thông báo trước 5 ngày **[COUNSEL]** |
| 18 | **Điền hồ sơ giáo viên từ CV** (thêm 15/10/2026): khi giáo viên chọn "Điền tự động từ CV của tôi", tệp giáo viên chọn (CV — PDF, ảnh, hoặc văn bản của tệp Word đọc ngay trên trình duyệt) được gửi tới **Google Vertex AI (Gemini 3.8 Flash, dự phòng 3.5 Flash-Lite; endpoint "global")** để trích xuất câu trả lời cho hồ sơ; chỉ điền vào các câu hỏi giáo viên **chưa** trả lời, lưu vào hồ sơ chưa hoàn tất (mục đích 17) để giáo viên kiểm tra và sửa; từ 16/10/2026 số điện thoại trong tệp được **điền** vào ô số điện thoại (riêng tư) nếu ô đang trống, và tệp PDF (≤ 10 MB) được **đính kèm** làm CV riêng tư của hồ sơ nếu chưa có CV — giáo viên đổi số hoặc xóa CV ở bước cuối; tệp chỉ được tải lên khi đăng hồ sơ. **Không lưu văn bản của tệp** (không ghi ở đâu trong route) | **Sự đồng ý rõ ràng, cụ thể** — thông báo hai lớp đặt ngay cạnh nút "Đồng ý và chọn CV" (`TEACHER_IMPORT_NOTICE_VERSION` — `2026-10-16b` từ khi thông báo nói rõ việc điền số điện thoại và đính kèm CV; nội dung trong `src/lib/teachers/import-notice.ts`); máy chủ ghi bản ghi đồng ý `teacher.import.consent` (phiên bản + băm nội dung thông báo, loại tệp, ngôn ngữ, máy chủ, bên nhận, vị trí) **trước khi** tệp rời đi — ghi thất bại thì không gửi; kết quả `teacher.import.result` chỉ ghi **tên trường**, không bao giờ ghi giá trị từ tệp. Hạn mức: 6/giờ, 20/ngày mỗi tài khoản; 400/ngày toàn tính năng. Trong ứng dụng gốc có thêm câu hỏi Google AI riêng (họ `teacher_cv`) |
| 19 | ~~Đăng nhập bằng LinkedIn~~ — **đã gỡ bỏ 16/10/2026** (chủ sở hữu: "remove linkedin login"), **chưa từng được bật** (GoTrue `external.linkedin_oidc` = false, đo ngày 16/10/2026): không có định danh, mã truy cập hay bản ghi đồng ý LinkedIn nào được tạo | — |
| 20 | **Kiểm tra ảnh hồ sơ giáo viên** (thêm 16/10/2026): khi giáo viên chọn ảnh hồ sơ (tải lên, hoặc ảnh tài khoản được điền sẵn), ảnh — thu nhỏ ≤ 768 px, JPEG, **bỏ toàn bộ siêu dữ liệu** — được gửi tới **Google Vertex AI (Gemini 3.5 Flash-Lite, dự phòng 3.8 Flash; endpoint "global")**, mô hình chỉ trả lời ba thông tin: ảnh thật hay không, có thấy khuôn mặt hay không, có phải toàn trẻ nhỏ hay không — **không nhận diện, không ước tính tuổi/giới tính/dân tộc**; mã nguồn quyết định (ảnh không đạt thì không thể đăng). Ảnh đã có trên hồ sơ được kiểm tra một lần (`/api/cron/teacher-photo-recheck`), ảnh không đạt → giáo viên được **đề nghị** đổi ảnh (thông báo trong ứng dụng + email dịch vụ), không ẩn hồ sơ. Chỉ lưu **kết quả** (bộ nhớ đệm kv ≤ 180 ngày) và các bản ghi kiểm toán `teacher.photo.ask` / `.refused` / `.override` | **Thực hiện hợp đồng** — kiểm duyệt tự động tin đăng (mục đích 2; hồ sơ giáo viên là một tin đăng), công khai trong /privacy (dòng Google, đoạn hồ sơ giáo viên, đoạn quyết định tự động) và ngay cạnh nút chọn ảnh. Con đường con người: giáo viên báo từ trang Trợ giúp → nhân viên chấp thuận ảnh tại Admin › Catalogue › Teacher photos (`teacher.photo.override`, mọi lần kiểm tra đều tôn trọng). **[COUNSEL]** xác nhận cơ sở "thực hiện hợp đồng" cho bước kiểm tra bắt buộc này — kể cả lần kiểm tra MỘT LẦN các ảnh đã có trên hồ sơ khi triển khai, giáo viên không thao tác gì (đề nghị đổi ảnh, không ẩn hồ sơ) — và việc ảnh có học viên (trẻ em) được gửi xử lý tạm thời — giáo viên cần sự cho phép (Điều khoản) |
| 21 | **Đăng nhập bằng Facebook ("Tiếp tục với Facebook")** (thêm 16/10/2026, chủ sở hữu: "if needed add sign in with facebook"; trên web, không trong ứng dụng): nhà cung cấp `facebook` của GoTrue, phạm vi `email` + hồ sơ công khai — Meta gửi cho eno **mã định danh Facebook riêng cho ứng dụng, họ tên, email và liên kết ảnh đại diện** (`/me?fields=email,first_name,last_name,name,picture`). Lưu: dòng định danh của GoTrue (`auth.identities`) và email + tên hiển thị của tài khoản (`src/lib/profile.ts`). **Không bao giờ lưu mã truy cập của Facebook** (trigger trên `auth.flow_state` do `infra/vn-node/apply-facebook-signin.sh` cài + `stripFacebookToken` ở `/auth/callback`, thất bại thì hủy đăng nhập); **không lấy ảnh** (liên kết hết hạn — `providerAvatarUrl`); không có email → không tạo tài khoản (mặc định của GoTrue); **không bao giờ gắn Facebook vào một tài khoản đã có** và không tạo cho địa chỉ của quản trị viên (trigger `eno_refuse_facebook_identity` trên `auth.identities`). **Tắt cho đến khi chủ sở hữu cấu hình** (GoTrue `external.facebook`) | **Thực hiện hợp đồng** — một cách đăng nhập người dùng tự chọn (như Google, Apple), công khai trong /privacy (dòng Meta (Tiếp tục với Facebook), đoạn thông tin tài khoản). **[COUNSEL]** xác nhận Meta là bên kiểm soát độc lập khi cung cấp đăng nhập |

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
- **Giấy tờ tùy thân và ảnh chân dung trong hồ sơ xác minh danh tính** — `identity_verifications` (Phụ lục A24) và ảnh trong kho riêng `business-verification`, đường dẫn `<profileId>/identity/…` (`src/lib/kyc/store.ts`). MEASURED 15/10/2026: 2 đã xác minh, 1 bị từ chối.
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
  │           ├→ Meta CAPI · Google Analytics   ⟨CHỈ KHI CÓ ĐỒNG Ý "Allow all"⟩
  │           └→ TikTok Events API              ⟨CHỈ KHI Quảng cáo được bật theo thẻ đồng ý nêu tên TikTok⟩
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

Empty today, and to remain so at filing: `EnforcementAction`, `BannedIdentity`, `SellerVerification`, `compliance_audit`, `takedown_orders`, `NativePushToken`, `identity_claim`. (`identity_verifications` is no longer empty: written since 21/08/2026 — MEASURED 15/10/2026: 2 verified, 1 rejected; whether real verifications survive the purge is **[OWNER INPUT]**.)

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
| Dữ liệu bị chuyển cho bên quảng cáo ngoài ý muốn | Trung bình | Behavioural data reaching Meta/TikTok/Google without consent | Browser pixel removed entirely; the only ad path is server-side (Meta CAPI, TikTok Events API), gated on a consent **cookie** the server can read, failing closed when absent. TikTok additionally requires the server-written consent **record** to show Advertising was switched on under a card that named TikTok — a "yes" given to the earlier wording is not reused (one known edge: §3.3, row 23) |
| Quyết định tự động (điểm tin nhiệm, thứ hạng) gây bất lợi | Trung bình | A seller loses visibility or is restricted by an automated score | Ranking formula published at /legal/ranking with exact weights; every trust event is itemised and disputable; enforcement is a ladder with a one-shot appeal and a documented outcome; drift-based score decay was **removed** so a score only moves on evidence |
| AI so khớp việc làm (Anthropic) đánh giá giáo viên *(08/10/2026)* | Trung bình | The judge reads nationality and native-speaker status, so a score may weigh nationality; free text may still carry a nickname the name filter misses; the profile leaves Vietnam under consumer terms | Consent-only, per opt-in, under the notice naming Anthropic; no name, contact, photo, video or CV field is exported and the name's words are taken out of the free text (best effort); the score only picks which jobs are SUGGESTED to the teacher — schools never see it and nothing is applied for on anyone's behalf; the owner approves each day's plan; withdrawal by switch or unsubscribe, stamped; the access export includes every match. **[COUNSEL]** on dropping nationality from the judge's input unless a job states it |
| AI đọc CV giáo viên (Google Gemini) *(15/10/2026)* | Trung bình | A CV often carries sensitive data (health, religion, ethnicity, criminal record, ID numbers) and third parties' details (referees); the model sees the whole file; hidden text in a file can try to steer the model; a wrong file can be someone else's CV | Consent beside the act, recorded before the file leaves; the notice says what CVs hold and to remove it first, and "choose only your own CV"; nothing of the file is stored or logged (field names only); the model fills only EMPTY answers into the private draft, the teacher checks every one and nothing is published by it; text Word itself marks hidden (or under 3pt) is dropped in the browser — best-effort hygiene — and the model is told the file is data, not instructions, between random per-reading marks; the extracted answers pass the same contact/banned-word screening as typed ones; Undo of a first reading deletes the draft; per-account and feature caps. **Low-risk AI** (a drafting aid, no decision about the person). **[OWNER]** cross-border transfer impact assessment update within 60 days of the first CV read |
| AI kiểm tra ảnh hồ sơ giáo viên (Google Gemini) *(16/10/2026)* | Thấp–trung bình | A wrong refusal blocks a real teacher's photo; a photo with students sends children's faces abroad for a few seconds; the photo leaves Vietnam | Lenient by design (fails only a non-photo, no face, or young children only — measured 0 wrong on 84 live photos + 42 hard cases); no identity, age, gender or looks in the answer; photo re-encoded without metadata; only the verdict kept (≤ 180 days); refusal copy names the human route and an admin can approve a photo durably; existing teachers are asked, never hidden; /privacy asks teachers to have their students' or parents' permission |
| Đăng nhập bằng Facebook *(16/10/2026)* | Thấp | GoTrue links a Facebook identity into an existing same-email account (Facebook emails count as verified), so whoever controls a Facebook account carrying someone's email could enter that person's eno account; Facebook's access token is a bearer token | A database trigger on `auth.identities` never adds a Facebook identity to an account that already has another way in, nor creates one for an ADMIN_EMAILS address (proved by the apply script; the callback also undoes a Facebook sign-in on an operator address). Residual: if Facebook ever returned an address it has not confirmed, an account made first with Facebook under someone else's address would later open to that person's email code while its maker kept Facebook access — not known to happen (GoTrue/Supabase treat Facebook's emails as verified); separate linking domains were rejected because they strand Facebook-made accounts from email sign-in; the token never stored (flow_state trigger, verified by the script) and stripped fail-closed at the callback; no photo taken; dark until configured; offered below the emailed code in in-app browsers until it is seen to work there |
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
| 16 | **Meta Platforms, Inc. — Conversions API** | Hoa Kỳ | `sha256(email)` (không gửi với tài khoản Sign in with Apple hoặc địa chỉ relay của Apple), `sha256(số điện thoại)`, `sha256(id nội bộ)`, **IP thô**, user-agent, cookie `_fbp`/`_fbc` | Đo lường chuyển đổi quảng cáo | **Bên Thứ ba / Bên Kiểm soát độc lập** | **CHỈ khi có đồng ý "Allow all"**; máy chủ fail-closed khi không có cookie đồng ý | `src/lib/meta-capi.ts:23,44–50` |
| 17 | **Google LLC — Analytics 4** (`G-CKTZK62B0X`) | Hoa Kỳ | Client-id, lượt xem trang, sự kiện, IP | Đo lường sử dụng | **Bên Thứ ba** | **CHỈ khi có đồng ý "Allow all"**; không nạp mã cho đến khi người dùng tương tác | `src/components/marketplace/analytics-tags.tsx:22,70` |
| 18 | **Google / Mozilla / Apple — dịch vụ Web Push** | Hoa Kỳ, toàn cầu | URL endpoint đẩy + khóa `p256dh`/`auth` + nội dung thông báo | Gửi thông báo đẩy | Bên Xử lý (theo tiêu chuẩn Web Push) | VAPID; nội dung mã hóa đầu-cuối theo chuẩn | `src/lib/push.ts` |
| 19 | **Google — Firebase Cloud Messaging + Apple APNs** | Hoa Kỳ | Token thiết bị + nội dung thông báo | Đẩy thông báo cho ứng dụng gốc | Bên Xử lý | DPA. **Trạng thái: chưa hoạt động — `NativePushToken` = 0 dòng** | `src/lib/native-push.ts:63` |
| 20 | **Google — Identity Services / OAuth** | Hoa Kỳ | Email, họ tên, ảnh đại diện từ tài khoản Google | Đăng nhập bằng Google — **13/22 danh tính hiện dùng Google** | Bên Thứ ba | Người dùng chủ động chọn; phạm vi tối thiểu | `auth.identities` MEASURED |
| 21 | **Telegram / Meta (đăng bài tự động)** | Ngoài Việt Nam | Nội dung tin đăng công khai + ảnh | Phân phối tin đăng lên kênh mạng xã hội | Bên Thứ ba | Chỉ chạy khi biến môi trường được đặt. **[VERIFY trạng thái trong môi trường sản xuất]** | `src/lib/syndicate.ts:49,68` |
| 22 | **Anthropic — Claude Haiku 5.5** (`claude-haiku-5-5`, mức suy luận trung bình; thêm 08/10/2026) | **Ngoài Việt Nam** (Hoa Kỳ) — vùng xử lý **[VERIFY]**: tuyến gói thuê bao không ghi nhận `inference_geo` | **Chỉ giáo viên đã đồng ý theo thông báo AI hiện hành:** tiêu đề và phần giới thiệu (tên của giáo viên được lược bỏ), quốc tịch, người bản ngữ hay không, thành phố đang sống và các thành phố có thể dạy, có dạy trực tuyến không, môn dạy, độ tuổi học viên, loại công việc, số năm kinh nghiệm, bằng cấp, loại chứng chỉ, mức lương mong muốn, ngày có thể bắt đầu; cùng thông tin công khai của việc làm giảng dạy. **Không bao giờ** có tên, ảnh, video, số điện thoại, email hay CV | So khớp giáo viên ↔ việc làm giảng dạy (mục đích 16) | Bên Xử lý **[COUNSEL]** | Gửi qua **gói thuê bao Claude của chủ sở hữu** (CLI `claude` đã đăng nhập trên máy của chủ sở hữu) — ⚠️ **điều khoản người tiêu dùng, không có DPA**; việc dữ liệu đầu vào có được dùng để huấn luyện mô hình hay không phụ thuộc cài đặt của tài khoản **[VERIFY: đã tắt]**; tệp đầu vào/đầu ra lưu cục bộ (0600) và bị xóa sau 90 ngày | `scripts/teachers-match.ts` (export: `aiMatchConsented`, `toMatchTeacher`); `~/eno-lead-pipeline src/cli/teachersMatch.ts` |
| 23 | **TikTok — Events API** (dataset `DB68R83C77UAU0U4E950`; thêm 12/10/2026; pháp nhân ký kết **[VERIFY: TikTok Pte. Ltd.]**) | **Ngoài Việt Nam** — nơi lưu trữ **[VERIFY: Singapore / Hoa Kỳ]** | Một sự kiện "hoàn tất đăng ký" khi một hồ sơ giáo viên được đăng công khai lần đầu: `sha256(email)` (không gửi với tài khoản Sign in with Apple, tài khoản liên kết Facebook (Điều khoản Nền tảng Meta: không chuyển dữ liệu Nền tảng cho mạng quảng cáo khác) hoặc địa chỉ relay của Apple), `sha256(số điện thoại đã xác minh)`, `sha256(id nội bộ)`, **IP thô**, user-agent, mã tin đăng + danh mục, địa chỉ trang đăng ký. **Không** cookie, **không** mã nhấp quảng cáo, không pixel trình duyệt | Đo lường chuyển đổi quảng cáo | **Bên Thứ ba / Bên Kiểm soát độc lập** **[COUNSEL — câu hỏi 12c]** | **CHỈ khi mục Quảng cáo được bật theo thẻ đồng ý có nêu tên TikTok**: cookie đồng ý **và** các bản ghi đồng ý do máy chủ ghi phải cho thấy mục Quảng cáo được **bật** (từ trạng thái tắt, hoặc ở câu trả lời đầu tiên) trong một bản ghi có phiên bản nội dung thẻ ≥ `2026-10-12` **và** thời điểm máy chủ ghi ≥ 00:00 ngày 13/10/2026 giờ Việt Nam (UTC+7), và vẫn bật từ đó; một lựa chọn "có" cũ chỉ được lưu lại sau ngày đó không được tính (ngoại lệ đã biết: bản ghi cũ chưa từng được ghi — §3.3 dòng 23, câu hỏi 12b). Máy chủ fail-closed. Tắt mục Quảng cáo chỉ ngăn các sự kiện về sau; sự kiện đã gửi do TikTok lưu giữ với tư cách bên kiểm soát độc lập — thời hạn lưu giữ **[VERIFY]**. eno không lưu bản ghi về việc gửi, nên bản xuất dữ liệu tài khoản không có mục này | `src/lib/tiktok-events.ts`, `src/lib/tiktok-consent.ts`, `src/lib/tiktok-consent-record.ts`, `src/app/api/teachers/me/route.ts` |
| 24 | **Google — Vertex AI (Gemini 3.8 Flash; dự phòng 3.5 Flash-Lite) — đọc CV giáo viên** (thêm 15/10/2026) | **Endpoint "global"** — Google có thể xử lý tại nhiều vùng | **Chỉ khi giáo viên chọn:** toàn bộ tệp CV giáo viên tự chọn — PDF/ảnh gửi nguyên dạng (ảnh đã nén, bỏ EXIF), tệp Word gửi dưới dạng văn bản hiển thị. CV có thể chứa dữ liệu nhạy cảm (sức khỏe, tôn giáo, dân tộc, tiền án, số giấy tờ) và thông tin người giới thiệu — thông báo nói rõ và khuyên xóa trước | Điền hồ sơ giáo viên (mục đích 18) | Bên Xử lý | CDPA của Google Cloud (☐ cần lưu bản sao); Google không dùng để huấn luyện; lưu đệm ngắn hạn; nhật ký lạm dụng ≤ 90 ngày **[VERIFY: cân nhắc tắt implicit caching của Vertex trên dự án]**; eno không lưu văn bản của tệp (tệp PDF chỉ được lưu dưới dạng CV riêng tư đính kèm hồ sơ, giáo viên có thể xóa); đồng ý ghi trước khi gửi | `src/app/api/teachers/me/import/route.ts`, `src/lib/teachers/import-ai.ts`, `src/lib/teachers/import-file.ts` |
| 25 | ~~LinkedIn — Sign In with LinkedIn~~ — **đã gỡ bỏ 16/10/2026, chưa từng được bật** (xem mục đích 19) | — | — | — | — | — | — |
| 26 | **Google — Vertex AI (Gemini 3.5 Flash-Lite; dự phòng 3.8 Flash) — kiểm tra ảnh hồ sơ giáo viên** (thêm 16/10/2026) | **Endpoint "global"** — Google có thể xử lý tại nhiều vùng | Ảnh hồ sơ giáo viên (thu nhỏ ≤ 768 px, bỏ siêu dữ liệu) — có thể có khuôn mặt học viên nếu giáo viên chọn ảnh chụp cùng lớp | Kiểm duyệt ảnh hồ sơ (mục đích 20) | Bên Xử lý | CDPA của Google Cloud (☐ cần lưu bản sao); Google không dùng để huấn luyện; nhật ký lạm dụng ≤ 90 ngày; eno chỉ lưu kết quả (≤ 180 ngày) | `src/lib/teachers/photo-check.ts`, `src/lib/teachers/photo-verdict.ts`, `src/app/api/teachers/me/photo-check/route.ts` |
| 27 | **Meta Platforms — Facebook Login ("Tiếp tục với Facebook")** (thêm 16/10/2026) — pháp nhân **[VERIFY: Meta Platforms, Inc. / Meta Platforms Ireland Ltd.]** | **Ngoài Việt Nam** | **Chiều nhận về:** mã định danh Facebook riêng cho ứng dụng, họ tên, email, liên kết ảnh đại diện. **Chiều gửi đi:** việc người dùng đang đăng nhập vào eno (Meta biết qua hộp thoại đăng nhập) | Đăng nhập (mục đích 21) | Bên Kiểm soát độc lập **[COUNSEL]** | Người dùng chủ động chọn; phạm vi tối thiểu (`email`, `public_profile`, không cần App Review); không lưu mã truy cập; không dùng ảnh. **Tắt cho đến khi cấu hình** | `src/lib/facebook-signin.ts`, `src/lib/auth/facebook.ts`, `src/app/[lang]/auth/callback/route.ts`, `infra/vn-node/apply-facebook-signin.sh` |

### 3.3 Mô tả và luận giải mục tiêu xử lý sau khi chuyển ra nước ngoài

The transfers are **infrastructural, not commercial**. eno.vn does not send personal data abroad in order to have it exploited there; it runs on managed infrastructure whose nearest regions are in Singapore, and the data is processed abroad only to deliver the service the user asked for:

- **Rows 1–4 (hosting and database)** exist because there is no Vietnam region for the managed Postgres and container platform in use. The data does not leave the operator's control: it sits in the operator's own project, under the operator's own credentials, with row-level security on every table.
- **Rows 6–9 (AI and translation)** are per-request calls, not bulk exports. The AI search index carries **public listing fields only, with seller contact data deliberately excluded at the document-mapping layer**.
- **Rows 12–14 (email and OTP)** transfer the minimum needed to deliver a message: an address or a phone number and the message body. The OTP is never logged.
- **Rows 16–17 (advertising and analytics)** are the only transfers made for a purpose the user could reasonably decline, and they are the only ones that require explicit opt-in. Without the "Allow all" tier **nothing is sent, server-side included**.
- **Row 22 (AI teacher matching, 08/10/2026)** is opt-in too, and narrower still: only teachers who ticked an opt-in under the AI notice that names Anthropic are exported (an older tick, given under the earlier Gemini note, does not count until the teacher confirms again); the export selects no name, contact, photo, video or CV field; and it runs per day, after the owner approves the day's plan. ⚠️ It reaches Anthropic through the owner's own Claude subscription (consumer terms, no DPA) — **[COUNSEL]**: whether that can stand as a processor arrangement, or the judge must move to the Claude API under Anthropic's commercial terms and DPA, which would get its own row.
- **Row 23 (TikTok, deployed 12/10/2026)** serves the same purpose as transfer row 16 (purpose 14) and is narrower: one event (a teacher profile first published), no cookie, no click identifier and no browser pixel, and only for an Advertising choice whose server-written consent record shows it was made under a card that named TikTok, on or after 00:00 on 13/10/2026 Vietnam time (the record must carry that card's version and a server-written time). Nobody was asked again. The event is sent only at first publication, so a profile published before a qualifying choice is never reported later. ⚠️ Known edge — **[COUNSEL]**: if a visitor's older consent record was never written (rate limit, blocked request), a later re-save of their settings reads as a first answer. **[COUNSEL]**: the recipient was added to /privacy and to the consent card on the day it went live (12/10/2026), with no notice period — is counting only choices made from the next day enough?

### 3.4 Loại dữ liệu cá nhân chuyển ra nước ngoài

Per row in §3.2. In aggregate: **the entire Appendix A inventory is transferred to Singapore** by virtue of rows 1–2; a strictly narrower subset reaches rows 5–23. **Sensitive personal data transferred:** location (`Listing.lat/lng`) as part of row 1; identity and bank documents in the private `business-verification` bucket as part of row 1; behavioural data as part of rows 1, 16, 17 and 23 (the last three only with consent).

### 3.5 Sự tuân thủ và biện pháp bảo vệ áp dụng cho việc chuyển

- Chuyển qua kênh mã hóa TLS; không có kênh truyền dữ liệu cá nhân nào không mã hóa.
- Từng bên nhận bị ràng buộc bằng **hợp đồng xử lý dữ liệu (DPA)** — ⚠️ §7 gap 5.
- Nguyên tắc tối thiểu hóa được thực thi trong mã nguồn, không chỉ trong chính sách: chỉ mục AI loại trừ số điện thoại; định danh (email, số điện thoại, id nội bộ) gửi cho Meta và TikTok được băm SHA-256 tại nguồn — địa chỉ IP và user-agent được gửi dạng thô; địa chỉ email trong nhật ký được che.
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
| A23 | Hồ sơ giáo viên chưa hoàn tất *(11/10/2026)* | `TeacherDraft.data` (câu trả lời đang điền: nơi sống, loại công việc, khu vực dạy, lương mong muốn, môn học, kinh nghiệm, bằng cấp, họ tên, quốc tịch, tiêu đề, giới thiệu, và — nếu đã nhập — các buổi rảnh và mức phí dạy thay; **không** số điện thoại, ảnh, video, công tắc dạy thay hay sự đồng ý), `.step`, `.rev`, `.createdAt`, `.updatedAt` | Cơ bản | Giáo viên đã đăng nhập, chưa đăng hồ sơ | Tiếp tục điền hồ sơ trên mọi thiết bị (mục đích 17) | Xóa khi đăng hồ sơ / "Bắt đầu lại" / xóa tài khoản (FK cascade); **90 ngày** sau lần thay đổi cuối (`/api/cron/teacher-draft-retention`, hằng ngày) | RLS bật, không policy; chỉ chủ tài khoản đọc qua `/api/teachers/me/draft` (`Cache-Control: private, no-store`); có trong dữ liệu tải xuống (`teacherProfileDraft`) |
| A24 | Hồ sơ xác minh danh tính *(đấu nối từ 21/08/2026)* | `identity_verifications`: `tier`, `method`, `status`, `submittedAt`, `decidedAt`, `decidedBy`, `rejectReason`, `subjectHash` (HMAC với `IDENTITY_HASH_PEPPER`), `fullName`, `nationality`, `residenceCountry`, `residenceSource`, `birthYear`, `documentType`, `documentExpiresAt`, `assuranceLevel`, `evidence`, `declarationVersion` / `declarationHash` / `declaredAt` / `declarationIp`, `documentsPurgedAt`; ảnh giấy tờ và ảnh chân dung trong kho riêng `business-verification`, đường dẫn `<profileId>/identity/…` | **Nhạy cảm** | Tài khoản gửi xác minh danh tính | Mục 5, 7, 8a, 8b | **[VERIFY]**. Khi xóa tài khoản: `profileId` → NULL, xóa họ tên, quốc tịch và nơi cư trú, bỏ đường dẫn ảnh và dữ liệu đầu vào khỏi `evidence`, ảnh vào hàng đợi xóa (`src/lib/core/account-erasure.ts`); giữ `subjectHash`, quyết định và ngày hết hạn | Ảnh trong kho riêng, không truy cập được từ internet; nhân viên xét duyệt, không bao giờ duyệt tự động; ngoài quy trình xét duyệt chỉ dùng KẾT QUẢ (đã xác minh hay chưa) |
| — | **Ngoài phạm vi hồ sơ này — sẽ xóa trước khi nộp** | `visa_applications`, `visa_documents`, `visa_events`, `visa_payments`, `visa_prefill_sessions`, `vnpt_access_token`, `vnpt_quota`; `Itinerary*`, `TripAssistance*`; kho `visa-documents` | — | — | — | Xóa bằng `scripts/purge-pre-launch-data.mjs --execute --with-storage` | Biên nhận xóa là bằng chứng — §2.7 |
| — | **Có lược đồ nhưng CHƯA ĐƯỢC ĐẤU NỐI — không mô tả là đang vận hành** | `takedown_orders`, `compliance_audit` (`identity_verifications` đã được đấu nối — A24) | — | — | — | 0 dòng | MEASURED: không có route API hay trang nào ghi vào hai bảng này |

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
| B15 | Meta Platforms, Inc. — Conversions API | US | `sha256(email/phone/id)` (email không gửi với tài khoản Apple hoặc relay của Apple), IP, user-agent, `_fbp`, `_fbc` | Đo lường quảng cáo | **Bên Kiểm soát độc lập** | **Chỉ khi đồng ý "Allow all"**; máy chủ fail-closed | ☐ **[VERIFY khóa có được đặt trong môi trường sản xuất không]** |
| B16 | Google LLC — Analytics 4 (`G-CKTZK62B0X`) | US | Client-id, lượt xem, sự kiện, IP | Đo lường sử dụng | **Bên Kiểm soát độc lập** | **Chỉ khi đồng ý "Allow all"**; chỉ nạp sau khi người dùng tương tác | ☐ |
| B17 | Google / Mozilla / Apple — Web Push | US, toàn cầu | Endpoint đẩy + khóa + nội dung | Thông báo đẩy | Bên Xử lý (theo chuẩn) | VAPID; nội dung mã hóa | n/a — dịch vụ chuẩn |
| B18 | Google FCM + Apple APNs | US | Token thiết bị + nội dung | Đẩy cho ứng dụng gốc | Bên Xử lý | **CHƯA HOẠT ĐỘNG — 0 token** | ☐ |
| B19 | Google — Identity Services / OAuth | US | Email, họ tên, ảnh từ tài khoản Google | Đăng nhập bằng Google (13/22 danh tính) | Bên Thứ ba | Người dùng chủ động; phạm vi tối thiểu | n/a |
| B20 | Telegram / Meta — đăng bài tự động | Ngoài VN | Nội dung tin đăng công khai + ảnh | Phân phối tin đăng | Bên Thứ ba | Chỉ chạy khi biến môi trường được đặt | ☐ **[VERIFY trạng thái]** |
| B21 | Cơ quan nhà nước có thẩm quyền | Việt Nam | Theo yêu cầu hợp pháp | Nghĩa vụ pháp lý | — | Chỉ trong phạm vi thẩm quyền; thông báo cho chủ thể khi được phép | n/a |
| B22 | Anthropic — Claude Haiku 5.5, qua gói thuê bao Claude của chủ sở hữu (CLI `claude`) — pháp nhân ký kết **[VERIFY]** | Ngoài VN (Hoa Kỳ) **[VERIFY vùng xử lý]** | Các trường hồ sơ giáo viên đã xuất (không tên, không liên hệ) + thông tin công khai của việc làm | So khớp giáo viên ↔ việc làm (mục đích 16), chỉ khi giáo viên đồng ý | Bên Xử lý **[COUNSEL]** | Chỉ giáo viên đồng ý theo `AI_NOTICE_VERSION`; không gửi tên/liên hệ; chủ sở hữu duyệt từng lần chạy | ✗ **Không có DPA — điều khoản người tiêu dùng [COUNSEL]**. Nếu chuyển sang Claude API (Console, điều khoản thương mại + DPA), ghi một dòng riêng |
| B23 | TikTok — Events API (email không gửi với tài khoản Apple, tài khoản liên kết Facebook — Điều khoản Nền tảng Meta — hoặc relay của Apple) (dataset `DB68R83C77UAU0U4E950`) — pháp nhân ký kết **[VERIFY: TikTok Pte. Ltd.]** | Ngoài VN **[VERIFY: Singapore / US]** | `sha256(email/phone/id)`, **IP thô**, user-agent, mã tin đăng + danh mục, địa chỉ trang đăng ký — một sự kiện khi hồ sơ giáo viên được đăng lần đầu | Đo lường quảng cáo | **Bên Kiểm soát độc lập** **[COUNSEL]** | **Chỉ khi Quảng cáo được bật theo thẻ đồng ý có nêu tên TikTok** (bản ghi đồng ý từ 13/10/2026); máy chủ fail-closed | ☐ **cần thu thập** — điều khoản dữ liệu của TikTok for Business **[VERIFY tên văn bản, và văn bản nào áp dụng cho Bên Kiểm soát độc lập]**. Khóa được chủ sở hữu cài vào môi trường sản xuất của eno.vn ngày 12/10/2026 (theo kết quả lệnh cài đặt) |
| B24 | Google — Vertex AI (Gemini), đọc CV giáo viên | **"global"** | Tệp CV giáo viên tự chọn | Điền hồ sơ giáo viên (mục đích 18) | Bên Xử lý | Đồng ý ghi trước khi gửi; không lưu văn bản (PDF chỉ thành CV riêng tư đính kèm); không huấn luyện | ☐ Nằm trong CDPA của B2 — **cần lưu bản sao** |
| B25 | ~~LinkedIn (Sign In with LinkedIn)~~ — đã gỡ bỏ 16/10/2026, chưa từng được bật | — | — | — | — | — | — |
| B26 | Google — Vertex AI (Gemini), kiểm tra ảnh hồ sơ giáo viên | **"global"** | Ảnh hồ sơ giáo viên (≤ 768 px, không siêu dữ liệu) | Kiểm duyệt ảnh hồ sơ (mục đích 20) | Bên Xử lý | Chỉ lưu kết quả ≤ 180 ngày; không huấn luyện | ☐ Nằm trong CDPA của B2 — **cần lưu bản sao** |
| B27 | Meta Platforms — Facebook Login — pháp nhân **[VERIFY]** | Ngoài VN | (nguồn) mã định danh riêng cho ứng dụng, họ tên, email, liên kết ảnh; (đi) việc đăng nhập | Đăng nhập (mục đích 21) | Bên Kiểm soát độc lập **[COUNSEL]** | Không lưu mã truy cập (trigger + callback); không dùng ảnh; tắt cho đến khi cấu hình | ☐ Điều khoản Nền tảng Meta — **cần lưu bản sao** |

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
| C19 | Đồng ý | Pixel trình duyệt của Meta đã **gỡ bỏ hoàn toàn**; chỉ còn CAPI phía máy chủ có kiểm soát đồng ý. TikTok chưa từng có pixel: chỉ Events API phía máy chủ, kiểm soát bằng cookie đồng ý **và** bản ghi đồng ý | ✅ | `analytics-tags.tsx:24–28`, `tiktok-events.ts`, `tiktok-consent-record.ts` |
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

> ⛔ **2026-10-14 — ĐÃ THAY ĐỔI / SUPERSEDED.** Chủ sở hữu quyết định mở danh mục con e-Visa trên eno.vn cho mọi người bán,
> mỗi tin chỉ hiển thị sau khi đội ngũ eno kiểm tra giấy phép của nhà cung cấp. Cách sửa "ẩn 14 tin" ở trên không còn áp
> dụng; thay vào đó hồ sơ phải mô tả đúng: sàn có tin dịch vụ e-Visa của bên thứ ba được cấp phép, eno không tự vận hành dịch
> vụ thị thực trên eno.vn. *(The owner opened an e-Visa subcategory on eno.vn to all sellers behind a licence check, so the
> fix above no longer applies: the dossier must describe third-party, licence-checked e-visa listings instead.)*

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
**Cách sửa nhỏ nhất:** với Google, Cloudflare, Microsoft và Meta, DPA là điều khoản tiêu chuẩn có thể chấp nhận và tải xuống trong bảng điều khiển — làm được trong một buổi chiều. Supabase, Resend và Telegram Gateway cần yêu cầu riêng. TikTok (B23, thêm 12/10/2026): văn bản áp dụng **[VERIFY]** — chưa xác định. **OpenStreetMap Nominatim không có DPA và không thể có** — hoặc bỏ nhánh dự phòng đó, hoặc tự vận hành, hoặc để counsel giải trình.
**Chặn nộp hồ sơ: CÓ.**

### 6. ⛔ Ba trường `[OWNER INPUT]` và cờ `OPERATOR_REGISTERED`
Tên công ty, số ĐKKD, địa chỉ trụ sở. Sau khi có ĐKKD, cập nhật `src/lib/site-legal.ts` (một chỗ duy nhất — footer, /signin, /terms, /privacy, /regulations đều đọc từ đó) và bật `registered: true`, điều này cũng làm trang /privacy chuyển từ *"hồ sơ đang được chuẩn bị, chưa nộp"* sang câu khẳng định đã nộp. **Đừng bật trước khi giấy chứng nhận đã ở trong tay.**
**Chặn nộp hồ sơ: CÓ.**

### 7. ⚠️ Điều kiện của nhân sự bảo vệ dữ liệu (Điều 13 NĐ 356/2025)
Bằng cao đẳng trở lên, ≥02 năm kinh nghiệm pháp chế/CNTT/an ninh dữ liệu, và **đã được đào tạo** về bảo vệ dữ liệu. Thêm câu hỏi độc lập: một người vừa là giám đốc, vừa là đại diện pháp luật, vừa là DPO.
**Cách sửa nhỏ nhất:** thu thập hồ sơ chứng minh; nếu thiếu chứng chỉ đào tạo, đăng ký một khóa trước khi nộp; nếu counsel cho rằng việc kiêm nhiệm là khiếm khuyết, bổ nhiệm một nhân sự thứ hai làm DPO.
**Chặn nộp hồ sơ: KHÔNG — nhưng dễ bị trả về.**

### 8. ⚠️ Xác minh trạng thái môi trường sản xuất cho các bên nhận
`RESEND_API_KEY`, `META_PIXEL_ID`/`META_CAPI_TOKEN`, `TIKTOK_PIXEL_ID`/`TIKTOK_EVENTS_TOKEN` (chủ sở hữu cài trên eno.vn ngày 12/10/2026 — theo kết quả lệnh cài đặt), `NEXT_PUBLIC_GA_ID`, `TELEGRAM_BOT_TOKEN`/`FB_PAGE_*`, `GOOGLE_MAPS_API_KEY` — không thể đọc từ checkout này (chúng nằm trong GCP Secret Manager `eno-root-env`). Một bên nhận được liệt kê nhưng thực tế chưa bật khiến hồ sơ **quá rộng**; một bên đang bật mà không liệt kê khiến hồ sơ **sai**.
**Cách sửa nhỏ nhất:** đọc `eno-root-env` một lần và đánh dấu Phụ lục B thành "đang hoạt động" / "đã cấu hình nhưng chưa bật" / "chưa cấu hình".
**Chặn nộp hồ sơ: KHÔNG — nhưng ảnh hưởng độ chính xác của Phụ lục B.**

### 9. ⚠️ Không mô tả hai mô-đun chưa đấu nối là đang vận hành
`takedown_orders`, `compliance_audit` (`identity_verifications` đã được đấu nối — xem Phụ lục A24) có lược đồ đầy đủ, tài liệu thiết kế đầy đủ, 0 dòng dữ liệu và **không có route API hay trang nào ghi vào chúng** (MEASURED). Liệt kê chúng như một biện pháp bảo vệ đang hoạt động là một tuyên bố sai dễ bị kiểm chứng.
**Cách sửa:** giữ nguyên như đã viết trong Phụ lục A — ghi rõ là "có lược đồ, chưa đấu nối".
**Chặn nộp hồ sơ: KHÔNG.**

### 10. ⚠️ Xác nhận chính sách sao lưu và thời hạn nhật ký
Con số "12 tháng" cho Cloud Logging đến từ tài liệu thiết kế nội bộ, không phải từ cấu hình đã đo. Thời hạn sao lưu / PITR của Supabase chưa biết.
**Cách sửa nhỏ nhất:** đọc cấu hình `_Default` log bucket và gói Supabase; ghi con số thật vào Phụ lục A22 và C29.
**Chặn nộp hồ sơ: KHÔNG.**

### 11. ⚠️ Cách diễn đạt "Allow all" đã cũ; TikTok chưa có đủ thông tin bên nhận (thêm 12/10/2026)
Mục đích 14, §2.1, §2.5 (sơ đồ), §3.2 dòng 16–17, §3.3, §3.5, Phụ lục B (B15–B16) và Phụ lục C ("ba mức đồng ý") — và có thể cả những chỗ khác — vẫn viết "Allow all" hoặc "ba mức" — cách diễn đạt từ trước khi thẻ đồng ý được tách theo mục đích (01/10/2026). Cổng hiện nay là mục **Quảng cáo** (Meta, TikTok) và mục **Phân tích** (Google Analytics). Với TikTok (dòng 23 / B23) còn thiếu: pháp nhân ký kết, nơi lưu trữ, văn bản điều khoản dữ liệu áp dụng và thời hạn lưu giữ — đều đang đánh dấu **[VERIFY]**.
**Cách sửa nhỏ nhất:** viết lại các chỗ nêu trên theo từng mục đích; điền bốn thông tin TikTok từ điều khoản TikTok for Business.
**Chặn nộp hồ sơ: CÓ.**

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

8. **Ngôn ngữ có hiệu lực.** Chính sách bảo vệ dữ liệu cá nhân hiện tuyên bố **bản tiếng Anh là bản có hiệu lực**, với bản tiếng Việt là bản dịch tiện lợi. Điều này có chấp nhận được với một pháp nhân Việt Nam phục vụ người dùng Việt Nam không?

9. **Ẩn danh sau khi xóa tài khoản.** `BannedIdentity` cố ý giữ số điện thoại và email của tài khoản bị đình chỉ **sau khi** tài khoản bị xóa, để ngăn né lệnh cấm. Có bảo vệ được trước quyền xóa không, và trong bao lâu?

10. **Tái kết nối mô-đun thị thực.** Khi mô-đun e-Visa do đối tác vận hành được đấu nối lại, đó là **hồ sơ cập nhật trong 10 ngày** theo Điều 20, hay một hồ sơ mới? Và điều đó có ảnh hưởng tới trạng thái giấy phép sàn TMĐT không?

11. **Mức phạt.** Xác nhận Điều 8(4) Luật 91/2025 (đến 5% doanh thu năm trước) và Điều 8(5) (đến 3 tỷ đồng) — hai con số này do chủ sở hữu cung cấp và **chưa được kiểm chứng độc lập** trong quá trình lập hồ sơ này.

12. **TikTok — bên nhận quảng cáo mới (thêm 12/10/2026; §3.2 dòng 23).** (a) Bên nhận được nêu trong chính sách và trên thẻ đồng ý vào đúng ngày đưa vào vận hành, không có thời gian báo trước; chỉ tính các lựa chọn Quảng cáo từ ngày hôm sau có đủ không? (b) Nếu bản ghi đồng ý cũ của một người chưa từng được ghi, lần lưu lại cài đặt sau đó được đọc như câu trả lời đầu tiên — rủi ro này có chấp nhận được không? (c) TikTok là "Bên Kiểm soát độc lập" hay "Bên Xử lý", và cần văn bản nào? (d) eno không lưu bản ghi về từng lần gửi và không thể thu hồi sự kiện đã gửi khi người dùng rút lại đồng ý hoặc xóa tài khoản — có cần ghi nhật ký gửi và quy trình yêu cầu TikTok xóa không?

---

**Sources for the legal-frame verification performed on 14/08/2026:**
[Nghị định 356/2025/NĐ-CP — thuvienphapluat.vn](https://thuvienphapluat.vn/van-ban/Quyen-dan-su/Nghi-dinh-356-2025-ND-CP-huong-dan-Luat-Bao-ve-du-lieu-ca-nhan-687428.aspx) · [Quy định chi tiết Luật BVDLCN — luatvietnam.vn](https://luatvietnam.vn/thong-tin/nghi-dinh-356-2025-nd-cp-quy-dinh-chi-tiet-luat-bao-ve-du-lieu-ca-nhan-422896-d1.html) · [Hồ sơ đánh giá tác động chuyển DLCN xuyên biên giới — thuvienphapluat.vn](https://thuvienphapluat.vn/phap-luat/ho-so-danh-gia-tac-dong-chuyen-du-lieu-ca-nhan-xuyen-bien-gioi-theo-nghi-dinh-3562025ndcp-chi-tiet-260885.html) · [EY Vietnam legal alert on Decree 356/2025/ND-CP](https://www.ey.com/content/dam/ey-unified-site/ey-com/vi-vn/technical/tax/documents/ey-vietnam-legal-alert-march-2026-decree-no356-2025-nd-cp-providing-detailed-guidance-for-implementation-of-personal-data-protection-law-viet.pdf) · [Nghị định hướng dẫn Luật BVDLCN — luatthanhdo.com.vn](https://luatthanhdo.com.vn/nghi-dinh-huong-dan-luat-bao-ve-du-lieu-ca-nhan)

**System evidence base:** `/Users/mk1e3/eno.vn/prisma/schema.prisma`, `/Users/mk1e3/eno.vn/src/app/privacy/page.tsx`, `/Users/mk1e3/eno.vn/src/lib/site-legal.ts`, `/Users/mk1e3/eno.vn/src/lib/edition-scope.ts`, `/Users/mk1e3/eno.vn/src/lib/core/seller.ts`, `/Users/mk1e3/eno.vn/src/lib/gemini.ts`, `/Users/mk1e3/eno.vn/src/lib/vertex-search.ts`, `/Users/mk1e3/eno.vn/src/lib/meta-capi.ts`, `/Users/mk1e3/eno.vn/src/lib/consent.ts`, `/Users/mk1e3/eno.vn/src/lib/ratelimit.ts`, `/Users/mk1e3/eno.vn/src/lib/ai-guard.ts`, `/Users/mk1e3/eno.vn/src/lib/core/media.ts`, `/Users/mk1e3/eno.vn/src/lib/otp-channels.ts`, `/Users/mk1e3/eno.vn/src/lib/mail.ts`, `/Users/mk1e3/eno.vn/src/app/api/account/export/route.ts`, `/Users/mk1e3/eno.vn/src/app/api/account/delete/route.ts`, `/Users/mk1e3/eno.vn/src/app/api/listings/[id]/contact/route.ts`, `/Users/mk1e3/eno.vn/next.config.ts`, `/Users/mk1e3/eno.vn/cloudbuild.yaml`, `/Users/mk1e3/eno.vn/docs/compliance-2026.md`, `/Users/mk1e3/eno.vn/scripts/purge-pre-launch-data.mjs`; production database read-only queries against `information_schema`, `pg_tables`, `cron.job`, `storage.buckets`, `auth.identities` on 13–14/08/2026. No code was modified.