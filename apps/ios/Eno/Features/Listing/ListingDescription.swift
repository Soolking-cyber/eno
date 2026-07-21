import SwiftUI
import EnoUI

// Light-markdown renderer for listing descriptions — mirrors the web
// listing-content.tsx formatDescription: blank-line paragraphs, `#` headings,
// `*`/`-`/`•` bullet lists, `1.`/`1)` numbered lists, and inline **bold**/*italic*.
// Native previously showed the raw markdown source.
struct ListingDescriptionView: View {
    let text: String

    enum Block: Equatable { case paragraph(String), heading(String), bullets([String]), numbered([String]) }

    var body: some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
            ForEach(Array(parse(text).enumerated()), id: \.offset) { _, block in
                render(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)   // web `allow-select`: descriptions stay copyable
    }

    @ViewBuilder private func render(_ block: Block) -> some View {
        switch block {
        case .paragraph(let s):
            inline(s).enoText(.callout, color: EnoColor.sub).lineSpacing(4)
        case .heading(let s):
            inline(s).enoText(.headline, color: EnoColor.fg)
        case .bullets(let items):
            listRows(items) { _ in "•" }
        case .numbered(let items):
            listRows(items) { "\($0 + 1)." }
        }
    }

    private func listRows(_ items: [String], marker: @escaping (Int) -> String) -> some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s1) {
            ForEach(items.indices, id: \.self) { i in
                HStack(alignment: .firstTextBaseline, spacing: EnoSpacing.s1 + 2) {
                    Text(marker(i)).enoText(.callout, color: EnoColor.ink4)
                    inline(items[i]).enoText(.callout, color: EnoColor.sub).lineSpacing(4)
                }
            }
        }
    }

    // Inline **bold**/*italic* via AttributedString markdown (block structure is
    // handled line-by-line above; SwiftUI's markdown is inline-only).
    private func inline(_ s: String) -> Text {
        if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return Text(a)
        }
        return Text(s)
    }

    // MARK: - parse (mirrors formatDescription's line machine)
    private func parse(_ text: String) -> [Block] {
        let lines = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        var out: [Block] = [], para: [String] = [], ul: [String] = [], ol: [String] = []
        func flushPara() { if !para.isEmpty { out.append(.paragraph(para.joined(separator: " "))); para = [] } }
        func flushUl() { if !ul.isEmpty { out.append(.bullets(ul)); ul = [] } }
        func flushOl() { if !ol.isEmpty { out.append(.numbered(ol)); ol = [] } }
        func flushAll() { flushPara(); flushUl(); flushOl() }
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flushAll(); continue }
            if let h = heading(line) { flushAll(); out.append(.heading(h)); continue }
            if let b = bullet(line) { flushPara(); flushOl(); ul.append(b); continue }
            if let n = numbered(line) { flushPara(); flushUl(); ol.append(n); continue }
            flushUl(); flushOl(); para.append(line)
        }
        flushAll()
        return out
    }

    // "# …" … "###### …" → heading text (needs a space after the hashes; NOT a bare "#").
    private func heading(_ line: String) -> String? {
        var hashes = 0
        for c in line { if c == "#" { hashes += 1 } else { break } }
        guard (1...6).contains(hashes) else { return nil }
        let after = line.index(line.startIndex, offsetBy: hashes)
        guard after < line.endIndex, line[after] == " " else { return nil }
        return String(line[after...]).trimmingCharacters(in: .whitespaces)
    }

    // "* " / "- " / "• " (a space after ONE marker, so "**bold**" is not a bullet).
    private func bullet(_ line: String) -> String? {
        for m in ["* ", "- ", "• "] where line.hasPrefix(m) {
            return String(line.dropFirst(m.count)).trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    // "1. " / "12) " — 1–3 digits then . or ) then a space.
    private func numbered(_ line: String) -> String? {
        var i = line.startIndex, digits = 0
        while i < line.endIndex, line[i].isNumber, digits < 3 { i = line.index(after: i); digits += 1 }
        guard digits >= 1, i < line.endIndex, line[i] == "." || line[i] == ")" else { return nil }
        let sep = line.index(after: i)
        guard sep < line.endIndex, line[sep] == " " else { return nil }
        return String(line[line.index(after: sep)...]).trimmingCharacters(in: .whitespaces)
    }
}
