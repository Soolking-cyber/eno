import UserNotifications
import UniformTypeIdentifiers
import UIKit

/// iOS 1.3 — a chat notification shows its listing's photo (owner, 2026-11-23: "make it super native" → rich notifications).
///
/// The server sends a thread push with `aps.mutable-content = 1` and `image` = the listing photo through the site's optimizer
/// on eno.vn (src/lib/native-push.ts apnsBody); iOS hands it here before showing it. This downloads that one photo, redraws it
/// as a JPEG (the optimizer may answer WebP or AVIF, which an attachment does not take) and attaches it.
/// ⛔ ANY FAILURE DELIVERS THE NOTIFICATION AS IT CAME: no `image`, a URL that is not the optimizer on https://eno.vn, a
/// non-200, an undecodable photo, an attachment iOS refuses, or the time iOS allows running out. The words always arrive.
/// ⛔ NOTHING ELSE IS TOUCHED: title, body, category (the Reply action), `url` and `to` reach the app exactly as sent.
final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var deliver: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?
    private var task: URLSessionDataTask?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.lock()
        deliver = contentHandler
        original = request.content
        lock.unlock()
        guard let raw = request.content.userInfo["image"] as? String, let url = Self.photoURL(raw) else {
            finish(with: nil)
            return
        }
        var photoRequest = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        photoRequest.setValue("image/jpeg,image/png;q=0.9,image/*;q=0.5", forHTTPHeaderField: "Accept")
        let task = URLSession.shared.dataTask(with: photoRequest) { [weak self] data, response, _ in
            guard let self else { return }
            guard let data, (response as? HTTPURLResponse)?.statusCode == 200,
                  let attachment = Self.attachment(from: data) else {
                self.finish(with: nil)
                return
            }
            self.finish(with: attachment)
        }
        lock.lock()
        self.task = task
        lock.unlock()
        task.resume()
    }

    /// iOS is about to stop waiting: the notification goes as it came.
    override func serviceExtensionTimeWillExpire() {
        lock.lock()
        let running = task
        lock.unlock()
        running?.cancel()
        finish(with: nil)
    }

    /// Hands the notification to iOS exactly once, with the photo when there is one.
    private func finish(with attachment: UNNotificationAttachment?) {
        lock.lock()
        let handler = deliver
        let content = original
        deliver = nil
        lock.unlock()
        guard let handler, let content else { return }
        guard let attachment, let rich = content.mutableCopy() as? UNMutableNotificationContent else {
            handler(content)
            return
        }
        rich.attachments = [attachment]
        handler(rich)
    }

    /// Only the site's image optimizer on the app's own origin (src/lib/native-surfaces.ts appImageUrl).
    static func photoURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme == "https", url.host?.lowercased() == "eno.vn",
              url.port == nil, url.user == nil, url.password == nil, url.path == "/_next/image" else { return nil }
        return url
    }

    /// The photo, decoded and re-encoded as a JPEG no wider than 1080 px, in a file iOS then moves into its own store.
    private static func attachment(from data: Data) -> UNNotificationAttachment? {
        guard let image = UIImage(data: data) else { return nil }
        let side = max(image.size.width, image.size.height, 1)
        let scale = min(1, 1080 / side)
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        guard let jpeg = (image.preparingThumbnail(of: size) ?? image).jpegData(compressionQuality: 0.85) else { return nil }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
        do {
            try jpeg.write(to: file, options: .atomic)
            return try UNNotificationAttachment(identifier: "photo", url: file, options: [UNNotificationAttachmentOptionsTypeHintKey: UTType.jpeg.identifier])
        } catch {
            try? FileManager.default.removeItem(at: file)
            return nil
        }
    }
}
