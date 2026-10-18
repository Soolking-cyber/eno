/**
 * jsdom gaps a Base UI Drawer (ui/drawer — every phone sheet, ui/picker-sheet) falls into, filled once.
 *
 *  · `ResizeObserver` — the drawer constructs one on mount and throws without it.
 *  · `Element.getAnimations` — the popup asks the platform whether it is still animating before it unmounts;
 *    jsdom runs no animations, so "none" is the truthful answer.
 *  · `scrollIntoView` — list navigation scrolls the highlighted row into view.
 *  · `matchMedia` — a non-matching stub where jsdom has none (ui/drawer's keyboard hook, theme probes).
 *
 * Call it from a `beforeAll`. The copies inline in older suites (mark-sold-sheet.test.tsx) are the same four lines.
 */
export function installDrawerPolyfills(): void {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!window.matchMedia) setViewport('desktop')
}

/**
 * The viewport as `useIsPhone` reads it — its real gate, `matchMedia('(max-width: 639.98px)')`, answered by a stub:
 * a phone matches that query (and no other), a desktop matches nothing. Set it BEFORE rendering; it is read on mount.
 */
export function setViewport(kind: 'phone' | 'desktop'): void {
  window.matchMedia = ((query: string) => ({
    matches: kind === 'phone' && /max-width:\s*639\.98px/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
