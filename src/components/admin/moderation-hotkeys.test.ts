// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { moderationHotkey } from './moderation-hotkeys'

const ev = (key: string, over: Partial<KeyboardEvent> = {}, target: HTMLElement = document.body) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, keyCode: key.charCodeAt(0), repeat: false, target, ...over }) as KeyboardEvent

describe('moderationHotkey — which keystrokes may decide a case', () => {
  it('plain c / d / a / j / k are hotkeys', () => {
    for (const k of ['c', 'd', 'a', 'j', 'k']) expect(moderationHotkey(ev(k))).toBe(k)
  })

  it('⛔ Cmd+C / Ctrl+C is a COPY, never "confirm the report" (audit #7)', () => {
    expect(moderationHotkey(ev('c', { metaKey: true }))).toBeNull()
    expect(moderationHotkey(ev('c', { ctrlKey: true }))).toBeNull()
  })

  it('⛔ Cmd/Ctrl+A (select all) never files an abusive-report strike; Cmd+D never dismisses', () => {
    expect(moderationHotkey(ev('a', { metaKey: true }))).toBeNull()
    expect(moderationHotkey(ev('a', { ctrlKey: true }))).toBeNull()
    expect(moderationHotkey(ev('d', { metaKey: true }))).toBeNull()
    expect(moderationHotkey(ev('c', { altKey: true }))).toBeNull()
  })

  it('IME composition (a Vietnamese keyboard) never acts', () => {
    expect(moderationHotkey(ev('c', { isComposing: true }))).toBeNull()
    expect(moderationHotkey(ev('a', { keyCode: 229 }))).toBeNull()
  })

  it('a held key keeps moving the selection but never repeats a decision', () => {
    expect(moderationHotkey(ev('j', { repeat: true }))).toBe('j')
    expect(moderationHotkey(ev('c', { repeat: true }))).toBeNull()
  })

  it('typing in a field, an editable region or an open menu is never a hotkey', () => {
    const input = document.createElement('input')
    const editable = document.createElement('div'); editable.contentEditable = 'true'
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu')
    const item = document.createElement('div'); menu.appendChild(item)
    expect(moderationHotkey(ev('c', {}, input))).toBeNull()
    expect(moderationHotkey(ev('c', {}, editable))).toBeNull()
    expect(moderationHotkey(ev('c', {}, item))).toBeNull()
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog')
    const inDialog = document.createElement('button'); dialog.appendChild(inDialog)
    expect(moderationHotkey(ev('c', {}, inDialog))).toBeNull()
  })
})
