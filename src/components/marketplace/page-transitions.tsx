'use client'

import { createContext, useCallback, useContext, useEffect, useRef, startTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type Dir = 'forward' | 'back'
type DocVT = Document & { startViewTransition?: (cb: () => Promise<void> | void) => unknown }

const SlideCtx = createContext<{ navigate: (href: string, dir: Dir) => void }>({
  navigate: () => {},
})

/** Facebook-style directional page slide for the bottom-nav tabs. Wraps the navigation
 *  in the native View Transitions API so the OUTGOING page slides one way while the
 *  INCOMING page slides the other (direction = tab order). The page content slides; the
 *  header + bottom nav are view-transition-named so they stay put. Resolves the
 *  transition once the route commits (pathname changes). Falls back to a normal push
 *  where the API is unavailable or reduced-motion is requested. */
export function useSlideRouter() {
  return useContext(SlideCtx)
}

export function PageTransitions({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const finishRef = useRef<(() => void) | null>(null)

  // The route committed (new DOM is on screen) → let the View Transition snapshot the
  // new page and run the slide.
  useEffect(() => {
    if (finishRef.current) {
      finishRef.current()
      finishRef.current = null
    }
  }, [pathname])

  const navigate = useCallback((href: string, dir: Dir) => {
    const doc = document as DocVT
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof doc.startViewTransition !== 'function' || reduce) {
      router.push(href)
      return
    }
    document.documentElement.dataset.navDir = dir
    doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          startTransition(() => {
            router.push(href)
            finishRef.current = resolve
          })
        }),
    )
  }, [router])

  return <SlideCtx.Provider value={{ navigate }}>{children}</SlideCtx.Provider>
}
