import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeSiwaHeadJs } from '@/lib/native-siwa-head'

/**
 * The pre-paint head script EXACTLY as src/app/[lang]/layout.tsx assembles it — read from the layout's source
 * (the one backtick `__html:` template there) and filled with the same constants, so a test runs the real script,
 * in the real order, instead of a copy that could drift from it.
 *
 * ⚠️ Every `${…}` in the template must be one this helper knows how to fill; a new one fails loudly here rather
 * than being silently left as text. `appleIos` stands for `ios` in NEXT_PUBLIC_APPLE_SIGNIN at build time.
 */
export function headScriptSource(opts: { appleIos: boolean; homeTwin?: string; appDownloadOff?: string }): string {
  const layout = readFileSync(join(process.cwd(), 'src/app/[lang]/layout.tsx'), 'utf8')
  const template = layout.match(/__html: `([^`]*)`,/)?.[1]
  if (!template) throw new Error('head-script: the backtick __html template was not found in layout.tsx')
  const values: Record<string, string> = {
    APP_HOME_TWIN_JS: opts.homeTwin ?? '',
    APP_DOWNLOAD_OFF_JS: opts.appDownloadOff ?? '',
    NATIVE_SIWA_JS: nativeSiwaHeadJs(opts.appleIos),
  }
  for (const [, name] of template.matchAll(/\$\{(\w+)\}/g)) {
    if (!(name in values)) throw new Error(`head-script: layout.tsx interpolates \${${name}}, which this helper does not fill`)
  }
  return new Function(...Object.keys(values), `return \`${template}\``)(...Object.values(values)) as string
}

/** Run the head script in the current (jsdom) document. */
export function runHeadScript(opts: { appleIos: boolean }): void {
  new Function(headScriptSource(opts))()
}
