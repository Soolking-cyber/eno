'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { correctIdentityAction } from './actions'

const MSG: Record<string, string> = {
  not_found: 'No such record — reload.',
  not_verified: 'Only a VERIFIED record can be corrected here. A pending case goes through the review queue.',
  nationality_invalid: 'Not a country code this app can assess. Use the alpha-3 from the document (ICAO “D” for Germany is accepted). Stateless codes (XXA/XXB/XXC/XXX) are not assessable — leave it blank.',
  residence_invalid: 'Not an ISO alpha-3 country. Unlike nationality, residence does not accept the MRZ alias “D”.',
  note_required: 'Say why. A correction to a compliance record without a reason is not one.',
  // ⛔ NOT A REFUSAL TO WORK — A REFUSAL TO DESTROY. The provider's own KYC established this
  // residence and it is the provenance the payments gate honours; clearing it here would shut the
  // rail with no way back. A wrong provider value has to be corrected at the provider.
  residence_provider_owned: 'That residence came from the payment provider’s own KYC and cannot be cleared here — it would shut the settlement rail with no way to restore it. Correct it at the provider.',
  // ⛔ NOTHING WAS WRITTEN. Something else touched this record mid-correction — most importantly an
  // account erasure, which rewrites the same evidence blob. Reload before retrying: if the record
  // was erased, the reload is what shows it, and a blind retry would be asking to undo a deletion.
  conflict: 'Someone else changed this record while you were correcting it. Nothing was saved — reload and look again before retrying.',
}

/**
 * CORRECT A VERIFIED IDENTITY'S FIELDS. Deliberately NOT part of the review queue: that queue
 * decides pending cases, and this touches records whose decision was already right but whose data
 * was never readable — the state that left production's only verified identity with a NULL
 * nationality and a permanently blocked wallet.
 *
 * ⛔ ONLY THE BOXES THE ADMIN ACTUALLY EDITED ARE SENT, AND SENDING BOTH UNCONDITIONALLY WAS A REAL
 * DEFECT — all three reviewers found it independently on the finished diff (2026-09-09). Both boxes
 * start from the stored value, so an admin fixing ONLY the nationality was silently re-submitting
 * the residence too; the server then saw a residence write and stamped `admin_document_review` over
 * a `provider_kyc` provenance, which is the one source the payments gate honours by default. An
 * operation that changed nothing closed the rail the record already had.
 *
 * ⚠️ IT ALSO CLOSES A STALE-FORM HOLE. This panel is rendered once; if another admin corrects the
 * record while it sits open, submitting would write the value THIS page loaded back over theirs.
 * Untouched fields are now `undefined` — "no opinion" — so a stale form can only overwrite what its
 * author deliberately typed.
 *
 * ⚠️ EMPTY STILL MEANS CLEAR: emptying a box is an EDIT, so it sends `''`, which the server reads as
 * "this document gives no assessable value — null it".
 */
export function CorrectIdentity({ v }: {
  v: { id: string; nationality: string | null; residenceCountry: string | null; residenceSource: string | null }
}) {
  const [open, setOpen] = useState(false)
  const [nat, setNat] = useState(v.nationality ?? '')
  const [res, setRes] = useState(v.residenceCountry ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // ⚠️ WHAT WAS TYPED IN, not what differs from the stored value. An admin who retypes the same
  // code is still asserting it; an admin who never touched the box has said nothing about it.
  const [touched, setTouched] = useState<{ nat: boolean; res: boolean }>({ nat: false, res: false })

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Correct nationality / residence
      </Button>
    )
  }

  // ⛔ CANCEL DISCARDS THE DRAFT — CLOSING THE PANEL USED TO KEEP IT. An admin could type a
  // nationality, cancel, reopen to fix only the residence, and save BOTH — including the change
  // they had just abandoned, because `touched.nat` was still set (codex, on the second diff,
  // 2026-09-09). Cancel now means cancel.
  const cancel = () => {
    setOpen(false)
    setNat(v.nationality ?? '')
    setRes(v.residenceCountry ?? '')
    setNote('')
    setTouched({ nat: false, res: false })
  }

  const submit = async () => {
    setBusy(true)
    try {
      const r = await correctIdentityAction({
        verificationId: v.id,
        ...(touched.nat ? { nationality: nat } : {}),
        ...(touched.res ? { residenceCountry: res } : {}),
        note,
      })
      if (r.ok && r.changed) { toast.success('Corrected.'); location.reload() }
      // ⚠️ A SUCCESSFUL NO-OP IS NOT A CORRECTION. The values already matched, or a residence
      // provenance the payments gate honours was protected from being overwritten with a weaker
      // one — either way nothing was written and no audit row exists, so saying "Corrected." left
      // the admin unable to tell a save from nothing happening (the Opus seat, 2026-09-09).
      else if (r.ok) toast.message('Nothing to change — the record already reads that way.')
      else toast.error(MSG[r.code] ?? r.code)
    } catch {
      /**
       * ⛔ A THROW MUST BE VISIBLE OR THE PANEL LIES BY SILENCE. `correctVerifiedIdentity`
       * deliberately RETHROWS anything that is not a write conflict, so a dropped connection came
       * back here as an unhandled rejection: no toast, `busy` cleared, the form unchanged — an
       * admin cannot tell "it failed" from "it did nothing", which is exactly the distinction this
       * screen exists to make (the Opus seat, on the finished diff, 2026-09-09).
       */
      // ⚠️ "COULD NOT CONFIRM", NOT "NOTHING CHANGED". The throw can happen after the transaction
      // committed — a dropped response, not a rolled-back write — so asserting a rollback would
      // send the admin back to retry on a false premise (codex, on the second diff, 2026-09-09).
      toast.error('Could not confirm whether that saved. Reload and check the record before retrying.')
    } finally { setBusy(false) }
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs" htmlFor={`n-${v.id}`}>Nationality</label>
        <Input id={`n-${v.id}`} value={nat} onChange={(e) => { setNat(e.target.value.toUpperCase().slice(0, 3)); setTouched((t) => ({ ...t, nat: true })) }} className="w-24 font-mono uppercase" />
        <label className="text-xs" htmlFor={`r-${v.id}`}>Residence</label>
        <Input id={`r-${v.id}`} value={res} onChange={(e) => { setRes(e.target.value.toUpperCase().slice(0, 3)); setTouched((t) => ({ ...t, res: true })) }} className="w-24 font-mono uppercase" />
      </div>
      {/*
        ⛔ SAYS WHAT SETTING A RESIDENCE DOES AND DOES NOT DO. Writing it stamps
        `admin_document_review`, which opens nothing until PAYMENTS_ADDRESS_SOURCES names that
        source — an admin who thinks they have just enabled somebody's wallet is worse off than one
        who knows they have recorded a fact awaiting a policy decision.
      */}
      <p className="text-xs text-muted-foreground">
        {/*
          ⚠️ THE SPACES ARE INSIDE THE TAGS ON PURPOSE. JSX drops a newline adjacent to an element,
          so text after a `</code>` at a line break loses its leading space and rendered
          "PAYMENTS_ADDRESS_SOURCESlists it" to every admin (the Opus seat, 2026-09-09).
        */}
        Only the boxes you edit are sent. Setting a residence stores source
        <code> admin_document_review </code>
        , which is inert until
        <code> PAYMENTS_ADDRESS_SOURCES </code>
        lists it. Current source: {v.residenceSource ?? 'none'}. Empty a box to clear that field.
      </p>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — recorded on the compliance record" />
      <div className="flex gap-2">
        <Button type="button" variant="cta" size="sm" disabled={busy || !note.trim() || (!touched.nat && !touched.res)} onClick={() => void submit()}>Save correction</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={cancel}>Cancel</Button>
      </div>
    </div>
  )
}
