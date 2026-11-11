/**
 * Building blocks the developer pages share (/developers, /developers/mcp, /developers/versioning). Server components
 * only: these pages are read mostly by agents and crawlers that run no JavaScript (developers/page.tsx's header note).
 */

/**
 * ⚠️ `whole`: ONE TAP OR CLICK SELECTS THE WHOLE VALUE (`user-select: all`), ready to copy (2026-11-06 audit). A Copy
 * button would be client JavaScript on a page whose readers are mostly agents that run none (the header note); the
 * selection is its no-JS form. Only on blocks that are ONE value to paste — the base URL, a header, a one-line command —
 * so a multi-line example keeps ordinary selection and a reader can still take one line of it.
 * ⛔ A <pre>: never inside a <p> (src/app/[lang]/html-nesting-contract.test.ts).
 */
export function Code({ children, whole = false }: { children: string; whole?: boolean }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-foreground/[0.04] p-3.5 text-xs leading-relaxed text-foreground ring-1 ring-border">
      <code className={whole ? 'select-all font-mono' : 'font-mono'}>{children}</code>
    </pre>
  )
}

/** Inline code in running text, the developers page's chip. */
export function C({ children }: { children: string }) {
  return <code className="rounded-lg bg-muted px-1 text-xs font-semibold">{children}</code>
}
