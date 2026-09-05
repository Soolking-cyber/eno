import SwiftUI
import EnoUI

// ── VERIFY YOUR IDENTITY ────────────────────────────────────────────────────────────────────────
//
// The native mirror of src/app/dashboard/account/verify. One step at a time — declaration → tier →
// document → selfie → check details — because that is the order the SERVER requires: the challenge
// is the consent receipt, and no image can be uploaded before it exists.
//
// ⚠️ THE DECLARATION COMES BEFORE THE TIER BUTTONS, NOT AFTER. Putting it at submit means the person
// has already spent five minutes photographing a passport, and the checkbox becomes something to
// click past to avoid losing that work. Read first, then act.

struct IdentityVerifyView: View {
    /// The expiry wheel is showing but nothing has been committed yet — see the note at the field.
    @State private var expiryEditing = false
    /// The uncommitted value the wheel edits before the seller confirms it.
    @State private var expiryDraft = IdentityVerifyView.defaultExpiry()
    @State private var model = IdentityModel()
    @State private var confirmStartOver = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if model.submitted { sent }
            else if let terminal = model.terminal { terminalOutcome(terminal) }
            else {
                switch model.step {
                case .tier: intro
                case .document: capture(.document)
                case .selfie: capture(.selfie)
                case .details: details
                }
            }
        }
        .navigationTitle(L10n.tr("Verify your identity", "Xác minh danh tính"))
        .navigationBarTitleDisplayMode(.inline)
        .background(EnoColor.canvas)
    }

    // ── declaration + tier ──────────────────────────────────────────────────────────────────────

    private var intro: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EnoSpacing.s4) {
                // ⚠️ SAYS WHO LOOKS AND HOW LONG. A passport is reviewed by a person on our team —
                // not by VNPT, whose integration is blocked — and the web page said exactly that
                // three lines apart from claiming the opposite. One sentence, true on both.
                Text(L10n.tr("Vietnamese law requires sellers to verify their identity before publishing. A person on our team reviews your document and selfie, usually within a working day, and you do this once per document.",
                             "Theo quy định của pháp luật Việt Nam, người bán phải xác minh danh tính trước khi đăng tin. Nhân viên của chúng tôi xem xét giấy tờ và ảnh chân dung của bạn, thường trong một ngày làm việc, và bạn chỉ cần làm một lần cho mỗi giấy tờ."))
                    .enoText(.callout, color: EnoColor.sub)

                EnoCard {
                    VStack(alignment: .leading, spacing: EnoSpacing.s3) {
                        Text(L10n.tr("Your declaration", "Cam đoan của bạn"))
                            .enoText(.headline, weight: .bold)
                        Text(declaration).enoText(.subheadline, color: EnoColor.sub)
                        // ⛔ NEVER PRE-CHECKED. The server refuses a record without explicit
                        // acceptance, and a pre-ticked box would make that guard a formality over a
                        // UI that had already decided for the person.
                        EnoToggle(L10n.tr("I have read the above and confirm it is true.",
                                          "Tôi đã đọc nội dung trên và xác nhận là đúng sự thật."),
                                  isOn: $model.accepted)
                    }
                }

                Text(L10n.tr("Choose how to verify", "Chọn cách xác minh"))
                    .enoText(.headline, weight: .bold)

                // ⚠️ DISABLED, NOT HIDDEN. Hiding the options until the box is ticked leaves the
                // screen looking broken — a declaration with no visible consequence.
                tierButton(.a, title: L10n.tr("Vietnamese citizen", "Công dân Việt Nam"),
                           // ⚠️ CCCD ONLY, BECAUSE VNeID IS NOT WIRED. The next step unconditionally
                           // asks for a photograph of the CCCD; naming VNeID here promised a route
                           // that does not exist, so a seller who has VNeID and no CCCD to hand
                           // picked this tier on the strength of the label and then had nowhere to
                           // go. (VNPT eKYC is still blocked on their token endpoint.)
                           note: L10n.tr("CCCD", "CCCD"))
                // ⚠️ THE SIX-MONTH RULE IS SAID HERE, before a single photograph. It is a refusal the
                // seller could otherwise only learn about at the details step, two captures in.
                tierButton(.b, title: L10n.tr("Foreign resident", "Người nước ngoài"),
                           note: L10n.tr("Passport valid 6+ months, plus a selfie — reviewed by our team",
                                         "Hộ chiếu còn hạn ít nhất 6 tháng, kèm ảnh chân dung — đội ngũ của chúng tôi xem xét"))

                if let e = model.error {
                    Text(e).enoText(.caption, color: EnoColor.danger)
                }

                // ⚠️ THE PRIVACY SENTENCE THE WEB PAGE CARRIES, AND THIS SCREEN DID NOT. On a screen
                // asking for a passport, what happens to the photographs is not a footnote.
                Text(L10n.tr("Your two photographs are stored privately and opened only by a reviewer on our team, through a link that expires in ten minutes. We keep the result, the document expiry date and a one-way fingerprint that lets us spot duplicate accounts — never the document number itself.",
                             "Hai ảnh của bạn được lưu trữ riêng tư và chỉ được mở bởi nhân viên xét duyệt của chúng tôi, qua đường dẫn hết hạn sau mười phút. Chúng tôi lưu kết quả, ngày hết hạn giấy tờ và một dấu vân tay một chiều để phát hiện tài khoản trùng lặp — không bao giờ lưu số giấy tờ."))
                    .enoText(.caption, color: EnoColor.sub)
            }
            .padding(EnoSpacing.s4)
        }
    }

    /// ⚠️ `EnoCard`'s ACTION initialiser, not a hand-rolled Button — the iOS design-lint flags a raw
    /// Button precisely so a new screen cannot quietly invent its own tap target, press animation and
    /// focus ring alongside the ones the design system already defines.
    private func tierButton(_ tier: IdentityModel.Tier, title: String, note: String) -> some View {
        // ⚠️ `EnoInteractiveCard` — a SEPARATE type, not an EnoCard overload. It wraps the card in a
        // Button with the house press-scale and the button accessibility trait, which is exactly what
        // a hand-rolled Button here would have had to reinvent (and get subtly wrong).
        EnoInteractiveCard(
            action: { Task { await model.start(tier) } },
            content: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).enoText(.callout, weight: .bold)
                    Text(note).enoText(.caption, color: EnoColor.sub)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            })
        .disabled(!model.accepted || model.busy)
        .opacity(model.accepted ? 1 : 0.5)
    }

    // ── capture ─────────────────────────────────────────────────────────────────────────────────

    private func capture(_ kind: DocumentCaptureView.Kind) -> some View {
        // ⚠️ THE CAPTURE OWNS THE WHOLE STEP, ON BLACK — title, tips, band, shutter, review, status —
        // the way every KYC vendor's capture screen is built (Persona/TikTok Shop, the owner's
        // reference, 2026-09-05). The copy lives HERE because only this screen knows the tier; the
        // capture view is tier-agnostic. "Start over" stays below it, on the same ground.
        VStack(spacing: 0) {
            DocumentCaptureView(
                kind: kind,
                guideAspect: model.tier == .a ? 1.585 : 1.42,
                title: kind == .document
                    ? (model.tier == .a
                       ? L10n.tr("Place the side of your CCCD with your photo within the frame",
                                 "Đặt mặt có ảnh của CCCD vào trong khung")
                       : L10n.tr("Place the passport page with your photo within the frame",
                                 "Đặt trang hộ chiếu có ảnh của bạn vào trong khung"))
                    : L10n.tr("Now a selfie — face inside the oval", "Bây giờ chụp chân dung — khuôn mặt trong khung oval"),
                // ⚠️ THE THINGS THAT ACTUALLY DECIDE A PASSPORT READ, said BEFORE the shutter. Every
                // failed scan traces to one of them — a cover sleeve, glare on the laminate over the
                // code lines, a bottom edge out of frame.
                tips: kind == .document && model.tier == .b
                    ? [L10n.tr("Out of its cover, held flat, no glare on the two code lines.",
                               "Tháo khỏi bao bìa, giữ phẳng, không loá sáng ở hai dòng mã."),
                       L10n.tr("All four corners of the page inside the frame, in good light.",
                               "Cả bốn góc trang nằm trong khung, nơi đủ sáng.")]
                    : kind == .document
                        ? [L10n.tr("All four corners of the card inside the frame, in good light.",
                                   "Cả bốn góc thẻ nằm trong khung, nơi đủ sáng.")]
                        : [L10n.tr("Good light on your face, nothing covering it.",
                                   "Đủ sáng trên khuôn mặt, không che khuất.")],
                frameLabel: kind == .document
                    ? (model.tier == .a ? L10n.tr("Front of card", "Mặt trước thẻ") : L10n.tr("Passport photo page", "Trang có ảnh"))
                    : nil,
                externallyBusy: model.busy || model.scanning,
                busyLabel: model.scanning
                    ? L10n.tr("Reading your passport…", "Đang đọc hộ chiếu…")
                    : L10n.tr("Uploading…", "Đang tải lên…"),
                // ⛔ A REFUSED UPLOAD USED TO JUST END THE SPINNER (fable) — the error is rendered
                // inside the capture, under the band, where the seller is looking.
                errorText: model.error,
                // ⚠️ THE REVIEW QUESTION KNOWS THE DOCUMENT. A CCCD has no code lines to ask about.
                reviewPrompt: kind == .selfie
                    ? L10n.tr("Is your face clear and well lit?", "Khuôn mặt bạn có rõ và đủ sáng không?")
                    : (model.tier == .a
                       ? L10n.tr("Is the whole card sharp, with all four corners in?", "Cả thẻ có rõ nét và đủ bốn góc không?")
                       : L10n.tr("Are the two lines at the bottom sharp, with no glare?", "Hai dòng mã ở cuối trang có rõ nét, không loá sáng không?"))
            ) { image in
                Task { await model.upload(image, kind: kind == .document ? "document" : "selfie") }
            }
            // ⛔ A NEW STEP IS A NEW CAPTURE VIEW. The reviewed shot is view state; without a
            // distinct identity per kind a passport page could sit under "Is your face clear?"
            // with "Use this photo" armed.
            .id(kind)

            // ⚠️ THE ESCAPE HATCH IS HERE TOO. The challenge is time-limited and can expire between
            // the two photographs; a seller with the wrong document in hand must not have to fail an
            // upload to get back to the tier choice.
            EnoButton(L10n.tr("Start over", "Bắt đầu lại"), variant: .text, size: .compact, fullWidth: false) {
                confirmStartOver = true
            }
            .disabled(model.busy || model.scanning)
            .padding(.vertical, EnoSpacing.s2)
        }
        .confirmationDialog(L10n.tr("Start over?", "Bắt đầu lại?"), isPresented: $confirmStartOver, titleVisibility: .visible) {
            Button(L10n.tr("Discard the photos and start over", "Bỏ ảnh và bắt đầu lại"), role: .destructive) {
                expiryDraft = Self.defaultExpiry()
                model.startOver()
            }
        } message: {
            Text(L10n.tr("Anything photographed so far will be discarded.", "Ảnh đã chụp sẽ bị bỏ."))
        }
    }

    // ── details ─────────────────────────────────────────────────────────────────────────────────

    private var details: some View {
        Form {
            Section {
                EnoField(L10n.tr("Surname", "Họ"), text: $model.surname)
                    .onChange(of: model.surname) { model.markEdited() }
                EnoField(L10n.tr("Given names", "Tên"), text: $model.givenNames)
                    .onChange(of: model.givenNames) { model.markEdited() }
                EnoField(model.tier == .a ? L10n.tr("CCCD number", "Số CCCD")
                                          : L10n.tr("Passport number", "Số hộ chiếu"),
                         text: $model.documentNumber)
                    .onChange(of: model.documentNumber) { model.markEdited() }
                // ⛔ THE EXPIRY FIELD, WITHOUT WHICH TIER A COULD NEVER SUBMIT. `canSubmit` requires
                // it, a CCCD has no MRZ to fill it, and there was no field to type it in — so every
                // Vietnamese seller reached a permanently disabled button beneath a line asking for a
                // date nothing on screen accepted. All three reviewers found this independently; it
                // is what happens when a flow is written and never walked.
                // ⛔ A DatePicker CANNOT SHOW "NOT SET", AND PRETENDING OTHERWISE BLOCKED TIER A.
                // With `documentExpiry` empty the `get` fell back to `Date()`, so the row displayed
                // today's date — filled, to look at — while the model still held "". SwiftUI runs a
                // binding's `set` only on interaction, so a seller who agreed with what they saw and
                // pressed Send met a disabled button under a line asking for the very date on screen.
                // Two reviewers found it; it is the second time this field has shipped unusable.
                // So the unset state is now a distinct row that says what it is, and choosing a date
                // is a deliberate act rather than an accident of the default.
                if model.documentExpiry.isEmpty && !expiryEditing {
                    // The house row primitive, not a hand-rolled Button: it carries the 56pt target,
                    // the press style and the disclosure semantics this row would otherwise re-invent.
                    EnoListRow(
                        title: L10n.tr("Expiry date", "Ngày hết hạn"),
                        subtitle: L10n.tr("Not set yet", "Chưa chọn"),
                        accessory: .disclosure
                    ) {
                        expiryEditing = true
                    }
                } else if model.documentExpiry.isEmpty {
                    // ⛔ REVEALING THE PICKER MUST NOT ITSELF ANSWER THE QUESTION. An earlier pass had
                    // the row write "five years from today" on tap, purely so the Send button would
                    // unlock — which meant a seller could submit an INVENTED expiry date for a legal
                    // identity document without ever choosing one. A date nobody picked is not data.
                    // So the wheel edits a local draft and the seller commits it deliberately; until
                    // they do, the field stays genuinely unset and Send stays genuinely disabled.
                    DatePicker(L10n.tr("Expiry date", "Ngày hết hạn"),
                               selection: $expiryDraft, displayedComponents: .date)
                    EnoButton(L10n.tr("Use this date", "Dùng ngày này"), variant: .secondary) {
                        model.documentExpiry = Self.iso(expiryDraft)
                        model.markEdited()
                    }
                } else {
                    // ⚠️ NO `in:` RANGE. Bounding this to `Date()...` crashes or silently clamps when
                    // the selection is already in the past — and a scanned EXPIRED passport puts it
                    // there, which is exactly when the seller most needs to see the real date. An
                    // expired document is refused with words below, not by rewriting what was read.
                    DatePicker(
                        L10n.tr("Expiry date", "Ngày hết hạn"),
                        selection: Binding(
                            get: { Self.parseISO(model.documentExpiry) ?? Self.defaultExpiry() },
                            set: { model.documentExpiry = Self.iso($0); model.markEdited() }),
                        displayedComponents: .date)
                }
                expiryNote
            } header: {
                Text(L10n.tr("Check your details", "Kiểm tra thông tin"))
            } footer: {
                // ⚠️ THREE STATES THE SELLER CAN TELL APART: read cleanly, could not read, and a
                // read that disagrees with what they typed. The old footer showed the first and
                // said nothing for the other two.
                if let d = model.mrzDisagreement {
                    Text(d).enoText(.caption, color: EnoColor.danger)
                } else if model.tier == .b, model.mrzFromScan, model.mrzValid {
                    Text(L10n.tr("Read from your passport — please check it is correct.",
                                 "Đã đọc từ hộ chiếu — vui lòng kiểm tra lại."))
                        .enoText(.caption, color: EnoColor.success)
                } else if model.scanFailed {
                    Text(L10n.tr("We could not read the two lines at the bottom of your passport from that photo. Retake it with the bottom of the page sharp and free of glare, or type the two lines below.",
                                 "Chúng tôi không đọc được hai dòng mã ở cuối hộ chiếu từ ảnh đó. Hãy chụp lại sao cho phần cuối trang rõ nét, không loá sáng, hoặc nhập hai dòng bên dưới."))
                        .enoText(.caption, color: EnoColor.danger)
                }
            }

            // ⛔ THE TYPED-MRZ FALLBACK, WITHOUT WHICH A FAILED SCAN IS A DEAD END. On the web these
            // two inputs are always present precisely because OCR fails on glare, and the server needs
            // a check-valid MRZ for tier B. Omitting them stranded any foreign seller whose scan did
            // not validate: no fields, no retake, a disabled button and nothing to do about it.
            // ⚠️ ONLY WHEN THE SCAN DID NOT DELIVER. Showing these always meant a seller whose scan
            // WORKED saw line 1 rendered without their name — blanked on purpose, so a misread name
            // cannot overrule the typed fields (the server prefers MRZ names) — under copy telling
            // them to type it "exactly as printed". Typing their name back in would defeat the very
            // protection the blanking provides. A successful scan needs no raw-line editor.
            // ⛔ GATED ON WHERE THE LINES CAME FROM, NOT ON WHETHER THEY ARE VALID YET. Keying this
            // on `!mrzValid` unmounted both fields at the exact instant the seller typed the last
            // character that made the checksum pass — the keyboard dropped, the text disappeared, and
            // there was no way to look at what had been entered. A previous version showed them
            // always, which was confusing after a good scan; the honest question is whether the SCAN
            // supplied the lines, which does not change while somebody is typing.
            // ⛔ ALSO SHOWN ON A DISAGREEMENT, not only on a failed scan. A mod-10-blind misread
            // (G↔6, S↔8, L↔1) passes every check digit; when the seller corrects the visible number
            // the line that will actually be verified has to be reachable, or the misread cannot be
            // corrected out of sight.
            if model.showsMrzLines {
                Section {
                    EnoField(placeholder: "P<VNMNGUYEN<<VAN<A<<<<<<<<<<<<<<<<<<<<<<<<<<",
                             text: $model.mrzLine1)
                        .onChange(of: model.mrzLine1) { model.markEdited() }
                    EnoField(placeholder: "C12345678VNM9001011M3001011<<<<<<<<<<<<<<04",
                             text: $model.mrzLine2)
                        .onChange(of: model.mrzLine2) { model.markEdited() }
                } header: {
                    Text(L10n.tr("The two lines at the bottom of the page",
                                 "Hai dòng ở cuối trang"))
                } footer: {
                    // ⛔ THE COPY MATCHES WHAT IS IN THE BOXES. Scanned lines are REBUILT — line 1 is
                    // name-less by design — so "exactly as printed" is wrong for them and right for
                    // the typed path. Keyed on where the lines came from, not on whether they validate.
                    if model.mrzFromScan {
                        Text(L10n.tr("These are rebuilt from what we read, so they will not match your passport character for character. They are what we check your details against — if the number or date above is wrong, correct it here, or retake the photo.",
                                     "Hai dòng này được dựng lại từ kết quả đọc nên sẽ không trùng từng ký tự với hộ chiếu. Đây là phần chúng tôi dùng để đối chiếu — nếu số hộ chiếu hoặc ngày ở trên bị sai, hãy sửa ở đây, hoặc chụp lại ảnh."))
                    } else {
                        Text(L10n.tr("Type the two lines of letters and numbers across the bottom of your passport page, exactly as printed.",
                                     "Hãy nhập hai dòng chữ và số ở cuối trang hộ chiếu, đúng như in trên hộ chiếu."))
                    }
                }
            }

            // ⚠️ A RETAKE IS ALWAYS AVAILABLE — a bad photo is the most likely cause of a failed scan,
            // and re-photographing is the fix the seller can actually perform.
            Section {
                Button(L10n.tr("Retake the document photo", "Chụp lại ảnh giấy tờ")) {
                    model.retakeDocument()
                }
                .enoText(.callout, color: EnoColor.brand)
                // ⛔ ALWAYS AN ESCAPE HATCH. The challenge is single-use and time-limited; if it
                // expires between the two photographs nothing downstream can succeed. One "Start
                // over" clears the burned code and both photos so a fresh attempt gets a fresh one.
                // ⚠️ CONFIRMED FIRST. One tap discards two uploads and the challenge, and it sits
                // right under Retake.
                Button(L10n.tr("Start over", "Bắt đầu lại")) {
                    confirmStartOver = true
                }
                .enoText(.callout, color: EnoColor.sub)
                // ⚠️ NOT WHILE A READ IS IN FLIGHT: a scan completing into a reset model would
                // write lines and `mrzFromScan` into a flow that no longer has a document.
                .disabled(model.busy || model.scanning)
                .confirmationDialog(L10n.tr("Start over?", "Bắt đầu lại?"), isPresented: $confirmStartOver, titleVisibility: .visible) {
                    Button(L10n.tr("Discard both photos and start over", "Bỏ cả hai ảnh và bắt đầu lại"), role: .destructive) {
                        // ⚠️ THE WHEEL'S DRAFT IS VIEW STATE and would otherwise carry the previous
                        // passport's expiry into the next attempt.
                        expiryDraft = Self.defaultExpiry()
                        model.startOver()
                    }
                } message: {
                    Text(L10n.tr("Your document photo and selfie will be discarded.", "Ảnh giấy tờ và ảnh chân dung của bạn sẽ bị bỏ."))
                }
            }

            if let reason = model.blockedReason {
                Section { Text(reason).enoText(.caption, color: EnoColor.sub) }
            }

            Section {
                EnoButton(L10n.tr("Send for review", "Gửi để xét duyệt"),
                          loading: model.busy) { Task { await model.submit() } }
                    .disabled(!model.canSubmit)
                if let e = model.error {
                    Text(e).enoText(.caption, color: EnoColor.danger)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(EnoColor.canvas)
    }

    // ── outcomes ────────────────────────────────────────────────────────────────────────────────

    private var sent: some View {
        // ⚠️ `EnoEmptyState`, not EnoPageState — the latter is a loading/empty/failure CONTAINER keyed
        // on a status, not a standalone message block. Using the primitive that matches the shape.
        EnoEmptyState(
            icon: "checkmark.circle.fill",
            title: L10n.tr("Sent", "Đã gửi"),
            message: L10n.tr("A person reviews this by hand, usually within a working day, and we will email you the result.",
                             "Một nhân viên sẽ kiểm tra thủ công, thường trong một ngày làm việc, và chúng tôi sẽ gửi email kết quả."))
    }

    /// ⛔ RENDERED INSTEAD OF THE FLOW, NOT BESIDE IT. These are refusals a retake cannot change; the
    /// next thing on screen must not be an invitation to do the thing that just failed.
    private func terminalOutcome(_ message: String) -> some View {
        VStack(spacing: EnoSpacing.s4) {
            Text(message).enoText(.callout).multilineTextAlignment(.center)
            EnoButton(L10n.tr("Back", "Quay lại"), variant: .secondary) { dismiss() }
        }
        .padding(EnoSpacing.s6)
    }

    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")   // never the device locale for a wire format
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static func iso(_ d: Date) -> String { isoFormatter.string(from: d) }
    private static func parseISO(_ s: String) -> Date? { s.isEmpty ? nil : isoFormatter.date(from: s) }

    /// ⛔ OUTSIDE THE `if/else`, DELIBERATELY. This lived inside the branch that runs only when
    /// `documentExpiry` is non-empty — so on the TYPED-MRZ path, where the expiry comes from line 2
    /// and that field stays empty, `canSubmit` refused an expired passport and NOTHING on screen said
    /// why. A disabled button with no explanation is the worst outcome of a correct check. The words
    /// are driven by the same `expiryProblem` the gate reads, so they cannot disagree.
    @ViewBuilder
    private var expiryNote: some View {
        switch model.expiryProblem {
        case .expired:
            Text(L10n.tr("This document has expired. Verification needs one that is still valid.",
                         "Giấy tờ này đã hết hạn. Cần giấy tờ còn hiệu lực để xác minh."))
                .enoText(.caption, color: EnoColor.danger)
        case .tooSoon:
            Text(L10n.tr("A passport must be valid for at least six more months.",
                         "Hộ chiếu phải còn hiệu lực ít nhất sáu tháng nữa."))
                .enoText(.caption, color: EnoColor.danger)
        case nil:
            EmptyView()
        }
    }

    /// Where the picker opens once the seller chooses to set a date. Deliberately NOT today: a
    /// document expiring today is not a usable document, and opening on an invalid value invites
    /// exactly the accidental submission the row above exists to prevent.
    private static func defaultExpiry() -> Date {
        Calendar(identifier: .gregorian).date(byAdding: .year, value: 5, to: Date()) ?? Date()
    }

    /// ⚠️ Mirrors DECLARATIONS['identity-v1'] in src/lib/compliance/declaration-text.ts. The version
    /// the seller accepted is recorded server-side; this text and that constant move together.
    private var declaration: String {
        L10n.tr(
            "I declare that: (1) the document I upload is genuine, issued by a competent authority, still valid and my own; (2) all information I provide is true, complete and accurate; (3) I understand that using a forged document or declaring falsely is unlawful, and I accept full legal responsibility for what I declare.",
            "Tôi xin cam đoan: (1) Giấy tờ tôi tải lên là giấy tờ thật, do cơ quan có thẩm quyền cấp, còn hiệu lực và là giấy tờ của chính tôi; (2) Mọi thông tin tôi cung cấp là đúng sự thật, đầy đủ và chính xác; (3) Tôi hiểu rằng việc sử dụng giấy tờ giả mạo hoặc khai báo không trung thực là hành vi vi phạm pháp luật, và tôi hoàn toàn chịu trách nhiệm trước pháp luật.")
    }
}
