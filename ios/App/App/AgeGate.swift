import UIKit
import StoreKit
// ⛔ WEAK-LINKED (OTHER_LDFLAGS -weak_framework DeclaredAgeRange). The framework exists only from iOS 26 and the app
// runs from 16.4: strongly linked, dyld would refuse to launch the app on every older iPhone. Every use below sits
// behind `#available(iOS 26.2, *)`; scripts/ios-release.sh refuses an archive whose binary loads it strongly.
import DeclaredAgeRange

/// THE ADULTS-ONLY GATE APPLE'S AGE-ASSURANCE LAWS REQUIRE (1.1; D17 in docs/ios-appstore-release.md).
///
/// Owner, 2026-11-09, choosing "Build 1.1 with age check, then open US". Texas SB 2420 applies to new Apple Accounts in
/// Texas since 2026-06-04 (Utah and Louisiana to follow), and Apple's age-assurance Q&A is explicit that an 18+ app still
/// has to ask: "If my app is rated 18+, do I still need to implement the Declared Age Range API? Yes. In regions where
/// legally required, you need to check the age of the people using your app". eno's Terms are 18+, so the check has one
/// gate, 18, and an answer that does not prove 18 or older closes the app: the page is blanked and the block screen
/// stays up.
///
/// ⛔ THE FIRST PAGE IS NOT HELD FOR APPLE'S REGION SIGNAL. Measured 2026-11-09 on the iOS 26.5 simulator: the read
/// takes 2.2–3.3 s on every launch, so holding the first load would add that to EVERY launch in every country —
/// Vietnam above all. eno.vn is a public website any browser opens without an age check, so what shows before Apple
/// answers is that same public page. From the moment Apple says the law applies the state is `.pending`, which holds
/// every new main-frame load until the answer.
///
/// - Outside a regulated region nothing is asked and nothing changes: Apple's own signal says whether the law applies
///   (`requiredRegulatoryFeatures ∋ .declaredAgeRangeRequired` on iOS 26.4+, `isEligibleForAgeFeatures` on 26.2–26.3).
///   Calling `requestAgeRange` without that check would show Apple's sharing sheet to every user in every country.
/// - Below iOS 26.2 there is nothing to call (Apple's regional categories arrive in 26.2) and the gate is open from the
///   first frame — byte-for-byte 1.0.3's launch.
/// - ⛔ OUTSIDE THE US STOREFRONT IT CLOSES ONLY ON APPLE'S ANSWER, NEVER ON APPLE'S FAILURE. Under 18, a decline, or a
///   range that does not settle 18 keeps it closed; a region signal that throws or hangs (twice, 10 s each — the read
///   measured 2.2–3.3 s), or an age request that THROWS, opens it.
///   Measured 2026-11-09 on the iOS 26.5 simulator: `requiredRegulatoryFeatures` says required and `requestAgeRange`
///   throws `notAvailable` — every launch. Developers report the same `notAvailable` on devices (Apple forums, "Declared
///   Age Range"). Failing closed there would lock a person out with no recovery ("Try again" fails the same way)
///   while nothing about them is known; a failure is not an answer to act on. Both plan reviewers argued for failing
///   closed (a US-storefront fallback); this measurement is why it is not built. ⚠️ The bypass that leaves (a minor
///   whose launch meets an Apple failure, e.g. offline) and the policy itself are for the lawyer, and the US storefront
///   opens only after a real iPhone in Apple's sandbox returns a real range (docs/ios-appstore-release.md, D17).
///   ⛔ ONCE APPLE HAS SAID THE LAW APPLIES, IN THE US STOREFRONT (`Storefront.current` = "USA"), Apple's failure CLOSES
///   it, with Try again — the laws are American, and that is where a failure-opening is a bypass. Not on an unreadable
///   region signal alone: App Review's devices are US accounts, and a reviewer meeting a failed read must still get in
///   (opus, review round 7). The blast radius is the point:
///   1.1 reaches all 145 current countries the day it is approved, US ticked or not, and if real iPhones answer like
///   the simulator ("required", then `notAvailable`), failing closed everywhere would lock out every iOS 26.4+ user in
///   Vietnam. The US storefront has no users until it is ticked, and it is ticked only after a real iPhone in Apple's
///   sandbox returns a real range, so a lockout there is found before anyone meets it. Unknown storefront = not the US.
///   ⛔ NO RE-CHECKS on foreground or network changes (tried in review round 2, removed in round 4): they fired over
///   pickers and sign-in sheets, blanked pages mid-task and re-covered the app on every Wi-Fi↔cellular switch. One ask
///   per cold launch, and "Try again".
///   ⛔ A failure never opens a gate Apple's ANSWER closed ("Try again" after a decline cannot fail its way in), and a
///   region Apple once called regulated stays regulated for the session — a later "not required" included (codex).
/// - ⛔ APPLE'S AGE REQUEST IS NEVER CUT OFF WHILE APPLE'S SHEET IS UP. A plain 30 s timeout on it (review rounds 1–6)
///   grew a new interleaving every round — a late answer thrown away, the sheet hiding the block screen, overlapping
///   requests. But awaiting it forever (round 7) turns a call that hangs WITHOUT a sheet into a cover that never lifts,
///   on every launch, in every country where Apple says "required" (opus, round 8). So: while something is presented
///   on the presenter (Apple's sheet) it waits; after 60 s with NO sheet and no answer, the call is hung, and that is
///   Apple's failure (the rule above). Its late result, if any, is ignored — it never showed the person anything.
/// - Nothing about the answer is stored or sent anywhere: it decides this launch and is gone (no privacy-label change).
///   It is asked again on the next cold launch and from the block screen's "Try again".
///
/// ⚠️ NOT BUILT, ON PURPOSE: PermissionKit's significant-change consent, the RESCIND_CONSENT server notification and the
/// `ageRatingCode` watch are the parental-consent plumbing for minors, and no one under 18 gets past this gate. ⚠️ BUT a
/// LATER significant change may owe ADULTS a notice where `requiredRegulatoryFeatures` carries
/// `.significantAppChangeRequiresAdultNotification` — `showSignificantUpdateAcknowledgment(in:updateDescription:)`,
/// iOS 26.4+. 1.1 owes none: it is the first build ever offered in the US, and the 18+ rating does not change.
final class AgeGate {
    enum BlockReason: Equatable {
        /// Apple says the account is under 18.
        case minor
        /// The person declined to share, or Apple's answer did not settle 18 either way.
        case unconfirmed
    }

    enum State: Equatable {
        case pending
        case allowed
        case blocked(BlockReason)
    }

    /// What Apple answered, reduced to what the gate reads.
    enum Answer: Equatable {
        case declined
        case range(lower: Int?, upper: Int?)
    }

    /// Main thread only (every caller is UIKit or WebKit's main-thread delegate). Starts `.allowed` (see the type
    /// comment); `.pending` only while Apple is being asked where the law applies. Never anything else below iOS 26.2.
    private(set) var state: State = .allowed
    /// Below iOS 26.2 there is nothing to ask, so the gate is settled from the start; above, after the first answer.
    private var settled = false
    /// Apple has said the law applies here; an unreadable signal later in the session does not undo that.
    private var knownRegulated = false
    /// After EVERY check, with the state before it: the block screen re-renders (a second decline must give "Try again"
    /// back), and only a step from closed to open loads the site.
    var onChange: ((_ state: State, _ previous: State) -> Void)?
    var isAllowed: Bool { state == .allowed }
    private var checking = false
    private let signals: AgeSignals

    init(signals: AgeSignals? = nil) {
        #if DEBUG
        let simulated = SimulatedAgeSignals.fromLaunchArguments()
        #else
        let simulated: AgeSignals? = nil
        #endif
        if let chosen = signals ?? simulated {
            self.signals = chosen
        } else if #available(iOS 26.2, *) {
            self.signals = AppleAgeSignals()
        } else {
            self.signals = NoAgeSignals()
            settled = true
        }
    }

    /// The whole decision, kept free of UIKit so it reads the same in the simulator's scripted runs.
    static func verdict(for answer: Answer) -> State {
        switch answer {
        case .declined:
            return .blocked(.unconfirmed)
        case let .range(lower, upper):
            if let lower, lower >= 18 { return .allowed }
            if let upper, upper < 18 { return .blocked(.minor) }
            // A range that straddles 18 or names neither bound proves nothing — for an 18 gate Apple answers
            // [18, nil] or [nil, 17], so this is a defensive branch, and it stays closed.
            return .blocked(.unconfirmed)
        }
    }

    /// Runs the check unless one is running or the gate is already open. `presenter` is where Apple's sheet attaches;
    /// the region read starts at once, and the request waits for `presenter` to be on screen.
    func check(presenter: UIViewController) {
        guard !checking, !settled || state != .allowed else { return }
        checking = true
        Task { @MainActor [weak self, weak presenter] in
            guard let self else { return }
            let result = await self.evaluate(presenter: presenter)
            self.checking = false
            self.settled = true
            AgeGateLog.log(result)
            let previous = self.state
            self.state = result
            self.onChange?(result, previous)
        }
    }

    @MainActor
    private func evaluate(presenter: UIViewController?) async -> State {
        AgeGateLog.step("check started")
        // Closed (by Apple's answer, or by a failure in the US storefront) → a failure keeps it closed (with Try again).
        let closedByAnswer: State? = { if case .blocked = state { return state } else { return nil } }()
        var regulatedRead: Bool?
        for _ in 0..<2 where regulatedRead == nil {
            if case let .value(read) = await race(timeout: 10.0, { try await self.signals.regionRequiresCheck() }) { regulatedRead = read }
        }
        if regulatedRead == true { knownRegulated = true }
        // Apple's failure: closed in the US storefront (with Try again), open anywhere else — see the type comment.
        let failure: () async -> State = {
            if let closedByAnswer { return closedByAnswer }
            if self.knownRegulated,
               case let .value(country) = await self.race(timeout: 5.0, { await self.signals.storefrontCountry() }), country == "USA" {
                AgeGateLog.step("Apple failed in the US storefront — block, Try again")
                return .blocked(.unconfirmed)
            }
            AgeGateLog.step("Apple failed; the law not known to apply here, or not the US storefront — open")
            return .allowed
        }
        guard let regulated = knownRegulated ? true : regulatedRead else {
            AgeGateLog.step("region signal unreadable")
            return await failure()
        }
        AgeGateLog.step("region signal: \(regulated ? "required" : "not required")")
        guard regulated else { return .allowed }
        // The law applies: hold every new main-frame load until Apple answers (a block screen already up stays up).
        if state == .allowed {
            state = .pending
            onChange?(.pending, .allowed)
        }

        // Apple's sheet needs a view controller in a window with nothing presented on it: at cold launch the check
        // starts in viewDidLoad, and in the first seconds the page may have opened a picker or a share sheet — UIKit
        // drops a present that collides, and the awaited request would never return (opus, review round 7).
        var waited = 0
        while (presenter?.viewIfLoaded?.window == nil || presenter?.presentedViewController != nil) && waited < 1200 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            waited += 1
        }
        guard let presenter, presenter.viewIfLoaded?.window != nil, presenter.presentedViewController == nil else {
            AgeGateLog.step("no window for Apple's sheet")
            return await failure()
        }
        let request = Task { @MainActor in try await self.signals.requestAdultGate(presenter: presenter) }
        var withoutSheet = 0.0
        while true {
            switch await race(timeout: 5.0, { try await request.value }) {
            case let .value(answer):
                return Self.verdict(for: answer)
            case .threw:
                AgeGateLog.step("age request threw")
                return await failure()
            case .timedOut:
                withoutSheet = presenter.presentedViewController == nil ? withoutSheet + 5.0 : 0
                if withoutSheet >= 60.0 {
                    AgeGateLog.step("age request hung with no sheet for 60 s")
                    return await failure()
                }
            }
        }
    }

    private enum Outcome<T> {
        case value(T)
        case threw
        case timedOut
    }

    /// `operation`'s result, or `.timedOut` after `timeout`. A plain task group cannot time out a call that ignores
    /// cancellation (the group awaits its children), so the two tasks race to resume one continuation instead.
    @MainActor
    private func race<T>(timeout: Double, _ operation: @escaping () async throws -> T) async -> Outcome<T> {
        await withCheckedContinuation { (continuation: CheckedContinuation<Outcome<T>, Never>) in
            let once = ResumeOnce()
            Task { @MainActor in
                let outcome: Outcome<T>
                do { outcome = .value(try await operation()) } catch {
                    AgeGateLog.step("call threw: \(error)")
                    outcome = .threw
                }
                if once.claim() { continuation.resume(returning: outcome) }
            }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                if once.claim() { continuation.resume(returning: .timedOut) }
            }
        }
    }
}

/// Main-actor flag: whichever task claims it first resumes the continuation.
private final class ResumeOnce {
    private var claimed = false
    func claim() -> Bool {
        if claimed { return false }
        claimed = true
        return true
    }
}

// MARK: - Where the answers come from

protocol AgeSignals {
    /// Whether the law where this account lives requires the age check.
    func regionRequiresCheck() async throws -> Bool
    /// Apple's sheet (or its silent answer, for a regulated account): the age range against the single gate, 18.
    @MainActor func requestAdultGate(presenter: UIViewController) async throws -> AgeGate.Answer
    /// ISO 3166-1 alpha-3 of the App Store storefront ("USA"), when StoreKit knows it (nil when signed out).
    func storefrontCountry() async -> String?
}

/// Below iOS 26.2: the gate starts open and never asks.
private struct NoAgeSignals: AgeSignals {
    func regionRequiresCheck() async throws -> Bool { false }
    func requestAdultGate(presenter: UIViewController) async throws -> AgeGate.Answer { .declined }
    func storefrontCountry() async -> String? { nil }
}

@available(iOS 26.2, *)
private struct AppleAgeSignals: AgeSignals {
    func regionRequiresCheck() async throws -> Bool {
        if #available(iOS 26.4, *) {
            return try await AgeRangeService.shared.requiredRegulatoryFeatures.contains(.declaredAgeRangeRequired)
        }
        return try await AgeRangeService.shared.isEligibleForAgeFeatures
    }

    @MainActor
    func requestAdultGate(presenter: UIViewController) async throws -> AgeGate.Answer {
        switch try await AgeRangeService.shared.requestAgeRange(ageGates: 18, in: presenter) {
        case .declinedSharing:
            return .declined
        case let .sharing(range):
            return .range(lower: range.lowerBound, upper: range.upperBound)
        @unknown default:
            return .declined
        }
    }

    func storefrontCountry() async -> String? {
        await Storefront.current?.countryCode
    }
}

#if DEBUG
/// Simulator runs only: `-EnoAgeGateSim <adult|minor|declined|straddle|error|unregulated|hang|requesthang>` scripts Apple's
/// answers; `-EnoAgeGateStorefront USA` plays a US account (any other value, or none, plays a non-US one)
/// through the real decision and UI (the age-assurance sandbox needs a device). Compiled out of every release build.
private struct SimulatedAgeSignals: AgeSignals {
    let mode: String

    static func fromLaunchArguments() -> AgeSignals? {
        guard let mode = UserDefaults.standard.string(forKey: "EnoAgeGateSim"), !mode.isEmpty else { return nil }
        return SimulatedAgeSignals(mode: mode)
    }

    func regionRequiresCheck() async throws -> Bool {
        switch mode {
        case "unregulated": return false
        case "hang":
            try await Task.sleep(nanoseconds: 60_000_000_000)
            return true
        default: return true
        }
    }

    func requestAdultGate(presenter: UIViewController) async throws -> AgeGate.Answer {
        try await Task.sleep(nanoseconds: mode == "requesthang" ? 600_000_000_000 : 300_000_000)
        switch mode {
        case "adult": return .range(lower: 18, upper: nil)
        case "minor": return .range(lower: nil, upper: 17)
        case "straddle": return .range(lower: 16, upper: nil)
        case "error": throw CocoaError(.featureUnsupported)
        default: return .declined
        }
    }

    func storefrontCountry() async -> String? { UserDefaults.standard.string(forKey: "EnoAgeGateStorefront") }
}
#endif

/// DEBUG builds only (simulator runs read it): each step and the decision. ⛔ Never in a release build — "blocked(minor)"
/// in a device's log would record an age status the gate otherwise forgets (codex, review 2026-11-09).
enum AgeGateLog {
    static func log(_ state: AgeGate.State) {
        #if DEBUG
        NSLog("⚡️  Age gate: %@", String(describing: state))
        #endif
    }
    static func step(_ message: String) {
        #if DEBUG
        NSLog("⚡️  Age gate step: %@", message)
        #endif
    }
}

// MARK: - The block screen

/// Full screen, cannot be swiped away, nothing of the web behind it. English or Vietnamese by the device's language.
final class AgeGateBlockViewController: UIViewController {
    var reason: AgeGate.BlockReason { didSet { if isViewLoaded { render() } } }
    var onTryAgain: (() -> Void)?

    private let titleLabel = UILabel()
    private let bodyLabel = UILabel()
    private let button = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    init(reason: AgeGate.BlockReason) {
        self.reason = reason
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
        isModalInPresentation = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private static var vietnamese: Bool {
        (Locale.preferredLanguages.first ?? "").lowercased().hasPrefix("vi")
    }

    private static func text(_ en: String, _ vi: String) -> String { vietnamese ? vi : en }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        titleLabel.font = UIFontMetrics(forTextStyle: .title2).scaledFont(for: .systemFont(ofSize: 22, weight: .bold))
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        bodyLabel.font = .preferredFont(forTextStyle: .body)
        bodyLabel.adjustsFontForContentSizeCategory = true
        bodyLabel.textColor = .secondaryLabel
        bodyLabel.textAlignment = .center
        bodyLabel.numberOfLines = 0

        var config = UIButton.Configuration.filled()
        config.cornerStyle = .capsule
        config.buttonSize = .large
        button.configuration = config
        button.addAction(UIAction { [weak self] _ in self?.tryAgain() }, for: .primaryActionTriggered)

        spinner.hidesWhenStopped = true

        let stack = UIStackView(arrangedSubviews: [titleLabel, bodyLabel, button, spinner])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(28, after: bodyLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        let margins = view.readableContentGuide
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: margins.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: margins.trailingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            titleLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            bodyLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        render()
    }

    private func render() {
        spinner.stopAnimating()
        titleLabel.text = Self.text("eno is for adults", "eno dành cho người từ 18 tuổi")
        switch reason {
        case .minor:
            bodyLabel.text = Self.text(
                "Apple tells us this account belongs to someone under 18. The eno marketplace is only for people 18 and older.",
                "Apple cho biết tài khoản này thuộc về người dưới 18 tuổi. Sàn eno chỉ dành cho người từ 18 tuổi trở lên."
            )
            button.isHidden = true
        case .unconfirmed:
            bodyLabel.text = Self.text(
                "Where you live, the law asks us to confirm with Apple that you are 18 or older before you use eno. Share your age range with eno when Apple asks, then try again. If Apple doesn't ask again, turn age range sharing on for eno in your iPhone's Settings.",
                "Tại nơi bạn sống, luật yêu cầu chúng tôi xác nhận với Apple rằng bạn từ 18 tuổi trở lên trước khi dùng eno. Hãy chia sẻ độ tuổi với eno khi Apple hỏi, rồi thử lại. Nếu Apple không hỏi lại, hãy bật chia sẻ độ tuổi cho eno trong Cài đặt của iPhone."
            )
            button.isHidden = false
            button.isEnabled = true
            button.configuration?.title = Self.text("Try again", "Thử lại")
        }
    }

    private func tryAgain() {
        button.isEnabled = false
        spinner.startAnimating()
        onTryAgain?()
    }
}
