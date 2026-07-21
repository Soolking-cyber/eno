import CoreGraphics

// Radius tiers (shared with web globals.css). Never write a numeric corner radius in a screen.
public enum EnoRadius {
    public static let card: CGFloat = 11     // panels / cards
    public static let control: CGFloat = 9   // buttons / inputs
    public static let chip: CGFloat = 7      // small chips / thumbnails ≤64px
}
