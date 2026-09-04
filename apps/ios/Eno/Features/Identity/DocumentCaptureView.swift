import SwiftUI
import AVFoundation
import EnoUI

// ── LIVE DOCUMENT / SELFIE CAPTURE ──────────────────────────────────────────────────────────────
//
// ⛔ THE LESSON THAT COST THE WEB THREE DAYS IS ENCODED HERE, so it cannot be repeated natively.
// On the web the preview box was 3:4 PORTRAIT while every camera is landscape, so `object-cover`
// discarded ~58% of the frame WIDTH — the exact axis the MRZ runs along — and the guide frame was
// 86% of what survived. The still handed to OCR was ~36% of the real frame: about 20 pixels per MRZ
// character, where the reader needs ~28. Every "OCR fix" for three days was tuning a recogniser that
// was being starved of pixels.
//
// So this view separates two things the web had fused:
//   · THE GUIDE — what the seller lines the document up against. Cosmetic.
//   · THE PHOTO — the full-resolution frame `AVCapturePhotoOutput` hands back, UNCROPPED, which is
//     what goes to Vision and to the upload.
// Cropping to the guide is what starved the read; the native path simply never does it.

/// What a running camera session is FOR. Any change here has to restart the session, so it is one
/// value the `.task` can key on.
private struct CaptureSession: Equatable {
    let kind: DocumentCaptureView.Kind
    let phase: ScenePhase
}

struct DocumentCaptureView: View {
    enum Kind: Equatable { case document, selfie }
    let kind: Kind
    /// Aspect of the alignment frame: ID-3 passport page 125×88mm ≈ 1.42, a CCCD 85.6×54 ≈ 1.585.
    var guideAspect: CGFloat = 1.42
    /// ⛔ THE SHUTTER MUST STAY SHUT WHILE THE CALLER IS STILL WORKING. `busy` below covers only the
    /// capture itself, which finishes in milliseconds — the UPLOAD that follows takes seconds on a
    /// Vietnamese mobile connection, and a second tap in that window started a concurrent upload
    /// whose reply could land out of order, overwrite `documentPath`, and clear the selfie taken for
    /// the previous document. Mismatched identity evidence is the worst possible outcome here.
    var externallyBusy: Bool = false
    let onCapture: (UIImage) -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var camera = CameraController()
    @State private var denied = false
    /// A capture is in flight — the shutter is inert until it finishes. See the note on the button.
    @State private var busy = false
    /// The last capture failed. Cleared on the next attempt.
    @State private var captureError: String?

    var body: some View {
        ZStack {
            // ⚠️ `ready:` IS NOT DECORATION — it is what guarantees `updateUIView` runs again. The
            // preview's connection does not exist until the session has an input, which happens on a
            // background queue after this first renders; without a value that CHANGES when that
            // completes, SwiftUI never revisits the view and the feed stays sideways forever.
            CameraPreview(controller: camera, ready: camera.isReady)
                .ignoresSafeArea(edges: .bottom)

            if kind == .selfie {
                // A head is ~0.75 wide-to-tall. The web shipped 0.54 — a slot, not a face.
                GeometryReader { geo in
                    let w = geo.size.width * 0.62
                    Ellipse()
                        .stroke(EnoColor.onBrand.opacity(0.85), lineWidth: 2)
                        .frame(width: w, height: w / 0.75)
                        .position(x: geo.size.width / 2, y: geo.size.height * 0.46)
                }
            } else {
                GeometryReader { geo in
                    let w = geo.size.width * 0.88
                    RoundedRectangle(cornerRadius: EnoRadius.card)
                        .stroke(EnoColor.onBrand.opacity(0.85), lineWidth: 2)
                        .frame(width: w, height: w / guideAspect)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)
                }
            }

            VStack {
                Spacer()
                Text(captureError ?? hint)
                    .enoText(.caption, color: EnoColor.onBrand)
                    .padding(.horizontal, EnoSpacing.s3).padding(.vertical, EnoSpacing.s2)
                    .background(Color.black.opacity(0.55), in: Capsule())
                    .padding(.bottom, EnoSpacing.s4)
                // ⚠️ A RAW Button IS CORRECT HERE, AND ONLY HERE. The shutter is a camera-standard
                // 72pt disc with a ring — a control EnoUI does not model and should not, since it
                // exists once in the whole app and its shape is a platform convention people already
                // know. Every other control on this screen uses a primitive. Baselined deliberately.
                Button {
                    // ⛔ ONE SHOT AT A TIME. `capturePhoto` before the session is running throws an
                    // NSException for "no active video connection" — reachable by tapping during the
                    // permission prompt — and a second tap while the first upload is in flight fires
                    // a duplicate that wipes the selfie path mid-flow (fable).
                    guard camera.isReady, !busy, !externallyBusy else { return }
                    busy = true
                    captureError = nil
                    camera.capture { image in
                        busy = false
                        guard let image else {
                            // Say so, rather than looking like a dead button.
                            captureError = L10n.tr("That photo did not save. Please try again.",
                                                   "Ảnh chưa được lưu. Vui lòng thử lại.")
                            return
                        }
                        onCapture(image)
                    }
                } label: {
                    Circle().fill(EnoColor.onBrand)
                        .frame(width: 72, height: 72)
                        .overlay(Circle().stroke(EnoColor.onBrand.opacity(0.6), lineWidth: 4).frame(width: 84, height: 84))
                }
                .padding(.bottom, EnoSpacing.s6)
                .disabled(!camera.isReady || busy || externallyBusy)
                .opacity(camera.isReady && !busy && !externallyBusy ? 1 : 0.5)
                .accessibilityLabel(L10n.tr("Take photo", "Chụp ảnh"))
            }

            // The seller's own way back, for an unavailability no notification announces.
            if !denied, !camera.isReady, captureError != nil {
                VStack {
                    Spacer()
                    EnoButton(L10n.tr("Try again", "Thử lại"), variant: .secondary, fullWidth: false) {
                        Task {
                            if case .ok = await camera.start(front: kind == .selfie) { captureError = nil }
                        }
                    }
                    .padding(.bottom, EnoSpacing.s8)
                }
            }

            if denied {
                VStack(spacing: EnoSpacing.s3) {
                    Text(L10n.tr("eno needs the camera to verify your identity.",
                                 "eno cần quyền máy ảnh để xác minh danh tính."))
                        .enoText(.callout, color: EnoColor.onBrand)
                        .multilineTextAlignment(.center)
                    // ⚠️ A DENIED PERMISSION CANNOT BE RE-ASKED IN-APP — iOS only prompts once. The
                    // only honest action is to open Settings, so that is the only one offered.
                    EnoButton(L10n.tr("Open Settings", "Mở Cài đặt"), variant: .secondary, fullWidth: false) {
                        if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
                    }
                }
                .padding(EnoSpacing.s6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.85))
            }
        }
        .background(Color.black)
        // ⛔ KEYED ON THE SCENE PHASE, BECAUSE THE FIX FOR A DENIED CAMERA HAPPENS IN ANOTHER APP.
        // The overlay sends people to Settings to grant access — and iOS then returns them here with
        // permission granted and a view that never asks again, so the camera stayed "denied" until
        // they backed out and re-entered. Re-running on foreground is the whole recovery.
        // ⛔ KEYED ON `kind` AS WELL AS THE PHASE, OR THE SELFIE IS TAKEN WITH THE BACK CAMERA.
        // The document step and the selfie step are the SAME view type in the SAME position in the
        // tree, so SwiftUI reuses the instance and only the `kind` property changes — a `.task` that
        // is not keyed on `kind` never re-runs, and the seller is asked to photograph their own face
        // through the rear lens. Keying on the phase alone (the previous fix) did not cover it.
        .task(id: CaptureSession(kind: kind, phase: scenePhase)) {
            // ⛔ BACKGROUNDING MUST RELEASE THE CAMERA, and returning early did not. `onDisappear`
            // does not fire when the app is merely backgrounded, so the session — and the camera
            // indicator — stayed live while the seller was in another app entirely.
            guard scenePhase == .active else { camera.stop(); return }
            switch await camera.start(front: kind == .selfie) {
            case .ok:          denied = false; captureError = nil
            case .refused:     denied = true
            // ⚠️ NOT a permission problem — do not send them to Settings. The camera is busy, absent
            // or was interrupted; say that, and leave the screen usable so a retry can succeed.
            case .unavailable: denied = false
                               captureError = L10n.tr("The camera is not available right now.",
                                                      "Máy ảnh hiện không khả dụng.")
            }
        }
        // ⚠️ AN INTERRUPTED CAMERA MUST BE RETRYABLE ON THIS SCREEN. A call, another app grabbing the
        // device, or a moment of contention left the shutter dead with no control to press and no
        // way back except abandoning verification. AVFoundation posts this the instant the
        // interruption ends, which is exactly when a retry will work.
        // ⛔ THE INTERRUPTION BEGINNING MATTERS AS MUCH AS IT ENDING. Handling only the end left the
        // shutter enabled through a phone call or another app taking the camera — and `capturePhoto`
        // on an interrupted session raises an Objective-C exception, which is a crash rather than the
        // error the guard was written to produce.
        .onReceive(NotificationCenter.default.publisher(
            for: AVCaptureSession.wasInterruptedNotification, object: camera.session)) { _ in
            camera.markInterrupted()
            captureError = L10n.tr("The camera was interrupted.", "Máy ảnh đã bị gián đoạn.")
        }
        .onReceive(NotificationCenter.default.publisher(
            for: AVCaptureSession.interruptionEndedNotification, object: camera.session)) { _ in
            Task {
                if case .ok = await camera.start(front: kind == .selfie) { captureError = nil }
            }
        }
        .onDisappear { camera.stop() }
    }

    private var hint: String {
        kind == .selfie
            ? L10n.tr("Face inside the oval, in good light", "Đưa khuôn mặt vào khung oval, nơi đủ sáng")
            : L10n.tr("Whole page inside the frame", "Cả trang nằm trong khung")
    }
}

// ── the session ─────────────────────────────────────────────────────────────────────────────────

/// Why a start did not succeed. ⛔ "REFUSED" AND "UNAVAILABLE" ARE DIFFERENT THINGS AND MUST NOT
/// SHARE A SCREEN. Collapsing them into one Bool put the "open Settings and grant camera access"
/// overlay in front of sellers whose permission was already granted and whose camera was merely
/// busy, absent (the simulator) or interrupted — telling someone to fix a setting that is already
/// correct is worse than saying nothing.
enum CameraStart { case ok, refused, unavailable }

@MainActor
@Observable
final class CameraController {
    let session = AVCaptureSession()
    /// True once the session is actually running — `capturePhoto` before that throws.
    private(set) var isReady = false
    private let output = AVCapturePhotoOutput()
    private var delegate: PhotoDelegate?

    // ⛔ ONE SERIAL QUEUE OWNS THE SESSION, AND THAT IS THE WHOLE DESIGN. `AVCaptureSession` is not
    // thread-safe: configuring it on the main actor while `startRunning`/`stopRunning` ran on
    // detached tasks was a data race, and it is also what produced the leave-and-come-straight-back
    // bugs — two unordered operations racing to decide whether the camera was on. Every mutation now
    // goes through this queue, so a stop queued after a start ALWAYS lands after it. Ordering, not
    // flags, is what makes the sequence correct. (Configuration stays off the main thread too:
    // `startRunning` blocks for hundreds of milliseconds, which on the main actor is a visible hang
    // on the one screen asking for the seller's trust.)
    private let queue = DispatchQueue(label: "vn.eno.identity.camera")

    /// Bumped by every start and every stop. A start whose generation is stale when it finishes has
    /// been superseded — the seller left, or moved to the other capture step — so it must not
    /// enable the shutter.
    private var generation = 0
    /// The lens currently configured, so a step change knows whether to reconfigure. ⚠️ The selfie
    /// step and the document step are the SAME view reused, so this is the only thing that notices.
    private var configuredPosition: AVCaptureDevice.Position?

    func start(front: Bool) async -> CameraStart {
        // ⛔ CLAIM THE GENERATION BEFORE THE FIRST AWAIT, NOT AFTER. The permission prompt can sit on
        // screen for as long as the seller likes; a `stop()` during that window bumped the counter
        // first and was then SUPERSEDED by this start when it resumed — so the session came up on a
        // screen that had already gone away, with the camera indicator lit.
        generation += 1
        let gen = generation
        guard await AVCaptureDevice.requestAccess(for: .video) else { return .refused }
        guard gen == generation else { return .unavailable }
        let position: AVCaptureDevice.Position = front ? .front : .back
        let needsConfiguration = configuredPosition != position

        let running: Bool = await withCheckedContinuation { continuation in
            queue.async { [session, output] in
                if needsConfiguration {
                    session.beginConfiguration()
                    // ⚠️ `.photo` — NOT a video preset. The MRZ is small, dense text and every pixel
                    // buys legibility; a video preset caps the still at preview resolution, which is
                    // precisely the starvation that broke the web reader for three days.
                    session.sessionPreset = .photo
                    // Swapping lenses means dropping the old input: `canAddInput` is false while the
                    // previous one is attached, which a naive retry reads as "no camera".
                    for existing in session.inputs { session.removeInput(existing) }
                    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera,
                                                               for: .video, position: position),
                          let input = try? AVCaptureDeviceInput(device: device),
                          session.canAddInput(input) else {
                        session.commitConfiguration()
                        continuation.resume(returning: false); return
                    }
                    session.addInput(input)
                    // ⛔ NO OUTPUT MEANS NO SHUTTER. Continuing when `canAddOutput` is false left the
                    // session running with nothing to capture into, and `capturePhoto` then raised an
                    // Objective-C exception — a crash, not a handleable error.
                    if session.outputs.isEmpty {
                        guard session.canAddOutput(output) else {
                            session.commitConfiguration()
                            continuation.resume(returning: false); return
                        }
                        session.addOutput(output)
                    }
                    // ⛔ ORIENT THE PHOTO OUTPUT TOO, NOT JUST THE PREVIEW. Rotating only the
                    // preview is the worst combination: the seller lines the passport up against a
                    // picture that looks right, and the file that reaches OCR and the reviewer is
                    // sideways. Vision is handed the EXIF tag, but the stored evidence a human opens
                    // is the same file — it must be upright on its own.
                    if let connection = output.connection(with: .video) {
                        if #available(iOS 17.0, *) {
                            if connection.isVideoRotationAngleSupported(90) {
                                connection.videoRotationAngle = 90
                            }
                        } else if connection.isVideoOrientationSupported {
                            connection.videoOrientation = .portrait
                        }
                    }
                    session.commitConfiguration()
                }
                if !session.isRunning { session.startRunning() }
                continuation.resume(returning: session.isRunning)
            }
        }

        // Superseded while the camera was coming up: leave `isReady` alone and let the newer
        // start (or the stop that overtook us) decide. The queue guarantees our work already ran.
        guard gen == generation else { return .unavailable }
        guard running else { isReady = false; return .unavailable }
        configuredPosition = position
        isReady = true
        return .ok
    }

    /// The session was interrupted (a call, another app taking the camera). Not a stop — the session
    /// resumes itself — but the shutter must not be pressable in the meantime.
    func markInterrupted() { isReady = false }

    func stop() {
        // ⛔ ALWAYS STOP. A running session keeps the camera indicator lit after the seller has moved
        // on, which reads as spyware and is the most common complaint about in-app camera use.
        generation += 1
        isReady = false
        queue.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    func capture(_ completion: @escaping (UIImage?) -> Void) {
        guard isReady else { completion(nil); return }
        let settings = AVCapturePhotoSettings()
        settings.flashMode = .off
        // Retained deliberately: AVFoundation holds the delegate weakly.
        let d = PhotoDelegate { [weak self] image in
            self?.delegate = nil
            completion(image)
        }
        delegate = d
        queue.async { [output] in
            // The connection can disappear between the check and here if the session was torn down;
            // asking for a photo without one is an exception rather than an error.
            // ⚠️ EXISTS IS NOT ENOUGH — it must be ACTIVE. An interrupted session keeps its
            // connection object while `capturePhoto` on it still throws.
            guard let c = output.connection(with: .video), c.isActive, c.isEnabled else {
                DispatchQueue.main.async { d.cancel() }
                return
            }
            output.capturePhoto(with: settings, delegate: d)
        }
    }
}

private final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let done: (UIImage?) -> Void
    private var fired = false
    init(_ done: @escaping (UIImage?) -> Void) { self.done = done }

    /// The capture never reached the output. Reports a failure so the caller releases the shutter.
    func cancel() { finish(nil) }

    /// ⚠️ ONE-SHOT. AVFoundation calls back once, but the no-connection path above also reports a
    /// failure — and a double report would release a shutter the next capture had already taken.
    private func finish(_ image: UIImage?) {
        guard !fired else { return }
        fired = true
        done(image)
    }

    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        // ⚠️ `UIImage(data:)` carries the EXIF orientation into the image, and Vision reads it — a
        // sideways MRZ never recognises. Nothing here rotates pixels; the orientation tag is enough.
        guard error == nil, let data = photo.fileDataRepresentation(), let img = UIImage(data: data) else {
            DispatchQueue.main.async { self.finish(nil) }; return
        }
        DispatchQueue.main.async { self.finish(img) }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let controller: CameraController
    /// See the call site: this exists so the view is re-evaluated once the connection is live.
    let ready: Bool

    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.layer.session = controller.session
        v.layer.videoGravity = .resizeAspectFill
        return v
    }

    // ⛔ THE PREVIEW'S ROTATION MUST BE SET, AND NOT IN `makeUIView`. The connection does not exist
    // until the session has an input, and `start()` adds that asynchronously — so at make-time there
    // is nothing to configure and the default can leave the live feed SIDEWAYS in an app locked to
    // portrait. Setting it here catches the connection once it appears. The seller lining a passport
    // up against a rotated preview is the whole capture experience failing before OCR is reached.
    func updateUIView(_ uiView: PreviewView, context: Context) {
        guard let connection = uiView.layer.connection else { return }
        if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
    }

    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        // swiftlint:disable:next force_cast
        override var layer: AVCaptureVideoPreviewLayer { super.layer as! AVCaptureVideoPreviewLayer }
    }
}
