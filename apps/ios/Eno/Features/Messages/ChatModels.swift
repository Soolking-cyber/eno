import Foundation

// Codable mirrors of the conversations API (src/app/api/conversations/*).
// Field names match the serialized JSON exactly — no CodingKeys.

// GET /api/conversations → { conversations: [InboxConvo] } (newest-first, take 100)
struct InboxConvo: Codable, Identifiable {
    let id: String
    // ⛔ OPTIONAL BECAUSE SUPPORT THREADS HAVE NO LISTING, and declaring these non-optional took the
    // WHOLE MESSAGES TAB DOWN. `src/app/api/conversations/route.ts` emits `listingId: c.listing?.id
    // ?? null` and `listingTitle: c.listing?.title ?? null` (:542-543) — an admin→user thread has no
    // listing by construction, which the POST path states outright ("`listingId: { not: null }`
    // EXCLUDES SUPPORT THREADS EXPLICITLY", :102). Against a non-optional `String` the decoder threw
    // `.valueNotFound`, `InboxModel.load()`'s `try?` swallowed it, `loaded` never flipped, and the
    // list rendered neither rows nor its empty state: one support message blanked the tab forever.
    let listingId: String?
    let listingTitle: String?
    let listingImage: String?
    /// 'visa' | 'itinerary' | 'listing' — what the thread is ABOUT; nil for a support thread.
    let kind: String?
    let lastMessageAt: String
    let lastMessageText: String?
    let lastOffer: LastOffer?
    let unread: Int
    let counterpart: Counterpart

    struct LastOffer: Codable {
        let mine: Bool
        let amount: Int?
        let status: String?
    }
    struct Counterpart: Codable {
        let name: String
        let avatarColor: String?
        let avatarUrl: String?
    }
}

struct InboxResponse: Codable {
    let conversations: [InboxConvo]
}

// GET /api/conversations/[id] → thread + last 200 messages (chronological);
// opening clears the caller's unread server-side.
struct ChatThread: Codable {
    let id: String
    let me: String
    let iAmSeller: Bool
    /// ⛔ nil on a support thread — the thread route reads `convo.listing?.id` throughout, and its own
    /// header records a bug where a LISTING-LESS thread was mishandled. Same outage as InboxConvo.
    let listing: ThreadListing?
    let counterpart: ThreadCounterpart
    var messages: [ChatMsg]

    struct ThreadListing: Codable {
        let id: String
        let title: String
        let image: String?
        let price: Int
        let negotiable: Bool
        let status: String?
    }
    struct ThreadCounterpart: Codable {
        let name: String
        let avatarColor: String?
        let avatarUrl: String?
        let sellerId: String?
    }
}

struct ChatMsg: Codable, Identifiable, Equatable {
    let id: String
    let mine: Bool
    let body: String
    let createdAt: String
    let kind: String?
    let offerAmount: Int?
    let offerStatus: String?
    /// ⛔ A RECALLED MESSAGE — the server redacts its body to "" and sets this (src/lib/messages.ts:469).
    /// Undecoded, it painted as an EMPTY BUBBLE with a timestamp: the reader sees a blank speech
    /// bubble and cannot tell whether something failed to load or was withdrawn.
    /// ⚠️ Defaulted so the OPTIMISTIC bubble built locally on send needs no value for it — a message
    /// this device just composed cannot already be recalled. Decoding is unaffected.
    var deleted: Bool? = nil

    // Client-side send states (not from the server).
    var pending: Bool? = nil
    var failed: Bool? = nil
    // The idempotency key sent with this message (review: retry MUST reuse it —
    // a fresh clientId defeats the server's msgid NX ledger and duplicates the
    // message/offer when the original response was dropped mid-network).
    var clientId: String? = nil

    var isOffer: Bool { kind == "offer" }
    var isRecalled: Bool { deleted == true }

    /// ⚠️ STRUCTURED CARDS CARRY NO BODY BY DESIGN. The visa and trip kinds render as rich cards on
    /// the web, so their `body` is empty — and iOS, which has no card for them, drew an empty bubble.
    /// Until those cards exist natively, a one-line stand-in at least tells the reader something
    /// arrived and what it was. ⛔ An unknown kind falls through to nil so a NEW server kind degrades
    /// to whatever body it carries rather than to silence.
    /// The message kinds that describe a service eno.vn is not licensed to offer. Named once so the
    /// edition gate and the labels below can never drift apart.
    static let servicesOnlyKinds: Set<String> = [
        "visa", "trip_quote", "trip_help", "itinerary", "passport", "portrait",
    ]

    var cardFallback: String? {
        // ⛔ THE EDITION GATE IS CHECKED BEFORE THE BODY, AND THAT ORDER IS THE WHOLE POINT.
        // Returning `nil` for any non-empty body handed the caller `cardFallback ?? m.body`, so a
        // visa or itinerary message that happened to carry text rendered that text VERBATIM on
        // eno.vn — the licensed marketplace describing a service it is not licensed for, decided by
        // whatever the server put in one field. A legal boundary cannot be conditional on remote
        // data being empty; it has to fail CLOSED. On the marketplace these kinds are always
        // replaced, body or no body.
        let k = kind ?? ""
        if Self.servicesOnlyKinds.contains(k), !Edition.showsVisaAndItinerary {
            return L10n.tr("Attachment", "Tệp đính kèm")
        }
        guard body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        switch kind {
        // ⛔ VISA AND TRIP LABELS ARE SERVICES-ONLY — naming them on the licensed marketplace is the
        // leak the edition split exists to prevent, and the compile-time flag does NOT protect a
        // string chosen at runtime (codex). On eno.vn these fall back to a neutral line: the reader
        // still learns something arrived, without eno.vn describing a service it may not offer.
        // ⚠️ `visa` BELONGS IN THIS LIST — `InboxConvo` declares it as a thread kind, and leaving it
        // out dropped the message through to `nil`, painting an empty bubble with a timestamp and
        // nothing else. The marketplace case is handled above, before the body check.
        case _ where Self.servicesOnlyKinds.contains(k):
            switch k {
            case "visa": return L10n.tr("Visa application", "Hồ sơ xin thị thực")
            case "trip_quote": return L10n.tr("Trip quote", "Báo giá chuyến đi")
            case "trip_help": return L10n.tr("Trip help requested", "Đã yêu cầu hỗ trợ chuyến đi")
            case "itinerary": return L10n.tr("Itinerary", "Lịch trình")
            case "passport": return L10n.tr("Passport details", "Thông tin hộ chiếu")
            default: return L10n.tr("Portrait photo", "Ảnh chân dung")
            }
        case "state", "status": return L10n.tr("Status update", "Cập nhật trạng thái")
        default: return nil
        }
    }
}

// POST /api/conversations {listingId, message?} → find-or-create
struct CreateConvoResponse: Codable {
    let id: String
    let created: Bool
}

// GET /api/conversations/unread → { unread } (0 when signed out)
struct UnreadResponse: Codable {
    let unread: Int
}
