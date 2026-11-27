'use client'

import { handleExternalClick } from '@/lib/native-browser'

// The byline's name as a link to the author's LinkedIn profile (owner, 2026-11-27: "attach linkedin profiles to content author").
// A client island for ONE reason: `handleExternalClick`, so the iOS/Android apps open LinkedIn in the in-app browser sheet instead of
// throwing the reader out to the system browser (src/lib/native-browser.ts). On the web it is a plain new-tab link.
// `rel="author"`: the link names the article's author. The mark tells a sighted reader where the name goes; "(LinkedIn)" tells a
// screen reader (a brand name: the same in every language).

// Byte-identical to footer.tsx's LinkedinIcon — the mono single-path brand-glyph policy there (share-button.tsx keeps its Facebook
// mark the same way), so the two surfaces cannot drift apart.
function LinkedinIcon(props: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>)
}

// A module constant, not a JSX literal (react/jsx-no-literals): a brand name, the same in every language, never sent to the translator.
const WHERE_IT_GOES = ' (LinkedIn)'

export function AuthorProfileLink({ href, name }: { href: string; name: string }) {
  return (
    <a
      href={href}
      onClick={handleExternalClick}
      target="_blank"
      rel="author noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg text-foreground transition-colors hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {name}
      <LinkedinIcon className="size-3.5 shrink-0 text-ink-4" />
      <span className="sr-only">{WHERE_IT_GOES}</span>
    </a>
  )
}
