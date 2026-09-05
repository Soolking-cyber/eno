import SwiftUI
import AVFoundation
import ImageIO
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
//   · THE PHOTO — the full-resolution frame `AVCapturePhotoOutput` hands back, cut only to the
//     BAND the seller composed in (`bandCrop`: the sensor's full width, the middle of its height),
//     which is what goes to Vision and to the upload, and exactly what the review shows.
// Cropping to the GUIDE is what starved the read; the band keeps every horizontal pixel.

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
    /// The instruction over the camera — the caller knows the document ("Place the passport page
    /// with your photo within the frame"). Rendered bold, on the black ground, like every KYC
    /// vendor's capture screen (Persona/TikTok Shop, owner's reference 2026-09-05).
    var title: String = ""
    /// Short lines under the title — the two or three things that decide a read (no glare, all
    /// four corners in). Optional.
    var tips: [String] = []
    /// The label inside the frame ("Passport photo page", "Front of card"). Optional.
    var frameLabel: String? = nil
    /// ⛔ THE SHUTTER MUST STAY SHUT WHILE THE CALLER IS STILL WORKING. `busy` below covers only the
    /// capture itself, which finishes in milliseconds — the UPLOAD that follows takes seconds on a
    /// Vietnamese mobile connection, and a second tap in that window started a concurrent upload
    /// whose reply could land out of order, overwrite `documentPath`, and clear the selfie taken for
    /// the previous document. Mismatched identity evidence is the worst possible outcome here.
    var externallyBusy: Bool = false
    /// What the caller is doing while `externallyBusy` ("Uploading…", "Reading your passport…").
    var busyLabel: String? = nil
    /// The caller's last error, shown under the band so a refused upload never ends in silence.
    var errorText: String? = nil
    /// The question asked over the reviewed shot — supplied by the caller, who knows the document.
    var reviewPrompt: String? = nil
    let onCapture: (UIImage) -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var camera = CameraController()
    @State private var denied = false
    /// A capture is in flight — the shutter is inert until it finishes. See the note on the button.
    @State private var busy = false
    /// The last capture failed. Cleared on the next attempt.
    @State private var captureError: String?
    /// ⚠️ THE SHOT IS REVIEWED BEFORE IT IS UPLOADED, in the SAME band it was composed in: what the
    /// seller sees at review is exactly the region that is uploaded (see `bandCrop`). The first
    /// version reviewed the full sensor frame `scaledToFit` on a full-screen black canvas — a 3:4
    /// photo in a 9:19.5 space — and that letterbox was "the black bar on the passport photo"
    /// the owner reported for three days.
    @State private var shot: UIImage?
    /// ⚠️ SET SYNCHRONOUSLY ON THE TAP. `externallyBusy` turns true only after the parent's task has
    /// run and the view re-rendered; two taps inside that window sent the same photo twice — the
    /// out-of-order-reply race the shutter already guards against with its own local flag.
    @State private var committed = false
    /// ⚠️ THE CALLER'S ERROR OUTLIVES THE SHOT IT WAS ABOUT. `errorText` is the parent's last upload
    /// failure; on Retake it stays useful under the live band (it says WHY the seller is retaking)
    /// but must NOT sit under the NEXT shot's review as if that photo had already been judged. Set
    /// on Retake, cleared when the caller's error changes (the next upload clears it on start).
    @State private var errorIsStale = false

    /// The camera band's aspect. Documents: a LANDSCAPE band (5:4) — the sensor's full width is kept
    /// (the axis the MRZ runs along), only the top and bottom of the portrait frame are outside it.
    /// Selfie: a 3:4 portrait card, the front camera's own aspect, so nothing is cropped at all.
    private var bandAspect: CGFloat { kind == .selfie ? 3.0 / 4.0 : 5.0 / 4.0 }

    var body: some View {
        // ⚠️ SCROLLS ONLY WHEN IT MUST. Title, two tips, the band, the hint and the 84pt shutter fit a
        // 4.7" phone at default type, but at accessibility text sizes the title alone can be four
        // lines, and a fixed VStack would push the shutter (or Retake / Use this photo) off the
        // bottom with no way to reach them. `.basedOnSize` keeps the screen still when it fits.
        // ⚠️ `minHeight: geo.size.height` IS LOAD-BEARING, NOT TIDINESS. A ScrollView sizes its
        // content to FIT, which collapses the trailing `Spacer(minLength: 0)` to nothing — on a
        // 6.7" phone the whole step would float in the top half above a black gap (gate). With the
        // floor the spacer expands exactly as it did in the fixed VStack, and only accessibility
        // type sizes push past it and scroll.
        GeometryReader { geo in
        ScrollView(.vertical) {
        VStack(spacing: 0) {
            // ── instruction ──
            VStack(spacing: EnoSpacing.s2) {
                if !title.isEmpty {
                    Text(title)
                        .enoText(.title, color: EnoColor.onBrand, weight: .bold)
                        .multilineTextAlignment(.center)
                }
                ForEach(tips, id: \.self) { tip in
                    Text(tip)
                        .enoText(.caption, color: EnoColor.onBrand.opacity(0.75))
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, EnoSpacing.s4)
            .padding(.top, EnoSpacing.s4)
            .padding(.bottom, EnoSpacing.s4)

            // ── the band: live camera, or the reviewed shot, in ONE fixed aspect ──
            ZStack {
                // ⚠️ THE PREVIEW STAYS MOUNTED THROUGH THE REVIEW. Unmounting it while the shot is up
                // means a fresh preview view on Retake, whose connection exists only after the session
                // has an input — and `ready:` would not change again, so `updateUIView` would not run
                // and the feed would come back sideways. The shot is layered OVER the live preview.
                // ⚠️ `ready:` IS NOT DECORATION — it is what guarantees `updateUIView` runs again after
                // the session's input lands on its background queue.
                CameraPreview(controller: camera, ready: camera.isReady)
                if let shot {
                    // scaledToFill in a band of the shot's own aspect: no letterbox, no crop.
                    Image(uiImage: shot)
                        .resizable()
                        .scaledToFill()
                        .accessibilityLabel(kind == .selfie
                                            ? L10n.tr("Your selfie", "Ảnh chân dung của bạn")
                                            : L10n.tr("Your document photo", "Ảnh giấy tờ của bạn"))
                } else {
                    guide
                }
            }
            .aspectRatio(bandAspect, contentMode: .fit)
            // Bounded in HEIGHT as well as width so a tablet-wide layout does not turn the band into
            // a wall. ⚠️ PER KIND: the 340pt cap fits the 5:4 document band (390pt → 312pt, width
            // decides) but is HEIGHT-bound for a 3:4 selfie card — under it the card shrank to
            // 255×340 on every iPhone, with the oval at ~158pt and black either side (gate). The
            // selfie cap is 560pt so a phone's card is width-bound (390×520, oval ~242pt as before)
            // and only a tablet-wide layout is capped; the step scrolls if the copy needs more.
            .frame(maxWidth: .infinity, maxHeight: kind == .selfie ? 560 : 340)
            .clipped()

            // ── below the band: hint, then the shutter or the review controls ──
            VStack(spacing: EnoSpacing.s3) {
                if shot == nil {
                    // ⚠️ THE CALLER'S BUSY LABEL SHOWS HERE TOO. After a passport upload the flow moves
                    // to the selfie step while the model is still reading the MRZ (`scan` runs inside
                    // `upload`, so `busy` stays true for seconds) — the selfie shutter is disabled for
                    // that time and, without this, dimmed with no explanation (gate).
                    Text(externallyBusy ? (busyLabel ?? hint) : (captureError ?? hint))
                        .enoText(.caption, color: EnoColor.onBrand)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, EnoSpacing.s3).padding(.vertical, EnoSpacing.s2)
                        .background(Color.black.opacity(0.55), in: Capsule())
                    Spacer(minLength: EnoSpacing.s2)
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
                            guard let image else {
                                busy = false
                                // Say so, rather than looking like a dead button.
                                captureError = L10n.tr("That photo did not save. Please try again.",
                                                       "Ảnh chưa được lưu. Vui lòng thử lại.")
                                return
                            }
                            // The review shows, and the upload receives, the BAND — what was composed.
                            // ⚠️ OFF THE MAIN ACTOR: `bandCrop` redraws the full sensor frame (a 12MP
                            // frame is a ~48MB transient) and would stall the tap; `busy` holds the
                            // shutter until the cropped shot is up.
                            let aspect = bandAspect
                            Task {
                                let cropped = await Task.detached(priority: .userInitiated) {
                                    Self.bandCrop(image, aspect: aspect)
                                }.value
                                shot = cropped
                                busy = false
                            }
                        }
                    } label: {
                        Circle().fill(EnoColor.onBrand)
                            .frame(width: 72, height: 72)
                            .overlay(Circle().stroke(EnoColor.onBrand.opacity(0.6), lineWidth: 4).frame(width: 84, height: 84))
                    }
                    .disabled(!camera.isReady || busy || externallyBusy)
                    .opacity(camera.isReady && !busy && !externallyBusy ? 1 : 0.5)
                    .accessibilityLabel(L10n.tr("Take photo", "Chụp ảnh"))
                } else if let shot {
                    Text(reviewPrompt ?? L10n.tr("Is everything sharp and in frame?", "Mọi thứ có rõ nét và nằm trong khung không?"))
                        .enoText(.callout, color: EnoColor.onBrand, weight: .bold)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, EnoSpacing.s4)
                    if externallyBusy, let busyLabel {
                        HStack(spacing: EnoSpacing.s2) {
                            ProgressView().tint(EnoColor.onBrand)
                            Text(busyLabel).enoText(.caption, color: EnoColor.onBrand.opacity(0.8))
                        }
                    }
                    // ⚠️ THE SHOT STAYS UP THROUGH THE UPLOAD. A success moves the flow to the next
                    // step (this view goes with it); a failure leaves the reviewed photo here so
                    // "Use this photo" can simply be tapped again, instead of the seller having to
                    // line the page up a second time. Both buttons wait while the upload runs.
                    HStack(spacing: EnoSpacing.s3) {
                        EnoButton(L10n.tr("Retake", "Chụp lại"), icon: "arrow.counterclockwise",
                                  variant: .secondary, fullWidth: false) {
                            self.shot = nil
                            committed = false
                            errorIsStale = errorText != nil
                        }
                        .disabled(externallyBusy || committed)
                        EnoButton(L10n.tr("Use this photo", "Dùng ảnh này"), icon: "checkmark",
                                  variant: .primary, loading: externallyBusy || committed, fullWidth: false) {
                            guard !externallyBusy, !committed else { return }
                            committed = true
                            onCapture(shot)
                            // ⚠️ BOUNDED. The parent's upload flips `externallyBusy` and the
                            // edge below re-arms the buttons; if it never does (a path that
                            // returns before going busy), this re-arms them anyway rather than
                            // leaving a seller on the black screen with two dead buttons.
                            Task {
                                try? await Task.sleep(for: .seconds(3))
                                if !externallyBusy { committed = false }
                            }
                        }
                        .disabled(externallyBusy || committed)
                    }
                }
                // ⛔ A REFUSED UPLOAD USED TO JUST END THE SPINNER (fable). The caller's error is
                // rendered HERE, under the band, in every phase — never off-screen.
                if let errorText, !externallyBusy, !(errorIsStale && shot != nil) {
                    Text(errorText)
                        .enoText(.caption, color: EnoColor.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, EnoSpacing.s4)
                }
                // The seller's own way back, for an unavailability no notification announces.
                if !denied, !camera.isReady, captureError != nil, shot == nil {
                    EnoButton(L10n.tr("Try again", "Thử lại"), variant: .secondary, fullWidth: false) {
                        Task {
                            if case .ok = await camera.start(front: kind == .selfie) { captureError = nil }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, EnoSpacing.s4)
            .padding(.bottom, EnoSpacing.s6)

            Spacer(minLength: 0)
        }
        .frame(minHeight: geo.size.height)
        }
        .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .overlay {
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
        // The upload finished (either way): a failed one leaves the shot up and re-arms the button.
        .onChange(of: externallyBusy) { if !externallyBusy { committed = false } }
        // A refused upload that never flipped `externallyBusy` still re-arms the review buttons.
        .onChange(of: errorText) { errorIsStale = false; if errorText != nil { committed = false } }
    }

    private var hint: String {
        kind == .selfie
            ? L10n.tr("Face inside the oval, in good light", "Đưa khuôn mặt vào khung oval, nơi đủ sáng")
            : L10n.tr("Whole page inside the frame", "Cả trang nằm trong khung")
    }

    // ── the guide over the live band: corner brackets, a veil outside, the label inside ──
    @ViewBuilder private var guide: some View {
        GeometryReader { geo in
            if kind == .selfie {
                // A head is ~0.75 wide-to-tall. The web shipped 0.54 — a slot, not a face.
                let w = geo.size.width * 0.62
                let r = CGRect(x: (geo.size.width - w) / 2, y: geo.size.height * 0.5 - (w / 0.75) / 2, width: w, height: w / 0.75)
                Color.black.opacity(0.35)
                    .mask(
                        ZStack {
                            Rectangle()
                            Ellipse().frame(width: r.width, height: r.height).position(x: r.midX, y: r.midY).blendMode(.destinationOut)
                        }
                        .compositingGroup()
                    )
                Ellipse()
                    .stroke(EnoColor.onBrand.opacity(0.9), lineWidth: 2)
                    .frame(width: r.width, height: r.height)
                    .position(x: r.midX, y: r.midY)
            } else {
                // 88% of the band's width, the document's own aspect, centred: the four corners are
                // what the seller aligns; the rest of the band stays visible under a light veil, so
                // the page's edges are found by eye rather than lost in black.
                let w = geo.size.width * 0.88
                let h = w / guideAspect
                let r = CGRect(x: (geo.size.width - w) / 2, y: (geo.size.height - h) / 2, width: w, height: h)
                Color.white.opacity(0.28)
                    .mask(
                        ZStack {
                            Rectangle()
                            RoundedRectangle(cornerRadius: EnoRadius.card).frame(width: r.width, height: r.height).position(x: r.midX, y: r.midY).blendMode(.destinationOut)
                        }
                        .compositingGroup()
                    )
                CornerBrackets(radius: EnoRadius.card, length: 26)
                    .stroke(EnoColor.onBrand, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .frame(width: r.width, height: r.height)
                    .position(x: r.midX, y: r.midY)
                if let frameLabel {
                    // At the TOP of the frame: the bottom of a passport page is its two code lines,
                    // and nothing may sit over them while the seller composes.
                    Text(frameLabel)
                        .enoText(.caption, color: EnoColor.onBrand)
                        .position(x: r.midX, y: r.minY + 16)
                }
            }
        }
        .allowsHitTesting(false)
    }

    /// The region of the sensor frame the band SHOWED (the preview layer is `resizeAspectFill`, so
    /// the overflowing axis is cropped, centred) — returned upright, at the sensor's resolution.
    /// For a document band (5:4) on a 3:4 portrait frame that is the FULL WIDTH and the middle
    /// 60% of the height: every MRZ pixel the sensor captured is kept (the web's three-day OCR
    /// starvation came from cropping the WIDTH). For the selfie card (3:4) it is the whole frame.
    // ⚠️ `nonisolated` BECAUSE IT IS CALLED OFF THE MAIN ACTOR, and a static member of a SwiftUI
    // View inherits that View's main-actor isolation. It compiles today (Swift 5 language mode)
    // and would be an error the day this target moves to Swift 6 — the shutter's `Task.detached`
    // is exactly the crossing that would break. Stated now, while the reason is in front of us.
    nonisolated static func bandCrop(_ image: UIImage, aspect: CGFloat) -> UIImage {
        // Normalise the orientation first: a camera JPEG is a landscape bitmap with a rotation flag.
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1 // pixels, not points: the camera JPEG is scale 1 and must stay full-resolution
        format.preferredRange = .standard
        guard image.size.width > 0, image.size.height > 0 else { return image }
        // ⚠️ NO REDRAW ON THE NORMAL PATH. PhotoDelegate decodes the capture bounded AND upright
        // (ImageIO, transform baked in), so the pixels can be cropped where they lie — no second
        // full-frame buffer. The redraw survives only for an image that arrives rotated, which now
        // means a fallback decode: correctness first, and it is bounded to the same 4032px.
        let upright: UIImage
        if image.imageOrientation == .up, image.cgImage != nil {
            upright = image
        } else {
            let k = min(1, 4032 / max(image.size.width, image.size.height))
            let size = CGSize(width: (image.size.width * k).rounded(.down), height: (image.size.height * k).rounded(.down))
            upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
        }
        guard let cg = upright.cgImage else { return upright }
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        let rect: CGRect = (w / h > aspect)
            ? CGRect(x: ((w - h * aspect) / 2).rounded(.down), y: 0, width: (h * aspect).rounded(.down), height: h)
            : CGRect(x: 0, y: ((h - w / aspect) / 2).rounded(.down), width: w, height: (w / aspect).rounded(.down))
        guard rect.width >= 1, rect.height >= 1, let cropped = cg.cropping(to: rect) else { return upright }
        return UIImage(cgImage: cropped)
    }
}

/// Four rounded L-shaped corners — the vendor-standard "line the document up here" cue.
private struct CornerBrackets: Shape {
    var radius: CGFloat
    var length: CGFloat
    func path(in rect: CGRect) -> Path {
        // ⚠️ TANGENT ARCS, NOT centre/angle arcs: `addArc(center:…clockwise:)` reads its flag in a Y-up
        // system and draws the other three-quarters of the circle on a Y-down screen — the corners
        // came out as loops. An arc between two tangents has no direction to get wrong.
        var p = Path()
        let r = min(radius, min(rect.width, rect.height) / 2)
        let l = max(length, r)
        let tl = CGPoint(x: rect.minX, y: rect.minY), tr = CGPoint(x: rect.maxX, y: rect.minY)
        let br = CGPoint(x: rect.maxX, y: rect.maxY), bl = CGPoint(x: rect.minX, y: rect.maxY)
        p.move(to: CGPoint(x: tl.x, y: tl.y + l)); p.addArc(tangent1End: tl, tangent2End: CGPoint(x: tl.x + l, y: tl.y), radius: r); p.addLine(to: CGPoint(x: tl.x + l, y: tl.y))
        p.move(to: CGPoint(x: tr.x - l, y: tr.y)); p.addArc(tangent1End: tr, tangent2End: CGPoint(x: tr.x, y: tr.y + l), radius: r); p.addLine(to: CGPoint(x: tr.x, y: tr.y + l))
        p.move(to: CGPoint(x: br.x, y: br.y - l)); p.addArc(tangent1End: br, tangent2End: CGPoint(x: br.x - l, y: br.y), radius: r); p.addLine(to: CGPoint(x: br.x - l, y: br.y))
        p.move(to: CGPoint(x: bl.x + l, y: bl.y)); p.addArc(tangent1End: bl, tangent2End: CGPoint(x: bl.x, y: bl.y - l), radius: r); p.addLine(to: CGPoint(x: bl.x, y: bl.y - l))
        return p
    }
}

/// ⛔ REFUSED (a permission the person must change in Settings) and UNAVAILABLE (the camera is
/// busy, absent or interrupted — retry here) MUST NEVER SHARE A SCREEN: sending a busy-camera user
/// to Settings, or leaving a denied one on a dead retry button, were both shipped bugs.
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
        // ⛔ DECODED BOUNDED, AND UPRIGHT, BY ImageIO — NOT `UIImage(data:)`. A 48MP capture decodes
        // to a ~195MB uncompressed buffer, and every later step (the upright redraw in `bandCrop`,
        // the 2400px encode in IdentityModel) held another one; a small phone is jettisoned during
        // capture and the seller loses the flow (gate, 2026-09-06). `kCGImageSourceThumbnailMaxPixel
        // Size` bounds the DECODE itself, so the big buffer never exists.
        // ⚠️ 4032px on the long edge is a 12MP frame exactly: nothing is lost for the common capture,
        // and it leaves ~90px per MRZ character where the reader needs ~28.
        // ⚠️ `WithTransform` BAKES THE EXIF ROTATION INTO THE PIXELS, which is why the returned image
        // is `.up`. The old comment here said the orientation TAG was enough — it was, for Vision,
        // and it is not for a CGImage crop: `cgImage` is the unrotated buffer, so a landscape-tagged
        // frame would be cropped along the wrong axis. Upright pixels remove that trap entirely.
        guard error == nil, let data = photo.fileDataRepresentation() else {
            DispatchQueue.main.async { self.finish(nil) }; return
        }
        let img: UIImage?
        if let src = CGImageSourceCreateWithData(data as CFData, nil),
           let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [
               kCGImageSourceCreateThumbnailFromImageAlways: true,
               kCGImageSourceCreateThumbnailWithTransform: true,
               kCGImageSourceThumbnailMaxPixelSize: 4032,
           ] as CFDictionary) {
            img = UIImage(cgImage: cg)
        } else {
            // ImageIO refused the container: the full decode is still better than no capture.
            img = UIImage(data: data)
        }
        guard let img else { DispatchQueue.main.async { self.finish(nil) }; return }
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
