import UIKit
import UserNotifications

// APNs registration client (audit #4). The SERVER is already built and dormant
// (src/lib/native-push.ts + POST /api/push/native-subscribe upserts NativePushToken);
// this is the missing native half: request authorization, register with APNs, upload
// the device token, and route a notification tap.
//
// GATED by `enabled`: it stays false (no permission prompt, no registration) until
// the app actually ships the aps-environment entitlement + APNS_* env is live — same
// dormancy as the server. Flip it to true in the same commit that wires the
// entitlement (portal step done), so we never prompt for a feature that can't deliver.
final class PushManager: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    /// Flip to true once the entitlement + APNS_* env are live (see readiness doc §🔧).
    static let enabled = false

    private static let askedKey = "eno-push-asked"

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// Ask once, contextually — call after the user is signed in (there is nothing to
    /// route to for a guest). Re-registers each launch if already authorized so a
    /// rotated APNs token re-homes to the current account.
    @MainActor
    func registerIfSignedIn() async {
        guard Self.enabled, AuthModel.shared.isSignedIn else { return }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        case .notDetermined:
            guard !UserDefaults.standard.bool(forKey: Self.askedKey) else { return }
            UserDefaults.standard.set(true, forKey: Self.askedKey)
            if (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true {
                UIApplication.shared.registerForRemoteNotifications()
            }
        default:
            break   // denied → respect it
        }
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task {
            guard await AuthModel.shared.isSignedIn else { return }
            _ = try? await APIClient.shared.send("POST", "api/push/native-subscribe",
                                                 body: ["token": hex, "platform": "ios"])
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // No entitlement / no network / simulator → silent; nothing to route to.
    }

    // Foreground: still show the banner (parity with a real push app).
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .badge, .sound]
    }

    // Tap → hand the payload's deep-link to the router (audit #3). Until the router
    // lands, a tap just foregrounds the app (the badge/notification list still work).
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        if let urlString = info["url"] as? String, let url = URL(string: urlString) {
            await MainActor.run { DeepLinkRouter.shared.handle(url) }
        } else if let convo = info["conversationId"] as? String {
            await MainActor.run { DeepLinkRouter.shared.openConversation(convo) }
        }
    }
}
