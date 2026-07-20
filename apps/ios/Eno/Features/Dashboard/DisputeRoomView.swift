import SwiftUI
import PhotosUI

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
                else if loading { ProgressView().frame(maxWidth: .infinity).padding(40) }
                else { Text(L10n.tr("Couldn't load this case.", "Không tải được hồ sơ này.")).foregroundStyle(Tokens.sub).padding(40) }
            }
            .background(Tokens.canvas)
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
                Divider().overlay(Tokens.ring)
                ForEach(d.timeline) { entry(d, $0) }
                if let note = d.decisionNote, !note.isEmpty {
                    decisionBlock(note)
                }
                if d.canPost && !d.submitted {
                    composer(d)
                } else if d.submitted {
                    Text(L10n.tr("You've submitted your response.", "Bạn đã gửi phản hồi."))
                        .font(.system(size: 13)).foregroundStyle(Tokens.sub)
                }
                if d.role == "reporter" && d.status == "open" && !d.withdrawn {
                    Button(role: .destructive) { Task { await withdraw() } } label: {
                        Text(L10n.tr("Withdraw this report", "Rút lại báo cáo")).font(.system(size: 14, weight: .semibold))
                    }
                    .padding(.top, 4)
                }
                if let e = errorMsg { Text(e).font(.system(size: 12)).foregroundStyle(Tokens.danger) }
            }
            .padding(16)
        }
    }

    private func header(_ d: Case) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(reasonLabel(d.reason)).font(.system(size: 18, weight: .bold)).foregroundStyle(Tokens.fg)
            if let l = d.listing {
                HStack(spacing: 10) {
                    AsyncImage(url: l.image.flatMap { ImageURL.optimized($0, width: 100) }) { p in
                        if case .success(let img) = p { img.resizable().scaledToFill() } else { Tokens.tint }
                    }
                    .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 8))
                    Text(l.title).font(.system(size: 13)).foregroundStyle(Tokens.sub).lineLimit(2)
                }
            }
            HStack(spacing: 8) {
                if d.role == "reporter", let c = d.counterparty {
                    Text(L10n.tr("Against \(c)", "Đối với \(c)")).font(.system(size: 12)).foregroundStyle(Tokens.sub)
                }
                if let until = d.evidenceUntil, d.stage == "evidence", let dt = Format.date(until) {
                    Text("· " + L10n.tr("Evidence closes \(Format.ago(dt.ISO8601Format()))", "Đóng nhận bằng chứng \(Format.ago(dt.ISO8601Format()))"))
                        .font(.system(size: 12)).foregroundStyle(Tokens.warning)
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
                    .font(.system(size: 11, weight: i == idx ? .bold : .medium))
                    .foregroundStyle(i <= idx ? Tokens.brand : Tokens.sub)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background((i <= idx ? Tokens.brand : Tokens.sub).opacity(0.1), in: Capsule())
                if i < 2 { Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(Tokens.sub) }
            }
        }
    }

    private func entry(_ d: Case, _ item: Case.Item) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(authorLabel(d, item)).font(.system(size: 12, weight: .bold)).foregroundStyle(item.kind == "decision" ? Tokens.brand : Tokens.fg)
            if !item.body.isEmpty { Text(item.body).font(.system(size: 13)).foregroundStyle(Tokens.sub) }
            if !item.images.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(item.images, id: \.self) { url in
                            AsyncImage(url: URL(string: url)) { p in
                                if case .success(let img) = p { img.resizable().scaledToFill() } else { Tokens.tint }
                            }
                            .frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
    }

    private func decisionBlock(_ note: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L10n.tr("Decision", "Kết luận")).font(.system(size: 13, weight: .bold)).foregroundStyle(Tokens.brand)
            Text(note).font(.system(size: 13)).foregroundStyle(Tokens.fg)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(Tokens.brandTint, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
    }

    private func composer(_ d: Case) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider().overlay(Tokens.ring)
            Text(L10n.tr("Your response (one submission)", "Phản hồi của bạn (một lần)")).font(.system(size: 14, weight: .bold)).foregroundStyle(Tokens.fg)
            TextField(L10n.tr("Explain your side…", "Giải thích phía bạn…"), text: $statement, axis: .vertical).lineLimit(3...8)
                .padding(10).background(Tokens.tint, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            HStack(spacing: 8) {
                if !evidenceImages.isEmpty { Text("\(evidenceImages.count)/6").font(.system(size: 12)).foregroundStyle(Tokens.sub) }
                PhotosPicker(selection: $picks, maxSelectionCount: max(1, 6 - evidenceImages.count), matching: .images) {
                    Label(L10n.tr("Add photos", "Thêm ảnh"), systemImage: "photo").font(.system(size: 13))
                }.disabled(uploading || evidenceImages.count >= 6)
                if uploading { ProgressView() }
            }
            Button {
                Task { await submit() }
            } label: {
                if submitting { ProgressView() } else { Text(L10n.tr("Submit response", "Gửi phản hồi")).font(.system(size: 14, weight: .semibold)) }
            }
            .disabled(submitting || (statement.trimmingCharacters(in: .whitespaces).isEmpty && evidenceImages.isEmpty))
        }
    }

    private func authorLabel(_ d: Case, _ item: Case.Item) -> String {
        switch item.role {
        case "reporter": return d.role == "reporter" ? L10n.tr("You", "Bạn") : L10n.tr("The reporter", "Người báo cáo")
        case "respondent": return d.role == "respondent" ? L10n.tr("You", "Bạn") : (d.counterparty ?? L10n.tr("The seller", "Người bán"))
        default: return L10n.tr("eno.vn moderation", "Kiểm duyệt eno.vn")
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
