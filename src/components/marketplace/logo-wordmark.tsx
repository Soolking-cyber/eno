// "eno" hero wordmark — the landing LCP element. Served as a small EXTERNAL file
// (not a data URI): a data URI put the logo's ~6.6KB inside the HTML, so on Slow-4G
// it couldn't paint until ~28KB of critical HTML (21KB inline CSS + the data URI)
// downloaded — a 2.5s self-inflicted render delay. As an external <img> with a
// high-priority preload (see layout.tsx), it's an LCP candidate that fetches in
// parallel and keeps the HTML small. width/height set the 4:1 ratio → no CLS.
export function LogoWordmark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      alt="ENO Logo"
      width={320}
      height={80}
      fetchPriority="high"
      decoding="async"
      className={className}
    />
  )
}
