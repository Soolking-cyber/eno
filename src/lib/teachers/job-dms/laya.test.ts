import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { layaUrl } from './laya'

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
