import type { MetadataRoute } from 'next'

/**
 * PWA manifest — served at /manifest.webmanifest and auto-linked in <head> by Next.
 * Required for "Add to Home Screen", which is the ONLY way iOS Safari allows web
 * push (the daily availability reminders). Android/desktop also use it for install.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'eno.vn — Expat Marketplace in Vietnam',
    short_name: 'eno.vn',
    description:
      'Marketplace for expats and internationals in Vietnam — housing, jobs, motorbikes, services and moving sales.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0a66c2',
    lang: 'en',
    categories: ['shopping', 'business', 'lifestyle'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
