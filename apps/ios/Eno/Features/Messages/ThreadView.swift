import SwiftUI
import Observation
import EnoUI

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
    @Environment(\.scenePhase) private var scenePhase
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
                    .enoText(.subheadline, color: EnoColor.sub)
            } else if let t = model.thread {
                thread(t)
            } else {
                ProgressView()
            }
        }
        .background(EnoColor.canvas)
        .navigationTitle(model.thread?.counterpart.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        // ⛔ `id: scenePhase` IS THE ENTIRE FIX, AND WITHOUT IT THE GATE BELOW WAS INERT.
        // `@Environment` is resolved when `body` runs and the closure captures THAT COPY, so
        // `scenePhase` inside a long-lived loop reads `.active` forever no matter what the app does.
        // The guard read like a fix, shipped like a fix, and polled the network every 12 seconds in
        // the user's pocket exactly as before. Keying the task on the phase makes SwiftUI cancel and
        // restart it on every transition, which both stops the poll on background and refreshes the
        // thread on return — so the guard is no longer needed at all.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await model.load()
            // ⛔ GATED ON scenePhase, AND IT SAYS SO BECAUSE IT DID NOT USED TO. This comment read
            // "visibility-gated backstop poll" while nothing gated it: `.task` is cancelled when the
            // VIEW disappears, not when the APP is backgrounded, so an open thread kept hitting the
            // network every 12 seconds with the phone in a pocket — battery and mobile data spent on
            // a screen nobody is looking at, on a market where data is metered.
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
                    LazyVStack(spacing: EnoSpacing.s2) {
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
                                .enoText(.caption, color: EnoColor.sub)
                                .padding(.top, EnoSpacing.s6)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(EnoSpacing.s3)
                }
                .onChange(of: t.messages.count) {
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            composer
        }
    }

    // ⛔ A SUPPORT THREAD HAS NO LISTING, so the whole bar goes rather than rendering an empty shell
    // with a 0 ₫ price. `@ViewBuilder` + EmptyView is the only shape that lets this disappear cleanly.
    /// ⚠️ DERIVED FROM THE MESSAGES, because `ChatThread` carries no `kind` of its own — only
    /// `InboxConvo` does. A services thread is one whose content is a services card, which is exactly
    /// what the set names. Reads the SAME set the bubble and the inbox row use, so no surface drifts.
    private func servicesHiddenThread(_ t: ChatThread) -> Bool {
        guard !Edition.showsVisaAndItinerary else { return false }
        return t.messages.contains { m in
            guard let k = m.kind else { return false }
            return ChatMsg.servicesOnlyKinds.contains(k)
        }
    }

    @ViewBuilder
    private func listingBar(_ t: ChatThread) -> some View {
        // ⛔ SAME LICENSING GATE AS THE BUBBLE AND THE INBOX ROW. Both editions share one database, so
        // a visa thread reaches eno.vn — and this bar prints the listing's TITLE and PRICE, which is
        // the licensed marketplace advertising a service it may not offer. Gating only the message
        // body left the service named in the header above it.
        if let listing = t.listing, !servicesHiddenThread(t) {
        HStack(spacing: 10) {
            if let img = listing.image, let url = ImageURL.optimized(img, width: 96) {
                EnoRemoteImage(url: url) { phase in
                    if case .success(let i) = phase { i.resizable().scaledToFill() } else { EnoColor.tint }
                }
                .frame(width: 36, height: 36)
                .clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(listing.title).enoText(.caption, color: EnoColor.fg, weight: .semibold).lineLimit(1)
                Text(Format.vnd(listing.price)).enoText(.caption, color: EnoColor.brand, weight: .bold)
            }
            Spacer()
        }
        .padding(.horizontal, EnoSpacing.s3)
        .padding(.vertical, EnoSpacing.s2)
        .background(EnoColor.card)
        .overlay(alignment: .bottom) { Rectangle().fill(EnoColor.ring).frame(height: 1) }
        }
    }

    // First-contact safety note (chat-safety-note.tsx rule: ≤3 msgs, none mine).
    @ViewBuilder
    private func safetyNote(_ t: ChatThread) -> some View {
        if t.messages.count <= 3 && !t.messages.contains(where: { $0.mine }) {
            Text(L10n.tr("First chat — never pay or ship before meeting. Meet in public, inspect, then pay.",
                         "Lần đầu trò chuyện — đừng thanh toán hay gửi hàng trước khi gặp. Gặp nơi công cộng, kiểm tra, rồi mới trả tiền."))
                .enoText(.caption, color: EnoColor.sub)
                .padding(10)
                .frame(maxWidth: .infinity)
                .background(EnoColor.tint.opacity(0.6), in: RoundedRectangle(cornerRadius: EnoRadius.card))
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
        // A passive neutral pill — EnoBadge IS this shape (micro type, sub ink, tint capsule).
        return EnoBadge(label)
    }

    private func bubble(_ m: ChatMsg) -> some View {
        VStack(alignment: m.mine ? .trailing : .leading, spacing: 3) {
            // ⛔ NEVER AN EMPTY BUBBLE. A recalled message has its body redacted server-side and a
            // structured card (visa/trip) has none by design — both used to paint as a blank speech
            // bubble with a timestamp, which reads as a failure rather than as what actually happened.
            Text(m.isRecalled
                 ? L10n.tr("Message removed", "Tin nhắn đã được thu hồi")
                 : (m.cardFallback ?? m.body))
                .font(EnoTextRole.subheadline.font)
                .italic(m.isRecalled || m.cardFallback != nil)
                // ⚠️ THE MUTED INK STILL HAS TO SIT ON THE RIGHT BACKGROUND. A recalled or card
                // bubble of MY OWN is painted on `EnoColor.brand`, and `EnoColor.sub` — a grey chosen
                // for the light card — is close to illegible there. Muting means "less prominent than
                // its neighbours", which on a brand bubble is a faded ON-brand, not a card grey.
                .foregroundStyle(m.isRecalled || m.cardFallback != nil
                                 ? (m.mine ? EnoColor.onBrand.opacity(0.75) : EnoColor.sub)
                                 : (m.mine ? EnoColor.onBrand : EnoColor.fg))
                .padding(.horizontal, 14)
                .padding(.vertical, EnoSpacing.s2)
                .background(m.failed == true ? EnoColor.danger.opacity(0.15) : (m.mine ? EnoColor.brand : EnoColor.card), in: RoundedRectangle(cornerRadius: EnoRadius.card))
                .opacity(m.pending == true ? 0.7 : 1)
            meta(m)
        }
        .frame(maxWidth: .infinity, alignment: m.mine ? .trailing : .leading)
        .padding(m.mine ? .leading : .trailing, 60)
    }

    @ViewBuilder
    private func meta(_ m: ChatMsg) -> some View {
        if m.failed == true {
            // TODO(EnoUI): stays hand-rolled — EnoButton has no danger-coloured `.text`
            // variant, and every filled/44pt variant would outweigh this meta line.
            Button {
                Task { await model.retry(m) }
            } label: {
                Text(L10n.tr("Not sent — tap to retry", "Chưa gửi — chạm để thử lại"))
                    .enoText(.micro, color: EnoColor.danger)
            }
        } else if m.pending == true {
            Text(L10n.tr("Sending…", "Đang gửi…")).enoText(.micro, color: EnoColor.sub, weight: .regular)
        } else if let d = Format.date(m.createdAt) {
            Text(d.formatted(.dateTime.hour().minute())).enoText(.micro, color: EnoColor.sub, weight: .regular)
        }
    }

    // Offer card (derived from offerAmount/offerStatus — never from body).
    private func offerCard(_ m: ChatMsg, thread t: ChatThread) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L10n.tr("💰 Offer", "💰 Đề nghị")).enoText(.caption, color: EnoColor.sub, weight: .bold)
            if let amt = m.offerAmount {
                Text(L10n.tr("Offered \(Format.vnd(amt))", "Đã trả giá \(Format.vnd(amt))"))
                    .enoText(.callout, color: EnoColor.fg, weight: .bold)
                if let price = t.listing?.price, price > 0 {
                    Text("\(Int((Double(amt) / Double(price) * 100).rounded()))% \(L10n.tr("of asking", "của giá rao")) · \(Format.vnd(price))")
                        .enoText(.caption, color: EnoColor.sub)
                }
            }
            if !m.body.isEmpty && !m.body.hasPrefix("💰") {
                Text(m.body).enoText(.subheadline, color: EnoColor.fg)
            }
            // Review #7: a network-failed counter must not read as a live offer.
            if m.failed == true {
                // TODO(EnoUI): see meta(_:) — no danger-coloured `.text` button variant yet.
                Button {
                    Task { await model.retry(m) }
                } label: {
                    Text(L10n.tr("Not sent — tap to retry", "Chưa gửi — chạm để thử lại"))
                        .enoText(.caption, color: EnoColor.danger, weight: .semibold)
                }
            } else if m.pending == true {
                Text(L10n.tr("Sending…", "Đang gửi…")).enoText(.caption, color: EnoColor.sub)
            } else {
                status(m)
            }
            if !m.mine && m.offerStatus == "pending" {
                HStack(spacing: EnoSpacing.s2) {
                    EnoButton(L10n.tr("Accept", "Chấp nhận"), size: .compact, fullWidth: false) {
                        Task { await model.act(on: m, action: "accept") }
                    }
                    EnoButton(L10n.tr("Decline", "Từ chối"), variant: .tertiary, size: .compact, fullWidth: false) {
                        Task { await model.act(on: m, action: "decline") }
                    }
                    // Landmine invariant: Counter only on negotiable listings.
                    // No listing ⇒ no asking price ⇒ nothing to counter.
                    if t.listing?.negotiable == true {
                        EnoButton(L10n.tr("Counter", "Trả giá"), variant: .text, size: .compact, fullWidth: false) {
                            counterPrompt = true
                        }
                    }
                }
                .padding(.top, 2)
            }
            if m.mine && m.offerStatus == "pending" && m.pending != true && m.failed != true {
                Text(L10n.tr("Waiting for a response…", "Đang chờ phản hồi…")).enoText(.caption, color: EnoColor.sub)
            }
        }
        .padding(EnoSpacing.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        // TODO(EnoUI): EnoCard hardcodes the card fill + ring, so the "mine" brand-tinted
        // variant of this panel can't ride on it yet — tokens only for now.
        .background(m.mine ? EnoColor.brandTint.opacity(0.5) : EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.card))
        .overlay(RoundedRectangle(cornerRadius: EnoRadius.card).strokeBorder(m.mine ? EnoColor.brand.opacity(0.3) : EnoColor.ring, lineWidth: 1))
    }

    @ViewBuilder
    private func status(_ m: ChatMsg) -> some View {
        switch m.offerStatus {
        case "accepted": Text(L10n.tr("Accepted", "Đã chấp nhận")).enoText(.caption, color: EnoColor.success, weight: .bold)
        case "declined": Text(L10n.tr("Declined", "Đã từ chối")).enoText(.caption, color: EnoColor.danger, weight: .bold)
        case "countered": Text(L10n.tr("Countered", "Đã trả giá khác")).enoText(.caption, color: EnoColor.sub, weight: .bold)
        case "pending": Text(L10n.tr("Pending", "Đang chờ")).enoText(.caption, color: EnoColor.warning, weight: .bold)
        default: EmptyView()
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            // TODO(EnoUI): EnoField is single-line and EnoTextArea is a fixed-height box —
            // neither covers a 1…4-line growing composer, so this stays native (same call
            // as the AI concierge composer). Chrome below is canon tokens.
            TextField(L10n.tr("Write a message…", "Nhập tin nhắn…"), text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .font(EnoTextRole.subheadline.font)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
            EnoIconButton(
                "arrow.up.circle.fill", size: 32,
                color: draft.trimmingCharacters(in: .whitespaces).isEmpty ? EnoColor.sub : EnoColor.brand,
                label: L10n.tr("Send", "Gửi")
            ) {
                let text = draft
                draft = ""
                Task { await model.send(text: text) }
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, EnoSpacing.s3)
        .padding(.vertical, EnoSpacing.s2)
        .background(.bar)
    }
}
