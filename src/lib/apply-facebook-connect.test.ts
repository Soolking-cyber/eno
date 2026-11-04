import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (f: string) => readFileSync(`infra/vn-node/${f}`, 'utf8')
const guard = (s: string) => s.match(/-- ENO-FB-GUARD-BEGIN[\s\S]*?-- ENO-FB-GUARD-END/)?.[0]

describe('Connect Facebook on the box', () => {
  it('both scripts hold one guard, so a re-run of either cannot restore an older one', () => {
    const a = guard(read('apply-facebook-connect.sh'))
    expect(a).toBeTruthy()
    expect(guard(read('apply-facebook-signin.sh'))).toBe(a)
  })
  it('the guard’s exception never reaches GoTrue’s own login, and operators stay refused past it', () => {
    const g = guard(read('apply-facebook-connect.sh'))!
    expect(g).toContain("session_user <> 'supabase_auth_admin'")
    expect(g).toContain('r.email IN (em, coalesce(acct')
  })
  // Same-event BEFORE triggers fire in name order: the operator check must read the address before it is stripped.
  it('the operator check fires before the address is stripped', () => {
    expect('eno_refuse_facebook_identity' < 'eno_strip_facebook_identity_email').toBe(true)
  })
  it('GoTrue’s manual linking stays closed: the script refuses it, and nginx still answers 403', () => {
    expect(read('apply-facebook-connect.sh')).toMatch(/GOTRUE_SECURITY_MANUAL_LINKING_ENABLED[\s\S]*Stop\./)
    expect(read('nginx/eno.conf')).toMatch(/identities\/\+authorize \{ return 403; \}/)
  })
  // ⛔ GoTrue's FACEBOOK_EMAIL_OPTIONAL is on so a connected Facebook with no email can sign in. Only the guard keeps new accounts from being made without one.
  it('a new account with no email stays refused, past the setting that would allow it', () => {
    const g = guard(read('apply-facebook-connect.sh'))!
    expect(g).toContain("'eno: a new Facebook account needs an email address'")
    const s = read('apply-facebook-connect.sh')
    expect(s.indexOf('INSTALL_SQL')).toBeLessThan(s.indexOf('=== WRITE: GoTrue signs in a connected Facebook'))
    expect(read('apply-facebook-signin.sh')).toContain('is on without the guard')
  })
  it('only the app’s role can call the functions', () => {
    const s = read('apply-facebook-connect.sh')
    expect(s).toContain('REVOKE ALL ON FUNCTION auth.eno_connect_facebook(uuid, text, jsonb) FROM PUBLIC')
    expect(s).toContain('REVOKE ALL ON FUNCTION auth.eno_disconnect_facebook(uuid, uuid) FROM PUBLIC')
    expect(s).toContain('GRANT EXECUTE ON FUNCTION auth.eno_connect_facebook(uuid, text, jsonb) TO :"app_role"')
    for (const r of ['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) expect(s).toContain(`'${r}'`)
  })
})
