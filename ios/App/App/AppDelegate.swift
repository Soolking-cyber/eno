import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Home-screen quick action that cold-launched the app, held until the bridge exists.
    private var launchShortcutItem: UIApplicationShortcutItem?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            // Cold launch from a quick action. The Capacitor bridge (and the App plugin's
            // capacitorOpenURL observer) doesn't exist yet, so forwarding now would post into the
            // void. Stash the item and return false — the documented way to tell UIKit NOT to also
            // call performActionFor for this same item — then forward from didBecomeActive, which
            // runs after the storyboard root VC's view (and thus the bridge) is set up. The App
            // plugin relays with retainUntilConsumed, so the event survives until the web app's
            // appUrlOpen listener attaches.
            launchShortcutItem = shortcutItem
            return false
        }
        return true
    }

    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        // Warm path: app already running, bridge alive — forward immediately.
        completionHandler(forward(shortcutItem: shortcutItem))
    }

    /// Translate a quick action into the shared deep-link scheme (enovn://open?path=…) and hand it
    /// to Capacitor's proxy so it reaches the JS appUrlOpen router like any other deep link.
    @discardableResult
    private func forward(shortcutItem: UIApplicationShortcutItem) -> Bool {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#")
        guard let path = shortcutItem.userInfo?["path"] as? String,
              let encoded = path.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: "enovn://open?path=" + encoded) else { return false }
        return ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        if let shortcutItem = launchShortcutItem {
            launchShortcutItem = nil
            forward(shortcutItem: shortcutItem)
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
