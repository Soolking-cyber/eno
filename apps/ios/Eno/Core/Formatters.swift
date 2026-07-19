import Foundation

enum Format {
    // Money mirrors src/lib/vnd.ts: Vietnamese uses DOT thousands + "đ"
    // ("12.000.000 đ"); English keeps commas ("12,000,000 VND").
    static func vnd(_ amount: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = L10n.isVi ? "." : ","
        let n = f.string(from: NSNumber(value: amount)) ?? String(amount)
        return L10n.isVi ? "\(n) đ" : "\(n) VND"
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoNoFraction = ISO8601DateFormatter()

    static func date(_ isoString: String) -> Date? {
        iso.date(from: isoString) ?? isoNoFraction.date(from: isoString)
    }

    // "3h ago" / "3 giờ trước" — the card/PDP recency stamp.
    static func ago(_ isoString: String) -> String {
        guard let d = date(isoString) else { return "" }
        let s = Int(Date().timeIntervalSince(d))
        if s < 3600 { return L10n.tr("\(max(1, s / 60))m ago", "\(max(1, s / 60)) phút trước") }
        if s < 86400 { return L10n.tr("\(s / 3600)h ago", "\(s / 3600) giờ trước") }
        if s < 30 * 86400 { return L10n.tr("\(s / 86400)d ago", "\(s / 86400) ngày trước") }
        return L10n.tr("\(s / (30 * 86400))mo ago", "\(s / (30 * 86400)) tháng trước")
    }
}
