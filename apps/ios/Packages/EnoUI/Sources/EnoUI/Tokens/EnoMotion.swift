import SwiftUI

// The eno motion system (ported from the web's spring easings). Use these — never an
// ad-hoc `.spring()` / `.easeInOut()`. All SPATIAL motion (scale/travel/parallax) must be
// gated on `accessibilityReduceMotion` by the caller; the EnoUI primitives already are.
public enum EnoMotion {
    public static let springSnappy = Animation.spring(duration: 0.22, bounce: 0.08)    // press, chip selection
    public static let springStandard = Animation.spring(duration: 0.34, bounce: 0.12)  // layout / state transitions
    public static let springSuccess = Animation.spring(duration: 0.46, bounce: 0.22)   // rare successful completion
    public static let fadeFast = Animation.easeOut(duration: 0.16)                      // opacity, image arrival
    public static let exit = Animation.easeIn(duration: 0.14)                           // removal
    public static let standard = Animation.easeInOut(duration: 0.24)                    // non-spatial state change
}
