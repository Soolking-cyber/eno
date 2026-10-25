import { describe, expect, it } from 'vitest'
import { classroomAddress, classroomHost, classroomRedirectPath, classroomRedirectUrl, isClassroomHost, isClassroomPath } from './host'

describe('classroom host', () => {
  it('derives classroom.<base> from the app URL, www stripped', () => {
    expect(classroomHost('https://eno.vn')).toBe('classroom.eno.vn')
    expect(classroomHost('https://www.eno.forum')).toBe('classroom.eno.forum')
    expect(classroomHost(undefined)).toBe('')
  })

  it('matches the Host header exactly, port and case ignored', () => {
    expect(isClassroomHost('Classroom.eno.vn:443', 'https://eno.vn')).toBe(true)
    expect(isClassroomHost('classroom.eno.vn.evil.example', 'https://eno.vn')).toBe(false)
    expect(isClassroomHost('eno.vn', 'https://eno.vn')).toBe(false)
    expect(isClassroomHost(null, 'https://eno.vn')).toBe(false)
    expect(isClassroomHost('classroom.eno.vn.', 'https://eno.vn')).toBe(true)
  })

  it('maps paths under /classroom without doubling or leaving the domain', () => {
    expect(classroomRedirectPath('/', '')).toBe('/classroom')
    expect(classroomRedirectPath('', '?a=1')).toBe('/classroom?a=1')
    expect(classroomRedirectPath('/join/abc/', '')).toBe('/classroom/join/abc')
    expect(classroomRedirectPath('/classroom', '')).toBe('/classroom')
    expect(classroomRedirectPath('/classroom/join/abc', '')).toBe('/classroom/join/abc')
    expect(classroomRedirectPath('/classrooms', '')).toBe('/classroom/classrooms')
    expect(classroomRedirectPath('//evil.example/x', '')).toBe('/classroom/evil.example/x')
  })

  it('⛔ never leaves /classroom through dot segments, plain or percent-encoded', () => {
    for (const p of ['/join/../../visa', '/..', '/./x', '/join/%2e%2e/%2E%2E/visa', '/a/.%2e/b', '/classroom/../visa', '/join\\..\\..\\visa', '/x\\y']) {
      expect(classroomRedirectPath(p, '?q=1')).toBe('/classroom')
    }
    for (const p of ['/join/../../visa', '/join\\..\\..\\visa', '/join/%2e%2e/%2e%2e/visa']) {
      expect(new URL(classroomRedirectUrl('https://eno.vn', p, '')!).pathname).toBe('/classroom')
    }
    expect(classroomRedirectPath('/join/a..b', '')).toBe('/classroom/join/a..b') // a dot inside a segment is fine
  })

  it('builds the redirect on the app origin', () => {
    expect(classroomRedirectUrl('https://eno.vn', '/join/x', '?q=1')).toBe('https://eno.vn/classroom/join/x?q=1')
    expect(classroomRedirectUrl(undefined, '/', '')).toBeNull()
    expect(classroomRedirectUrl('not a url', '/', '')).toBeNull()
  })

  it('names the shareable address, and falls back to the path without an app URL', () => {
    expect(classroomAddress('https://eno.vn')).toBe('https://classroom.eno.vn')
    expect(classroomAddress('')).toBe('/classroom')
  })

  it('knows a classroom page by whole segment', () => {
    expect(isClassroomPath('/classroom')).toBe(true)
    expect(isClassroomPath('/classroom/join/x')).toBe(true)
    expect(isClassroomPath('/classrooms')).toBe(false)
    expect(isClassroomPath('/')).toBe(false)
    expect(isClassroomPath(null)).toBe(false)
  })
})
