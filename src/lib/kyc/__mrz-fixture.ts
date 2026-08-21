// Builds a TD3 passport MRZ whose check digits genuinely verify, so a fixture cannot silently
// become a rejection-path test. Mirrors the mod-7-3-1 in src/lib/visa/mrz.ts rather than importing
// it — a fixture that shares the implementation under test would hide a bug in both.
const WEIGHTS = [7, 3, 1]
const val = (c: string) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.toUpperCase().charCodeAt(0) - 55)
const check = (s: string) => String(s.split('').reduce((acc, c, i) => acc + val(c) * WEIGHTS[i % 3], 0) % 10)
const pad = (s: string, n: number) => (s + '<'.repeat(n)).slice(0, n)

export function buildMrz(o: { surname: string; given: string; number: string; nat: string; dob: string; exp: string }) {
  const name = pad(`${o.surname.replace(/ /g, '<')}<<${o.given.replace(/ /g, '<')}`, 39)
  const line1 = `P<${o.nat}${name}`
  const num = pad(o.number, 9)
  const personal = pad('', 14)
  const body = `${num}${check(num)}${o.nat}${o.dob}${check(o.dob)}F${o.exp}${check(o.exp)}${personal}${check(personal)}`
  const composite = `${num}${check(num)}${o.dob}${check(o.dob)}${o.exp}${check(o.exp)}${personal}${check(personal)}`
  return { line1, line2: `${body}${check(composite)}` }
}
