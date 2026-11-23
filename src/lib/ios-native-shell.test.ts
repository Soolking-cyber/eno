import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIGN_IN_PLUGIN } from './apple-signin'
import { NATIVE_OAUTH_REDIRECT } from './native-auth'
import { signInPluginErrorCode } from './native-sign-in-plugin'

/**
 * ⛔ NO CI JOB COMPILES THE iOS SHELL, SO THIS IS WHAT KEEPS ITS NATIVE FILES AND THE WEB CONTRACTS IN STEP.
 * The `EnoSignIn` plugin (ios/App/App/EnoSignInPlugin.swift, iOS build 3 of 1.0.3 on) implements the types in
 * src/lib/native-sign-in-plugin.ts, and a drift between the two compiles fine on both sides and fails only on a
 * device: a renamed jsName silently turns the binary back into build 2 (no Apple, no Google), a renamed rejection
 * code turns a silent cancel into an error toast, a renamed result key drops Apple's name. Same pattern as
 * native-retired-categories.test.ts: the web suite reads the native sources and fails until they match.
 * The rest pins the build-3 shell decisions (SIWA plan §7.18, D20) where a later edit could quietly undo them.
 */
const ROOT = join(__dirname, '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const swift = read('ios/App/App/EnoSignInPlugin.swift')
const jsContract = read('src/lib/native-sign-in-plugin.ts')

/** The member names declared inside `export (type|interface) <name> … { … }` in the JS contract (one line or many). */
const tsMembers = (name: string): Set<string> => {
  const start = jsContract.search(new RegExp(`export (?:type|interface) ${name}\\b`))
  if (start < 0) throw new Error(`${name} not found in native-sign-in-plugin.ts`)
  const open = jsContract.indexOf('{', start)
  let end = open
  for (let depth = 0; end < jsContract.length; end++) {
    if (jsContract[end] === '{') depth++
    else if (jsContract[end] === '}' && --depth === 0) break
  }
  // First word of each line only, so `{ nonce: string }` inside a method signature is not a member.
  return new Set([...jsContract.slice(open + 1, end).matchAll(/^\s*(\w+)\??\s*[:(]/gm)].map((x) => x[1]))
}

const plistString = (src: string, key: string): string | undefined =>
  src.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]
const stringsValue = (src: string, key: string): string | undefined =>
  src.match(new RegExp(`^"${key}" = "((?:[^"\\\\]|\\\\.)*)";$`, 'm'))?.[1]

describe('EnoSignInPlugin.swift implements src/lib/native-sign-in-plugin.ts', () => {
  it('registers under the jsName the web looks for', () => {
    expect(swift.match(/let jsName = "([^"]+)"/)?.[1]).toBe(SIGN_IN_PLUGIN)
  })

  it('exposes exactly the contract methods, each as a promise', () => {
    const methods = [...swift.matchAll(/CAPPluginMethod\(#selector\(EnoSignInPlugin\.(\w+)\(_:\)\), returnType: \.promise\)/g)]
      .map((m) => m[1])
    expect(new Set(methods)).toEqual(tsMembers('EnoSignInPlugin'))
    for (const name of methods) expect(swift).toContain(`@objc func ${name}(_ call: CAPPluginCall)`)
  })

  it('reads the option keys the JS sends', () => {
    // appleCredential(nonce) → signInWithApple({ nonce }); webAuthSession(url, ephemeral) → webAuth({ url, ephemeral })
    expect(jsContract).toContain('p.signInWithApple({ nonce })')
    expect(jsContract).toContain('p.webAuth({ url, ephemeral })')
    expect(swift).toContain('call.getString("nonce")')
    expect(swift).toContain('call.getString("url")')
    expect(swift).toContain('call.getBool("ephemeral")')
  })

  it('⛔ webAuth opens only GoTrue’s authorize endpoint on sb.eno.vn — no other host, port, user or path (C3)', () => {
    expect(swift).toContain('static let authorizeHost = "sb.eno.vn"')
    expect(swift).toContain('static let authorizePath = "/auth/v1/authorize"')
    const guard = swift.match(/@objc func webAuth\(_ call: CAPPluginCall\) \{([\s\S]*?)\n {8}\}/)?.[1] ?? ''
    for (const check of ['url.scheme?.lowercased() == "https"', 'url.host?.lowercased() == EnoSignInPlugin.authorizeHost',
      'url.port == nil', 'url.user == nil', 'url.path == EnoSignInPlugin.authorizePath']) expect(guard, check).toContain(check)
  })

  it("resolves Apple's credential with exactly the AppleCredential keys", () => {
    const initial = swift.match(/var answer: PluginCallResultData = \[([^\]]*)\]/)?.[1] ?? ''
    const keys = new Set([
      ...[...initial.matchAll(/"(\w+)":/g)].map((m) => m[1]),
      ...[...swift.matchAll(/answer\["(\w+)"\] =/g)].map((m) => m[1]),
    ])
    expect(keys).toEqual(tsMembers('AppleCredential'))
    expect(swift).toContain('settle { $0.resolve(["url": callbackURL.absoluteString]) }')
    expect(tsMembers('WebAuthResult')).toEqual(new Set(['url']))
  })

  it('rejects only with codes the JS recognises, and recognises them all', () => {
    const cases = swift.match(/private enum SignInFailure: String \{\s*case ([^}]*?)\s*\}/)?.[1]
    const codes = (cases ?? '').split(',').map((c) => c.trim()).filter(Boolean)
    expect(codes.sort()).toEqual(['busy', 'canceled', 'failed', 'unavailable'])
    for (const code of codes) expect(signInPluginErrorCode({ code })).toBe(code)
    // ASAuthorizationError 1001 is the silent cancel and 1000 is `unavailable` — the mapping the JS copy relies on.
    // Pinned by order along the if / else-if chain: each test is followed by its own code before the next test.
    const at = (s: string) => swift.indexOf(s)
    const chain = [
      'ASAuthorizationError.Code.canceled.rawValue', 'SignInFailure.canceled.rawValue',
      'ASAuthorizationError.Code.unknown.rawValue', 'SignInFailure.unavailable.rawValue',
      'ASWebAuthenticationSessionError.Code.canceledLogin.rawValue',
    ]
    for (const s of chain) expect(at(s), s).toBeGreaterThan(-1)
    expect(chain.map(at)).toEqual([...chain.map(at)].sort((a, b) => a - b))
    const webCancel = swift.slice(at('canceledLogin.rawValue'))
    expect(webCancel.indexOf('SignInFailure.canceled.rawValue')).toBeLessThan(webCancel.indexOf('SignInFailure.failed.rawValue'))
  })

  it('hands back only the callback /auth/callback issues, on the scheme the app registers', () => {
    const scheme = swift.match(/static let callbackScheme = "([^"]+)"/)?.[1]
    const host = swift.match(/static let callbackHost = "([^"]+)"/)?.[1]
    expect(`${scheme}://${host}`).toBe(NATIVE_OAUTH_REDIRECT)
    expect(read('ios/App/App/Info.plist')).toMatch(new RegExp(`<key>CFBundleURLSchemes</key>\\s*<array>\\s*<string>${scheme}</string>`))
  })

  it('refuses a nonce that is not 64 lowercase hex before the sheet opens', () => {
    expect(swift).toContain('value.utf8.count == 64')
    expect(swift).toContain('(0x30...0x39).contains($0) || (0x61...0x66).contains($0)')
  })
})

describe('the shell carries the plugin into the binary', () => {
  it('MainViewController registers it before the first page loads', () => {
    const vc = read('ios/App/App/MainViewController.swift')
    // 1.1 adds the navigation filter's install after it, in the same pre-first-load hook (the age gate needs that).
    expect(vc).toMatch(/override func capacitorDidLoad\(\) \{\s*bridge\?\.registerPluginInstance\(EnoSignInPlugin\(\)\)\s*installNavigationFailureFilter\(\)\s*\}/)
  })

  it('project.pbxproj compiles EnoSignInPlugin.swift into the App target', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
    const sources = pbx.match(/\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//)?.[1] ?? ''
    expect(sources).toContain('/* EnoSignInPlugin.swift in Sources */')
    expect(pbx).toMatch(/\/\* EnoSignInPlugin\.swift \*\/ = \{isa = PBXFileReference; lastKnownFileType = sourcecode\.swift; path = EnoSignInPlugin\.swift;/)
    // The App target's version, Debug and Release alike — build 3 is still 1.0.3 (plan §7.18), and a later bump moves
    // both lines together. Not pinned to 1.0.3 itself: the next version must not fail this suite. (The build NUMBER is
    // scripts/ios-release.sh's to write; it is not asserted here.)
    const versions = [...pbx.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1])
    expect(versions).toHaveLength(2)
    expect(new Set(versions).size).toBe(1)
    const [major = 0, minor = 0, patch = 0] = versions[0].split('.').map(Number)
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(1_000_003)
  })

  it('App.entitlements carries Sign in with Apple = [Default] beside the two v1 entitlements', () => {
    const ent = read('ios/App/App/App.entitlements')
    expect(ent).toMatch(/<key>com\.apple\.developer\.applesignin<\/key>\s*<array>\s*<string>Default<\/string>\s*<\/array>/)
    expect(ent).toMatch(/<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>\s*<string>applinks:eno\.vn<\/string>\s*<\/array>/)
    expect(ent).toContain('<key>aps-environment</key>')
  })

  it('scripts/ios-release.sh refuses an archive signed without it', () => {
    const script = read('scripts/ios-release.sh')
    expect(script).toContain('[ "$(ent com.apple.developer.applesignin:0)" = "Default" ] && [ -z "$(ent com.apple.developer.applesignin:1)" ]')
  })
})

/**
 * 1.1 — Apple's Declared Age Range gate (ios/App/App/AgeGate.swift; D17, owner 2026-11-09: "Build 1.1 with age check,
 * then open US"). The decisions a later edit could quietly undo, each of which fails only on a device: a strong link
 * (no launch below iOS 26), a filter installed after the first load (the page renders before Apple answers), a gate
 * that closes on Apple's failure (a lockout with no recovery, measured on the simulator), a stored age range.
 */
describe('the 1.1 age gate', () => {
  const gate = read('ios/App/App/AgeGate.swift')
  const vc = read('ios/App/App/MainViewController.swift')
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
  const script = read('scripts/ios-release.sh')

  it('project.pbxproj compiles AgeGate.swift and weak-links DeclaredAgeRange in both configurations', () => {
    const sources = pbx.match(/\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//)?.[1] ?? ''
    expect(sources).toContain('/* AgeGate.swift in Sources */')
    expect(pbx).toMatch(/\/\* AgeGate\.swift \*\/ = \{isa = PBXFileReference; lastKnownFileType = sourcecode\.swift; path = AgeGate\.swift;/)
    const flags = [...pbx.matchAll(/OTHER_LDFLAGS = \(([\s\S]*?)\n\s*\);/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
    expect(flags).toEqual(['"$(inherited)", "-weak_framework", DeclaredAgeRange,', '"$(inherited)", "-weak_framework", DeclaredAgeRange,'])
    expect([...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => m[1])).not.toContain('26.0')
  })

  it('App.entitlements carries com.apple.developer.declared-age-range = true, and the release script requires it and the weak link', () => {
    expect(read('ios/App/App/App.entitlements')).toMatch(/<key>com\.apple\.developer\.declared-age-range<\/key>\s*<true\/>/)
    expect(script).toContain('[ "$(ent com.apple.developer.declared-age-range)" = "true" ]')
    expect(script).toContain('LC_LOAD_WEAK_DYLIB')
  })

  it('the first page is NOT held for the region signal (2–3 s measured); loads are held from "the law applies" on', () => {
    expect(gate).toContain('private(set) var state: State = .allowed')
    // …but the page cannot be used while Apple is asked: an opaque cover over it from `.pending`, off at `.allowed`.
    expect(vc).toMatch(/case \.pending:\s*if ageCover\.superview == nil \{[\s\S]{0,200}view\.addSubview\(ageCover\)/)
    expect(vc).toMatch(/case \.allowed:\s*ageCover\.removeFromSuperview\(\)/)
    expect(gate).toMatch(/guard regulated else \{ return \.allowed \}[\s\S]{0,200}state = \.pending\s*onChange\?\(\.pending, \.allowed\)/)
  })

  it('the navigation filter is installed before the first load and holds every main-frame load while the gate is closed', () => {
    // …and again as an idempotent fallback BEFORE super.viewDidLoad(), which is what starts Capacitor's first load.
    expect(vc).toMatch(/override func viewDidLoad\(\) \{(?:\s*\/\/[^\n]*)*\s*installNavigationFailureFilter\(\)\s*super\.viewDidLoad\(\)/)
    expect(vc).toContain('guard navigationFilter == nil else { return }')
    expect(vc).toContain('filter.holdsAppLoads = { [weak self] in !(self?.ageGate.isAllowed ?? true) }')
    expect(vc).toMatch(/holdsAppLoads\?\(\) == true \{\s*onHeldLoad\?\(url\)\s*decisionHandler\(\.cancel\)/)
    // The watchdog and pull-to-refresh never retry a held load (each retry would be cancelled and spend the budget).
    expect(vc).toContain('guard ageGate.isAllowed, let wv = webView else { return }')
    expect(vc).toContain('guard ageGate.isAllowed, let wv = webView, reloadAttempts < 6 else { return }')
    expect(vc).toContain('guard ageGate.isAllowed else { refreshControl.endRefreshing(); return }')
  })

  it('opens on 18+ only, closes on under-18 / decline / an unsettled range; Apple FAILING opens it outside the US storefront only', () => {
    expect(gate).toContain('if let lower, lower >= 18 { return .allowed }')
    expect(gate).toContain('if let upper, upper < 18 { return .blocked(.minor) }')
    expect(gate).toMatch(/case \.declined:\s*return \.blocked\(\.unconfirmed\)/)
    expect(gate).toContain('requestAgeRange(ageGates: 18, in: presenter)')
    // Every Apple failure (region unreadable, no window, a throw) goes through ONE rule: an answer-closed gate stays
    // closed; the US storefront closes (with Try again); anywhere else opens — 1.1 reaches all 145 countries on
    // approval, and failing closed there on simulator-like devices would lock out Vietnam.
    expect(gate.match(/return await failure\(\)/g)).toHaveLength(4)
    // …and the US rule needs Apple's own "the law applies" first: App Review's US devices must get past a failed read.
    expect(gate).toMatch(/let failure: \(\) async -> State = \{\s*if let closedByAnswer \{ return closedByAnswer \}\s*if self\.knownRegulated,\s*case let \.value\(country\) = await self\.race\(timeout: 5\.0, \{ await self\.signals\.storefrontCountry\(\) \}\), country == "USA" \{[\s\S]{0,120}return \.blocked\(\.unconfirmed\)\s*\}[\s\S]{0,200}return \.allowed/)
    // The region read is not held for, so its timeout sits well above the measured 2.2–3.3 s (opus, review round 5).
    expect(gate).toContain('race(timeout: 10.0, { try await self.signals.regionRequiresCheck() })')
    // ⛔ Apple's age request is never cut off while Apple's sheet is up (a plain timeout grew a new interleaving every
    // round); only 60 s with NO sheet and no answer counts as hung — Apple's failure, not an endless cover (round 8).
    expect(gate).not.toMatch(/race\(timeout: [\d.]+, \{ try await self\.signals\.requestAdultGate/)
    expect(gate).toContain('withoutSheet = presenter.presentedViewController == nil ? withoutSheet + 5.0 : 0')
    expect(gate).toMatch(/if withoutSheet >= 60\.0 \{\s*AgeGateLog\.step\("age request hung with no sheet for 60 s"\)\s*return await failure\(\)/)
    // A failure never opens a gate an ANSWER closed, and "the law applies" sticks for the session — a later
    // "not required" included (codex, review round 4).
    expect(gate.match(/if let closedByAnswer \{ return closedByAnswer \}/g)).toHaveLength(1)
    expect(gate).toContain('guard let regulated = knownRegulated ? true : regulatedRead else {')
    // ⛔ One ask per cold launch + Try again. The foreground / network re-checks of round 2 fired over pickers and
    // sign-in sheets, blanked pages mid-task and re-covered the app on every Wi-Fi↔cellular switch (round 4).
    expect(vc).not.toMatch(/NWPathMonitor|willEnterForegroundNotification/)
    expect(gate).not.toContain('openedOnFailure')
    // The site is up before Apple answers (not held at launch), so a block always blanks a running page.
    // …stopping a first load still in flight, and letting exactly that about:blank past Capacitor, which cancels every
    // top-level URL that is not the app's (measured: without this the page stayed https://eno.vn/ behind the block).
    expect(vc).toMatch(/wv\.stopLoading\(\)\s*navigationFilter\?\.allowsNextBlank = true\s*wv\.loadHTMLString\("", baseURL: nil\)/)
    expect(vc).toMatch(/if allowsNextBlank, navigationAction\.request\.url\?\.absoluteString == "about:blank",[\s\S]{0,140}allowsNextBlank = false\s*decisionHandler\(\.allow\)/)
    // Every check reports back (a second decline must give Try again back); only closed → open loads the site.
    expect(gate).toContain('self.onChange?(result, previous)')
    expect(gate).not.toContain('guard result != self.state')
    expect(vc).toContain('guard previous != .allowed else { return }')
    // Opening dismisses the block screen FROM ITS PRESENTER (after Try again it presents Apple's sheet itself).
    expect(vc).toContain('block.presentingViewController?.dismiss(animated: true)')
    // Apple's sheet waits for nothing to be presented (a picker the page opened would swallow it).
    expect(gate).toContain("presenter?.presentedViewController != nil) && waited < 1200")
    expect(vc).toContain('cover.accessibilityViewIsModal = true')
    // Asked only where Apple says the law applies: never a bare request (that shows Apple's sheet in every country).
    expect(gate).toContain('requiredRegulatoryFeatures.contains(.declaredAgeRangeRequired)')
    expect(gate).toContain('AgeRangeService.shared.isEligibleForAgeFeatures')
    expect(gate).toMatch(/#available\(iOS 26\.2, \*\)/)
  })

  it('stores, sends and logs nothing in release, and its simulator script is compiled out of release builds', () => {
    expect(gate).not.toMatch(/UserDefaults\.standard\.set|Keychain|URLSession|fetch\(/)
    // NSLog only inside #if DEBUG: "blocked(minor)" must never reach a release device's log.
    const logs = [...gate.matchAll(/NSLog\(/g)].map((m) => m.index ?? 0)
    expect(logs.length).toBeGreaterThan(0)
    for (const at of logs) expect(gate.lastIndexOf('#if DEBUG', at), String(at)).toBeGreaterThan(gate.lastIndexOf('#endif', at))
    const sim = gate.indexOf('private struct SimulatedAgeSignals')
    expect(sim).toBeGreaterThan(-1)
    expect(gate.lastIndexOf('#if DEBUG', sim)).toBeGreaterThan(gate.lastIndexOf('#endif', sim))
  })
})

describe('build-3 purpose strings and privacy manifest (D20)', () => {
  const plist = read('ios/App/App/Info.plist')
  const en = read('ios/App/App/en.lproj/InfoPlist.strings')
  const vi = read('ios/App/App/vi.lproj/InfoPlist.strings')
  const USAGE = ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'NSMicrophoneUsageDescription', 'NSLocationWhenInUseUsageDescription']

  it('Info.plist (development region en) and en.lproj say the same thing; vi.lproj has every key', () => {
    for (const key of USAGE) {
      expect(plistString(plist, key), key).toBeTruthy()
      expect(stringsValue(en, key), key).toBe(plistString(plist, key))
      expect(stringsValue(vi, key), key).toBeTruthy()
    }
  })

  it('the microphone names the teacher intro video (N2); camera and photos name what goes to a seller in chat (N3)', () => {
    expect(stringsValue(en, 'NSMicrophoneUsageDescription')).toContain('teacher profile')
    expect(stringsValue(vi, 'NSMicrophoneUsageDescription')).toContain('hồ sơ giáo viên')
    const plist = read('ios/App/App/Info.plist')
    for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
      expect(stringsValue(en, key), key).toContain('a photo or document you send to a seller in chat')
      expect(stringsValue(vi, key), key).toContain('ảnh hay giấy tờ bạn gửi cho người bán trong chat')
      // ⛔ No service by name in a signed binary (commit gate C1, both seats): eno.vn's binary must not name the
      // e-Visa service — a submitted string can only be withdrawn by a new submission.
      for (const text of [stringsValue(en, key), stringsValue(vi, key), plist]) expect(text, key).not.toMatch(/visa|hộ chiếu|passport/i)
    }
  })

  it('declares Audio Data and Other Financial Info, and every type linked and untracked (P1, P4, P5/N1)', () => {
    const manifest = read('ios/App/App/PrivacyInfo.xcprivacy')
    const entries = [...manifest.matchAll(
      /<dict>\s*<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataType(\w+)<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<(true|false)\/>\s*<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<(true|false)\/>\s*<key>NSPrivacyCollectedDataTypePurposes<\/key>\s*<array>([\s\S]*?)<\/array>\s*<\/dict>/g,
    )].map(([, type, linked, tracking, purposes]) => ({ type, linked, tracking, purposes }))
    // Every entry parsed — a reordered dict would otherwise slip past the checks below.
    expect(entries.length).toBe(manifest.match(/<key>NSPrivacyCollectedDataType<\/key>/g)?.length)
    const types = new Set(entries.map((e) => e.type))
    for (const t of ['AudioData', 'OtherFinancialInfo', 'OtherDiagnosticData']) expect(types.has(t), t).toBe(true)
    for (const t of ['SensitiveInfo', 'PaymentInfo']) expect(types.has(t), t).toBe(false)
    for (const e of entries) {
      expect(e.linked, e.type).toBe('true')
      expect(e.tracking, e.type).toBe('false')
      expect(e.purposes, e.type).toContain('NSPrivacyCollectedDataTypePurposeAppFunctionality')
    }
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/)
  })
})
