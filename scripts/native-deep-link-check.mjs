#!/usr/bin/env node
// ── Runs the NATIVE deep-link validators against one attack table (speed plan item 11, 2026-10-17) ────────────────
//
//   node scripts/native-deep-link-check.mjs      # macOS with Xcode (swift) and a JDK — before every native release
//
// No CI job compiles the native shells, and src/lib/native-deep-link-parity.test.ts can only read their SOURCE. This
// executes them: it lifts isRoutablePath and its helpers out of ios/App/App/AppDelegate.swift and
// android/app/src/main/java/vn/eno/app/MainActivity.java verbatim, runs each with the swift interpreter and the JDK,
// and checks every case below — the same spellings src/lib/deep-link.test.ts pins for the web (GHSA-rvm3-566m-v7fv:
// no link may reach a path under "/_"). Android's android.net.Uri.decode does not exist on a desktop JVM, so a port of
// it stands in: AOSP libcore UriCodec.appendDecoded(s, convertPlus=false, UTF_8, throwOnFailure=false), quirks and all
// — a malformed escape CONSUMES the bad character, writes U+FFFD and still puts the partial byte (`%ZZ` → U+FFFD, NUL,
// "Z"); an escape cut off by the end of the string ends the decode.
// ⚠️ It compiles the extracted functions, not the projects: build them too (./gradlew :app:assembleDebug, xcodebuild).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

/** [path, routable] — the table src/lib/native-deep-link-parity.test.ts runs through the web validator. */
const CASES = JSON.parse(readFileSync(join(ROOT, 'src/lib/deep-link-attack-table.json'), 'utf8')).cases.map((c) => [c.path, c.routable])

/** The brace-matched block that starts at `marker`. */
function block(src, marker) {
  const start = src.indexOf(marker)
  if (start < 0) throw new Error(`${marker} not found`)
  let end = src.indexOf('{', start)
  for (let depth = 0; end < src.length; end++) {
    if (src[end] === '{') depth++
    else if (src[end] === '}' && --depth === 0) break
  }
  return src.slice(start, end + 1)
}

const quote = (s) => JSON.stringify(s) // a JSON string literal is a valid Swift and Java literal for these inputs
const dir = mkdtempSync(join(tmpdir(), 'native-deep-link-'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
let failed = false

function report(label, out) {
  const wrong = out.split('\n').filter((l) => l.startsWith('WRONG'))
  console.log(wrong.length ? `✗ ${label}: ${wrong.length} wrong\n  ${wrong.join('\n  ')}` : `✓ ${label}: all ${CASES.length} cases right`)
  if (wrong.length || !out.includes('DONE')) failed = true
}

// ── iOS ──
{
  const src = readFileSync(join(ROOT, 'ios/App/App/AppDelegate.swift'), 'utf8')
  const funcs = ['isRoutablePath(', 'isRoutableSpelling(', 'decodedLeniently(', 'hexDigit(', 'hasParserSplitChars(']
    .map((name) => block(src, `static func ${name}`).replace(/(?:private )?static func/, 'func'))
  const checks = CASES.map(([p, ok]) => `if isRoutablePath(${quote(p)}) != ${ok} { print("WRONG ${p} want ${ok}") }`)
  const file = join(dir, 'check.swift')
  writeFileSync(file, ['import Foundation', ...funcs, ...checks, 'print("DONE")'].join('\n'))
  report('iOS AppDelegate.isRoutablePath', execFileSync('xcrun', ['swift', file], { encoding: 'utf8' }))
}

// ── Android ──
{
  const src = readFileSync(join(ROOT, 'android/app/src/main/java/vn/eno/app/MainActivity.java'), 'utf8')
  const funcs = ['boolean isRoutablePath(', 'boolean settlesRoutable(', 'boolean isRoutableSpelling(', 'String decodedLeniently(', 'int hexDigit(', 'boolean hasParserSplitChars(']
    .map((name) => block(src, `private static ${name}`))
  const checks = CASES.map(([p, ok]) => `if (isRoutablePath(${quote(p)}) != ${ok}) System.out.println("WRONG ${p} want ${ok}");`)
  const java = `import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
public class Check {
  /** AOSP libcore UriCodec.appendDecoded(s, false, UTF_8, false) — see the header of this script. */
  static final class Uri {
    static String decode(String s) {
      StringBuilder out = new StringBuilder(s.length()); ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      int i = 0;
      while (i < s.length()) {
        char c = s.charAt(i); i++;
        switch (c) {
          case '+': flush(out, bytes); out.append('+'); break;
          case '%':
            byte hexValue = 0;
            for (int j = 0; j < 2; j++) {
              if (i >= s.length()) { flush(out, bytes); out.append('\uFFFD'); return out.toString(); }
              c = s.charAt(i); i++;
              int digit = hex(c);
              if (digit < 0) { flush(out, bytes); out.append('\uFFFD'); break; }
              hexValue = (byte) (hexValue * 0x10 + digit);
            }
            bytes.write(hexValue);
            break;
          default: flush(out, bytes); out.append(c);
        }
      }
      flush(out, bytes); return out.toString();
    }
    static int hex(char c) {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return -1;
    }
    static void flush(StringBuilder out, ByteArrayOutputStream b) {
      if (b.size() > 0) { out.append(new String(b.toByteArray(), StandardCharsets.UTF_8)); b.reset(); }
    }
  }
${funcs.join('\n')}
  public static void main(String[] args) {
${checks.map((c) => `    ${c}`).join('\n')}
    System.out.println("DONE");
  }
}
`
  writeFileSync(join(dir, 'Check.java'), java)
  execFileSync('javac', ['Check.java'], { cwd: dir, stdio: 'inherit' })
  report('Android MainActivity.isRoutablePath', execFileSync('java', ['-cp', dir, 'Check'], { encoding: 'utf8' }))
}

process.exit(failed ? 1 : 0)
