import Testing
import Foundation
import UIKit
@testable import EnoUI

// ── WHAT THIS SUITE IS FOR ──────────────────────────────────────────────────────────────────────
//
// `EnoRemoteImage` exists because `AsyncImage` never retries, and a photo marketplace that silently
// gives up on an image shows a grey box where the thing being sold should be. The retry POLICY is
// the whole point of the replacement, and none of it is observable by looking at the view: a passing
// screenshot proves an image loaded, not that a failed one would have been asked for again.
//
// So the transport is injected and the policy is tested directly — how many requests each kind of
// failure produces, and which of them recover.

/// Answers whatever the test tells it to, and counts how many times it was asked.
private final class StubProtocol: URLProtocol {
    struct Response { let status: Int; let body: Data }
    nonisolated(unsafe) static var script: [Result<Response, Error>] = []
    nonisolated(unsafe) static var requests = 0
    private static let lock = NSLock()

    static func reset(_ script: [Result<Response, Error>]) {
        lock.lock(); defer { lock.unlock() }
        self.script = script; requests = 0
    }

    static func next() -> Result<Response, Error> {
        lock.lock(); defer { lock.unlock() }
        let i = min(requests, script.count - 1)
        requests += 1
        return script[i]
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        switch Self.next() {
        case .success(let r):
            let response = HTTPURLResponse(url: request.url!, statusCode: r.status,
                                           httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: r.body)
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let e):
            client?.urlProtocol(self, didFailWithError: e)
        }
    }
}

private func stubbedSession() -> URLSession {
    let c = URLSessionConfiguration.ephemeral
    c.protocolClasses = [StubProtocol.self]
    return URLSession(configuration: c)
}

/// A 1×1 PNG — the smallest thing `UIImage(data:)` will actually decode.
private let onePixelPNG = Data(base64Encoded:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!

private let anyURL = URL(string: "https://eno.vn/_next/image?url=x&w=640&q=60")!

// ⚠️ `.serialized` IS LOAD-BEARING. Swift Testing runs a suite's tests in PARALLEL by default, and
// `StubProtocol`'s script and counter are shared statics — so one test could reset the script while
// another was mid-load and assert against a response meant for a different case. The failure would
// have been intermittent, which is the worst kind of test to own.
@Suite("Remote image retry policy", .serialized)
struct RemoteImageTests {
    @Test func decodesASuccessfulResponse() async {
        StubProtocol.reset([.success(.init(status: 200, body: onePixelPNG))])
        let outcome = await EnoImageLoader.load(anyURL, using: stubbedSession())
        guard case .success = outcome else { Issue.record("expected success, got \(outcome)"); return }
        #expect(StubProtocol.requests == 1)
    }

    @Test func doesNotRetryA404() async {
        // ⚠️ A MISSING IMAGE IS AN ANSWER. Asking three times burns a phone's battery and a metered
        // connection to be told the same thing three times.
        StubProtocol.reset([.success(.init(status: 404, body: Data()))])
        let outcome = await EnoImageLoader.load(anyURL, using: stubbedSession())
        guard case .failure = outcome else { Issue.record("expected failure, got \(outcome)"); return }
        #expect(StubProtocol.requests == 1)
    }

    @Test func doesNotRetryA400() async {
        // The width guard in ImageURL is what prevents these, but if one ever slips through it is a
        // permanent answer too — the URL is wrong, and it will be wrong again in 120ms.
        StubProtocol.reset([.success(.init(status: 400, body: Data()))])
        _ = await EnoImageLoader.load(anyURL, using: stubbedSession())
        #expect(StubProtocol.requests == 1)
    }

    @Test func retriesA500ToTheAttemptLimit() async {
        StubProtocol.reset([.success(.init(status: 500, body: Data()))])
        let outcome = await EnoImageLoader.load(anyURL, using: stubbedSession())
        guard case .failure = outcome else { Issue.record("expected failure, got \(outcome)"); return }
        #expect(StubProtocol.requests == EnoImageLoader.maxAttempts)
    }

    @Test func recoversFromATransientTransportFailure() async {
        // ⛔ THE CASE THE WHOLE FILE EXISTS FOR: a connection that dies mid-flight, then works. This
        // is what `AsyncImage` turns into a permanently grey card.
        StubProtocol.reset([
            .failure(URLError(.networkConnectionLost)),
            .success(.init(status: 200, body: onePixelPNG)),
        ])
        let outcome = await EnoImageLoader.load(anyURL, using: stubbedSession())
        guard case .success = outcome else { Issue.record("expected success, got \(outcome)"); return }
        #expect(StubProtocol.requests == 2)
    }

    @Test func recoversFromATimeout() async {
        // The exact error observed against production from the simulator: -1001.
        StubProtocol.reset([
            .failure(URLError(.timedOut)),
            .failure(URLError(.timedOut)),
            .success(.init(status: 200, body: onePixelPNG)),
        ])
        let outcome = await EnoImageLoader.load(anyURL, using: stubbedSession())
        guard case .success = outcome else { Issue.record("expected success, got \(outcome)"); return }
        #expect(StubProtocol.requests == 3)
    }

    @Test func reportsAnUndecodableBodyRatherThanRetryingForever() async {
        StubProtocol.reset([.success(.init(status: 200, body: Data("not an image".utf8)))])
        let outcome = await EnoImageLoader.load(anyURL, using: stubbedSession())
        guard case .failure = outcome else { Issue.record("expected failure, got \(outcome)"); return }
        #expect(StubProtocol.requests == 1)
    }
}
