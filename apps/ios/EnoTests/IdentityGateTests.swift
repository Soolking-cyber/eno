import Testing
import Foundation
@testable import Eno

private let L1 = "P<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<"
private let L2 = "X1234567<7NLD8802141F3007310<<<<<<<<<<<<<<00"

@Suite("Identity — the confirmed fields and the MRZ must agree")
struct IdentityDisagreementTests {
    @MainActor private func model() -> IdentityModel {
        let m = IdentityModel()
        m.tier = .b
        m.mrzLine1 = L1; m.mrzLine2 = L2
        m.documentPath = "doc"; m.selfiePath = "selfie"; m.challengeCode = "c"
        m.surname = "DE VRIES"; m.givenNames = "SOPHIE ANNA"
        return m
    }

    @Test @MainActor func noTypedNumberIsNoDisagreement() {
        let m = model()
        #expect(m.mrzValid)
        #expect(m.mrzDisagreement == nil)
        #expect(m.canSubmit)
    }

    @Test @MainActor func aCorrectedNumberBlocksSendAndNamesBothValues() {
        let m = model()
        m.documentNumber = "x1234561"          // the seller "fixed" a mod-10-blind misread
        let d = m.mrzDisagreement
        #expect(d != nil)
        #expect(d?.contains("X1234567") == true)
        #expect(d?.contains("X1234561") == true)
        #expect(!m.canSubmit)
        m.documentNumber = " X1234567 "         // agrees again, whitespace and case aside
        #expect(m.mrzDisagreement == nil)
        #expect(m.canSubmit)
    }

    @Test @MainActor func aCorrectedExpiryBlocksSend() {
        let m = model()
        m.documentExpiry = "2031-07-31"
        #expect(m.mrzDisagreement?.contains("2030-07-31") == true)
        #expect(!m.canSubmit)
    }

    /// The raw-line editor opens for a disagreement and STAYS open while the seller corrects line 2,
    /// even though the first keystroke breaks a check digit and the disagreement disappears.
    @Test @MainActor func theEditorStaysOpenWhileTheSellerCorrectsTheLine() {
        let m = model()
        m.mrzFromScan = true
        #expect(!m.showsMrzLines, "a clean scan needs no raw-line editor")
        m.documentNumber = "X1234561"; m.markEdited()   // the field's edit hook, always mounted
        #expect(m.mrzDisagreement != nil)
        #expect(m.showsMrzLines)
        m.mrzLine2 = "X123456"                      // mid-edit: no longer valid, no longer disagreeing
        #expect(m.mrzDisagreement == nil)
        #expect(m.showsMrzLines, "…and the editor is still there")
        m.retakeDocument()
        #expect(!m.mrzLinesRevealed, "a retake clears the latch with the lines")
    }

    @Test @MainActor func onlyAValidMrzCanDisagree() {
        let m = model()
        m.mrzLine2 = "X1234567<7NLD8802141F3007310<<<<<<<<<<<<<<01"   // composite wrong
        m.documentNumber = "ZZZ"
        #expect(!m.mrzValid)
        #expect(m.mrzDisagreement == nil)
    }
}

@Suite("Identity — a failed scan says so")
struct IdentityScanFailedTests {
    @Test @MainActor func failedOnlyAfterAnUploadedPassportWithNoScannedLines() {
        let m = IdentityModel()
        m.tier = .b
        #expect(!m.scanFailed, "nothing photographed yet")
        m.documentPath = "doc"
        #expect(m.scanFailed)
        m.mrzFromScan = true
        #expect(!m.scanFailed)
        m.mrzFromScan = false; m.scanning = true
        #expect(!m.scanFailed, "still reading")
        m.scanning = false
        m.mrzLine1 = L1; m.mrzLine2 = L2               // typed by hand, and valid
        #expect(!m.scanFailed, "a correct manual entry is not a failed scan")
        m.mrzLine2 = ""; m.tier = .a
        #expect(!m.scanFailed, "a CCCD has no MRZ to fail")
    }

    @Test @MainActor func startOverReturnsToTheTierChoiceWithNothingKept() {
        let m = IdentityModel()
        m.tier = .b; m.step = .details; m.documentPath = "d"; m.selfiePath = "s"; m.challengeCode = "c"
        m.mrzLine1 = L1; m.mrzLine2 = L2; m.mrzFromScan = true; m.surname = "X"; m.error = "old"
        m.startOver()
        #expect(m.step == .tier)
        #expect(m.tier == nil)
        #expect(m.challengeCode == nil && m.documentPath == nil && m.selfiePath == nil)
        #expect(m.mrzLine2.isEmpty && !m.mrzFromScan && m.surname.isEmpty)
        #expect(m.error == nil)
    }
}
