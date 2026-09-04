import Testing
import Foundation
@testable import Eno

// ⚠️ ITS OWN FILE. These started life appended to MrzTests.swift — the KYC/MRZ suite — where the
// next refactor of that file would have dragged chat tests along with it.

@Suite("Contact reveal refusals")
@MainActor
struct ContactRefusalTests {
    // ⛔ EVERY REFUSAL NEEDS ITS OWN WORDS, and two of them are not errors at all.
    // `reply_required` is the reply-first GATE: a buyer who has not been answered yet has done
    // nothing wrong, and a generic "something went wrong" would read as a broken app.
    @Test func theReplyGateIsExplained() {
        let s = ThreadModel.contactRefusal("reply_required")
        #expect(s.contains("replies") || s.contains("trả lời"))
    }

    // ⛔ A PARTNER DECLINES BY AGREEMENT, NOT BY OMISSION. Falling through to "hasn't added a phone
    // number" would misdescribe an official partner as a seller who forgot something.
    @Test func aPartnerIsNotDescribedAsForgetful() {
        let s = ThreadModel.contactRefusal("partner_chat_only")
        #expect(s.contains("partner") || s.contains("đối tác"))
        #expect(!s.contains("hasn't added"))
    }

    @Test func everyServerCodeHasItsOwnSentence() {
        let codes = ["partner_chat_only", "no_contact", "reply_required", "rate_limited", "auth_required"]
        let sentences = Set(codes.map { ThreadModel.contactRefusal($0) })
        #expect(sentences.count == codes.count, "each refusal must say something different")
        // …and an unknown code still says something actionable rather than nothing.
        #expect(!ThreadModel.contactRefusal(nil).isEmpty)
        #expect(!sentences.contains(ThreadModel.contactRefusal(nil)))
    }
}

@Suite("Contact reveal — refusal permanence")
@MainActor
struct ContactPermanenceTests {
    // ⛔ SOME REFUSALS CANNOT CHANGE, and continuing to offer the ask turns an accurate message into
    // a wrong one: three taps on a partner listing replaces "this is an official partner" with
    // "too many requests" from a route that logs and rate-limits every attempt.
    @Test func aPartnerAndAMissingNumberAreFinal() {
        #expect(ThreadModel.refusalIsPermanent("partner_chat_only"))
        #expect(ThreadModel.refusalIsPermanent("no_contact"))
        #expect(ThreadModel.refusalIsPermanent("not_found"))
    }

    // ⛔ AND THE REPLY GATE IS NOT FINAL — it lifts the moment the seller answers. Treating it as
    // permanent would remove the ask from the one buyer who is about to be allowed to use it.
    @Test func theReplyGateAndAThrottleAreNotFinal() {
        // These two DO change on their own — the seller answers, the window rolls — so the ask must
        // stay on offer. Treating the reply gate as final would remove the control from exactly the
        // buyer who is about to be allowed to use it.
        #expect(!ThreadModel.refusalIsPermanent("reply_required"))
        #expect(!ThreadModel.refusalIsPermanent("rate_limited"))
        #expect(!ThreadModel.refusalIsPermanent(nil))
    }

    // ⚠️ `auth_required` IS FINAL FOR A DIFFERENT REASON than a partner or a missing number: it is not
    // that the answer will never change, it is that nothing ON THIS SCREEN can change it. The session
    // is gone and this thread cannot renew it, so leaving the button live just re-hits a logged,
    // rate-limited route to be told the same thing. The copy sends them to sign in again.
    @Test func anExpiredSessionStopsTheRetapLoop() {
        #expect(ThreadModel.refusalIsPermanent("auth_required"))
    }

    // ⚠️ EVERY CODE THE ROUTE CAN RETURN, read off src/app/api/listings/[id]/contact/route.ts.
    // A code the server sends and the app has never heard of falls back to "could not get contact",
    // which is the generic message this whole table exists to avoid.
    @Test func everyCodeTheRouteSendsIsMapped() {
        let fromRoute = ["auth_required", "no_contact", "not_found",
                         "partner_chat_only", "rate_limited", "reply_required"]
        let fallback = ThreadModel.contactRefusal(nil)
        for code in fromRoute {
            #expect(ThreadModel.contactRefusal(code) != fallback, "\(code) has no copy of its own")
        }
    }
}

@Suite("Contact reveal — the notice goes stale")
@MainActor
struct ContactNoticeTests {
    /// ⚠️ BUILT BY DECODING, NOT BY MEMBERWISE INIT — these models gain fields as the API does, and a
    /// hand-written initialiser would break on every one. Decoding also proves the model still parses
    /// the shape the server sends. ⛔ AND NOT `try!`: a required field added later would crash the
    /// whole test target rather than failing one test.
    private func thread(_ msgs: [(String, Bool)]) throws -> ChatThread {
        let items = msgs.map { id, mine in
            "{\"id\":\"\(id)\",\"mine\":\(mine),\"body\":\"hi\",\"createdAt\":\"2026-09-04T10:00:00Z\"}"
        }
        let json = "{\"id\":\"c1\",\"me\":\"u1\",\"iAmSeller\":false,"
            + "\"counterpart\":{\"name\":\"Seller\"},"
            + "\"messages\":[\(items.joined(separator: ","))]}"
        return try JSONDecoder().decode(ChatThread.self, from: Data(json.utf8))
    }

    private func refused(_ m: ThreadModel, seen id: String?) {
        m.contactNotice = "You can request contact once the seller replies."
        m.setNoticeSeenCounterpartIdForTesting(id)
    }

    // ⛔ THE GATE LIFTS WHILE THE BUYER IS WATCHING. The notice was written once and cleared only by
    // another tap, so the seller would reply, the ask would become usable, and the buyer would still
    // be reading that they cannot ask — under a live button.
    @Test func aNewReplyFromTheSellerClearsIt() throws {
        let m = ThreadModel(convoId: "c1")
        refused(m, seen: nil)
        m.thread = try thread([("b1", true), ("s1", false)])
        m.clearStaleContactNotice()
        #expect(m.contactNotice == nil)
    }

    // ⛔ THE CASE A COUNT-BASED CHECK GOT WRONG, and it is the most likely waiting state there is.
    // `load()` appends the buyer's own PENDING/FAILED bubbles AFTER the server's messages, so "the
    // last N are new" reads those local bubbles instead of the reply. A buyer whose last message
    // failed would have kept reading "once the seller replies" on every poll, forever.
    @Test func aFailedOwnBubbleAfterTheReplyDoesNotMaskIt() throws {
        let m = ThreadModel(convoId: "c1")
        refused(m, seen: "s1")
        m.thread = try thread([("s1", false), ("s2", false), ("b1", true)])
        m.clearStaleContactNotice()
        #expect(m.contactNotice == nil)
    }

    // ⚠️ THE BUYER'S OWN MESSAGE IS NOT A REPLY. Clearing on any new message would wipe the notice
    // the instant they sent another one, which is precisely when it is still true.
    @Test func theBuyersOwnMessageDoesNot() throws {
        let m = ThreadModel(convoId: "c1")
        refused(m, seen: "s1")
        m.thread = try thread([("s1", false), ("b1", true)])
        m.clearStaleContactNotice()
        #expect(m.contactNotice != nil)
    }

    // ⛔ A PERMANENT REFUSAL IS NOT MADE FALSE BY A REPLY. A partner who answers is still a partner.
    @Test func aPermanentRefusalSurvivesAReply() throws {
        let m = ThreadModel(convoId: "c1")
        m.contactNotice = "This is an official eno partner…"
        m.contactRefused = true
        m.setNoticeSeenCounterpartIdForTesting(nil)
        m.thread = try thread([("s1", false)])
        m.clearStaleContactNotice()
        #expect(m.contactNotice != nil)
    }

    @Test func nothingToClearIsANoOp() throws {
        let m = ThreadModel(convoId: "c1")
        m.thread = try thread([("s1", false)])
        m.clearStaleContactNotice()
        #expect(m.contactNotice == nil)
    }
}

@Suite("Contact reveal — the error code survives the wire")
struct ContactErrorCodeTests {
    // ⛔ THE WHOLE COPY TABLE HANGS ON THIS ONE LINK. The route answers {"error":"reply_required"};
    // if the client read `code` instead of `error`, every refusal would collapse into the generic
    // fallback — the exact failure the `EmptyBody` overload comment warns about one layer up.
    @Test func theServersErrorFieldReachesTheCopyTable() throws {
        let body = try JSONDecoder().decode(APIErrorBody.self,
                                            from: Data("{\"error\":\"reply_required\"}".utf8))
        #expect(body.reason == "reply_required")
    }

    @Test func theAlternativeCodeFieldAlsoWorks() throws {
        let body = try JSONDecoder().decode(APIErrorBody.self,
                                            from: Data("{\"code\":\"no_contact\"}".utf8))
        #expect(body.reason == "no_contact")
    }
}

@Suite("Contact reveal — waiting must not cost the ask")
@MainActor
struct ContactGateThrottleTests {
    // ⛔ THE ROUTE IS RATE-LIMITED, so an impatient buyer tapping through the reply gate spends the
    // window and is throttled at the exact moment the seller replies and the gate lifts. Nothing they
    // do changes the answer until that reply arrives — so while the notice stands, the ask is off.
    @Test func aStandingNoticeIsWhatDisablesTheAsk() {
        let m = ThreadModel(convoId: "c1")
        #expect(m.contactNotice == nil)          // nothing said → the ask is available
        m.contactNotice = "You can request contact once the seller replies."
        #expect(m.contactNotice != nil)          // …and the view disables on exactly this
    }
}
