import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * The Laya engine on the box (teacher job DMs, 2026-10-20): infra/vn-node/laya-server, jobs.compose.yml, and the one line
 * apps.compose.yml gives eno-vn. What can be held without the box: the container can never publish its unauthenticated
 * port and is a compose project of its own; the model and the runtime stay pinned, baked and checked by content, and the
 * build proves an offline load as the runtime user; LAYA_ENGINE_URL names exactly this container, on eno.vn only; and
 * server.py's HTTP contract (engine id from the baked files, the bounds, one pass at a time, a caller that hung up is
 * not worked for, no request text in the log) holds against a stub model — test_server.py, run here when there is a
 * python3.
 */
const ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const DIR = 'infra/vn-node/laya-server'
const DOCKERFILE = read(`${DIR}/Dockerfile`)
const SERVER = read(`${DIR}/server.py`)
const REQUIREMENTS = read(`${DIR}/requirements.txt`)
const JOBS = read('infra/vn-node/jobs.compose.yml')
const APPS = read('infra/vn-node/apps.compose.yml')
/** The file without its comment lines — what docker, compose or pip actually read. */
const code = (text: string) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

const requireHere = createRequire(import.meta.url)
/** js-yaml arrives only through eslint, so the YAML-parse checks skip without it (as in apply-gotrue-db-pool.test.ts). */
const yamlLoad: ((s: string) => unknown) | null = (() => {
  try { return (requireHere('js-yaml') as { load: (s: string) => unknown }).load } catch { return null }
})()
type Service = Record<string, unknown> & { environment?: Record<string, unknown> }
type Compose = { name?: string; services: Record<string, Service>; networks?: Record<string, { external?: boolean }> }

/** The final stage of the Dockerfile — from its last FROM. */
const FINAL_STAGE = DOCKERFILE.slice(DOCKERFILE.lastIndexOf('\nFROM '))
/** ENV pairs set in the final stage (continuation lines joined). */
const finalEnv = (() => {
  const env: Record<string, string> = {}
  for (const m of code(FINAL_STAGE).matchAll(/^ENV ((?:.*\\\n)*.*)$/gm)) {
    for (const pair of m[1].replace(/\\\n/g, ' ').trim().split(/\s+/)) {
      const at = pair.indexOf('=')
      env[pair.slice(0, at)] = pair.slice(at + 1)
    }
  }
  return env
})()
const CONTAINER = JOBS.match(/^\s+container_name:\s*(\S+)\s*$/m)?.[1]
const CPUS = Number(JOBS.match(/^\s+cpus:\s*(\d+)\s*$/m)?.[1])

const PYTHON = (() => {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['-c', 'import sys; print(sys.version_info >= (3, 8))'], { encoding: 'utf8', timeout: 10_000 })
    if (r.status === 0 && r.stdout.trim() === 'True') return bin
  }
  return null
})()

describe('jobs.compose.yml · the eno-laya container', () => {
  it('never publishes a port and never joins the host network — the server has no authentication', () => {
    expect(code(JOBS)).not.toMatch(/^\s*(ports|network_mode)\s*:/m)
    // …nor a port-mapping list item under some other key ("8790:8790", "127.0.0.1:8790:8790").
    expect(code(JOBS)).not.toMatch(/^\s*-\s*["']?[\d.]*:?\d+:\d+["']?\s*$/m)
  })

  it('is a compose project of its own, so neither file ever sees the other\'s containers as orphans', () => {
    expect(code(JOBS)).toMatch(/^name:\s*eno-jobs\s*$/m)
    expect(code(APPS)).not.toMatch(/^name:\s*eno-jobs\s*$/m)
  })

  it.skipIf(!yamlLoad)('runs the local image, bounded and locked down, on supabase_default', () => {
    const doc = yamlLoad!(JOBS) as Compose
    expect(Object.keys(doc.services)).toEqual(['eno-laya'])
    const svc = doc.services['eno-laya']
    expect(svc).toMatchObject({
      image: 'eno-laya:local', pull_policy: 'never', container_name: 'eno-laya', restart: 'unless-stopped',
      networks: ['supabase_default'], cpus: 3, mem_limit: '4g', oom_score_adj: 500,
      cap_drop: ['ALL'], read_only: true,
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
    })
    expect(svc.ports).toBeUndefined()
    expect(svc.network_mode).toBeUndefined()
    expect(svc.memswap_limit, 'no swap: the ceiling is the ceiling').toBe(svc.mem_limit)
    expect(svc.security_opt).toContain('no-new-privileges:true')
    expect((svc.tmpfs as string[]).some((t) => t === '/tmp' || t.startsWith('/tmp:'))).toBe(true)
    expect(doc.networks?.supabase_default?.external).toBe(true)
  })

  it('runs as many torch threads as it has CPUs', () => {
    expect(CPUS).toBe(3)
    expect(finalEnv.LAYA_THREADS).toBe(String(CPUS))
    expect(finalEnv.OMP_NUM_THREADS).toBe(String(CPUS))
  })
})

describe('apps.compose.yml · LAYA_ENGINE_URL', () => {
  const expected = `http://${CONTAINER}:${finalEnv.LAYA_PORT}`

  it('names the container and the port the image serves on', () => {
    expect(expected).toBe('http://eno-laya:8790')
    expect(code(APPS).match(/LAYA_ENGINE_URL/g), 'one line, on one service').toHaveLength(1)
    expect(code(APPS)).toContain(`LAYA_ENGINE_URL: '${expected}'`)
  })

  // The placement check that never skips (codex, gate 6a: js-yaml is only a transitive dependency): the text of each
  // service's block, cut at the next top-level service.
  it('is set on eno-vn only — read from the text, whatever parsers are installed', () => {
    const block = (name: string) => {
      const at = APPS.search(new RegExp(`^  ${name}:\\s*$`, 'm'))
      expect(at, name).toBeGreaterThan(-1)
      const rest = APPS.slice(at + 1)
      const next = rest.search(/^  [a-z][\w-]*:\s*$/m)
      return next === -1 ? rest : rest.slice(0, next)
    }
    expect(block('eno-vn')).toContain('LAYA_ENGINE_URL')
    expect(block('eno-forum')).not.toContain('LAYA_ENGINE_URL')
  })

  it.skipIf(!yamlLoad)('is set on eno-vn only — teachers live on the marketplace', () => {
    const doc = yamlLoad!(APPS) as Compose
    expect(doc.services['eno-vn'].environment?.LAYA_ENGINE_URL).toBe(expected)
    expect(doc.services['eno-forum'].environment?.LAYA_ENGINE_URL).toBeUndefined()
    // The rest of eno-vn's runtime switches are untouched.
    expect(doc.services['eno-vn'].environment).toMatchObject({
      LISTING_IMAGES_INTERNAL: 'true', ENO_ISR_PG: '1', SUPABASE_INTERNAL_FETCH: 'true',
    })
  })
})

describe('laya-server image', () => {
  it('bakes the model at a full commit, checks the weights by content and writes the engine-id files', () => {
    const d = code(DOCKERFILE)
    expect(d).toMatch(/^ARG LAYA_REPO=convaiinnovations\/laya-multilingual$/m)
    expect(d).toMatch(/^ARG LAYA_REVISION=[0-9a-f]{40}$/m)
    expect(d).toMatch(/^ARG LAYA_WEIGHTS_SHA256=[0-9a-f]{64}$/m)
    expect(d).toMatch(/^ARG LAYA_TOKENIZER_SHA256=[0-9a-f]{64}$/m)
    expect(d).toContain(`grep -Eq '^[0-9a-f]{40}$'`)
    expect(d).toContain(`snapshot_download(sys.argv[1], revision=sys.argv[2], local_dir='/models/laya'`)
    expect(d).toContain('| sha256sum -c -')
    expect(d).toContain(`printf '%s\\n' "$LAYA_REVISION" > /models/laya/REVISION`)
    expect(d).toContain(`printf '%s\\n' "$LAYA_REPO" > /models/laya/MODEL_ID`)
  })

  it('loads the model with the network off at build — first where it may still be rewritten, then as the runtime user', () => {
    const d = code(DOCKERFILE)
    const modelStage = d.slice(d.indexOf(' AS model'), d.lastIndexOf('\nFROM '))
    expect(modelStage).toContain(`RUN --network=none HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 python -c 'import laya; laya.load("/models/laya")'`)
    const final = code(FINAL_STAGE)
    const user = final.indexOf('\nUSER laya')
    const load = final.indexOf(`RUN --network=none python -c 'import laya; laya.load("/models/laya")'`)
    expect(user).toBeGreaterThan(-1)
    expect(load, 'the runtime-user load comes after USER').toBeGreaterThan(user)
    expect(final.slice(load)).toContain('server.engine_identity("/models/laya")')
  })

  it('runs offline and non-root, on the measured Python with the CPU build of torch', () => {
    const d = code(DOCKERFILE)
    expect(d.match(/^FROM \S+/m)?.[0]).toBe('FROM python:3.11-slim')
    expect(d).toContain('pip install --index-url https://download.pytorch.org/whl/cpu torch==2.2.2')
    expect(d).toContain(`torch.__version__ == '2.2.2+cpu'`)
    expect(finalEnv).toMatchObject({
      LAYA_MODEL: '/models/laya', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', LAYA_HOST: '0.0.0.0', LAYA_PORT: '8790',
    })
    const users = [...code(FINAL_STAGE).matchAll(/^USER (\S+)$/gm)].map((m) => m[1])
    expect(users.length).toBeGreaterThan(0)
    expect(users[users.length - 1]).not.toMatch(/^(root|0)(:|$)/)
    const health = code(FINAL_STAGE).match(/^HEALTHCHECK [\s\S]*?CMD \[(.*)\]$/m)?.[1] ?? ''
    expect(health).toContain('urllib.request.urlopen')
    expect(health).toContain('/healthz')
    expect(health).not.toContain('curl')
    expect(code(FINAL_STAGE)).toMatch(/^CMD \["python", "\/app\/server\.py"\]$/m)
  })

  it('pins exactly the runtime the pipeline measured', () => {
    const pins = code(REQUIREMENTS).split('\n').map((l) => l.trim()).filter(Boolean).sort()
    expect(pins).toEqual([
      'huggingface_hub==0.36.2', 'laya==0.3.6', 'numpy==1.26.4', 'safetensors==0.8.0', 'tokenizers==0.22.2',
      'torch==2.2.2', 'transformers==4.57.6',
    ])
  })
})

describe('laya-server/server.py', () => {
  it('never asks the hub at boot, and keeps the bounds', () => {
    expect(SERVER).not.toMatch(/HfApi|model_info|scan_cache_dir|snapshot_download|hf_hub_download/)
    expect(SERVER).toMatch(/^MAX_STATES = 64\b/m)
    expect(SERVER).toMatch(/^MAX_BODY = 2_000_000\b/m)
    expect(SERVER).toMatch(/^MAX_CHARS = 6000\b/m)
    expect(SERVER).toContain('os.environ.get("LAYA_MODEL", "/models/laya")')
  })

  it.skipIf(!PYTHON)('answers its HTTP contract against a stub model (test_server.py)', () => {
    const r = spawnSync(PYTHON!, ['-B', join(ROOT, DIR, 'test_server.py')], {
      encoding: 'utf8', timeout: 120_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stderr).toMatch(/^OK$/m)
  }, 120_000)
})
