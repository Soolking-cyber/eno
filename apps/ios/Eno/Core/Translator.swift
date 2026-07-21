import SwiftUI
import Combine
import os

// Machine-translation client — the native mirror of the web's mt-client.ts +
// POST /api/translate (Google Cloud Translation primary, Azure fallback, results
// DB-cached forever server-side, 6 billable-req/min/IP + 1M-char/day budget).
//
// It batches uncached source strings per target language into ONE request, caches
// the results (memory + UserDefaults so they survive relaunch), and drives SwiftUI
// re-render. English source is a no-op; Vietnamese prefers the hand-authored fields
// callers already have (title/titleVi, name/nameVi) and only falls to MT otherwise.
//
// Two re-render channels, on purpose:
//   • contentGen — bumps when dynamic-content batches land; LocalizedText/Localized
//     observe it and re-render JUST themselves (no tree reset → scroll preserved).
//   • uiGen — bumps when a UI-dictionary prefetch completes; RootView folds it into
//     its .id so the fixed chrome rebuilds once, at language-switch time.
//
// @unchecked Sendable: the shared cache is guarded by an unfair lock and the two
// @Published counters are only ever mutated on the main actor (MainActor.run).
final class Translator: ObservableObject, @unchecked Sendable {
    static let shared = Translator()

    @Published private(set) var contentGen = 0
    @Published private(set) var uiGen = 0

    private struct Store {
        var cache: [String: String] = [:]
        var pending: [String: Set<String>] = [:]   // lang -> sources awaiting a batch
        var knownUI: Set<String> = []              // every English UI source tr() has seen
        var draining = false
    }
    private static let lock = OSAllocatedUnfairLock(initialState: Store())
    private static let defaultsKey = "eno-mt-cache-v1"
    private static let maxPersisted = 6000

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.defaultsKey),
           let saved = try? JSONDecoder().decode([String: String].self, from: data) {
            Self.lock.withLock { $0.cache = saved }
        }
    }

    private static func key(_ source: String, _ lang: String) -> String { lang + "\u{1}" + source }

    // ── nonisolated read/enqueue (safe from anywhere) ─────────────────────────
    static func cached(_ source: String, _ lang: String) -> String? {
        lock.withLock { $0.cache[key(source, lang)] }
    }

    static func request(_ source: String, _ lang: String) {
        guard !source.isEmpty, lang != "en" else { return }
        let k = key(source, lang)
        let added = lock.withLock { st -> Bool in
            guard st.cache[k] == nil else { return false }
            return st.pending[lang, default: []].insert(source).inserted
        }
        if added { shared.scheduleDrain() }
    }

    static func noteUI(_ english: String) {
        guard !english.isEmpty else { return }
        lock.withLock { _ = $0.knownUI.insert(english) }
    }

    // ── language switch: prefetch the whole known UI dictionary at once ────────
    // en + vi need NO prefetch — tr() serves those from the source / curated arg.
    func switchLanguage(to lang: String) {
        guard lang != "en", lang != "vi" else { Task { await bumpUI() }; return }
        let sources = Self.lock.withLock { st -> [String] in
            st.knownUI.filter { st.cache[Self.key($0, lang)] == nil }
        }
        Task {
            if !sources.isEmpty { await translate(sources, lang) }
            // Skip the chrome rebuild if the user has since switched again (avoids
            // a stale identity reset from an obsolete prefetch task).
            if L10n.currentLang == lang { await bumpUI() }
        }
    }

    // ── batched drain of pending dynamic-content requests ─────────────────────
    // ONE serial loop, not one Task per 60ms tick: `draining` stays set until the
    // queue is empty, so continuous scrolling can't spawn concurrent request bursts
    // (which would blow the 6-billable-req/min/IP limit). New requests just append to
    // `pending`; this loop picks them up next tick.
    func scheduleDrain() {
        let start = Self.lock.withLock { st -> Bool in
            if st.draining { return false }
            st.draining = true
            return true
        }
        guard start else { return }
        Task {
            while true {
                try? await Task.sleep(nanoseconds: 60_000_000)   // 60ms coalesce, like mt-client
                let work = Self.lock.withLock { st -> [String: [String]] in
                    let w = st.pending.mapValues { Array($0) }
                    st.pending.removeAll()
                    return w
                }
                if work.isEmpty {
                    Self.lock.withLock { $0.draining = false }
                    break
                }
                var landed = false
                for (lang, texts) in work where !texts.isEmpty {
                    if await translate(texts, lang) { landed = true }
                }
                if landed { await bumpContent() }
            }
        }
    }

    @MainActor private func bumpContent() { contentGen &+= 1 }
    @MainActor private func bumpUI() { uiGen &+= 1 }

    // POST /api/translate in server-sized chunks; write results into the cache.
    // A pause between chunks keeps a big prefetch from firing >6 POSTs back-to-back
    // (rate limit). Fail-open: on error the source stands (retried when re-requested).
    @discardableResult
    private func translate(_ texts: [String], _ lang: String) async -> Bool {
        var landed = false
        var firstChunk = true
        for chunk in chunked(texts, maxItems: 100, maxChars: 28_000) {
            if !firstChunk { try? await Task.sleep(nanoseconds: 400_000_000) }
            firstChunk = false
            struct Resp: Decodable { let translations: [String] }
            guard let resp: Resp = try? await APIClient.shared.post(
                "api/translate", body: ["texts": chunk, "target": lang]
            ), resp.translations.count == chunk.count else { continue }
            var any = false
            Self.lock.withLock { st in
                for (s, t) in zip(chunk, resp.translations) where !t.isEmpty {
                    st.cache[Self.key(s, lang)] = t
                    any = true
                }
            }
            // Only "landed" if a NON-EMPTY translation was actually stored — an
            // all-empty success must not bump contentGen, or re-render → cache-miss →
            // re-request would loop forever.
            if any { landed = true }
        }
        if landed { persist() }
        return landed
    }

    private func persist() {
        // Bound the IN-MEMORY cache too (not just the persisted copy) so a long
        // scrolling session can't grow it without limit.
        let snapshot = Self.lock.withLock { st -> [String: String] in
            if st.cache.count > Self.maxPersisted {
                st.cache = Dictionary(uniqueKeysWithValues: st.cache.prefix(Self.maxPersisted).map { ($0.key, $0.value) })
            }
            return st.cache
        }
        if let data = try? JSONEncoder().encode(snapshot) {
            UserDefaults.standard.set(data, forKey: Self.defaultsKey)
        }
    }

    private func chunked(_ items: [String], maxItems: Int, maxChars: Int) -> [[String]] {
        var out: [[String]] = [], cur: [String] = [], chars = 0
        for s in items {
            if !cur.isEmpty, cur.count >= maxItems || chars + s.count > maxChars {
                out.append(cur); cur = []; chars = 0
            }
            cur.append(s); chars += s.count
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }
}

// Dynamic-content Text showing the machine translation for the active language,
// filling in asynchronously (observes Translator so only THIS view re-renders when
// its translation lands — no tree reset). For en it shows the source; for vi (or any
// language with a curated variant) the caller passes it as `preferred`.
struct LocalizedText: View {
    let source: String
    var preferred: String? = nil
    @ObservedObject private var mt = Translator.shared

    var body: some View {
        let _ = mt.contentGen
        Text(L10n.localizedContent(source, preferred: preferred))
    }
}

// Generic form: hands the resolved (translated) string to a builder — for content
// that isn't a plain Text, e.g. the PDP's light-markdown ListingDescriptionView.
struct Localized<Content: View>: View {
    let source: String
    var preferred: String? = nil
    @ObservedObject private var mt = Translator.shared
    @ViewBuilder let content: (String) -> Content

    var body: some View {
        let _ = mt.contentGen
        content(L10n.localizedContent(source, preferred: preferred))
    }
}
