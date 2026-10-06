/**
 * ⛔ A VIETNAMESE USER'S APP OPENS ON THE VIETNAMESE HOME — DECIDED BEFORE ANYTHING ELSE RUNS (2026-10-06).
 *
 * Both apps render eno.vn and start on `/` at every cold start and offline retry, and on eno.vn `/` is a `/vi` pilot
 * page that is always English. On the WEB that earns a one-tap suggestion, never a redirect (decision V-a,
 * lang-suggestion-banner.tsx). A WebView has no SEO stake, so the apps FOLLOW instead — and only from the start page
 * `/`, to its twin `/vi`, by the banner's own rule (preferredLanguage there: stored choice, then the `lang` cookie,
 * then the first supported browser language). An explicit English choice stays English.
 *
 * ⛔ WHY IN THE PRE-PAINT SCRIPT, NOT IN NativeBootstrap (review, 2026-10-06). The first version followed after
 * hydration, once the launch deep link had been routed, and every review round found another launch navigation it
 * raced: a late appUrlOpen, then a push tap whose listener only registers after sign-in and a permission check —
 * each fix exposed the next. Here the decision is taken while `/` is still PARSING: no listener exists yet, so the
 * launch URL (getLaunchUrl) and every RETAINED event (appUrlOpen and the push tap: Capacitor holds each until a
 * listener registers) are still waiting for the `/vi` document, which handles them exactly like any cold start.
 * `window.__enoLeaving` keeps the doomed `/` document from registering anything meanwhile (NativeBootstrap and
 * native push both stand down — leavingForHomeTwin below) and from lifting the splash before `/vi` paints.
 *
 * ⚠️ The strings are spliced into the pre-paint TEMPLATE LITERAL in src/app/[lang]/layout.tsx: no backslashes and
 * no regex in them (a `\s` there would silently become `s`). The picker is tested against preferredLanguage itself
 * (lang-pilot.test.tsx), so the two cannot drift apart unnoticed.
 */
import { LANGUAGES } from '@/lib/languages'
import { LANG_COOKIE } from '@/lib/lang-variant'
import { VI_PILOT } from '@/lib/lang-pinned'

/** preferredLanguage (lang-suggestion-banner.tsx), as plain ES5: (stored, cookie, browser languages, known codes) → code | null. */
export const APP_LANGUAGE_PICK_JS =
  "function(st,ck,ls,K){var kn=function(v){return v&&K.indexOf(v)>-1?v:null};var p=kn(st)||kn(ck);if(p)return p;" +
  "for(var i=0;i<ls.length;i++){var lc=String(ls[i]||'').toLowerCase();if(lc.indexOf('zh')===0)return 'zh-Hans';" +
  "var c=kn(lc.split('-')[0]);if(c)return c}return null}"

/** The follow for the apps' pre-paint script; '' when this edition's `/` has no `/vi` twin (eno.forum). */
export function appHomeTwinJs(twin: string | null): string {
  if (!twin) return ''
  const mark = `; ${LANG_COOKIE}=`
  return (
    "if(location.pathname==='/'){var st=null,ck=null;try{st=localStorage.getItem('lang')}catch(e){}" +
    `var cs='; '+document.cookie,ci=cs.indexOf(${JSON.stringify(mark)});` +
    `if(ci>-1){var cv=cs.slice(ci+${mark.length}),ce=cv.indexOf(';');if(ce>-1)cv=cv.slice(0,ce);try{ck=decodeURIComponent(cv)}catch(e){}}` +
    'var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];' +
    `if((${APP_LANGUAGE_PICK_JS})(st,ck,ls,${JSON.stringify(LANGUAGES.map((l) => l.code))})==='vi')` +
    `{window.__enoLeaving=1;location.replace(${JSON.stringify(twin)}+location.search)}}`
  )
}

export const APP_HOME_TWIN_JS = appHomeTwinJs(VI_PILOT.live.includes('/') ? '/vi' : null)

/** True in the `/` document the pre-paint script is already replacing with `/vi`: register nothing there. */
export function leavingForHomeTwin(): boolean {
  return typeof window !== 'undefined' && (window as Window & { __enoLeaving?: number }).__enoLeaving === 1
}
