'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { approveIdentityAction, refreshIdentityCapturesAction, rejectIdentityAction } from './actions'

/**
 * ONE CASE, WITH THE TWO CAPTURES AND THE TWO DECISIONS. EN-only admin chrome.
 *
 * ⛔ THE CAPTURES ARE INLINE NOW, AND THAT REVERSES A DELIBERATE RULE — read this before undoing it.
 * They opened in a new tab on the reasoning that an `<img src={signedUrl}>` puts a passport
 * photograph into the page's own DOM and any screenshot of the admin screen, and that making the
 * act of looking a separate click keeps it a visible decision. Owner, 2026-09-06: *"in admin
 * verification show photo and passport here and enable fullview mode so admin can quickly verify
 * no need for doenloading"*. Reviewing a queue by opening two tabs per case and tabbing back to
 * compare a six-character code against handwriting is how a reviewer starts approving on half the
 * evidence, so the exposure buys real accuracy rather than only convenience.
 *
 * ⚠️ WHAT DID NOT CHANGE, AND MUST NOT. The URLs are the same short-lived signed links the route
 * already returned, the route is `auth: 'admin'`, and its response is `no-store`. Inline rendering
 * widens no permission — the same admin could already open the same URL. `referrerPolicy="no-referrer"`
 * is on every image for the reason the old links carried `noreferrer`: codex flagged signed URLs as
 * bearer credentials, and the storage host must not receive the admin page's URL.
 *
 * ⚠️ `rel="noopener noreferrer"` STAYS on the full-view escape hatch for the same reason.
 *
 * ⛔ THE CAPTURES ARE ONE CASE WIDE; THE CONTACT LINE IS NOT, AND BOTH HALVES OF THAT ARE ON PURPOSE.
 * The queue renders every pending panel at once, so "inline" without `loading="lazy"` meant one
 * screenshot or screen-share carried every waiting applicant's PASSPORT AND SELFIE at the same
 * time — a genuinely different exposure from the one the owner asked for, which was about not
 * downloading the case in front of you. ⚠️ LAZY NARROWS THAT; IT DOES NOT BOUND IT TO ONE CASE, and
 * two reviewers were right to say so. `loading="lazy"` is a scheduling hint: browsers fetch some
 * distance ahead of the viewport, several panels fit on a tall screen, and a capture stays decoded
 * in the document after it scrolls away. So the true claim is "the cases a reviewer has actually
 * worked", not "the one in front of them". If that is ever too much, the fix is to mount captures
 * only for a selected case — not another attribute.
 * The email and phone still render eagerly for all fifty, because they are one short line the
 * reviewer scans to match an account and there is nothing to defer; say that plainly rather than
 * claiming a blanket "one case wide" the code does not deliver. If that line ever becomes a
 * problem, the fix is the same one: render it only for the case being worked.
 */

const ERROR_TEXT: Record<string, string> = {
  not_pending: 'No longer pending — someone else already decided this one.',
  not_found: 'Case not found.',
  expired_at_review: 'Cannot approve: the document is inside the six-month validity floor measured from TODAY. It was valid at submission and is not now.',
  duplicate_identity: 'Cannot approve: this identity is already verified on another account.',
  still_pending: 'The decision did not stick — reload and try again.',
  evidence_unavailable: 'Cannot approve: the captures for this case can no longer be produced. Use “Reload captures”; if they still fail, reject with a reason.',
  failed: 'Something went wrong. Nothing was changed.',
}

export function IdentityReviewPanel({ item }: {
  item: {
    id: string
    tier: string
    fullName: string | null
    nationality: string | null
    documentExpiresAt: string | null
    submittedAt: string
    method: string
    documentUrl: string | null
    selfieUrl: string | null
    expectedNote: string
    checksPassed: string[]
    email: string | null
    phone: string | null
    accountName: string | null
  }
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  /** Which capture is open full-screen, if any. */
  const [full, setFull] = useState<null | { url: string; label: string }>(null)
  /** Survives `full` going null so the closing animation still has a title and an image. */
  const [lastFull, setLastFull] = useState<null | { url: string; label: string }>(null)
  /**
   * ⛔ THE FULL VIEW'S OWN FAILURES, KEPT OUT OF `dead`. Writing them into `dead` made the comment
   * beside that handler a lie and did real damage: the dialog mounts a SECOND request for the same
   * URL, so one transient failure of the large fetch replaced a thumbnail the reviewer had been
   * looking at successfully with an error box and disabled Approve underneath it.
   */
  const [fullDead, setFullDead] = useState<Record<string, true>>({})
  /**
   * ⛔ WHICH CAPTURES ARE ACTUALLY ON SCREEN. Gating approval on "not known-dead" was not the same
   * promise as "the reviewer has seen the evidence", and `loading="lazy"` made the gap wide: a case
   * below the fold has not requested its images at all, so no `onError` has fired, `dead` is empty
   * and Approve was live under two grey boxes.
   *
   * ⛔ AND IT IS SET FROM A REF, NOT ONLY FROM onLoad — THE onLoad-ONLY VERSION WAS WORSE THAN THE
   * HOLE IT CLOSED. This panel is server-rendered, so an in-viewport image starts fetching before
   * hydration; React attaches its listeners at hydration and cannot see a `load` that already
   * fired (facebook/react#15446). The fast, first-in-queue cases — the ones actually worked — would
   * have shown two perfectly good captures with Approve permanently disabled and no banner, since
   * nothing had failed. The ref reads `complete`/`naturalWidth`, which are facts about the element
   * rather than an event that may already be gone, and the handlers stay for the images that
   * complete after hydration.
   */
  const [loaded, setLoaded] = useState<Record<string, true>>({})
  /**
   * A server refusal (`evidence_unavailable`) also summons the recovery control. Nothing the
   * BROWSER sees is wrong in that state — both thumbnails loaded from cache while the object behind
   * them was purged — so without this the message says "use Reload captures" beside no such button.
   */
  const [serverRefusedEvidence, setServerRefusedEvidence] = useState(false)

  /** Marks an image loaded or dead from the element itself, immune to the hydration race above. */
  function settleImage(el: HTMLImageElement | null, url: string) {
    if (!el || !el.complete) return
    if (el.naturalWidth > 0) setLoaded((l) => (l[url] ? l : { ...l, [url]: true }))
    else setDead((d) => (d[url] ? d : { ...d, [url]: true }))
  }
  /**
   * ⛔ A CAPTURE THAT FAILED TO LOAD IS AS UNJUDGEABLE AS ONE THAT WAS NEVER THERE, AND ONLY THIS
   * STATE MAKES THE TWO LOOK ALIKE. The panel below promises that "absent captures are stated, not
   * hidden", but it tested `url !== null` only — and these are SHORT-LIVED signed URLs
   * (`REVIEW_URL_TTL` is 600s). Work a queue for eleven minutes, scroll to a case, and the browser
   * draws its own broken-image glyph inside a `bg-muted` box: not a stated absence, just a picture
   * that looks like it is still loading. That is exactly the half-evidence approval the promise
   * exists to prevent.
   *
   * ⚠️ KEYED BY URL, NOT BY LABEL, SO A REFRESH ACTUALLY CLEARS IT. Keying on "Document"/"Selfie"
   * made the failure permanent for the life of the panel: a freshly signed link would mount into a
   * slot still marked dead and never render. Keying on the URL means a new signature is a new key
   * and recovers by construction.
   */
  const [dead, setDead] = useState<Record<string, true>>({})
  /** Freshly minted links, replacing the ones the server rendered with, per capture. */
  const [resigned, setResigned] = useState<{ documentUrl: string | null; selfieUrl: string | null } | null>(null)
  const [resigning, setResigning] = useState(false)

  /**
   * ⛔ THE ONLY RECOVERY FROM AN EXPIRED CAPTURE THAT DOES NOT DESTROY WORK. "Reload the page" was
   * the previous answer and it discards every rejection note typed into the other fifty panels.
   * This re-mints both links for THIS case; a null back means the case or the account is gone,
   * which the grid already renders as "cannot judge this case".
   */
  async function reloadCaptures() {
    setResigning(true)
    try {
      const fresh = await refreshIdentityCapturesAction(item.id)
      /**
       * ⛔ AN ALL-NULL ANSWER IS DISCARDED, NOT ADOPTED — ADOPTING IT BRICKED THE PANEL. `resigned`
       * shadows `item` for the life of the component, so writing two nulls into it moved both
       * captures to the "unavailable" branch, which has no Reload button: the reviewer was left in
       * a terminal state whose only exit was the page reload this feature exists to avoid, over a
       * lapsed session or a momentary database blip. Keeping the old links costs nothing (they were
       * already failing) and keeps the retry reachable.
       */
      if (!fresh.documentUrl && !fresh.selfieUrl) {
        /**
         * ⚠️ DO NOT BLAME THE SESSION FOR A MISSING OBJECT. The action returns the same two nulls
         * for "not an admin any more", "case no longer pending" and "the evidence is gone", by
         * design — a distinguishable refusal here would confirm a case id is real. So the message
         * must name the possibilities rather than assert the one that flatters the reviewer, or a
         * purged capture sends them round the Reload button for ever chasing an auth problem they
         * do not have.
         */
        toast.error('Could not produce the captures — the case may no longer be pending, the files may be gone, or your admin session may have lapsed. Try again shortly before deciding this case.')
        return
      }
      /**
       * ⚠️ A PARTIAL ANSWER KEEPS THE HALF IT COULD NOT RE-SIGN — AND KEEPS THE CURRENT ONE, NOT THE
       * ORIGINAL. Adopting `{ documentUrl: fresh, selfieUrl: null }` wholesale turned a working
       * selfie into "unavailable" on the strength of one failed signature; falling back to
       * `item.selfieUrl` was the next version's bug, since after one successful refresh that is the
       * OLDER, already-expired link. Each side falls back to whatever is currently in force.
       *
       * ⚠️ `dead`/`loaded` ARE NOT CLEARED, DELIBERATELY. They are keyed by URL, so a freshly signed
       * link is a fresh key that starts in neither map; wiping them instead cleared the entries for
       * a link that was kept, which is how an expired capture came back looking healthy with
       * Approve enabled underneath it.
       */
      const next = {
        documentUrl: fresh.documentUrl ?? docUrl,
        selfieUrl: fresh.selfieUrl ?? selfUrl,
      }
      /**
       * ⚠️ CLEAR THE INCOMING URLS' KEYS EXPLICITLY. Recovery otherwise rests on the signer always
       * returning a DIFFERENT string, and a signature minted twice inside the same second can
       * repeat: the identical URL would land in a slot still marked dead and never render, so the
       * one button that fixes things would appear to do nothing. Only the two keys being adopted
       * are dropped — every other entry is still a true record of a link that failed.
       */
      const forget = (m: Record<string, true>) => {
        const copy = { ...m }
        // ⛔ ONLY THE URLS THE SIGNER ACTUALLY RETURNED. Iterating `next` cleared the failure record
        // of the capture that could NOT be re-signed — the one still carrying its old, expired link
        // — so a known-broken image was remounted looking healthy and Approve came back with it.
        // A kept fallback keeps its history; a fresh signature has none to keep.
        for (const u of [fresh.documentUrl, fresh.selfieUrl]) if (u) delete copy[u]
        return copy
      }
      setDead(forget)
      setFullDead(forget)
      setResigned(next)
      /**
       * ⚠️ ONLY A COMPLETE RE-SIGN CLEARS THE SERVER'S REFUSAL. Clearing it on a PARTIAL answer
       * re-enabled Approve while one capture was still the old, refused link — so the reviewer
       * clicked into the same 409 and the banner that would have explained it had just been
       * dismissed by the click that caused it.
       */
      if (fresh.documentUrl && fresh.selfieUrl) setServerRefusedEvidence(false)
    } catch {
      toast.error('Could not refresh the captures for this case.')
    } finally {
      setResigning(false)
    }
  }

  /**
   * ⛔ APPROVAL IS GATED ON THE EVIDENCE BEING ON SCREEN, BECAUSE OTHERWISE THE STATED ABSENCE IS
   * DECORATION. The grid says "cannot judge this case" and then left Approve enabled underneath it,
   * which is the half-evidence approval this whole panel is built to prevent — a reviewer who
   * scrolled past two red boxes could still approve. Reject stays enabled on purpose: a case whose
   * documents cannot be produced is exactly a case a reviewer should be able to turn down, and it
   * already requires a written reason.
   */
  const docUrl = resigned ? resigned.documentUrl : item.documentUrl
  const selfUrl = resigned ? resigned.selfieUrl : item.selfieUrl
  /**
   * TWO DIFFERENT QUESTIONS, AND CONFLATING THEM PUT A RED BANNER ON EVERY UNSCROLLED CASE.
   * `captureFailed` is "something is wrong and there is a way out" — a link that was never there, a
   * fetch that errored, or a server refusal — and it is what summons the recovery control.
   * `evidenceMissing` is the stricter "the reviewer has not actually seen both captures", which
   * also covers the lazy case not yet scrolled to. Approval waits for the second; the banner
   * answers only the first, so a case below the fold looks calm rather than broken.
   *
   * ⚠️ `fullDead` IS IN NEITHER. It marks a failure of the SECOND, full-size fetch for a thumbnail
   * that is on screen and fine. Feeding it into these disabled Approve underneath an image the
   * reviewer was reading successfully — the exact regression the handler's own comment promises it
   * does not cause. It shows its message inside the dialog and nowhere else.
   */
  const captureFailed =
    !docUrl || !selfUrl ||
    !!dead[docUrl] || !!dead[selfUrl] ||
    serverRefusedEvidence
  const evidenceMissing = captureFailed || !loaded[docUrl] || !loaded[selfUrl]
  /**
   * ⛔ THE RECOVERY CONTROL IS SUMMONED BY A WIDER CONDITION THAN THE ONE THAT BLOCKS APPROVAL, and
   * getting that backwards is the mistake this line exists to correct. `fullDead` must NOT disable
   * Approve — the thumbnail is on screen and fine, and blocking on the second fetch's failure is
   * the regression the handler promises it does not cause — but the dialog's own message tells the
   * reviewer to press Reload, so it absolutely must make the button appear. Three reviewers found
   * the same dead end twice, from both directions; these are two questions and they get two names.
   */
  const anyFullDead = (!!docUrl && !!fullDead[docUrl]) || (!!selfUrl && !!fullDead[selfUrl])
  const recoveryOffered = captureFailed || anyFullDead

  /**
   * ⛔ RECOVERY IS ALWAYS REACHABLE, NOT ONLY FROM THE STATE THAT NOTICED THE PROBLEM. The Reload
   * control used to render only inside the branch for a thumbnail whose own `onError` had fired,
   * and three reviewers found the same two holes: a thumbnail that decoded at minute 2 and failed
   * its full-size fetch at minute 12 (`fullDead`, thumbnail still alive), and a server refusal of
   * `evidence_unavailable` — both print text telling the reviewer to use a button that was not on
   * the screen. The only exit was the page reload this whole feature exists to avoid. It hangs off
   * `captureFailed` above, which every one of those states sets.
   */
  

  const act = async (decision: 'approve' | 'reject') => {
    setBusy(true)
    try {
      const res = decision === 'approve'
        ? await approveIdentityAction(item.id)
        : await rejectIdentityAction(item.id, note)
      if (res.ok) {
        toast.success(res.status === 'verified' ? 'Approved.' : 'Rejected.')
        location.reload()
      } else {
        /**
         * ⛔ THE SERVER'S "cannot produce the captures" MUST REACH THE BANNER, or its own message
         * names a button that is not on the screen. This is the state nothing in the browser can
         * see: both thumbnails painted from cache while the object behind them was purged or the
         * account deleted, so no `onError` ever fires and `dead` stays empty. Without this line the
         * reviewer reads "use Reload captures", finds nothing, and clicks Approve into a 409 for
         * ever — page reload or Reject being the only exits.
         */
        if (res.code === 'evidence_unavailable') setServerRefusedEvidence(true)
        toast.error(ERROR_TEXT[res.code] ?? res.code)
      }
    } finally {
      setBusy(false)
    }
  }

  // ⚠️ TIER IS SHOWN FIRST AND IN WORDS. A reviewer who assumes every case is a passport will mark
  // a perfectly valid CCCD down for lacking an MRZ and a six-month expiry it never had.
  const tierLabel = item.tier === 'A' ? 'Tier A — Vietnamese CCCD' : 'Tier B — foreign passport'

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{item.fullName || '(no name read)'}</p>
          {/*
            ⚠️ THE ACCOUNT NEXT TO THE DOCUMENT, because the mismatch is the thing a reviewer is
            actually looking for: a passport in one name submitted from an account in another is
            the case this queue exists to catch, and until now it could only be found by leaving
            the page. Selectable text, not links — a mailto: or tel: from an admin screen invites a
            reviewer to contact an applicant out of band, which is not this queue's job.
          */}
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Account:</span>{' '}
            {item.accountName || '(no display name)'}
            {' · '}
            <span className="select-all font-mono">{item.email || 'no email'}</span>
            {' · '}
            <span className="select-all font-mono">{item.phone || 'no phone'}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {tierLabel} · {item.nationality || 'nationality not read'} · submitted{' '}
            {new Date(item.submittedAt).toISOString().slice(0, 16).replace('T', ' ')}
          </p>
        </div>
        <Badge variant={item.tier === 'A' ? 'brand' : 'outline'}>{item.method}</Badge>
      </div>

      <dl className="grid gap-2 rounded-xl bg-tint p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Document expires</dt>
          <dd className="font-medium">{item.documentExpiresAt?.slice(0, 10) ?? 'not read'}</dd>
        </div>
        <div>
          {/*
            ⛔ THE ONE THING THE REVIEWER IS ACTUALLY CHECKING BY EYE. The selfie must show this exact
            code written on paper and held by the person. It is what makes the pair of images harder
            to forge than either alone — a stolen passport photo cannot produce it.
          */}
          <dt className="text-xs text-muted-foreground">Code that must appear in the selfie</dt>
          <dd className="font-mono font-semibold tracking-widest">{item.expectedNote}</dd>
        </div>
      </dl>

      {item.checksPassed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Automatic checks passed: {item.checksPassed.join(', ')}
        </p>
      )}

      {/*
        ⚠️ ABSENT CAPTURES ARE STATED, NOT HIDDEN. A missing one is a case that cannot be judged;
        silently rendering one panel instead of two would let a reviewer approve on half the
        evidence without noticing the other half was never there.
      */}
      {recoveryOffered && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 px-3 py-2 text-xs text-destructive">
          {/*
            ⚠️ ONE MESSAGE, AND IT ASSERTS NO CAUSE. A null link means any of: nothing was ever
            submitted, the path is not the profile's, the account was deleted, or storage refused to
            sign — and the panel cannot tell which, deliberately, because a distinguishable answer
            would confirm a case id is real. A version of this line guessed "never submitted" and
            told the reviewer reloading could not help, next to a reload button that often would
            have. Name the recovery and the fallback; leave the diagnosis alone.
          */}
          {/*
            ⚠️ IT DOES NOT RECOMMEND REJECTION. An earlier version ended "if it still fails, reject
            with a reason", and a reviewer whose links died during a storage blip would have been
            steered into refusing a valid applicant's identity over an outage. Refusal is always
            available and always requires a written reason; it does not need encouraging from a
            banner that cannot tell an outage from a deletion. The server can tell, and only its
            `evidence_unavailable` — not this — means the evidence is actually gone.
          */}
          <span>A capture is not showing. Signed links last 10 minutes — try reloading.</span>
          <Button variant="outline" size="sm" disabled={resigning} onClick={() => void reloadCaptures()}>
            {resigning ? 'Reloading…' : 'Reload captures'}
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ['Document', docUrl],
          ['Selfie', selfUrl],
        ] as const).map(([label, url]) => (
          <figure key={label} className="space-y-1">
            <figcaption className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{label}</span>
              {/* Hidden once the link is known dead: it points at the same expired signature and
                  would send the reviewer to a storage error page dressed as an escape hatch. */}
              {url && !dead[url] && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  Open in a tab
                </a>
              )}
            </figcaption>
            {url && !dead[url] ? (
              // The image IS the control: clicking it opens the full view, which is the whole point
              // of showing it here rather than sending the reviewer to a download.
              <button
                type="button"
                onClick={() => { setFull({ url, label }); setLastFull({ url, label }) }}
                aria-label={`View ${label.toLowerCase()} full screen`}
                className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border bg-muted"
              >
                {/* ⚠️ A PLAIN <img>, NOT next/image, AND DELIBERATELY: these are signed short-lived
                    storage URLs, and next/image would proxy them through our own optimizer and CACHE
                    someone's passport on the server. The eslint rule that would object is not on. */}
                <img
                  /**
                   * ⛔ `key={url}` SO A RE-SIGNED LINK GETS A NEW ELEMENT. Without it React reuses
                   * the mounted node, and the ref below then reads the PREVIOUS image's
                   * `complete`/`naturalWidth` — marking the new URL loaded before its fetch has
                   * even started, which re-enables Approve over a capture nobody has seen. A new
                   * key means a new node with `complete === false`, so the ref abstains and the
                   * handlers decide.
                   */
                  key={url}
                  src={url}
                  alt={`${label} capture awaiting review`}
                  referrerPolicy="no-referrer"
                  /**
                   * ⛔ LAZY BECAUSE THE QUEUE RENDERS EVERY PENDING CASE AT ONCE — NOT to protect the
                   * TTL, which an earlier version of this comment claimed and had exactly backwards:
                   * a signature expires on the wall clock whether or not anyone fetches it, so
                   * deferring a fetch can only ever land it CLOSER to expiry. That is a real cost and
                   * it is paid for deliberately, with `Reload captures` below as the recovery.
                   * What lazy buys: `listKycQueue()` takes up to 50 cases and each panel holds two
                   * captures, so eager loading fires up to a hundred full-resolution passport and
                   * selfie requests the moment the tab opens — the browser evicts and re-requests
                   * under that load — and it decodes every waiting applicant's documents into one
                   * page, so a single screenshot or screen-share carries all of them. The owner
                   * asked not to download the case in front of them; that is not the same as
                   * publishing the whole queue to the framebuffer.
                   */
                  loading="lazy"
                  decoding="async"
                  ref={(el) => settleImage(el, url)}
                  onLoad={() => setLoaded((l) => ({ ...l, [url]: true }))}
                  onError={() => setDead((d) => ({ ...d, [url]: true }))}
                  className="h-56 w-full object-contain"
                />
              </button>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-destructive/40 px-3 text-center text-xs text-destructive">
                <span>
                  {url
                    ? `${label} could not be loaded — use Reload captures above.`
                    : `${label} unavailable — cannot judge this case`}
                </span>
              </div>
            )}
          </figure>
        ))}
      </div>

      {/*
        FULL VIEW, ON THE Dialog PRIMITIVE. ⛔ IT WAS A HAND-ROLLED `fixed inset-0` DIV AND THAT WAS
        WRONG THREE WAYS AT ONCE — all four reviewers landed on it, and the justification written
        beside it ("it must not trap focus behind a scrollable body") described the problem Dialog
        exists to solve rather than a reason to avoid it. (1) Nothing moved focus into the overlay,
        so `aria-modal` hid the still-focused thumbnail from assistive tech while Tab walked into
        Approve and Reject behind a passport filling the screen — an irreversible KYC decision taken
        blind. (2) It rendered inside `<Card className="space-y-4">` rather than a portal, so it
        inherited the sibling margin and any transformed ancestor would have clipped "full screen"
        to the card. (3) No scroll lock. Dialog portals, traps, restores focus and locks scroll, and
        it already closes on Escape and on the backdrop, which is every behaviour the comment
        claimed as the reason for hand-rolling.
        `object-contain` so a passport is never cropped — a cropped MRZ is the one thing that would
        send the reviewer back to downloading.
      */}
      <Dialog open={!!full} onOpenChange={(open) => { if (!open) setFull(null) }}>
        {/* ⚠️ `flex flex-col` IS REQUIRED — DialogContent's own class list is `grid`, so the image's
            `min-h-0 flex-1` below would have done nothing and a tall passport would have overflowed
            the 92vh box with no scroll. */}
        <DialogContent className="flex h-[92vh] max-w-[min(96vw,1400px)] flex-col gap-3 p-4 sm:max-w-[min(96vw,1400px)]">
          <DialogHeader>
            {/* ⚠️ `lastFull`, NOT `full` — Dialog animates its exit, and reading `full` here rendered
                "undefined — full view" for the length of that animation on every close. */}
            <DialogTitle className="text-sm font-semibold">{lastFull?.label} — full view</DialogTitle>
          </DialogHeader>
          {lastFull && (
            <>
              {/* Plain <img> for the reason given on the thumbnail above: never cache a passport. */}
              <img
                src={lastFull.url}
                alt={`${lastFull.label} capture, full view`}
                referrerPolicy="no-referrer"
                /**
                 * ⛔ A FAILURE HERE MUST NOT CLOSE THE DIALOG OR CONDEMN THE THUMBNAIL. It did both:
                 * this mounts a second request for the same URL, so a transient failure or a
                 * non-cacheable response would flip `dead` and replace an image the reviewer was
                 * looking at successfully with an error, while yanking the dialog — and with it the
                 * "Open in a tab" escape hatch — out from under them. `fullDead` is a separate map
                 * so this really does mark only itself.
                 */
                onLoad={() => setFullDead((d) => { if (!d[lastFull.url]) return d; const { [lastFull.url]: _gone, ...rest } = d; return rest })}
                onError={() => setFullDead((d) => ({ ...d, [lastFull.url]: true }))}
                className="min-h-0 flex-1 object-contain"
              />
              {fullDead[lastFull.url] && (
                <p className="shrink-0 text-center text-xs text-destructive">
                  This capture would not load. Close and use “Reload captures” at the top of the case.
                </p>
              )}
              {/* Hidden on a dead capture for the same reason as the caption link: it points at the
                  identical failing signature and reads as an escape hatch that is not one. */}
              {!fullDead[lastFull.url] && (
                <a href={lastFull.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-center text-xs text-muted-foreground underline hover:text-foreground">
                  Open in a tab
                </a>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="space-y-2">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason — required to reject. SHOWN TO THE SELLER (hub, bell, email): write it to them, in their language (Vietnamese for a CCCD), never about them"
          rows={2}
        />
        <div className="flex gap-2">
          {/*
            ⚠️ THE SERVER DECIDES, THE BUTTON ONLY REPORTS. Approve is refused server-side when the
            document is inside the validity floor measured from TODAY or the identity is already
            verified elsewhere — `reviewKycCase` re-runs the whole decision rather than reading back
            what submission concluded. Disabling on `!note` is a courtesy; the real rule is in
            `rejectIdentityAction`.
          */}
          <Button variant="cta" size="sm" disabled={busy || evidenceMissing} onClick={() => void act('approve')}>
            Approve
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !note.trim()} onClick={() => void act('reject')}>
            Reject
          </Button>
        </div>
      </div>
    </Card>
  )
}
