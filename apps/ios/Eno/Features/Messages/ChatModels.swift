import Foundation

// Codable mirrors of the conversations API (src/app/api/conversations/*).
// Field names match the serialized JSON exactly — no CodingKeys.

// GET /api/conversations → { conversations: [InboxConvo] } (newest-first, take 100)
struct InboxConvo: Codable, Identifiable {
    let id: String
    let listingId: String
    let listingTitle: String
    let listingImage: String?
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
    let listing: ThreadListing
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

    // Client-side send states (not from the server).
    var pending: Bool? = nil
    var failed: Bool? = nil

    var isOffer: Bool { kind == "offer" }
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
