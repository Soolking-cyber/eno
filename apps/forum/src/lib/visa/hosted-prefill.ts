import 'server-only'

import Browserbase from '@browserbasehq/sdk'
import { chromium, type Locator, type Page } from 'playwright-core'
import type { VisaPayload } from '@/lib/visa/schema'

const OFFICIAL_EVISA_FORM = 'https://evisa.gov.vn/e-visa/foreigners/'
const SESSION_TIMEOUT_SECONDS = 30 * 60

type HostedDocument = {
  buffer: Buffer
  mimeType: string
  name: string
}

export type HostedPrefillSession = {
  id: string
  liveViewUrl: string
  expiresAt: string
  warnings: string[]
  persistentLogin: boolean
}

function browserbase() {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim()
  if (!apiKey) throw new Error('hosted_browser_not_configured')
  return new Browserbase({ apiKey })
}

function projectId() {
  return process.env.BROWSERBASE_PROJECT_ID?.trim() || undefined
}

function governmentContextId() {
  return process.env.BROWSERBASE_CONTEXT_ID?.trim() || undefined
}

function errorCode(error: unknown) {
  if (error instanceof Error && error.message === 'hosted_browser_not_configured') return error
  return new Error('hosted_browser_failed')
}

function officialDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

function passportType(value: VisaPayload['passportType']) {
  return {
    ordinary: 'Ordinary passport',
    diplomatic: 'Diplomatic passport',
    official: 'Official passport',
    other: 'Other',
  }[value]
}

function occupationCategory(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('retir')) return 'Retired'
  if (normalized.includes('student')) return 'Student'
  if (normalized.includes('unemploy')) return 'Unemployed'
  if (normalized.includes('official') || normalized.includes('government')) return 'Official'
  if (normalized.includes('business') || normalized.includes('self-employ') || normalized.includes('entrepreneur')) return 'Businessman'
  return 'Employee'
}

function purposeCategory(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('relative') || normalized.includes('family')) return 'Visiting relatives'
  if (normalized.includes('work')) return 'Working'
  if (normalized.includes('business')) return 'Business'
  if (normalized.includes('tour')) return 'Tourist'
  return 'Other'
}

async function fill(page: Page, id: string, value: string | number | null | undefined, warnings: string[]) {
  if (value === '' || value == null) return
  const field = page.locator(`#${id}`)
  if (await field.count() !== 1) return warnings.push(`${id}: field changed on the official form`)
  try {
    await field.fill(String(value))
  } catch {
    warnings.push(`${id}: review and fill manually`)
  }
}

async function upload(page: Page, id: string, file: HostedDocument, warnings: string[]) {
  const field = page.locator(`#${id}`)
  if (await field.count() !== 1) return warnings.push(`${id}: upload changed on the official form`)
  try {
    await field.setInputFiles(file)
  } catch {
    warnings.push(`${id}: upload manually`)
  }
}

async function clickExactOption(options: Locator, labels: string[]) {
  const texts = await options.allTextContents()
  for (const label of labels.filter(Boolean)) {
    const index = texts.findIndex((text) => text.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase())
    if (index >= 0) {
      await options.nth(index).click()
      return true
    }
  }
  return false
}

async function choose(page: Page, id: string, labels: string[], warnings: string[]) {
  const field = page.locator(`#${id}`)
  if (await field.count() !== 1) return warnings.push(`${id}: dropdown changed on the official form`)
  try {
    await field.click({ force: true })
    const readOnly = await field.getAttribute('readonly')
    for (const label of labels.filter(Boolean)) {
      if (readOnly === null) {
        await field.fill(label)
        await page.waitForTimeout(150)
      }
      const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option-content')
      if (await clickExactOption(options, [label])) return
    }
    await page.keyboard.press('Escape')
    warnings.push(`${id}: choose manually`)
  } catch {
    await page.keyboard.press('Escape').catch(() => undefined)
    warnings.push(`${id}: choose manually`)
  }
}

async function pickDate(page: Page, id: string, value: string, warnings: string[]) {
  if (!value) return
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const field = page.locator(`#${id}`)
  if (!match || await field.count() !== 1) return warnings.push(`${id}: date needs manual review`)
  try {
    const year = Number(match[1])
    const month = match[2]
    await field.click()
    const picker = page.locator('.ant-picker-dropdown:visible')
    await picker.locator('.ant-picker-year-btn').click()
    const decadeText = await picker.locator('.ant-picker-decade-btn').innerText()
    const decadeStart = Number(decadeText.match(/\d{4}/)?.[0])
    if (!Number.isFinite(decadeStart)) throw new Error('date_picker_changed')
    const targetDecadeStart = Math.floor(year / 10) * 10
    const decadeMoves = (targetDecadeStart - decadeStart) / 10
    const direction = decadeMoves < 0 ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn'
    for (let index = 0; index < Math.abs(decadeMoves); index += 1) await picker.locator(direction).click()
    await picker.locator(`td[title="${year}"]`).click()
    await picker.locator(`td[title="${year}-${month}"]`).click()
    await picker.locator(`td[title="${value}"]`).click()
    if (await field.inputValue() !== officialDate(value)) throw new Error('date_not_applied')
  } catch {
    await page.keyboard.press('Escape').catch(() => undefined)
    warnings.push(`${id}: select date manually`)
  }
}

async function chooseRadio(page: Page, question: string, value: '0' | '1', warnings: string[]) {
  const groups = page.locator('.ant-radio-group')
  for (let index = 0; index < await groups.count(); index += 1) {
    const group = groups.nth(index)
    const matches = await group.evaluate((node, expected) => {
      let parent: HTMLElement | null = node as HTMLElement
      for (let depth = 0; depth < 4 && parent; depth += 1, parent = parent.parentElement) {
        if ((parent.innerText || '').toLocaleLowerCase().includes(expected.toLocaleLowerCase())) return true
      }
      return false
    }, question)
    if (!matches) continue
    try {
      await group.locator(`input[value="${value}"]`).check({ force: true })
      return
    } catch {
      break
    }
  }
  warnings.push(`${question}: select manually`)
}

async function fillOfficialForm(page: Page, payload: VisaPayload, portrait: HostedDocument, passport: HostedDocument) {
  const warnings: string[] = []
  await page.goto(OFFICIAL_EVISA_FORM, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.locator('#basic_ttcnHo').waitFor({ state: 'visible', timeout: 30_000 })

  await upload(page, 'basic_anhMat', portrait, warnings)
  await upload(page, 'basic_anhHoChieu', passport, warnings)
  await page.waitForTimeout(750)

  await fill(page, 'basic_ttcnHo', payload.surname, warnings)
  await fill(page, 'basic_ttcnDemVaTen', payload.givenNames, warnings)
  await pickDate(page, 'basic_ttcnNgayThangNamSinhStr', payload.dateOfBirth, warnings)
  await choose(page, 'basic_ttcnGioiTinh', payload.sex === 'male' ? ['Male'] : payload.sex === 'female' ? ['Female'] : [], warnings)
  await choose(page, 'basic_ttcnMaQt', [payload.nationality], warnings)
  await fill(page, 'basic_ttcnCccd', payload.identityNumber, warnings)
  await fill(page, 'basic_ttcnEmail', payload.email, warnings)
  await fill(page, 'basic_ttcnConfirmEmail', payload.email, warnings)
  await fill(page, 'basic_ttcnTonGiao', payload.religion, warnings)
  await fill(page, 'basic_ttcnNoiSinh', payload.placeOfBirth, warnings)

  await chooseRadio(page, 'Have you ever used any other passports to enter into Viet Nam?', payload.usedOtherPassportsForVietnam === 'yes' ? '1' : '0', warnings)
  await chooseRadio(page, 'Do you have multiple nationalities?', payload.hasOtherNationalities === 'yes' ? '1' : '0', warnings)
  await chooseRadio(page, 'Violation of the Vietnamese laws/regulations', payload.hasVietnamLawViolation === 'yes' ? '1' : '0', warnings)
  if (payload.usedOtherPassportsForVietnam === 'yes') warnings.push('Passport previously used for Vietnam: complete the structured official fields from the approved answer')
  if (payload.hasOtherNationalities === 'yes') warnings.push('Other nationalities: complete the structured official fields from the approved answer')
  if (payload.hasVietnamLawViolation === 'yes') warnings.push('Vietnam law history: complete the structured official fields from the approved answer')

  await page.locator('#basic_nddnTtDeNghi').getByText(payload.entryType === 'multiple' ? 'Multiple-entry' : 'Single-entry', { exact: true }).click()
  await pickDate(page, 'basic_nddnTtdtTuNgayStr', payload.visaValidFrom, warnings)
  await pickDate(page, 'basic_nddnTtdtDenNgayStr', payload.visaValidTo, warnings)
  await fill(page, 'basic_hcSo', payload.passportNumber, warnings)
  await fill(page, 'basic_hcNoiCap', payload.passportIssuingAuthority, warnings)
  await choose(page, 'basic_hcLoai', [passportType(payload.passportType)], warnings)
  await pickDate(page, 'basic_hcNgayCapStr', payload.passportIssueDate, warnings)
  await pickDate(page, 'basic_hcGiaTriDenStr', payload.passportExpiryDate, warnings)
  await chooseRadio(page, 'Do you hold any other valid passports', payload.hasOtherPassports === 'yes' ? '1' : '0', warnings)
  if (payload.hasOtherPassports === 'yes') warnings.push('Other valid passport: complete the structured official fields from the approved answer')

  await fill(page, 'basic_ttllDcThuongTru', payload.permanentAddress, warnings)
  await fill(page, 'basic_ttllDcLienHe', payload.permanentAddress, warnings)
  await fill(page, 'basic_ttllSdt', payload.phone, warnings)
  await fill(page, 'basic_ttllLlHoTen', payload.emergencyName, warnings)
  await fill(page, 'basic_ttllLlNoiOHienTai', payload.emergencyAddress, warnings)
  await fill(page, 'basic_ttllLlSdt', payload.emergencyPhone, warnings)
  await fill(page, 'basic_ttllLlQuanHe', payload.emergencyRelationship, warnings)

  await choose(page, 'basic_nnNgheNghiep', [occupationCategory(payload.occupation)], warnings)
  await fill(page, 'basic_nnNgheNghiepHienTai', payload.occupation, warnings)
  await fill(page, 'basic_nnTenCtyCq', payload.employerName, warnings)
  await fill(page, 'basic_nnDiaChi', payload.employerAddress, warnings)
  await fill(page, 'basic_nnSdt', payload.employerPhone, warnings)

  await choose(page, 'basic_ttcdMucDich', [purposeCategory(payload.purposeOfEntry)], warnings)
  await pickDate(page, 'basic_ttcdThoiGianNcStr', payload.intendedEntryDate, warnings)
  await fill(page, 'basic_ttcdSoNgayTamTru', payload.stayLengthDays, warnings)
  await fill(page, 'basic_ttcdSdt', payload.phone, warnings)
  await choose(page, 'basic_ttcdDcTamTru', [payload.temporaryAddress], warnings)
  await choose(page, 'basic_ttcdTinhTp', [payload.temporaryProvince], warnings)
  await choose(page, 'basic_ttcdPhuongXa', [payload.temporaryWard], warnings)
  await choose(page, 'basic_ttcdNcCuaKhau', [payload.entryGate], warnings)
  await choose(page, 'basic_ttcdXcCuaKhau', [payload.exitGate], warnings)

  const hasLocalContact = Boolean(payload.localContactName || payload.localContactAddress || payload.localContactPhone)
  await chooseRadio(page, 'Agency/Organization/Individual that the applicant plans to contact', hasLocalContact ? '1' : '0', warnings)
  if (hasLocalContact) {
    await fill(page, 'basic_cqTcLienHe_0_cqTc', payload.localContactName, warnings)
    await fill(page, 'basic_cqTcLienHe_0_diaChi', payload.localContactAddress, warnings)
    await fill(page, 'basic_cqTcLienHe_0_sdt', payload.localContactPhone, warnings)
    await fill(page, 'basic_cqTcLienHe_0_mucDich', payload.purposeOfEntry, warnings)
  }
  await chooseRadio(page, 'Have you been to Viet Nam in the last 01 year?', payload.visitedVietnamLastYear === 'yes' ? '1' : '0', warnings)
  await chooseRadio(page, 'Do you have relatives who currently reside in Viet Nam?', payload.hasRelativesInVietnam === 'yes' ? '1' : '0', warnings)
  if (payload.visitedVietnamLastYear === 'yes') warnings.push('Previous Vietnam visit: complete the structured official fields from the approved answer')
  if (payload.hasRelativesInVietnam === 'yes') warnings.push('Relatives in Vietnam: complete the structured official fields from the approved answer')

  await fill(page, 'basic_kpbhDuTinh', payload.estimatedExpenses, warnings)
  await choose(page, 'basic_kpbhMuaBaoHiem', [payload.hasTravelInsurance === 'yes' ? 'Yes' : 'No'], warnings)
  await choose(page, 'basic_kpbhNguoiDamBao', [payload.expensesPayer === 'self' ? 'Personal' : 'Company'], warnings)
  await choose(page, 'basic_kpbhHinhThuc', [{
    cash: 'Cash',
    credit_card: 'Credit card',
    travellers_cheques: "Traveller's cheques",
  }[payload.paymentMethod]], warnings)
  if (payload.expensesPayer !== 'self') {
    await fill(page, 'basic_kpbhCongTyTen', payload.payerName, warnings)
    await fill(page, 'basic_kpbhCongTyDiaChi', payload.payerAddress, warnings)
    await fill(page, 'basic_kpbhCongTySdt', payload.payerPhone, warnings)
  }
  warnings.push('Contact address was prefilled from the permanent address; confirm it is still correct')

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  return [...new Set(warnings)]
}

export async function createHostedVisaPrefill(input: {
  payload: VisaPayload
  portrait: HostedDocument
  passport: HostedDocument
}): Promise<HostedPrefillSession> {
  const bb = browserbase()
  const contextId = governmentContextId()
  const session = await bb.sessions.create({
    browserSettings: {
      ...(contextId ? { context: { id: contextId, persist: true } } : {}),
      logSession: false,
      recordSession: false,
      solveCaptchas: false,
      viewport: { width: 1440, height: 900 },
    },
    keepAlive: true,
    projectId: projectId(),
    region: 'ap-southeast-1',
    timeout: SESSION_TIMEOUT_SECONDS,
    userMetadata: { workflow: 'visa-prefill' },
  }).catch((error) => { throw errorCode(error) })

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    browser = await chromium.connectOverCDP(session.connectUrl)
    const context = browser.contexts()[0]
    const page = context.pages()[0] || await context.newPage()
    const warnings = await fillOfficialForm(page, input.payload, input.portrait, input.passport)
    const liveView = await bb.sessions.debug(session.id)
    await browser.close()
    return { id: session.id, liveViewUrl: liveView.debuggerFullscreenUrl, expiresAt: session.expiresAt, warnings, persistentLogin: Boolean(contextId) }
  } catch (error) {
    // Log the real cause server-side — errorCode() deliberately collapses it to an opaque code.
    console.error('[visa-prefill] hosted prefill failed', error)
    await browser?.close().catch(() => undefined)
    await bb.sessions.update(session.id, { status: 'REQUEST_RELEASE', projectId: projectId() }).catch(() => undefined)
    throw errorCode(error)
  }
}

export async function resumeHostedVisaPrefill(sessionId: string): Promise<HostedPrefillSession | null> {
  const bb = browserbase()
  try {
    const session = await bb.sessions.retrieve(sessionId)
    if (!['PENDING', 'RUNNING'].includes(session.status) || new Date(session.expiresAt) <= new Date()) return null
    const liveView = await bb.sessions.debug(sessionId)
    return { id: session.id, liveViewUrl: liveView.debuggerFullscreenUrl, expiresAt: session.expiresAt, warnings: [], persistentLogin: Boolean(governmentContextId()) }
  } catch {
    return null
  }
}

export async function releaseHostedVisaPrefill(sessionId: string) {
  await browserbase().sessions.update(sessionId, { status: 'REQUEST_RELEASE', projectId: projectId() })
}
