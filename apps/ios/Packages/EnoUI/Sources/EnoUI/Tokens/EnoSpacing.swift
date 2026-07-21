import CoreGraphics

// 4pt half-step on an 8pt rhythm. Use for padding/spacing — never a raw magic number.
public enum EnoSpacing {
    public static let s1: CGFloat = 4
    public static let s2: CGFloat = 8
    public static let s3: CGFloat = 12
    public static let s4: CGFloat = 16
    public static let s6: CGFloat = 24
    public static let s8: CGFloat = 32
    public static let s12: CGFloat = 48
    public static let s16: CGFloat = 64
    public static let screenGutter: CGFloat = 16
}
