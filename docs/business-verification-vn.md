# Automatic business verification for Vietnam — options & recommendation

**Status: RESEARCH ONLY. No code built.** The owner asked whether an individual→business
upgrade can be *automatically* verified, cheaply/freely and securely. This is the answer,
with every load-bearing claim live-probed on 2026-07-23 (public companies only — Vinamilk
`0300588569`, Viettel `0100109106` + branch `-011`, FPT `0101248141`; no individual tax
IDs touched). Build only after an owner nod, and put the chosen design through the
both-ends second opinion first (this is a trust gate on money-adjacent accounts).

## Bottom line

**Vietnam has no official public API for business verification.** The one real
machine-readable enterprise-registration API (NGSP/LGSP) is government-to-government and
needs a data-sharing agreement eno.vn cannot get at this stage. Everything automatable is
either a **private mirror** of the tax registry (best option — VietQR), an **undocumented
official endpoint** (best-effort secondary — the registry portal's autocomplete), or a
**scraper/aggregator** (unsafe for a trust decision). The authoritative live source (GDT)
is a captcha-gated form behind a WAF — usable by a human, never by our server.

**What the free automated path can honestly prove:** *"this tax code (MST) exists in the
tax registry, matches the legal name and (fuzzily) the address the seller entered, and was
active as of about a month ago."* **What no cheap automated source proves:** the legal
representative's identity, or that the person clicking "upgrade" is connected to the
company. If that matters — and it does before payouts — it needs a separate ownership
proof (a bank account in the company name, or a one-off official extract), not a registry
lookup.

> ⚠️ **THE ONE MISTAKE NOT TO MAKE (both external reviewers, independently — codex GPT-5.6
> + Gemini): a registry match is NOT an identity check, so it must NOT auto-grant a
> "verified business" badge or any risk-bearing privilege.** Every fact VietQR returns is
> *public* — a fraudster can copy Vinamilk's MST, legal name and address off the web and
> pass this check to wear a trusted corporate identity, defrauding buyers long before any
> payout. The registry check answers "is this a real registered company?" It does **not**
> answer "does the person upgrading control it?" Those are two different gates, and the
> badge belongs to the second one.

## Recommended pipeline (two gates, not one)

**Gate A — "registry-matched" (instant, free, low-trust).** On the upgrade form, `GET
api.vietqr.io/v2/business/{taxCode}`, then:
   - **Mark the account `registry-matched`** — NOT "verified business" — when the MST
     exists, the returned `name` fuzzy-matches `legalName` (normalize diacritics + case),
     the `address` fuzzy-matches (street+number only — see the address landmine), and
     `status` is `NNT đang hoạt động`. This unlocks *self-declared business presentation*
     (a business display name, the business fields) but confers **no trust badge and no
     money privileges** on its own.
   - **Route to the official check** (Gate A-official — the registry autocomplete, option
     2), never hard-fail, when body `code == '51'` (not found). VietQR is a private mirror
     with no completeness guarantee and a ~1-month lag: a `51` can mean not-found, a
     just-registered company, or a Casso omission — none of which is proof of nonexistence.
     A `51` that the official registry also can't find, for a company claiming >1 month of
     existence, is the only real fail.

**Gate B — "verified business" (the badge + payouts). REQUIRES OWNERSHIP PROOF.** This is
where the trust signal is earned, and the cheapest safe proof is **control of a bank
account whose holder name matches the registered legal name** — the seller already links a
payout account, so this adds no new friction and directly binds the person to the company.
A name mismatch, or a representative/charter question, escalates to a **human reviewing a
paid official extract** (option 4, ~$0.80). Only Gate B grants the badge and the money-
bearing limits.

**Everywhere:** store the address the seller entered as their *declaration*; don't block on
an exact match (see the landmine). The verification ceiling of the free path is
name+MST+status — never present it as more.

This gives an instant, free, zero-friction "registry-matched" state for the common case,
a soft official path for brand-new companies, and reserves the actual trust badge for a
cheap ownership proof the seller was going to give anyway — without buying a KYB seat or
scraping anything, and without ever handing a fraudster a badge for public data.

## The options, ranked

| # | Option | Fitness | Cost | Automatable | Confidence |
|---|---|---|---|---|---|
| 1 | **VietQR Tax ID Lookup** (`api.vietqr.io/v2/business/{taxCode}`) | **Best free auto-check** | Free (keyless) | ✅ yes | verified-live |
| 2 | **NBRP registry autocomplete** (`dangkykinhdoanh.gov.vn` .ashx) | Best-effort secondary | Free | ⚠️ brittle | verified-live |
| 3 | **GDT lookup** (`tracuunnt.gdt.gov.vn`) | Human/admin fallback only | Free | ❌ captcha+WAF | verified-live |
| 4 | **Official paid extract** (`dichvuthongtin.dkkd.gov.vn`) | Escalation for high-risk | ~20–40k₫/doc (~$0.80–1.60) | ❌ manual order | documented |
| 5 | **T-VAN e-invoice APIs** (XInvoice/Viettel/VNPT/MISA) | Possible upgrade over VietQR | "free" tier (unverified) | ✅ (signup) | documented |
| 6 | esgoo.net free MST API | Tiebreaker only — **data years stale** | Free | ✅ but unsafe | verified-live |
| 7 | masothue.com + clones | Human convenience link only | Free (ads) | ❌ Cloudflare/poisoned search | verified-live |
| 8 | Commercial KYB (Didit ~$2/check, Sumsub, Trulioo…) | Only if AML/UBO later needed | $ per check | ✅ | documented |
| 9 | NGSP/LGSP gov API | The "real" API — unreachable for us | n/a | gov-to-gov only | documented |
| 10 | thongtindoanhnghiep.co | **DEAD** — don't resurrect | — | — | verified-live |

## Option details (the ones that matter)

### 1. VietQR Tax ID Lookup — the recommended free auto-check
- **Operator:** Casso (a private Vietnamese fintech, `cas.so`) — **not** NAPAS, **not**
  government. A self-declared mirror of GDT data, refreshed ~monthly.
- **Access:** public keyless JSON. `GET https://api.vietqr.io/v2/business/{taxCode}`.
  Verified from this machine: a match returns
  `{code:'00', data:{id,name,internationalName,shortName,address,status}, metadata:{source:'https://www.gdt.gov.vn', updatedAt, disclaimer}}`;
  not-found returns **HTTP 200** with body `code:'51'`. 10-digit enterprise codes and
  13-digit branch codes (`…-011`) both work.
- **Verifies:** MST existence, legal name, address (new post-2025 format), and status
  (`NNT đang hoạt động`). Returns **no** legal representative and **no** charter capital.
- **Cost / auth:** free, no registration, no headers.
- **Risks:** a private third party with no ToS on the free tier — could paywall, add auth,
  or vanish. Data lags ~1 month (hence the "route to official check" branch, not a hard
  fail). Rate-limit threshold unpublished → cache per-MST, one call per upgrade attempt.
  ⚠️ **NOT "no PII" (external review):** the record carries a legal/proprietor name (and for
  hộ kinh doanh, a natural person's name), and sending every upgrade MST to Casso is a
  **disclosure to a third party**. Under the PDPL (Decree 13/2023 → 2025 PDPL) that needs a
  lawful basis, notice, minimization, and — for a processor relationship at any real volume
  — a data-processing agreement Casso's free tier does not offer. It also leaks eno.vn's
  conversion metrics to an unaccountable party. Treat the free tier as fine for a pilot;
  a production trust gate wants the T-VAN option (5) or a contracted provider with a DPA.

### 2. National Business Registration Portal — official corroboration (best-effort)
- **Operator:** the Business Registration Management Agency (now under the Ministry of
  Finance after the 2025 MPI merger). The only free official source that *shows* the legal
  representative's name.
- **Access (live-verified automatable slice):** an undocumented autocomplete —
  `POST https://dangkykinhdoanh.gov.vn/_layouts/15/NCS.Control.QTDKDN/Ajax/SorlSearchEnterpriseName.ashx`
  with `searchField=<MST|name>`, `lang=vn`, and an `h` token scraped from the homepage
  (~15-min lifetime; expired → body `RELOAD`). Response is a JS array literal with unquoted
  keys (needs a tolerant parser). Full-detail pages are ASP.NET WebForms postbacks that
  don't server-render results — those need a headless browser (don't).
- **No captcha** on basic search (two live probes — this overrides a secondhand "captcha"
  claim in one 2026 guide). Only the short-lived token.
- **Risks:** undocumented SharePoint internals, no ToS grant, breaks on portal upgrades,
  token scraping is brittle. **⚠️ TLS defect:** the server sends a leaf-only cert chain
  (`curl` exit 60) — pin the *GlobalSign RSA OV SSL CA 2018* intermediate for this host;
  **never** `rejectUnauthorized:false`. Build it as a signal that can silently degrade,
  never the sole gate.

### 3. GDT taxpayer lookup — human/admin only
- Authoritative, *current* (VietQR mirrors it). But: public web form with a **mandatory
  image captcha** on every query, behind an **F5 BIG-IP WAF** that returned a 245-byte
  "Request Rejected" to a non-browser client, on a leaf-only TLS chain. There is no JSON
  backend in the page. An ecosystem of paid captcha-solvers exists *for this site* — proof
  it actively fights automation. **Use exactly one way:** an ops person opens it in a
  browser for spot-checks/disputes. Automating it means buying captcha-breaking against a
  government WAF — a non-starter for a trust feature.

### 4. Official paid extract — the escalation with paper
- Same registry agency, official paid channel; **legally citable** output. The full record
  incl. legal representative and charter capital. **~20,000₫** (~$0.80) per ERC info copy,
  **40,000₫** for registration-file docs/financials (Circular 47/2019/TT-BTC). Manual web
  order + per-doc payment, days turnaround — **not automatable**, but cheap, fully
  official, and the right escalation for high-risk sellers or disputes.

### 5. T-VAN e-invoice provider APIs — the one worth a trial
- Licensed e-invoice providers (XInvoice, Viettel, VNPT, MISA) expose GDT-sourced taxpayer
  lookups, e.g. `GET https://api.xinvoice.vn/gdt-api/tax-payer/{taxCode}` with
  `client-id` + `api-key` headers issued on signup. Advertised "free"; freshness *may* beat
  VietQR's monthly snapshot (unproven). **Same integration shape as VietQR** — worth a
  registration experiment as the possible official-channel upgrade. Not probed (signup-gated).

### 6–7. esgoo.net / masothue.com — NOT for automated decisions
- **esgoo.net** (`GET esgoo.net/api-mst/{mst}.htm`): free, fast, *nominally* carries the
  rep name VietQR lacks — but live-probed **years stale** (returned Viettel's 2022-departed
  representative, pre-2025 addresses). Free tiebreaker at most; a mismatch against it must
  **never** auto-reject.
- **masothue.com** (+ clones): richest human page, sometimes fresher than VietQR — but web
  only, **Cloudflare-challenged** on every path in one probe, with a deliberately
  **poisoned `/Search/` redirect**. Fine as a link shown to ops; a wrong-company match
  wired into a trust decision is worse than no data. Serves rep-name/phone PII.

### 8–10. KYB vendors / NGSP / dead ends
- **Commercial KYB** (Didit ~$2/check, Sumsub, Trulioo, ComplyCube, AsiaVerify; local CRIF
  D&B Vietnam, VietnamCredit, FiinGroup): real money per free-upgrade attempt. Note
  Vietnam has **no public UBO registry**, so vendor "UBO coverage" numbers are
  reconstructions from other sources. (FATF does not require a *public* UBO registry — it
  requires competent authorities to be able to obtain adequate, accurate, timely
  beneficial-ownership information; Vietnam's 2023 grey-listing was broader than this one
  gap. Corrected per external review.) Sensible only if eno.vn later needs
  AML/sanctions/UBO screening — overkill for "does this MST match this name".
- **NGSP/LGSP:** the real gov API exists — gov-to-gov only. The endgame if eno.vn ever
  reaches the scale to negotiate access.
- **thongtindoanhnghiep.co:** dead (HTTP 000). OpenCorporates: partial, lagging VN. Don't
  re-litigate these.

## Engineering landmines (for whoever builds it)

- **VietQR returns errors as HTTP 200** with a body `code` (`'51'` = not found). **Parse
  the body code, never the HTTP status.**
- **Address matching:** the **1 July 2025** merger of 63 provinces into 34 rewrote every
  registered address. VietQR serves the new format (`Phường Cầu Giấy, TP Hà Nội`); esgoo
  and many user documents carry the old (`Quận Cầu Giấy`). Exact-string address comparison
  **will** false-negative — fuzzy-match street+number, treat ward/district as advisory, or
  verify name+MST strictly and store the address as declared.
- **The MST *is* the ERC enterprise code** (same 10-digit number for enterprises); branches
  add a 3-digit suffix (`…-011`). One input field verifies both; VietQR handles the
  13-digit format.
- **Segment caveat:** many upgrading sellers will be **hộ kinh doanh** (business
  households), which the NBRP covers only partially and whose HKD tax registrations may not
  appear in VietQR/esgoo — design the flow to *not* hard-reject an HKD that fails the
  enterprise lookup.
- **Gov TLS:** both `tracuunnt` and `dangkykinhdoanh` serve **leaf-only cert chains** —
  pin/bundle the GlobalSign intermediate; never disable TLS verification.
- **PII (Decree 13/2023 → 2025 PDPL, effective 2026):** legal-representative names and any
  CCCD-based search are personal data. Avoid the personal-TIN path (`mstcn.jsp`) and CCCD
  search entirely; store lookup results with that in mind.
- **Government churn:** the 2025 restructuring merged MPI into the Ministry of Finance and
  reorganized GDT into the Tax Department. All domains still resolve as of 2026-07-23, but
  expect endpoint/branding moves — the dkkd `.ashx` especially can vanish on a portal
  upgrade. Whatever we build on option 2 must fail soft.

## What to decide

The owner's call before any build:
1. **Two gates or one?** The recommendation is the two-gate split above: a free instant
   *registry-matched* state (no badge), and a *verified-business* badge that requires the
   bank-name ownership proof. Or: keep it single-gate and accept that the badge means only
   "a real company's public details were entered" (weaker, and both reviewers flagged it as
   a fraud vector).
2. **Does the badge carry money privileges?** If a verified business gets higher limits or
   payout access, Gate B (ownership proof) is mandatory, not optional.
3. **Worth a T-VAN trial** (option 5) as the official-channel, DPA-able upgrade over the
   keyless private mirror? Recommended for production; VietQR is the right *pilot*.

## Review trail

Dual external review, both families (owner's standing reviewer pair, 2026-07-23):
- **codex GPT-5.6 (sol, high)** and **Gemini** independently returned the SAME top finding
  — auto-approving a "verified business" on a registry match alone is a control failure —
  which reshaped the pipeline into the two-gate design above. Also adopted: the PDPL/DPA
  caveat on the Casso call, the FATF correction, and softening `code:'51'` from "proof of
  nonexistence" to "route to the official check".
- **Refuted with evidence:** Gemini flagged the "63→34 provinces" and "MPI merged into MoF"
  claims as hallucinations. Web-verified against primary reporting — Resolution
  202/2025/QH15 (63→34 provinces, district tier abolished, effective 2025-07-01) and Decree
  29/2025/ND-CP (MPI merged into the Ministry of Finance, Feb 2025) — **both are correct**;
  Gemini's training predates the mid-2025 reforms, and the live VietQR probe (Vinamilk's
  address as a ward directly under Hồ Chí Minh City, no district) corroborates. The
  address-matching landmine stands.

_All live claims probed 2026-07-23 from this machine; raw artifacts under the session
scratchpad. Re-verify endpoints before building — this is a fast-moving government surface._
