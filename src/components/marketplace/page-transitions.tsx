'use client'

import { createContext, useCallback, useContext } from 'react'
import { useRouter } from 'next/navigation'

// NOTE: the bottom-nav directional page slide used the native View Transitions API,
// which threw "Transition was aborted (timeout in DOM update)" on real navigations and
// flashed a darkened snapshot mid-slide. Reverted to a plain push (the template fade
// handles the visual). The provider/hook are kept so callers don't change; `navigate`
// now just routes. A proper old+new slide would need framer-motion's AnimatePresence.
const SlideCtx = createContext<{ navigate: (href: string, dir?: 'forward' | 'back') => void }>({
  navigate: () => {},
})

export function useSlideRouter() {
  return useContext(SlideCtx)
}

export function PageTransitions({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const navigate = useCallback((href: string) => { router.push(href) }, [router])
  return <SlideCtx.Provider value={{ navigate }}>{children}</SlideCtx.Provider>
}
