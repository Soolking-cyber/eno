'use client'

// ⚠️ DEV-ONLY HARNESS — not linked from anywhere, and it exists because the two things that keep
// breaking in KYC (the camera's layout, and whether the MRZ actually autofills) cannot be seen from
// the real page without a signed-in session AND a live single-use challenge. That gap is why camera
// changes kept shipping on reasoning instead of on a look. This mounts the capture component alone,
// with the uploads stubbed, so the layout and the on-device read can be driven locally in a browser.
//
// ⛔ NOTHING HERE TOUCHES PRODUCTION DATA. `onUploaded` is a no-op and no challenge is issued, so
// nothing can be submitted; the OCR path is the real one.

import { useEffect, useState } from 'react'
import { KycCapture } from '@/components/marketplace/kyc-capture'
import { readMrz, namesFromNameLine, type MrzReadResult } from '@/lib/identity/mrz-ocr'
import { createMrzOcrEngine } from '@/lib/identity/mrz-ocr-tesseract'

const TITLE = 'KYC capture preview (dev)'
const BLURB = 'Document capture + the real on-device MRZ read. Uploads are stubbed.'

export default function KycPreviewPage() {
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<MrzReadResult | null>(null)
  const push = (s: string) => setLog((l) => [...l, s])

  // ⚠️ A DIRECT HANDLE ON THE READ, so the pipeline can be exercised against a KNOWN image without
  // a camera, a permission prompt or a capture. `window.__kycRead(imageData)` → the same readMrz the
  // real flow calls. Dev route only.
  useEffect(() => {
    ;(window as unknown as { __kycRead?: unknown }).__kycRead = async (img: ImageData) => {
      const eng = createMrzOcrEngine()
      try {
        await eng.ready()
        const t0 = performance.now()
        const r = await readMrz(img, eng.engine)
        const ms = Math.round(performance.now() - t0)
        const names = r.ok && !r.mrz.fields.surname ? namesFromNameLine(r.pool.nameLine) : {}
        return {
          ok: r.ok,
          ms,
          attempts: r.attempts,
          variantIndex: r.ok ? r.variantIndex : null,
          reason: r.ok ? null : r.reason,
          fields: r.ok ? r.mrz.fields : null,
          pooled: r.ok ? null : r.pool,
          nameFromPool: names,
          lines: r.ok ? r.lines : null,
        }
      } finally { void eng.terminate() }
    }
  }, [])

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* Built in JS — the repo forbids bare string literals in JSX (react/jsx-no-literals), which is
          how every user-facing string stays translatable. A dev route is no exception to the lint. */}
      <h1 className="text-lg font-bold">{TITLE}</h1>
      <p className="text-sm text-muted-foreground">{BLURB}</p>

      <KycCapture
        kind="document"
        guide="passport"
        alt="Preview"
        // The harness mirrors what the real caller passes, so the in-frame label is visible here too.
        frameLabel="Passport photo page"
        onUploaded={(path) => push(`uploaded → ${path}`)}
        onImage={async (img) => {
          if (!img) { push('onImage: null (decode failed)'); return }
          push(`still ${img.width}×${img.height}`)
          const eng = createMrzOcrEngine()
          try {
            await eng.ready()
            push('engine ready')
            const r = await readMrz(img, eng.engine)
            setResult(r)
            push(r.ok
              ? `OK via ${r.variantIndex === -1 ? 'fusion' : `variant ${r.variantIndex}`} in ${r.attempts} calls`
              : `${r.reason} in ${r.attempts} calls; recovered ${Object.keys(r.pool).join(',') || 'none'}`)
            if (r.ok) {
              const names = r.mrz.fields.surname ? {} : namesFromNameLine(r.pool.nameLine)
              push(`surname=${r.mrz.fields.surname ?? names.surname ?? '—'} given=${r.mrz.fields.givenNames ?? names.givenNames ?? '—'}`)
              push(`number=${r.mrz.fields.passportNumber ?? '—'} expiry=${r.mrz.fields.passportExpiryDate ?? '—'}`)
            }
          } catch (e) {
            push(`EXCEPTION ${e instanceof Error ? e.message : String(e)}`)
          } finally {
            void eng.terminate()
          }
        }}
      />

      <pre className="whitespace-pre-wrap break-all rounded-lg bg-black/90 p-3 font-mono text-xs text-success">
        {log.join('\n') || 'waiting…'}
      </pre>
      {result?.ok && (
        <pre className="whitespace-pre-wrap break-all rounded-lg border p-3 font-mono text-xs">
          {result.lines[0]}
          {'\n'}
          {result.lines[1]}
        </pre>
      )}
    </div>
  )
}
