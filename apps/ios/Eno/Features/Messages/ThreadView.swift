import SwiftUI
import Observation

// Chat thread (#118), mirroring messages/[id]/page.tsx: chronological bubbles
// (mine brand / theirs card), day separators, offer CARDS derived from
// offerAmount/offerStatus with Accept/Decline for the recipient and Counter
// gated by negotiable (the server 409s + docks trust otherwise — landmine),
// safety notes, optimistic sends with clientId idempotency + tap-to-retry,
// 12s visibility poll as the realtime backstop (the sanctioned web fallback).
@MainActor
@Observable
final class ThreadModel {
    let convoId: String
    var thread: ChatThread?
    var notFound = false
    var actionError: String?

    init(convoId: String) {
        self.convoId = convoId
    }

    func load() async {
        do {
            let t: ChatThread = try await APIClient.shared.get("api/conversations/\(convoId)")
            // Keep local bubbles the server response doesn't carry: pending/failed
            // sends, AND just-delivered ones — a poll that STARTED before a send
            // completed returns a list without it, which would blink the message
            // out for a cycle. Recent own messages survive the merge.
            let serverIds = Set(t.messages.map(\.id))
            // Duplication guard for the other half of the race: the poll can
            // return the DB copy of a send whose local bubble is still pending
            // (replace() hasn't run). A pending bubble whose content matches a
            // recent own server message is that same message — drop it, and let
            // the late replace() no-op (see replace()).
            let recentMineBodies = Set(t.messages.filter(\.mine).suffix(10).map { "\($0.body)|\($0.offerAmount ?? -1)" })
            let keep = thread?.messages.filter { m in
                guard !serverIds.contains(m.id) else { return false }
                let key = "\(m.body)|\(m.offerAmount ?? -1)"
                if (m.pending ?? false) { return !recentMineBodies.contains(key) }
                if (m.failed ?? false) { return true }
                if m.mine, let d = Format.date(m.createdAt), Date().timeIntervalSince(d) < 60 { return !recentMineBodies.contains(key) }
                return false
            } ?? []
            var merged = t
            merged.messages.append(contentsOf: keep)
            thread = merged
        } catch {
            if case APIError.http(let s) = error, s == 404 || s == 403 { notFound = true }
        }
    }

    func send(text: String) async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, body.count <= 2000 else { return }
        await deliver(body: body, offerAmount: nil, clientId: UUID().uuidString)
    }

    func counter(amount: Int) async {
        guard amount > 0 else { return }
        await deliver(body: "", offerAmount: amount, clientId: UUID().uuidString)
    }

    private func deliver(body localBody: String, offerAmount: Int?, clientId: String) async {
        let localId = "local-\(UUID().uuidString)"
        // The clientId is the server's idempotency key AND is stored on the local
        // bubble so retry() reuses it (never mints a new one — that would dodge
        // the server ledger and duplicate the message/offer).
        var payload: [String: Any] = ["clientId": clientId]
        if let offerAmount { payload["offerAmount"] = offerAmount } else { payload["body"] = localBody }
        let local = ChatMsg(
            id: localId, mine: true, body: localBody,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            kind: offerAmount != nil ? "offer" : "text",
            offerAmount: offerAmount, offerStatus: offerAmount != nil ? "pending" : nil,
            pending: true, failed: nil, clientId: clientId
        )
        thread?.messages.append(local)
        do {
            let sent: ChatMsg = try await APIClient.shared.post("api/conversations/\(convoId)/messages", body: payload)
            replace(localId, with: sent)
            if offerAmount != nil { await load() } // counters flip older offers server-side
        } catch {
            mark(localId, failed: true)
        }
    }

    func retry(_ msg: ChatMsg) async {
        guard msg.failed == true else { return }
        thread?.messages.removeAll { $0.id == msg.id }
        // Reuse the ORIGINAL clientId so a retry of a send whose response was
        // dropped is deduped by the server, not re-inserted as a duplicate.
        await deliver(body: msg.body, offerAmount: msg.offerAmount, clientId: msg.clientId ?? UUID().uuidString)
    }

    func act(on msg: ChatMsg, action: String) async {
        // Review #6: a swallowed failure left optimistic accept/decline state
        // standing. Only reload on a real 2xx; surface everything else.
        let status = try? await APIClient.shared.send("POST", "api/conversations/\(convoId)/offer", body: ["messageId": msg.id, "action": action])
        if let status, (200..<300).contains(status) {
            await load()
        } else if status == 409 {
            actionError = L10n.tr("This offer can't be updated anymore.", "Đề nghị này không còn hiệu lực.")
            await load()
        } else {
            actionError = L10n.tr("Could not update the offer. Try again.", "Không cập nhật được đề nghị. Thử lại.")
        }
    }

    private func replace(_ localId: String, with server: ChatMsg) {
        guard var t = thread else { return }
        if t.messages.contains(where: { $0.id == server.id }) {
            // The poll already delivered the server copy — just drop the local
            // bubble instead of swapping (a swap would duplicate the id).
            t.messages.removeAll { $0.id == localId }
        } else if let idx = t.messages.firstIndex(where: { $0.id == localId }) {
            t.messages[idx] = server
        }
        thread = t
    }

    private func mark(_ localId: String, failed: Bool) {
        guard var t = thread else { return }
        if let idx = t.messages.firstIndex(where: { $0.id == localId }) {
            t.messages[idx].pending = false
            t.messages[idx].failed = failed
        }
        thread = t
    }
}

struct ThreadView: View {
    let convoId: String
    @State private var model: ThreadModel
    @State private var draft = ""
    @State private var counterPrompt = false
    @State private var counterText = ""

    init(convoId: String) {
        self.convoId = convoId
        _model = State(initialValue: ThreadModel(convoId: convoId))
    }

    var body: some View {
        Group {
            if model.notFound {
                Text(L10n.tr("Conversation not found.", "Không tìm thấy cuộc trò chuyện."))
                    .font(.system(size: 15))
                    .foregroundStyle(Tokens.sub)
            } else if let t = model.thread {
                thread(t)
            } else {
                ProgressView()
            }
        }
        .background(Tokens.canvas)
        .navigationTitle(model.thread?.counterpart.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load()
            // Visibility-gated backstop poll (the web's sanctioned fallback).
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(12))
                guard !Task.isCancelled else { break }
                await model.load()
            }
        }
        .alert(
            model.actionError ?? "",
            isPresented: Binding(get: { model.actionError != nil }, set: { if !$0 { model.actionError = nil } })
        ) {
            Button("OK") { model.actionError = nil }
        }
        .alert(L10n.tr("Counter-offer (VND)", "Trả giá (đ)"), isPresented: $counterPrompt) {
            TextField(L10n.tr("Amount", "Số tiền"), text: $counterText)
                .keyboardType(.numberPad)
            Button(L10n.tr("Send", "Gửi")) {
                if let amt = Int(counterText.filter(\.isNumber)) {
                    Task { await model.counter(amount: amt) }
                }
                counterText = ""
            }
            Button(L10n.tr("Cancel", "Hủy"), role: .cancel) { counterText = "" }
        }
    }

    private func thread(_ t: ChatThread) -> some View {
        VStack(spacing: 0) {
            listingBar(t)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        safetyNote(t)
                        ForEach(Array(t.messages.enumerated()), id: \.element.id) { idx, m in
                            if daySeparatorNeeded(t.messages, idx) {
                                daySeparator(m.createdAt)
                            }
                            if m.isOffer {
                                offerCard(m, thread: t)
                            } else {
                                bubble(m)
                            }
                        }
                        if t.messages.isEmpty {
                            Text(L10n.tr("Say hello — this seller will be notified.", "Gửi lời chào — người bán sẽ được thông báo."))
                                .font(.system(size: 13))
                                .foregroundStyle(Tokens.sub)
                                .padding(.top, 24)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(12)
                }
                .onChange(of: t.messages.count) {
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            composer
        }
    }

    private func listingBar(_ t: ChatThread) -> some View {
        HStack(spacing: 10) {
            if let img = t.listing.image, let url = ImageURL.optimized(img, width: 96) {
                AsyncImage(url: url) { phase in
                    if case .success(let i) = phase { i.resizable().scaledToFill() } else { Tokens.tint }
                }
                .frame(width: 36, height: 36)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(t.listing.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Tokens.fg).lineLimit(1)
                Text(Format.vnd(t.listing.price)).font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.brand)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Tokens.card)
        .overlay(alignment: .bottom) { Rectangle().fill(Tokens.ring).frame(height: 1) }
    }

    // First-contact safety note (chat-safety-note.tsx rule: ≤3 msgs, none mine).
    @ViewBuilder
    private func safetyNote(_ t: ChatThread) -> some View {
        if t.messages.count <= 3 && !t.messages.contains(where: { $0.mine }) {
            Text(L10n.tr("First chat — never pay or ship before meeting. Meet in public, inspect, then pay.",
                         "Lần đầu trò chuyện — đừng thanh toán hay gửi hàng trước khi gặp. Gặp nơi công cộng, kiểm tra, rồi mới trả tiền."))
                .font(.system(size: 12))
                .foregroundStyle(Tokens.sub)
                .padding(10)
                .frame(maxWidth: .infinity)
                .background(Tokens.tint.opacity(0.6), in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
        }
    }

    private func daySeparatorNeeded(_ msgs: [ChatMsg], _ idx: Int) -> Bool {
        guard idx > 0 else { return true }
        let a = Format.date(msgs[idx - 1].createdAt).map { Calendar.current.startOfDay(for: $0) }
        let b = Format.date(msgs[idx].createdAt).map { Calendar.current.startOfDay(for: $0) }
        return a != b
    }

    private func daySeparator(_ iso: String) -> some View {
        let label: String = {
            guard let d = Format.date(iso) else { return "" }
            if Calendar.current.isDateInToday(d) { return L10n.tr("Today", "Hôm nay") }
            if Calendar.current.isDateInYesterday(d) { return L10n.tr("Yesterday", "Hôm qua") }
            return d.formatted(.dateTime.month(.abbreviated).day())
        }()
        return Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Tokens.sub)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Tokens.tint, in: Capsule())
    }

    private func bubble(_ m: ChatMsg) -> some View {
        VStack(alignment: m.mine ? .trailing : .leading, spacing: 3) {
            Text(m.body)
                .font(.system(size: 15))
                .foregroundStyle(m.mine ? .white : Tokens.fg)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(m.failed == true ? Tokens.danger.opacity(0.15) : (m.mine ? Tokens.brand : Tokens.card), in: RoundedRectangle(cornerRadius: 16))
                .opacity(m.pending == true ? 0.7 : 1)
            meta(m)
        }
        .frame(maxWidth: .infinity, alignment: m.mine ? .trailing : .leading)
        .padding(m.mine ? .leading : .trailing, 60)
    }

    @ViewBuilder
    private func meta(_ m: ChatMsg) -> some View {
        if m.failed == true {
            Button {
                Task { await model.retry(m) }
            } label: {
                Text(L10n.tr("Not sent — tap to retry", "Chưa gửi — chạm để thử lại"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Tokens.danger)
            }
        } else if m.pending == true {
            Text(L10n.tr("Sending…", "Đang gửi…")).font(.system(size: 11)).foregroundStyle(Tokens.sub)
        } else if let d = Format.date(m.createdAt) {
            Text(d.formatted(.dateTime.hour().minute())).font(.system(size: 11)).foregroundStyle(Tokens.sub)
        }
    }

    // Offer card (derived from offerAmount/offerStatus — never from body).
    private func offerCard(_ m: ChatMsg, thread t: ChatThread) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L10n.tr("💰 Offer", "💰 Đề nghị")).font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.sub)
            if let amt = m.offerAmount {
                Text(L10n.tr("Offered \(Format.vnd(amt))", "Đã trả giá \(Format.vnd(amt))"))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Tokens.fg)
                if t.listing.price > 0 {
                    Text("\(Int((Double(amt) / Double(t.listing.price) * 100).rounded()))% \(L10n.tr("of asking", "của giá rao")) · \(Format.vnd(t.listing.price))")
                        .font(.system(size: 12))
                        .foregroundStyle(Tokens.sub)
                }
            }
            if !m.body.isEmpty && !m.body.hasPrefix("💰") {
                Text(m.body).font(.system(size: 14)).foregroundStyle(Tokens.fg)
            }
            // Review #7: a network-failed counter must not read as a live offer.
            if m.failed == true {
                Button {
                    Task { await model.retry(m) }
                } label: {
                    Text(L10n.tr("Not sent — tap to retry", "Chưa gửi — chạm để thử lại"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Tokens.danger)
                }
            } else if m.pending == true {
                Text(L10n.tr("Sending…", "Đang gửi…")).font(.system(size: 12)).foregroundStyle(Tokens.sub)
            } else {
                status(m)
            }
            if !m.mine && m.offerStatus == "pending" {
                HStack(spacing: 8) {
                    Button(L10n.tr("Accept", "Chấp nhận")) { Task { await model.act(on: m, action: "accept") } }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .frame(height: 36)
                        .background(Tokens.brand, in: Capsule())
                    Button(L10n.tr("Decline", "Từ chối")) { Task { await model.act(on: m, action: "decline") } }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Tokens.fg)
                        .padding(.horizontal, 16)
                        .frame(height: 36)
                        .background(Tokens.tint, in: Capsule())
                    // Landmine invariant: Counter only on negotiable listings.
                    if t.listing.negotiable {
                        Button(L10n.tr("Counter", "Trả giá")) { counterPrompt = true }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Tokens.brand)
                    }
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
            if m.mine && m.offerStatus == "pending" && m.pending != true && m.failed != true {
                Text(L10n.tr("Waiting for a response…", "Đang chờ phản hồi…")).font(.system(size: 12)).foregroundStyle(Tokens.sub)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(m.mine ? Tokens.brandTint.opacity(0.5) : Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: Tokens.radiusCard).strokeBorder(m.mine ? Tokens.brand.opacity(0.3) : Tokens.ring, lineWidth: 1))
    }

    @ViewBuilder
    private func status(_ m: ChatMsg) -> some View {
        switch m.offerStatus {
        case "accepted": Text(L10n.tr("Accepted", "Đã chấp nhận")).font(.system(size: 12, weight: .bold)).foregroundStyle(.green)
        case "declined": Text(L10n.tr("Declined", "Đã từ chối")).font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.danger)
        case "countered": Text(L10n.tr("Countered", "Đã trả giá khác")).font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.sub)
        case "pending": Text(L10n.tr("Pending", "Đang chờ")).font(.system(size: 12, weight: .bold)).foregroundStyle(.orange)
        default: EmptyView()
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField(L10n.tr("Write a message…", "Nhập tin nhắn…"), text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .font(.system(size: 15))
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Tokens.tint, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            Button {
                let text = draft
                draft = ""
                Task { await model.send(text: text) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(draft.trimmingCharacters(in: .whitespaces).isEmpty ? Tokens.sub : Tokens.brand, in: Circle())
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}
