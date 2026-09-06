import SwiftUI
import EnoUI

/// A top-level category's tile, drawn from the same Solar v2 artwork the web's home grid uses.
///
/// ⚠️ IT FALLS BACK TO AN SF SYMBOL ON PURPOSE. `UIImage(named:)` is the only way to ask "is this
/// asset in the bundle?" before rendering — `Image(_:)` renders an empty square for a missing name
/// and says nothing. A category added to `src/lib/taxonomy.ts` before the icon generators are
/// re-run would otherwise show a blank tile on the rail, which reads as a broken app rather than a
/// missing regeneration step.
struct EnoCategoryIcon: View {
    let slug: String
    let fallback: String

    var body: some View {
        // ⛔ THE ART FIRST, THE LINE GLYPH SECOND, THE SF SYMBOL LAST. The web's category rail draws
        // `/icons/categories/<slug>.webp` — the same rendered 3D pieces as the nav — and a flat
        // monochrome outline in its place is not the same rail (owner: *"categories rail is not
        // same"*). `art-<slug>` is that picture; `cat-<slug>` is the Solar tile the web uses in its
        // smaller surfaces; the symbol is the last resort for a slug added before either was
        // regenerated.
        if UIImage(named: "art-\(slug)") != nil {
            Image("art-\(slug)")
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
        } else if UIImage(named: "cat-\(slug)") != nil {
            Image("cat-\(slug)")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(EnoColor.sub)   // muted at rest (web text-body), like the FINN grid
        } else {
            Image(systemName: fallback).enoIcon(.lg, color: EnoColor.sub)
        }
    }
}
