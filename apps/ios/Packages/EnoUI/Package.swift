// swift-tools-version:5.9
import PackageDescription

// EnoUI — the eno.vn iOS design system. A SEPARATE package on purpose: the module
// boundary guarantees no networking, app models, L10n globals or feature state leak
// into a component. Components take strings, values and closures only.
// Canon: docs/ios-design-language.md.
let package = Package(
    name: "EnoUI",
    platforms: [.iOS(.v17)],
    products: [.library(name: "EnoUI", targets: ["EnoUI"])],
    targets: [.target(name: "EnoUI", path: "Sources/EnoUI")]
)
