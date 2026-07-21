import CoreGraphics

// Mostly flat — card hierarchy comes from surface + a 1pt ring, not shadows. These few
// shadow tokens are for floating surfaces ONLY (map card, floating filter bar, media
// overlay). System sheets/menus/navigation own their own elevation — never double them.
public enum EnoElevation {
    case flat, raised, floating, overlay

    /// (light opacity, dark opacity, blur radius, y offset) — nil = no shadow.
    var shadow: (light: Double, dark: Double, radius: CGFloat, y: CGFloat)? {
        switch self {
        case .flat:     return nil
        case .raised:   return (0.06, 0.24, 3, 1)
        case .floating: return (0.10, 0.30, 10, 4)
        case .overlay:  return (0.16, 0.38, 24, 10)
        }
    }
}
