import Foundation
import Observation

// Currency approximation, mirroring the web (currency-context + currencies.ts):
// /api/fx returns { base:'VND', rates: { USD: <usd-per-1-vnd>, … } }; the card
// and PDP show "≈ $190" beside VND prices. Rates cache for 12h like the web's
// localStorage 'eno-fx'.
struct FxEnvelope: Codable {
    let base: String
    let rates: [String: Double]
    let updated: Double
}

@MainActor
@Observable
final class Fx {
    static let shared = Fx()
    private(set) var usdPerVnd: Double?

    private static let cacheKey = "eno-fx-usd"
    private static let cacheAtKey = "eno-fx-at"
    private static let maxAge: TimeInterval = 12 * 60 * 60

    private init() {
        let saved = UserDefaults.standard.double(forKey: Self.cacheKey)
        let at = UserDefaults.standard.double(forKey: Self.cacheAtKey)
        if saved > 0, Date().timeIntervalSince1970 - at < Self.maxAge {
            usdPerVnd = saved
        }
    }

    func ensureLoaded() async {
        guard usdPerVnd == nil else { return }
        guard let fx: FxEnvelope = try? await APIClient.shared.get("api/fx") else { return }
        guard let usd = fx.rates["USD"], usd > 0 else { return }
        usdPerVnd = usd
        UserDefaults.standard.set(usd, forKey: Self.cacheKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.cacheAtKey)
    }

    // "≈ $190" — Intl en-US currency style, whole units (currencies.ts:41).
    func approxUSD(_ vnd: Int) -> String? {
        guard let rate = usdPerVnd, vnd > 0 else { return nil }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_US")
        return f.string(from: NSNumber(value: Double(vnd) * rate)).map { "≈ \($0)" }
    }
}
