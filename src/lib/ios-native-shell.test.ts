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
    expect(vc).toMatch(/override func capacitorDidLoad\(\) \{\s*bridge\?\.registerPluginInstance\(EnoSignInPlugin\(\)\)\s*\}/)
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
