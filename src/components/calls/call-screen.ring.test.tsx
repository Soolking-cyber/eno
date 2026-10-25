// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * call-screen.tsx — the ring shows before its details, and ⛔ Answer stays disabled until they are in (§4: see who is
 * calling, about what, before answering); the "This call is from the person above" line never shows under a blank
 * header. And while the video switch has paused video, the camera button is gone and the screen says the call goes on.
 */
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/lib/calls/client/media', () => ({ callsWorkHere: () => true }))
vi.mock('@/lib/calls/client/engine', () => ({ callEngine: { accept: vi.fn(async () => {}), decline: vi.fn(), toggleMute: vi.fn(), toggleCamera: vi.fn(), hangup: vi.fn() } }))

import { CallScreen } from './call-screen'
import type { CallView } from '@/lib/calls/client/engine'

const base: CallView = {
  phase: 'incoming', callId: 'c1', conversationId: null, role: 'callee', media: 'audio', peer: null, listing: null,
  muted: false, cameraOn: false, remoteVideoRevealed: false, remoteVideoLive: false, canSwitchCamera: false, facing: 'user', peerOnHold: false,
  encrypted: false, connectedAt: null, capAt: null, endReason: null, error: null, quality: null, localStream: null, remoteStream: null,
  ringUntil: null, detailsPending: false, videoPaused: false,
}
const peer = { name: 'Lan', avatarUrl: null, verified: true, memberSince: null, side: 'seller' as const }

afterEach(cleanup)

describe('the incoming screen', () => {
  it('details still loading: a placeholder header, Answer disabled, Decline available, no "person above" line', () => {
    render(<CallScreen view={{ ...base, detailsPending: true }} />)
    expect(screen.getByText('Checking who is calling…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('Lan')).toBeNull()
    expect(screen.getByText(/This call is from the person above/).className).toContain('invisible')
  })

  it('details in: who is calling, about what, and Answer enabled', () => {
    render(<CallScreen view={{ ...base, peer, listing: { id: 'l1', title: 'Sofa' } }} />)
    expect(screen.getAllByText('Lan').length).toBeGreaterThan(0)
    expect(screen.getByText(/Sofa/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/This call is from the person above/).className).not.toContain('invisible')
  })
})

describe('the video switch paused', () => {
  it('no camera button, and the screen says the call continues', () => {
    render(<CallScreen view={{ ...base, phase: 'connected', media: 'video', peer, videoPaused: true }} />)
    expect(screen.queryByRole('button', { name: 'Turn camera on' })).toBeNull()
    expect(screen.getByText('Video is paused for now — the call continues')).toBeTruthy()
  })

  it('video allowed: the camera button is there', () => {
    render(<CallScreen view={{ ...base, phase: 'connected', media: 'video', peer }} />)
    expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeTruthy()
    expect(screen.queryByText('Video is paused for now — the call continues')).toBeNull()
  })
})
