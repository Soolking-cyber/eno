import Script from 'next/script'

// Google Analytics (GA4) + Meta (Facebook) Pixel. Both are OPT-IN via env — they
// render nothing until the IDs are set, so there's zero perf cost out of the box.
// GA loads afterInteractive (post-hydration) for an accurate PageView; the heavier
// Meta Pixel (fbevents.js, ~240 KiB + legacy-JS polyfills) loads lazyOnload — during
// browser idle AFTER the load event — so it never competes with hydration/LCP/TBT.
// Both event helpers in lib/analytics.ts guard window.fbq/gtag and the vendors
// self-queue, so deferring the Pixel can't drop a click or break an interaction.
//   NEXT_PUBLIC_GA_ID       e.g. G-XXXXXXXXXX  (env overrides the default below)
//   NEXT_PUBLIC_FB_PIXEL_ID e.g. 1234567890
// GA Measurement IDs are public (they ship in the page), so the live ID is set as
// the default — works in prod with no extra env step; env still overrides it.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-CKTZK62B0X'
const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID || '1006148665611946'

export function AnalyticsTags() {
  return (
    <>
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      )}
      {FB_PIXEL_ID && (
        <>
          <Script id="fb-pixel" strategy="lazyOnload">
            {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${FB_PIXEL_ID}');fbq('track','PageView');`}
          </Script>
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img height="1" width="1" style={{ display: 'none' }} alt="" src={`https://www.facebook.com/tr?id=${FB_PIXEL_ID}&ev=PageView&noscript=1`} />
          </noscript>
        </>
      )}
    </>
  )
}
