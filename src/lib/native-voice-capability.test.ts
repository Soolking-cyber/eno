import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isNativeVoiceUserAgent } from '@/lib/app-review-gates'

/**
 * ⛔ THE BINARY SAYS IT CAN HEAR ONLY WHEN IT CAN (owner, 2026-10-29: "also ios android apps add the live concierge to them
 * too"). The site opens the voice guide in an app only for a user agent carrying `EnoVoice/1` (app-review-gates.ts). That
 * token rides in capacitor.config.ts — so every binary built with it must also carry Android's RECORD_AUDIO (Capacitor
 * denies the WebView's microphone without it) and an iOS microphone purpose string that names the guide (App Store
 * 5.1.1(ii)). The three are held together here; a binary with the token and without either would open a guide that cannot
 * hear, or ask for the microphone in words that do not say why.
 */
const read = (p: string) => readFileSync(p, 'utf8')
const config = read('capacitor.config.ts')
const manifest = read('android/app/src/main/AndroidManifest.xml')
const strings = (p: string) => /"NSMicrophoneUsageDescription" = "([^"]*)";/.exec(read(p))?.[1] ?? ''
const plistMic = /<key>NSMicrophoneUsageDescription<\/key>\s*<string>([^<]*)<\/string>/.exec(read('ios/App/App/Info.plist'))?.[1] ?? ''

describe('the voice guide\'s capability token travels with the microphone it needs', () => {
  const ua = /appendUserAgent: '([^']*)'/.exec(config)?.[1] ?? ''

  it('the shells append EnoVoice/1 beside EnoNativeApp/1 — and the site reads that as a binary built for the guide', () => {
    expect(ua).toBe('EnoNativeApp/1 EnoVoice/1')
    expect(isNativeVoiceUserAgent(`Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 ${ua}`)).toBe(true)
    expect(isNativeVoiceUserAgent(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ${ua}`)).toBe(true)
  })

  it('⛔ every binary on the stores today (EnoNativeApp/1 alone) is not one — nor a browser, nor the shelved SwiftUI app, carrying the token (opus)', () => {
    expect(isNativeVoiceUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1')).toBe(false)
    expect(isNativeVoiceUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 EnoNativeApp/1')).toBe(false)
    expect(isNativeVoiceUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 EnoVoice/1')).toBe(false)
    expect(isNativeVoiceUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 EnoNativeTabs/1 EnoVoice/1')).toBe(false)
  })

  it('Android declares both permissions Capacitor asks for (it denies the whole request unless both are granted), the microphone optional', () => {
    expect(manifest).toMatch(/<uses-permission android:name="android\.permission\.RECORD_AUDIO" \/>/)
    expect(manifest).toMatch(/<uses-permission android:name="android\.permission\.MODIFY_AUDIO_SETTINGS" \/>/)
    expect(manifest).toMatch(/<uses-feature android:name="android\.hardware\.microphone" android:required="false" \/>/)
  })

  it('iOS asks for the microphone naming the voice guide — and still the videos it was for (Info.plist = en.lproj)', () => {
    expect(plistMic).toContain('voice guide')
    expect(plistMic).toContain('teacher profile')
    expect(strings('ios/App/App/en.lproj/InfoPlist.strings')).toBe(plistMic)
    expect(strings('ios/App/App/vi.lproj/InfoPlist.strings')).toContain('trợ lý giọng nói')
    expect(strings('ios/App/App/vi.lproj/InfoPlist.strings')).toContain('hồ sơ giáo viên')
  })

  it('Play: versionCode 6, 1.0.4 — never 5, built and never uploaded', () => {
    const gradle = read('android/app/build.gradle')
    expect(gradle).toMatch(/^\s*versionCode 6$/m)
    expect(gradle).toMatch(/^\s*versionName "1\.0\.4"$/m)
  })
})

describe('⛔ Android App Links never claim the classroom or the guide\'s window (the classroom is web-only)', () => {
  // The ONE filter that opens https links: its <data> merge into scheme × host × path, so its prefixes are what it claims.
  const appLinks = /<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/.exec(manifest)?.[1] ?? ''
  const prefixes = [...appLinks.matchAll(/android:pathPrefix="([^"]*)"/g)].map((m) => m[1])

  it('one verified filter claims web links — https on eno.vn, by path prefix only (codex: no other matcher, no other filter)', () => {
    expect(manifest.match(/<intent-filter android:autoVerify="true">/g)).toHaveLength(1)
    expect(appLinks).toContain('<data android:scheme="https" />')
    expect([...appLinks.matchAll(/android:host="([^"]*)"/g)].map((m) => m[1])).toEqual(['eno.vn'])
    expect(appLinks).not.toMatch(/android:(path|pathPattern|pathSuffix|pathAdvancedPattern)=/)
    expect(manifest.replace(appLinks, '')).not.toMatch(/android:scheme="https?"|android:host=/)
  })

  it('no path prefix matches /classroom or /concierge (a prefix is a STRING prefix: "/c" claimed both)', () => {
    expect(prefixes.length).toBeGreaterThan(0)
    for (const path of ['/classroom', '/classroom/join/AB12CD', '/concierge']) {
      expect(prefixes.filter((p) => path.startsWith(p)), path).toEqual([])
    }
  })

  it('the pages the old "/c" was kept for still open in the app: category pages, checkout, contact', () => {
    for (const path of ['/c/rentals', '/checkout', '/contact', '/listings/abc', '/brands/apple']) {
      expect(prefixes.some((p) => path.startsWith(p)), path).toBe(true)
    }
  })
})
