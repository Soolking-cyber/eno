import UIKit

/// The UIScene life cycle (1.3 groundwork, owner 2026-11-23: "rebuild with 27"). From April 2027 App Store Connect takes only
/// binaries built with the iOS 27 SDK (ITMS-90725), and a UIKit app built with that SDK and NO scene manifest does not
/// launch on iOS 27 (TN3187). So the window now belongs to a scene (Info.plist UIApplicationSceneManifest → Main storyboard).
///
/// ⛔ NOTHING IS RE-ROUTED HERE. Every way into the app that used to reach AppDelegate — a custom-scheme or universal link, a
/// Home-screen shortcut, at launch or while running — arrives in a scene callback instead, and each one is handed to the
/// SAME AppDelegate code it always ran (`deliver`, `continueWeb`, `forward(shortcutItem:)`): the deep-link validation and
/// its tests (native-deep-link-parity.test.ts) stay where they are. Push registration and notification taps are unchanged
/// (AppDelegate + UNUserNotificationCenter), and UIApplication's active/resign notifications are still posted, so
/// MainViewController's watchdog and EnoShell's launch picture keep their hooks.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var launchShortcutItem: UIApplicationShortcutItem?

    private var app: AppDelegate? { UIApplication.shared.delegate as? AppDelegate }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // AppDelegate (and anything that asks it for the window, as Capacitor's plugins may) keeps finding the one window.
        app?.window = window
        // EnoShell's launch picture is for a launch from the icon only (EnoShell.plainLaunch): a link, a notification, a
        // shortcut or a handed-off activity opens somewhere else. Under scenes these arrive HERE, no longer in launchOptions.
        EnoShell.plainLaunch = connectionOptions.urlContexts.isEmpty && connectionOptions.userActivities.isEmpty
            && connectionOptions.shortcutItem == nil && connectionOptions.notificationResponse == nil
        if let item = connectionOptions.shortcutItem { launchShortcutItem = item } // delivered once the app is active
        // Delivered here, as `application(_:open:)` was at a cold launch: with no WebView yet the link goes to Capacitor's
        // launch-URL store (ApplicationDelegateProxy), which the web's boot code reads (App.getLaunchUrl) — the same path.
        if let context = connectionOptions.urlContexts.first { app?.deliver(context.url, options: Self.options(context)) }
        // Any activity: a universal link, or (1.3) a Spotlight result for a listing — continueWeb tells them apart.
        if let activity = connectionOptions.userActivities.first { app?.continueWeb(activity) }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        if let item = launchShortcutItem {
            launchShortcutItem = nil
            app?.forward(shortcutItem: item)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { app?.deliver(context.url, options: Self.options(context)) }
    }

    /// The opening app and open-in-place flag, as `application(_:open:options:)` received them (Capacitor's appUrlOpen).
    private static func options(_ context: UIOpenURLContext) -> [UIApplication.OpenURLOptionsKey: Any] {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
        if let source = context.options.sourceApplication { options[.sourceApplication] = source }
        return options
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        app?.continueWeb(userActivity)
    }

    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(app?.forward(shortcutItem: shortcutItem) ?? false)
    }
}
