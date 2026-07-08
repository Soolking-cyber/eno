'use client'

import { useEffect, useState } from 'react'

// Tiny on-screen diagnostics for the iOS keyboard work — renders ONLY with ?kbdebug=1
// in the URL (zero cost otherwise). Shows the live numbers the keyboard pinning depends
// on so a single user screenshot carries the data we can't capture off-device.
export function KbDebug() {
  const [on, setOn] = useState(false)
  const [s, setS] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('kbdebug=1')) return
    setOn(true)
    const read = () => {
      const vv = window.visualViewport
      const root = document.documentElement
      const footer = document.querySelector('.chat-footer')
      const fr = footer?.getBoundingClientRect()
      const lines = [
        `build ${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev'}`,
        `innerH ${window.innerHeight} · vvH ${vv ? Math.round(vv.height) : '—'} · vvTop ${vv ? Math.round(vv.offsetTop) : '—'}`,
        `kb-open ${root.classList.contains('kb-open')} · locked ${root.classList.contains('chat-locked')}`,
        `--vvh ${root.style.getPropertyValue('--vvh') || '—'} · --vvt ${root.style.getPropertyValue('--vvt') || '—'}`,
        `footer ${fr ? `${Math.round(fr.top)}→${Math.round(fr.bottom)} ${getComputedStyle(footer!).position}` : 'none'}`,
        `kbTop(exp) ${vv ? Math.round(vv.offsetTop + vv.height) : '—'} · UA ${navigator.userAgent.slice(-45)}`,
      ]
      setS(lines.join('\n'))
    }
    read()
    const t = setInterval(read, 300)
    window.visualViewport?.addEventListener('resize', read)
    window.visualViewport?.addEventListener('scroll', read)
    return () => {
      clearInterval(t)
      window.visualViewport?.removeEventListener('resize', read)
      window.visualViewport?.removeEventListener('scroll', read)
    }
  }, [])

  if (!on) return null
  return (
    <pre className="pointer-events-none fixed left-1 top-14 z-[9999] max-w-[95vw] whitespace-pre-wrap rounded-lg bg-black/80 p-2 text-[10px] leading-tight text-green-300">
      {s}
    </pre>
  )
}
