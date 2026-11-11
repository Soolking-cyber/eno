import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeSiwaHeadJs } from '@/lib/native-siwa-head'
import { APP_SHEET_HEAD_JS } from '@/lib/app-sheet'
import { CONCIERGE_FRAME_HEAD_JS } from '@/lib/concierge/frame-head'
import { STORE_OS_HEAD_JS } from '@/lib/app-store-links'
import { SESSION_COOKIE_NAME_JS, sessionCookieName } from '@/lib/supabase/session-cookie'

/**
 * The pre-paint head script EXACTLY as src/app/[lang]/layout.tsx assembles it — read from the layout's source
 * (the one backtick `__html:` template there) and filled with the same constants, so a test runs the real script,
 * in the real order, instead of a copy that could drift from it.
 *
 * ⚠️ Every `${…}` in the template must be one this helper knows how to fill; a new one fails loudly here rather
 * than being silently left as text. `appleIos` stands for `ios` in NEXT_PUBLIC_APPLE_SIGNIN at build time;
 * `supabaseUrl`, when given, stands for NEXT_PUBLIC_SUPABASE_URL at build time (null = unset), else the test
 * process's own value is used, as the build would.
 */
export function headScriptSource(opts: { appleIos: boolean; homeTwin?: string; supabaseUrl?: string | null }): string {
  const layout = readFileSync(join(process.cwd(), 'src/app/[lang]/layout.tsx'), 'utf8')
  const template = layout.match(/__html: `([^`]*)`,/)?.[1]
  if (!template) throw new Error('head-script: the backtick __html template was not found in layout.tsx')
  const values: Record<string, string> = {
    APP_HOME_TWIN_JS: opts.homeTwin ?? '',
    STORE_OS_HEAD_JS,
    NATIVE_SIWA_JS: nativeSiwaHeadJs(opts.appleIos),
    APP_SHEET_HEAD_JS,
    CONCIERGE_FRAME_HEAD_JS,
    SESSION_COOKIE_NAME_JS: opts.supabaseUrl !== undefined ? JSON.stringify(sessionCookieName(opts.supabaseUrl)) : SESSION_COOKIE_NAME_JS,
  }
  for (const [, name] of template.matchAll(/\$\{(\w+)\}/g)) {
    if (!(name in values)) throw new Error(`head-script: layout.tsx interpolates \${${name}}, which this helper does not fill`)
  }
  return new Function(...Object.keys(values), `return \`${template}\``)(...Object.values(values)) as string
}

/** Run the head script in the current (jsdom) document. */
export function runHeadScript(opts: { appleIos: boolean; supabaseUrl?: string | null }): void {
  new Function(headScriptSource(opts))()
}
