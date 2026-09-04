import Foundation
import Vision
import CoreImage
import UIKit

extension UIImage.Orientation {
    /// UIKit and Core Graphics number the same eight orientations differently; Vision speaks CG.
    var cgOrientation: CGImagePropertyOrientation {
        switch self {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}

// ── READING THE MRZ ON DEVICE ───────────────────────────────────────────────────────────────────
//
// ⛔ THIS IS A REWRITE, NOT A PORT, AND THAT IS THE POINT. The web reads the MRZ with Tesseract
// compiled to WASM (~6MB of engine + traineddata, self-hosted because the CSP forbids a CDN), sweeping
// four preprocessing variants across several crop bands under a 40-second budget. None of that belongs
// in a Swift app: Vision ships with the OS, runs on the Neural Engine, needs no download, and returns
// per-observation confidence the web pipeline has to infer from check digits.
//
// What DOES carry over unchanged is the grading. `Mrz.parse` is a faithful port of the same ICAO 9303
// check-digit maths, so a read is accepted here on exactly the evidence the web accepts it on — and
// the SERVER re-derives everything regardless (verify-decision.ts). This is a form pre-fill that can
// prove its own accuracy, never an identity decision.
//
// ⚠️ WHY `.accurate` AND NOT `.fast`. The MRZ is small, dense, fixed-alphabet text where a single
// wrong character invalidates a whole field. `.fast` is tuned for large, well-spaced text; on OCR-B at
// this size it trades exactly the accuracy the check digits then reject.
//
// ⚠️ WHY NO CUSTOM WORDS OR LANGUAGE CORRECTION. `usesLanguageCorrection` "fixes" MRZ toward dictionary
// words — the same trap the web hit with Tesseract's dictionaries, which it disables at engine init
// (load_system_dawg / load_freq_dawg). An MRZ is not language.

enum MrzScanner {
    struct Reading {
        /// The two lines exactly as recognised, cleaned to the MRZ alphabet.
        let lines: [String]
        /// The parse of the best candidate pair, or nil when no pair looked like a TD3.
        let parsed: Mrz.Result?
        /// Every line Vision returned, for diagnosis when a read fails.
        let raw: [String]
    }

    /// Recognise the MRZ in a still. Returns whatever was found — the caller decides what to do with
    /// a parse that does not validate.
    static func read(_ image: UIImage) async -> Reading {
        guard let cg = image.cgImage else { return Reading(lines: [], parsed: nil, raw: []) }
        let raw = await recognise(cg, orientation: image.imageOrientation.cgOrientation)
        let cleaned = raw.map(Mrz.clean).filter { $0.count >= 20 }

        // ⚠️ SELECT BY SHAPE, NOT BY POSITION. Vision returns lines in reading order, which includes
        // the printed fields above the MRZ and anything below it. The MRZ pair is identifiable
        // structurally — two adjacent lines near 44 characters drawn only from the MRZ alphabet.
        // ⛔ THE FLOOR MUST BE BELOW 44, AND THAT IS THE WHOLE REASON `pad` EXISTS. This filter
        // demanded 40–48 characters while the note on `pad` says a recognised line-1 routinely
        // arrives at 36 — so the truncated name line was DISCARDED here, before padding could
        // restore it, and the pair could never form. Two reviewers found the contradiction between
        // this line and that comment; the code and its own documentation disagreed, and the code
        // was wrong. Line 2 carries check digits to the last column and stays near full width;
        // line 1 is the one that loses its trailing filler, so the floor has to admit it.
        let candidates = cleaned.filter { (Mrz.minRecognisedLine...Mrz.lineLength + 4).contains($0.count) }
        var best: (lines: [String], parsed: Mrz.Result)?
        for i in candidates.indices.dropLast() {
            let a = pad(candidates[i]), b = pad(candidates[i + 1])
            let r = Mrz.parse(a, b)
            // Prefer a fully valid pair; otherwise keep the one that passes the most checks, so the
            // UI can say WHICH field failed rather than "try again".
            if r.valid { return Reading(lines: [a, b], parsed: r, raw: raw) }
            let score = [r.checks.passportNumber, r.checks.dateOfBirth, r.checks.expiryDate].filter { $0 }.count
            let bestScore = best.map { [$0.parsed.checks.passportNumber, $0.parsed.checks.dateOfBirth, $0.parsed.checks.expiryDate].filter { $0 }.count } ?? -1
            if score > bestScore { best = ([a, b], r) }
        }
        return Reading(lines: best?.lines ?? [], parsed: best?.parsed, raw: raw)
    }

    /// ⚠️ A LINE SHORT OF 44 IS THE NORM, NOT AN ERROR — and assuming otherwise cost the web three
    /// days. Recognisers stop at the last glyph and never emit the trailing `<` filler, so line 1
    /// routinely arrives at 36 characters. Padding restores the fixed-width layout every offset in
    /// `Mrz.parse` depends on.
    private static func pad(_ line: String) -> String {
        String((line + String(repeating: "<", count: Mrz.lineLength)).prefix(Mrz.lineLength))
    }

    private static func recognise(_ image: CGImage, orientation: CGImagePropertyOrientation) async -> [String] {
        await withCheckedContinuation { continuation in
            // ⛔ A CONTINUATION RESUMED TWICE IS A CRASH, NOT A BUG REPORT — and there are two paths
            // out of this block. When `perform` fails, Vision may invoke the request's completion
            // handler with the error AND THEN throw, so the handler and the `catch` below both fire.
            // `fatalError: SWIFT TASK CONTINUATION MISUSE` is not something a seller should meet
            // while photographing their passport. One-shot, guarded by a lock because the completion
            // handler is not promised to arrive on the calling thread.
            let resumed = NSLock()
            var done = false
            func finish(_ lines: [String]) {
                resumed.lock(); defer { resumed.unlock() }
                guard !done else { return }
                done = true
                continuation.resume(returning: lines)
            }
            let request = VNRecognizeTextRequest { request, _ in
                let obs = (request.results as? [VNRecognizedTextObservation]) ?? []
                finish(obs.compactMap { $0.topCandidates(1).first?.string })
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false          // see the note above — an MRZ is not language
            request.recognitionLanguages = ["en-US"]
            // ⚠️ MRZ glyphs are small relative to the page. Without a floor, Vision discards them as
            // noise on a full-page capture; 1/32 of the image height comfortably admits OCR-B at the
            // sizes a phone produces while still ignoring speckle.
            request.minimumTextHeight = 0.015
            // ⛔ THE ORIENTATION MUST BE PASSED, AND `.cgImage` IS EXACTLY WHERE IT GETS LOST.
            // `AVCapturePhotoOutput` hands back raw sensor frames — landscape, with the upright
            // rotation carried as an EXIF tag on the UIImage. Reading `.cgImage` DROPS that tag, so a
            // portrait capture reaches Vision rotated 90°, and a sideways MRZ never recognises. All
            // three reviewers caught this; the capture view's own comment ("the orientation tag is
            // enough") was true of the UIImage and false the moment anything unwrapped it.
            let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
            do {
                try handler.perform([request])
            } catch {
                finish([])
            }
        }
    }
}
