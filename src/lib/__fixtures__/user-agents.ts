/**
 * User-agents for the counter guards (bot-ua.ts and every route that reads it). Shared so the
 * library test and each counter's route test judge the SAME strings — a route test that invents its
 * own "Chrome" proves only that its own string passes.
 *
 * ⚠️ PROVENANCE, BECAUSE A FIXTURE THAT IS MADE UP PROVES ONLY THAT THE REGEX MATCHES THE REGEX.
 * `meta-externalagent` is copied from Cloudflare's own log for POST /api/site-stats (eno.forum,
 * 2026-09-17), the same strings bot-ua.test.ts pins. The rest follow each vendor's published format
 * (crawler docs; the in-app browsers' documented suffixes) with current version numbers; the PEOPLE
 * list is weighted to what this market actually opens a shared listing in.
 */
export const CRAWLER_UAS: Record<string, string> = {
  'meta-externalagent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
  'meta-externalagent (bare)': 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
  facebookexternalhit: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  Googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/145.0.0.0 Safari/537.36',
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  Applebot: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  AhrefsBot: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  SemrushBot: 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  Bytespider: 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  YandexBot: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  Baiduspider: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  DuckDuckBot: 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
  coccocbot: 'Mozilla/5.0 (compatible; coccocbot-web/1.0; +http://help.coccoc.com/searchengine)',
  HeadlessChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.0.0 Safari/537.36',
  curl: 'curl/8.7.1',
  'no user-agent': '',
}

export const PERSON_UAS: Record<string, string> = {
  'Chrome (Mac)': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'Chrome (Android)': 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
  'Safari (iPhone)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  'Safari (Mac)': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  // ⛔ THE FACEBOOK IN-APP BROWSER IS A PERSON. It is where someone lands after tapping a listing
  // shared in a Facebook group — the expat groups are this marketplace's front door — and it shares
  // a company, not a token, with the crawler above.
  'Facebook in-app (iOS)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/519.0.0.38.104;FBBV/737413395;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/vi_VN;FBOP/80]',
  'Facebook in-app (Android)': 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.157 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/522.0.0.49.82;IABMV/1;]',
  'Messenger in-app': 'Mozilla/5.0 (Linux; Android 13; SM-A325F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.157 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/520.0.0.47.109;]',
  'Instagram in-app': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,3; iOS 18_5; vi_VN; vi; scale=3.00; 1290x2796; 761497279; IABMV/1)',
  // ⛔ ZALO IS VIETNAM'S MESSENGER, and its in-app browser is how a link shared in a chat opens.
  'Zalo in-app (Android)': 'Mozilla/5.0 (Linux; Android 13; SM-A325F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.179 Mobile Safari/537.36 Zalo android/12100720 ZaloTheme/light ZaloLanguage/vi',
  'Zalo in-app (iOS)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/25080402 ZaloTheme/light ZaloLanguage/vi',
  // `BytedanceWebview` — and why the list says `bytespider`, never `bytedance`.
  'TikTok in-app': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_40.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/vi Region/VN isDarkMode/0 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6',
  // Cốc Cốc's browser beside its crawler (`coccocbot`) — the pair the list has to tell apart.
  'Coc Coc browser': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) coc_coc_browser/140.0.208 Chrome/140.0.7339.208 Safari/537.36',
  'Google app (iOS)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.778392459 Mobile/15E148 Safari/604.1',
  'Samsung Internet': 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  // The Cubot fixture that killed a generic `bot` token (see bot-ua.ts).
  Cubot: 'Mozilla/5.0 (Linux; Android 12; CUBOT_NOTE_40) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  // eno's own native shell (capacitor.config.ts appendUserAgent).
  'eno native app': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1',
}
