import SwiftUI
import PhotosUI
import EnoUI

// Native dispute case room (#10) — replaces the WebSheet(/disputes/[id]) redirect.
// Evidence timeline + stage stepper + one-shot statement/photo submission +
// withdraw (reporter). Reporter identity is shielded from the respondent by the
// server (role labels only); we never render a counterparty name to the respondent.
struct DisputeRoomView: View {
    let caseId: String

    @State private var data: Case?
    @State private var loading = true
    @State private var statement = ""
    @State private var picks: [PhotosPickerItem] = []
    @State private var evidenceImages: [String] = []
    @State private var uploading = false
    @State private var submitting = false
    @State private var errorMsg: String?

    struct Case: Codable {
        let id: String
        let role: String                 // reporter | respondent
        let reason: String
        let status: String
        let stage: String                // evidence | review | decided
        let canPost: Bool
        let submitted: Bool
        let withdrawn: Bool
        let createdAt: String
        let evidenceUntil: String?
        let decisionNote: String?
        let counterparty: String?
        let listing: Listing?
        let timeline: [Item]
        struct Listing: Codable { let id: String; let title: String; let image: String? }
        struct Item: Codable, Identifiable {
            let id: String; let kind: String; let role: String; let body: String; let images: [String]; let at: String
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let d = data { room(d) }
                else if loading { EnoLoadingState() }
                else { Text(L10n.tr("Couldn't load this case.", "Không tải được hồ sơ này.")).enoText(.body, color: EnoColor.sub).padding(40) }
            }
            .background(EnoColor.canvas)
            .navigationTitle(L10n.tr("Dispute", "Khiếu nại"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
        .onChange(of: picks) {
            let items = picks; picks = []
            Task { await uploadEvidence(items) }
        }
    }

    private func room(_ d: Case) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header(d)
                stageStepper(d.stage)
                Divider().overlay(EnoColor.ring)
                ForEach(d.timeline) { entry(d, $0) }
                if let note = d.decisionNote, !note.isEmpty {
                    decisionBlock(note)
                }
                if d.canPost && !d.submitted {
                    composer(d)
                } else if d.submitted {
                    Text(L10n.tr("You've submitted your response.", "Bạn đã gửi phản hồi."))
                        .enoText(.caption, color: EnoColor.sub)
                }
                if d.role == "reporter" && d.status == "open" && !d.withdrawn {
                    // Left as a native destructive Button on purpose: EnoButton's `.destructive`
                    // is a FILLED red control, which would out-shout the primary "Submit response"
                    // CTA directly above it. There is no destructive *text* variant yet.
                    Button(role: .destructive) { Task { await withdraw() } } label: {
                        Text(L10n.tr("Withdraw this report", "Rút lại báo cáo")).font(EnoTextRole.label.font)
                    }
                    .padding(.top, EnoSpacing.s1)
                }
                if let e = errorMsg { Text(e).enoText(.caption, color: EnoColor.danger) }
            }
            .padding(EnoSpacing.screenGutter)
        }
    }

    private func header(_ d: Case) -> some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
            Text(reasonLabel(d.reason)).enoText(.headline, color: EnoColor.fg, weight: .bold)
            if let l = d.listing {
                HStack(spacing: 10) {
                    EnoRemoteImage(url: l.image.flatMap { ImageURL.optimized($0, width: 100) }) { p in
                        if case .success(let img) = p { img.resizable().scaledToFill() } else { EnoColor.tint }
                    }
                    .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
                    Text(l.title).enoText(.caption, color: EnoColor.sub).lineLimit(2)
                }
            }
            HStack(spacing: EnoSpacing.s2) {
                if d.role == "reporter", let c = d.counterparty {
                    Text(L10n.tr("Against \(c)", "Đối với \(c)")).enoText(.caption, color: EnoColor.sub)
                }
                if let until = d.evidenceUntil, d.stage == "evidence", let dt = Format.date(until) {
                    Text("· " + L10n.tr("Evidence closes \(Format.ago(dt.ISO8601Format()))", "Đóng nhận bằng chứng \(Format.ago(dt.ISO8601Format()))"))
                        .enoText(.caption, color: EnoColor.warning)
                }
            }
        }
    }

    private func stageStepper(_ stage: String) -> some View {
        let stages = ["evidence", "review", "decided"]
        let labels = [L10n.tr("Evidence", "Bằng chứng"), L10n.tr("Review", "Xem xét"), L10n.tr("Decided", "Kết luận")]
        let idx = stages.firstIndex(of: stage) ?? 0
        return HStack(spacing: 6) {
            ForEach(0..<3) { i in
                Text(labels[i])
                    .font(EnoTextRole.micro.font.weight(i == idx ? .bold : .medium))
                    .foregroundStyle(i <= idx ? EnoColor.brand : EnoColor.sub)
                    .padding(.horizontal, EnoSpacing.s2).padding(.vertical, EnoSpacing.s1)
                    .background((i <= idx ? EnoColor.brand : EnoColor.sub).opacity(0.1), in: Capsule())
                if i < 2 { EnoIcon("forward", .xs, color: EnoColor.sub) }
            }
        }
    }

    private func entry(_ d: Case, _ item: Case.Item) -> some View {
        EnoCard(padding: EnoSpacing.s3) {
            VStack(alignment: .leading, spacing: EnoSpacing.s1) {
                Text(authorLabel(d, item))
                    .enoText(.caption, color: item.kind == "decision" ? EnoColor.brand : EnoColor.fg, weight: .bold)
                if !item.body.isEmpty { Text(item.body).enoText(.caption, color: EnoColor.sub) }
                if !item.images.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(item.images, id: \.self) { url in
                                EnoRemoteImage(url: URL(string: url)) { p in
                                    if case .success(let img) = p { img.resizable().scaledToFill() } else { EnoColor.tint }
                                }
                                .frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
                            }
                        }
                    }
                }
            }
        }
    }

    private func decisionBlock(_ note: String) -> some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s1) {
            Text(L10n.tr("Decision", "Kết luận")).enoText(.caption, color: EnoColor.brand, weight: .bold)
            Text(note).enoText(.caption, color: EnoColor.fg)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(EnoSpacing.s3)
        .background(EnoColor.brandTint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
    }

    private func composer(_ d: Case) -> some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
            Divider().overlay(EnoColor.ring)
            Text(L10n.tr("Your response (one submission)", "Phản hồi của bạn (một lần)"))
                .enoText(.label, color: EnoColor.fg, weight: .bold)
            EnoTextArea(placeholder: L10n.tr("Explain your side…", "Giải thích phía bạn…"), text: $statement)
            HStack(spacing: EnoSpacing.s2) {
                if !evidenceImages.isEmpty { Text("\(evidenceImages.count)/6").enoText(.caption, color: EnoColor.sub) }
                PhotosPicker(selection: $picks, maxSelectionCount: max(1, 6 - evidenceImages.count), matching: .images) {
                    Label(L10n.tr("Add photos", "Thêm ảnh"), systemImage: "photo").font(EnoTextRole.label.font)
                }.disabled(uploading || evidenceImages.count >= 6)
                if uploading { ProgressView() }
            }
            EnoButton(L10n.tr("Submit response", "Gửi phản hồi"), loading: submitting) {
                Task { await submit() }
            }
            .disabled(submitting || (statement.trimmingCharacters(in: .whitespaces).isEmpty && evidenceImages.isEmpty))
        }
    }

    private func authorLabel(_ d: Case, _ item: Case.Item) -> String {
        switch item.role {
        case "reporter": return d.role == "reporter" ? L10n.tr("You", "Bạn") : L10n.tr("The reporter", "Người báo cáo")
        case "respondent": return d.role == "respondent" ? L10n.tr("You", "Bạn") : (d.counterparty ?? L10n.tr("The seller", "Người bán"))
        default: return L10n.tr("\(Edition.siteName) moderation", "Kiểm duyệt \(Edition.siteName)")
        }
    }

    private func reasonLabel(_ r: String) -> String {
        switch r {
        case "scam": return L10n.tr("Scam / fraud", "Lừa đảo")
        case "counterfeit": return L10n.tr("Counterfeit", "Hàng giả")
        case "misrepresentation": return L10n.tr("Not as described", "Không đúng mô tả")
        case "offensive": return L10n.tr("Offensive / abusive", "Xúc phạm")
        case "spam": return L10n.tr("Spam", "Spam")
        default: return L10n.tr("Report", "Báo cáo")
        }
    }

    private func load() async {
        defer { loading = false }
        data = try? await APIClient.shared.get("api/disputes/\(caseId)")
    }

    private func uploadEvidence(_ items: [PhotosPickerItem]) async {
        uploading = true; errorMsg = nil
        defer { uploading = false }
        for item in items {
            guard evidenceImages.count < 6,
                  let data = try? await item.loadTransferable(type: Data.self),
                  let ui = UIImage(data: data),
                  let jpeg = ui.jpegData(compressionQuality: 0.85) else { continue }
            if let urls = try? await APIClient.shared.uploadImages([jpeg]), let url = urls.first {
                evidenceImages.append(url)
            }
        }
    }

    private func submit() async {
        submitting = true; errorMsg = nil
        defer { submitting = false }
        do {
            let code = try await APIClient.shared.send("POST", "api/disputes/\(caseId)/messages",
                                                       body: ["body": statement.trimmingCharacters(in: .whitespacesAndNewlines), "images": evidenceImages])
            if (200..<300).contains(code) { statement = ""; evidenceImages = []; await load() }
            else { errorMsg = disputeError(code) }
        } catch APIError.http(let c) { errorMsg = disputeError(c) }
        catch { errorMsg = L10n.tr("Couldn't submit. Try again.", "Không gửi được. Thử lại.") }
    }

    private func withdraw() async {
        do {
            let code = try await APIClient.shared.send("POST", "api/disputes/\(caseId)/withdraw", body: nil)
            if (200..<300).contains(code) { await load() } else { errorMsg = L10n.tr("Couldn't withdraw.", "Không rút được.") }
        } catch { errorMsg = L10n.tr("Couldn't withdraw.", "Không rút được.") }
    }

    private func disputeError(_ code: Int) -> String {
        switch code {
        case 409: return L10n.tr("The evidence window is closed or you already responded.", "Đã hết hạn nộp bằng chứng hoặc bạn đã phản hồi.")
        case 429: return L10n.tr("Too many attempts — try again later.", "Quá nhiều lần thử — thử lại sau.")
        default: return L10n.tr("Couldn't submit. Try again.", "Không gửi được. Thử lại.")
        }
    }
}
