import CoreGraphics

// Radius tiers (shared with web globals.css). Never write a numeric corner radius in a screen.
public enum EnoRadius {
    public static let card: CGFloat = 11     // panels / cards
    public static let control: CGFloat = 9   // buttons / inputs
    public static let chip: CGFloat = 7      // small chips / thumbnails ≤64px
    /// ⛔ MEDIA ≥ ~96px, AND IT IS NOT `card`. Design canon §2 gives large media its own, rounder
    /// corner — the web draws every listing photo `rounded-2xl` (16px) while its panels sit at
    /// `xl`. The app was clipping card photos at `control` (9pt), which is the button radius: on a
    /// 180pt-wide card that reads as a squarer, harder tile than the same card on the site
    /// (owner, 2026-09-06: *"product images squirle square"*). Matching the web's 16 is what makes
    /// the two feeds look like one product.
    public static let media: CGFloat = 16    // listing photos, gallery tiles, any media ≥96px
}
