'use client'

import { useCallback, useRef } from 'react'

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAADvYeXXUeqC3zRQC'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  execute: (id: string) => void
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null
function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => { scriptPromise = null; reject(new Error('turnstile_unavailable')) }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function useTurnstile() {
  const widgetId = useRef<string | null>(null)
  const resolver = useRef<((token: string | undefined) => void) | null>(null)

  const attach = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current) } catch { /* already removed */ }
      }
      widgetId.current = null
      resolver.current = null
      return
    }
    if (widgetId.current) return
    loadScript().then(() => {
      if (!window.turnstile || widgetId.current || !element.isConnected) return
      widgetId.current = window.turnstile.render(element, {
        sitekey: SITE_KEY,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token: string) => { resolver.current?.(token); resolver.current = null },
        'error-callback': () => { resolver.current?.(undefined); resolver.current = null },
      })
    }).catch(() => {})
  }, [])

  const getToken = useCallback(() => new Promise<string | undefined>((resolve) => {
    const api = window.turnstile
    const id = widgetId.current
    if (!api || !id) { resolve(undefined); return }
    let settled = false
    const timeout = window.setTimeout(() => finish(undefined), 15_000)
    function finish(token: string | undefined) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      if (resolver.current === finish) resolver.current = null
      resolve(token)
    }
    resolver.current = finish
    try { api.reset(id); api.execute(id) } catch { finish(undefined) }
  }), [])

  const Widget = useCallback(() => <div ref={attach} className="flex justify-center empty:hidden" />, [attach])
  return { getToken, Widget }
}

