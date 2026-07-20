import UIKit
import Vision
#if canImport(FoundationModels)
import FoundationModels
#endif

// ON-DEVICE listing autofill (owner: "on device as much as possible, only
// necessary parts to server"). Two free, private, offline stages:
//   1. Vision (iOS 13+, every iPhone): image → classification labels + OCR text.
//   2. Apple Foundation Models (iOS 26 / Apple Intelligence): the built-in
//      on-device LLM maps those signals + the taxonomy → structured listing
//      fields via guided generation. ZERO server cost, works offline, no login.
// Returns nil when the device can't do it (no Apple Intelligence) → the caller
// falls back to the paid server /api/ai/classify. Moderation + concierge stay
// server-side by design (trust boundary + needs the live catalog).
enum OnDeviceAI {
    static func classify(_ image: UIImage, lang: String, categorySlugs: [String]) async -> ClassifyResult? {
        guard let cg = image.cgImage else { return nil }
        let (labels, ocr) = await visionSignals(cg)
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return await foundationGuess(labels: labels, ocr: ocr, lang: lang, slugs: categorySlugs)
        }
        #endif
        return nil
    }

    // MARK: Vision — image → top labels + OCR (off the main actor; CPU work)
    private static func visionSignals(_ cg: CGImage) async -> (labels: [String], ocr: [String]) {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let handler = VNImageRequestHandler(cgImage: cg, options: [:])
                let classify = VNClassifyImageRequest()
                let ocr = VNRecognizeTextRequest()
                ocr.recognitionLevel = .accurate
                ocr.usesLanguageCorrection = true
                try? handler.perform([classify, ocr])
                // .results is already typed [VNClassificationObservation]? /
                // [VNRecognizedTextObservation]? — the as? casts were dead (audit #13c).
                let labels = classify.results?
                    .filter { $0.confidence > 0.1 }
                    .prefix(8)
                    .map { $0.identifier.replacingOccurrences(of: "_", with: " ") } ?? []
                let text = ocr.results?
                    .compactMap { $0.topCandidates(1).first?.string }
                    .filter { $0.count >= 2 }
                    .prefix(12)
                    .map { $0 } ?? []
                cont.resume(returning: (Array(labels), Array(text)))
            }
        }
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
private struct ListingGuess {
    @Guide(description: "the single best-matching category slug, copied EXACTLY (verbatim) from the allowed list")
    var categorySlug: String
    @Guide(description: "item condition — exactly the word 'new' or the word 'used'")
    var condition: String
    @Guide(description: "a concise buyer-facing product title, at most 60 characters, no phone numbers or links")
    var title: String
    @Guide(description: "the brand name if clearly identifiable from the image or the text, otherwise an empty string")
    var brand: String
}

@available(iOS 26.0, *)
extension OnDeviceAI {
    static func foundationGuess(labels: [String], ocr: [String], lang: String, slugs: [String]) async -> ClassifyResult? {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else { return nil }
        let langName = lang == "vi" ? "Vietnamese" : "English"
        let session = LanguageModelSession(instructions: Instructions("""
            You tag secondhand-marketplace product photos. Pick exactly ONE categorySlug \
            from this allowed list and copy it verbatim: \(slugs.joined(separator: ", ")). \
            Write the title in \(langName). If unsure of the brand, leave it empty.
            """))
        let prompt = """
            Vision labels for the photo: \(labels.isEmpty ? "(none)" : labels.joined(separator: ", ")).
            Text read on the item or its box: \(ocr.isEmpty ? "(none)" : ocr.joined(separator: " | ")).
            Produce the listing fields.
            """
        guard let response = try? await session.respond(to: prompt, generating: ListingGuess.self) else { return nil }
        let g = response.content
        // Drop a hallucinated slug — only a real taxonomy slug is trusted.
        guard slugs.contains(g.categorySlug) else { return nil }
        let condition = (g.condition == "new" || g.condition == "used") ? g.condition : nil
        let brand = g.brand.trimmingCharacters(in: .whitespaces)
        let title = String(g.title.prefix(140)).trimmingCharacters(in: .whitespaces)
        return ClassifyResult(
            categorySlug: g.categorySlug,
            subcategorySlug: nil,
            listingType: nil,
            condition: condition,
            title: title.isEmpty ? nil : title,
            brand: brand.isEmpty ? nil : brand,
            brandUncertain: brand.isEmpty,
            model: nil,
            attributes: nil,
            unclear: false
        )
    }
}
#endif
