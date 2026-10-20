import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const dns = vi.hoisted(() => ({ answer: [] as Array<{ address: string; family: number }> | Error, asked: [] as string[] }))
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => { dns.asked.push(host); if (dns.answer instanceof Error) throw dns.answer; return dns.answer },
}))
import { layaAnswers, layaBase, layaUrl, privateAddress } from './laya'

describe('layaUrl — post text only ever goes to the eno-laya engine (codex, gates 1b + 1c)', () => {
  afterEach(() => vi.unstubAllEnvs())
  it.each([
    ['http://eno-laya:8790', 'http://eno-laya:8790'],
    ['http://localhost:8799/', 'http://localhost:8799'],
    ['http://127.0.0.1:8790', 'http://127.0.0.1:8790'],
    ['http://[::1]:8790', 'http://[::1]:8790'],
  ])('accepts %s', (env, want) => {
    vi.stubEnv('LAYA_ENGINE_URL', env)
    expect(layaUrl()).toBe(want)
  })
  it.each(['https://laya.example.com', 'http://8.8.8.8:8790', 'http://10.0.0.5:8790', 'http://172.20.0.3:8790', 'http://other-box:8790', 'ftp://eno-laya', 'not a url', ''])('refuses %s', (env) => {
    vi.stubEnv('LAYA_ENGINE_URL', env)
    expect(layaUrl()).toBeNull()
  })
})

describe('layaBase — the name resolves to the box, or the post text goes nowhere (opus, gate 6g)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); dns.asked = [] })
  it('a private address: the request goes to that ADDRESS', async () => {
    vi.stubEnv('LAYA_ENGINE_URL', 'http://eno-laya:8790')
    dns.answer = [{ address: '172.18.0.7', family: 4 }]
    expect(await layaBase()).toBe('http://172.18.0.7:8790')
    dns.answer = [{ address: 'fd00::7', family: 6 }]
    expect(await layaBase()).toBe('http://[fd00::7]:8790')
  })
  it('⛔ a public address (a wildcard search domain while no eno-laya exists), a mix, nothing, or an error: no engine', async () => {
    vi.stubEnv('LAYA_ENGINE_URL', 'http://eno-laya:8790')
    for (const answer of [[{ address: '203.0.113.9', family: 4 }], [{ address: '172.18.0.7', family: 4 }, { address: '8.8.8.8', family: 4 }], [], new Error('ENOTFOUND')]) {
      dns.answer = answer
      expect(await layaBase(), JSON.stringify(answer instanceof Error ? 'error' : answer)).toBeNull()
    }
  })
  it('a loopback address is used as it is — nothing to resolve', async () => {
    vi.stubEnv('LAYA_ENGINE_URL', 'http://127.0.0.1:8790')
    expect(await layaBase()).toBe('http://127.0.0.1:8790')
    expect(dns.asked).toEqual([])
  })
  it('⛔ layaAnswers sends nothing when the name resolves off the box', async () => {
    vi.stubEnv('LAYA_ENGINE_URL', 'http://eno-laya:8790')
    dns.answer = [{ address: '203.0.113.9', family: 4 }]
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await layaAnswers(['English teacher wanted, District 7'])).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('privateAddress', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '::1', 'fd12:3456::1', 'fc00::1']) expect(privateAddress(ip), ip).toBe(true)
    for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '203.0.113.9', '2001:db8::1', 'fe80::1', '11.0.0.1']) expect(privateAddress(ip), ip).toBe(false)
  })
})
