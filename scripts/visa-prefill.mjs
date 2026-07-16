#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const handoff = process.argv[2]
if (!handoff) { console.error('Usage: npm run visa:prefill -- <one-use URL from /admin/visas>'); process.exit(1) }
const url = new URL(handoff)
const production = url.protocol === 'https:' && ['eno.forum', 'www.eno.forum'].includes(url.hostname)
const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
if ((!production && !local) || !url.pathname.startsWith('/api/visa/prefill/')) { console.error('Refusing an unexpected handoff URL.'); process.exit(1) }
const response = await fetch(handoff, { headers: { Accept: 'application/json' }, cache: 'no-store' })
const bundle = await response.json().catch(() => ({}))
if (!response.ok || !bundle.stopBeforeSubmission) { console.error(`Handoff unavailable: ${bundle.error || response.status}`); process.exit(1) }

const dir = await mkdtemp(join(tmpdir(), 'eno-visa-'))
const portrait = join(dir, 'portrait.jpg'), passport = join(dir, 'passport.jpg')
const download = async (source, target) => { const item = await fetch(source, { cache: 'no-store' }); if (!item.ok) throw new Error('document_download_failed'); await writeFile(target, Buffer.from(await item.arrayBuffer()), { mode: 0o600 }) }
await Promise.all([download(bundle.documents.portrait, portrait), download(bundle.documents.passport, passport)])
const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({ locale: 'en-US', acceptDownloads: false })
const page = await context.newPage(), warnings = []
const officialDate = (value) => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || ''); return match ? `${match[3]}/${match[2]}/${match[1]}` : value || '' }
const fill = async (id, value) => { if (value === '' || value == null) return; const field = page.locator(`#${id}`); if (await field.count() !== 1) return warnings.push(`${id}: not found`); try { await field.fill(String(value)) } catch { warnings.push(`${id}: fill manually`) } }
const upload = async (id, path) => { const field = page.locator(`#${id}`); if (await field.count() !== 1) return warnings.push(`${id}: upload not found`); try { await field.setInputFiles(path) } catch { warnings.push(`${id}: upload manually`) } }
const choose = async (id, labels) => { const field = page.locator(`#${id}`); if (await field.count() !== 1) return warnings.push(`${id}: dropdown not found`); for (const label of labels.filter(Boolean)) { try { if (await field.evaluate((node) => node.tagName === 'SELECT')) { await field.selectOption({ label }); return } await field.click(); const option = page.getByRole('option', { name: label, exact: true }).last(); if (await option.count()) { await option.click(); return } } catch {} } warnings.push(`${id}: choose manually`) }

try {
  await page.goto('https://evisa.gov.vn/e-visa/foreigners/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(1500)
  const p = bundle.payload
  await upload('basic_anhMat', portrait); await upload('basic_anhHoChieu', passport)
  await fill('basic_ttcnHo', p.surname); await fill('basic_ttcnDemVaTen', p.givenNames); await fill('basic_ttcnNgayThangNamSinhStr', officialDate(p.dateOfBirth))
  await choose('basic_ttcnGioiTinh', p.sex === 'male' ? ['Male', 'Nam'] : p.sex === 'female' ? ['Female', 'Nữ'] : []); await choose('basic_ttcnMaQt', [p.nationality])
  await fill('basic_ttcnSoDinhDanh', p.identityNumber); await fill('basic_ttcnEmail', p.email); await fill('basic_ttcnEmailXacNhan', p.email); await fill('basic_ttcnTonGiao', p.religion); await fill('basic_ttcnNoiSinh', p.placeOfBirth)
  await fill('basic_nddnTtdtTuNgayStr', officialDate(p.visaValidFrom)); await fill('basic_nddnTtdtDenNgayStr', officialDate(p.visaValidTo)); await fill('basic_hcSo', p.passportNumber); await fill('basic_hcNoiCap', p.passportIssuingAuthority); await fill('basic_hcNgayCapStr', officialDate(p.passportIssueDate)); await fill('basic_hcGiaTriDenStr', officialDate(p.passportExpiryDate))
  await fill('basic_lhThuongTruDiaChi', p.permanentAddress); await fill('basic_lhDienThoai', p.phone); await fill('basic_lhKhanCapHoTen', p.emergencyName); await fill('basic_lhKhanCapQuanHe', p.emergencyRelationship); await fill('basic_lhKhanCapDiaChi', p.emergencyAddress); await fill('basic_lhKhanCapDienThoai', p.emergencyPhone)
  await fill('basic_nnNgheNghiep', p.occupation); await fill('basic_nnTenCoQuan', p.employerName); await fill('basic_nnDiaChiCoQuan', p.employerAddress); await fill('basic_nnDienThoaiCoQuan', p.employerPhone)
  await fill('basic_tthtMucDichNhapCanh', p.purposeOfEntry); await fill('basic_tthtNgayDuKienNhapCanhStr', officialDate(p.intendedEntryDate)); await fill('basic_tthtThoiGianTamTru', p.stayLengthDays); await fill('basic_tthtDiaChiTamTru', p.temporaryAddress); await choose('basic_tthtTinhThanh', [p.temporaryProvince]); await choose('basic_tthtXaPhuong', [p.temporaryWard]); await choose('basic_tthtCuaKhauNhap', [p.entryGate]); await choose('basic_tthtCuaKhauXuat', [p.exitGate])
  console.log(`Prepared case ${bundle.applicationId}. Review every field in the visible browser.`)
  if (warnings.length) console.log(`Manual checks:\n- ${warnings.join('\n- ')}`)
  console.log('This tool will not click declaration, Next, CAPTCHA, payment, or Submit. Press Enter when the review session is finished.')
  await new Promise((resolve) => process.stdin.once('data', resolve))
} finally { await context.close().catch(() => {}); await browser.close().catch(() => {}); await rm(dir, { recursive: true, force: true }) }
