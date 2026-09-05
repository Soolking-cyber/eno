import Foundation

// ── VIETNAMESE BANKS THAT CAN RECEIVE A VIETQR TRANSFER ─────────────────────────────────────────
//
// ⛔ A BANK IS CHOSEN FROM THIS LIST, NEVER TYPED. The six-digit value is the NAPAS acquirer BIN
// that goes into tag 38 of the QR payload, and a wrong one does not error — it makes a QR that
// scans and names a DIFFERENT bank. So the seller picks a name they recognise and the BIN comes
// from here.
//
// ⚠️ A VERBATIM COPY OF src/lib/payments/vn-banks.ts. Both clients and the server's readiness
// check must agree on which banks exist; a BIN saved on the web and no longer listed here would
// render as no bank at all. Change it there first, then here, in the same commit.
struct VnBank: Identifiable, Equatable {
    /// The 6-digit NAPAS acquirer BIN.
    let bin: String
    /// What Vietnamese people call it — the label a seller recognises.
    let short: String
    /// The full legal name, for disambiguation.
    let name: String
    var id: String { bin }
}

enum VnBanks {
    static let all: [VnBank] = [
        VnBank(bin: "970425", short: "ABBANK", name: "Ngân hàng TMCP An Bình"),
        VnBank(bin: "970416", short: "ACB", name: "Ngân hàng TMCP Á Châu"),
        VnBank(bin: "970405", short: "Agribank", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam"),
        VnBank(bin: "970409", short: "BacABank", name: "Ngân hàng TMCP Bắc Á"),
        VnBank(bin: "970438", short: "BaoVietBank", name: "Ngân hàng TMCP Bảo Việt"),
        VnBank(bin: "970418", short: "BIDV", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam"),
        VnBank(bin: "546034", short: "CAKE", name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số CAKE by VPBank"),
        VnBank(bin: "422589", short: "CIMB", name: "Ngân hàng TNHH MTV CIMB Việt Nam"),
        VnBank(bin: "970446", short: "COOPBANK", name: "Ngân hàng Hợp tác xã Việt Nam"),
        VnBank(bin: "970431", short: "Eximbank", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam"),
        VnBank(bin: "970437", short: "HDBank", name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh"),
        VnBank(bin: "668888", short: "KBank", name: "Ngân hàng Đại chúng TNHH Kasikornbank"),
        VnBank(bin: "970452", short: "KienLongBank", name: "Ngân hàng TMCP Kiên Long"),
        VnBank(bin: "970449", short: "LPBank", name: "Ngân hàng TMCP Lộc Phát Việt Nam"),
        VnBank(bin: "970422", short: "MBBank", name: "Ngân hàng TMCP Quân đội"),
        VnBank(bin: "970414", short: "MBV", name: "Ngân hàng TNHH MTV Việt Nam Hiện Đại"),
        VnBank(bin: "971025", short: "MoMo", name: "CTCP Dịch Vụ Di Động Trực Tuyến"),
        VnBank(bin: "970426", short: "MSB", name: "Ngân hàng TMCP Hàng Hải Việt Nam"),
        VnBank(bin: "970428", short: "NamABank", name: "Ngân hàng TMCP Nam Á"),
        VnBank(bin: "970419", short: "NCB", name: "Ngân hàng TMCP Quốc Dân"),
        VnBank(bin: "970448", short: "OCB", name: "Ngân hàng TMCP Phương Đông"),
        VnBank(bin: "970430", short: "PGBank", name: "Ngân hàng TMCP Thịnh vượng và Phát triển"),
        VnBank(bin: "970412", short: "PVcomBank", name: "Ngân hàng TMCP Đại Chúng Việt Nam"),
        VnBank(bin: "971133", short: "PVcomBank Pay", name: "Ngân hàng TMCP Đại Chúng Việt Nam Ngân hàng số"),
        VnBank(bin: "970403", short: "Sacombank", name: "Ngân hàng TMCP Sài Gòn Thương Tín"),
        VnBank(bin: "970400", short: "SaigonBank", name: "Ngân hàng TMCP Sài Gòn Công Thương"),
        VnBank(bin: "970429", short: "SCB", name: "Ngân hàng TMCP Sài Gòn"),
        VnBank(bin: "970440", short: "SeABank", name: "Ngân hàng TMCP Đông Nam Á"),
        VnBank(bin: "970443", short: "SHB", name: "Ngân hàng TMCP Sài Gòn - Hà Nội"),
        VnBank(bin: "970424", short: "ShinhanBank", name: "Ngân hàng TNHH MTV Shinhan Việt Nam"),
        VnBank(bin: "970407", short: "Techcombank", name: "Ngân hàng TMCP Kỹ thương Việt Nam"),
        VnBank(bin: "963388", short: "Timo", name: "Ngân hàng số Timo by Ban Viet Bank (Timo by Ban Viet Bank)"),
        VnBank(bin: "970423", short: "TPBank", name: "Ngân hàng TMCP Tiên Phong"),
        VnBank(bin: "546035", short: "Ubank", name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số Ubank by VPBank"),
        VnBank(bin: "970441", short: "VIB", name: "Ngân hàng TMCP Quốc tế Việt Nam"),
        VnBank(bin: "970427", short: "VietABank", name: "Ngân hàng TMCP Việt Á"),
        VnBank(bin: "970433", short: "VietBank", name: "Ngân hàng TMCP Việt Nam Thương Tín"),
        VnBank(bin: "970454", short: "VietCapitalBank", name: "Ngân hàng TMCP Bản Việt"),
        VnBank(bin: "970436", short: "Vietcombank", name: "Ngân hàng TMCP Ngoại Thương Việt Nam"),
        VnBank(bin: "970415", short: "VietinBank", name: "Ngân hàng TMCP Công thương Việt Nam"),
        VnBank(bin: "970432", short: "VPBank", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng"),
        VnBank(bin: "970457", short: "Woori", name: "Ngân hàng TNHH MTV Woori Việt Nam"),
    ]

    /// ⚠️ EXACT BIN LOOKUP, so a stored value can always be rendered as the bank a seller chose —
    /// and a saved BIN that is no longer listed leaves the picker EMPTY rather than selecting a row
    /// that does not exist.
    static func byBin(_ bin: String?) -> VnBank? {
        let b = (bin ?? "").trimmingCharacters(in: .whitespaces)
        return all.first { $0.bin == b }
    }
}
