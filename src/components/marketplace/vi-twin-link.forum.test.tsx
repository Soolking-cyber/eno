import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'

// eno.forum: no /vi twins (lang-pinned.ts viPilotFor empties every list on the services edition), so never a link to one.
vi.mock('@/lib/edition', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/edition')>()), IS_SERVICES: true, IS_MARKETPLACE: false }))

const { ViTwinLink } = await import('./vi-twin-link')
const html = (path: string) => renderToStaticMarkup(<LanguageProvider initialLang="en"><ViTwinLink path={path} lang="en" /></LanguageProvider>)

describe('ViTwinLink on eno.forum', () => {
  it('renders nothing on any family page', () => {
    for (const p of ['/help', '/help/help-who-can-leave-a-review', '/schools', '/tools', '/c/rentals', '/c/rentals/d2', '/hcmc-rent-index']) expect(html(p), p).toBe('')
  })
})
