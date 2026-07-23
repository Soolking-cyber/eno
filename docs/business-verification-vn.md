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
company. That gap is why the single business badge (owner: one badge, granted only after
verification — no two-tier system) needs **at least two independent verification channels**
(owner-confirmed), one of which proves *control*, not just existence: a bank account whose
holder name matches the registered company (the endorsed default), or a human-reviewed
registration document. Registry-check-alone is not a second channel — it answers the same
"is it real?" question off the same source.

> ⚠️ **THE ONE MISTAKE NOT TO MAKE (both external reviewers, independently — codex GPT-5.6
> + Gemini): a registry match is NOT an identity check.** Every fact VietQR returns is
> *public* — a fraudster can copy Vinamilk's MST, legal name and address off the web and
> pass a registry check to wear a trusted corporate identity. The registry check answers
> "is this a real registered company?" It does **not** answer "does the person upgrading
> control it?" With a SINGLE business badge (owner decision — see below), the verification
> that gates it **must** answer the second question too, or the one badge is spoofable.

## The verification — ONE badge, granted only after ≥2 channels pass (owner, 2026-07-23)

**One state, one gate — but the gate needs at least TWO independent channels** (owner:
"of course at least 2 diff verification channels, bank name is a good one"). An account is
either *individual* or *business*, with no intermediate tier and no second badge; it flips
to *business* only after verification, and stays *individual* until then. Registry-check-
alone is explicitly **not enough** — it is public data anyone can copy — so verification
requires two channels that answer two different questions, and they must be *independent*
(a forger would have to defeat both, not one). The default pair:

**Channel 1 — Registry (is the company REAL?).** `GET api.vietqr.io/v2/business/{taxCode}`:
the MST exists, the returned `name` fuzzy-matches `legalName` (normalize diacritics + case),
the `address` fuzzy-matches (street+number only — see the landmine), and `status` is
`NNT đang hoạt động`. A body `code == '51'` **routes to the official registry check**
(option 2), never a hard fail — VietQR lags ~1 month, so a `51` can be a just-registered
company or a Casso omission. Only a `51` the official registry ALSO can't find, for a
company claiming >1 month of existence, is a real fail.

**Channel 2 — Ownership binding (does THIS user CONTROL it?).** The owner-endorsed proof is
**a bank account whose holder name matches the registered legal name** — the seller links a
payout account anyway, so it adds no friction and directly ties the person to the company.
This is the channel a registry lookup can never provide: a scammer can read Vinamilk's MST
off the web, but cannot produce a bank account in Vinamilk's name.

**Channel 3 (fallback / higher assurance) — Document upload, human-reviewed.** A photo of
the ERC (Enterprise Registration Certificate) or hộ-kinh-doanh registration certificate,
cross-checked by an ops person against the Channel-1 registry data. Use it when Channel 2
can't apply (see the HKD note) or as a third channel for high-value sellers, and as the
place a ~$0.80 **official paid extract** (option 4) is pulled for disputes.

**The rule: at least two of these pass, and one of the two is the ownership binding
(Channel 2 or a human-reviewed Channel 3).** Two "is it real?" signals (VietQR + official
registry) are NOT two channels for this purpose — they answer the same question off the
same source; the second channel must prove *control*. Only then does the account become a
business account. Store the address the seller entered as their *declaration* — don't
hard-block on an exact match (see the landmine).

⚠️ **Segment split — hộ kinh doanh (business households).** Many upgrading sellers are HKD,
not enterprises: the registry (Channel 1) covers them only partially, and their "bank
account" is usually a *personal* account in the proprietor's name. So for HKD, match
Channel 2 against the **proprietor's name** (not a company name), and lean on **Channel 3
(the HKD certificate, human-reviewed)** as the primary "is it real?" signal when VietQR
returns `51`. Design the flow so an HKD that fails the enterprise lookup is routed to
document review, never hard-rejected.

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

Settled (owner, 2026-07-23): **one badge, granted only after verification, and the
verification is ≥2 independent channels — one of which is the bank-name ownership binding.**
The remaining calls before any build:
1. **How to run the bank-name channel.** Two options: (a) *name-match at payout setup* — we
   already hold the payout account's holder name, so compare it to the registered legal
   name (free, but only as trustworthy as how the bank name was captured); (b) a **VietQR
   `lookup` / bank-transfer-name API or a 1₫ penny-name-check** to read the account holder's
   real registered name from the bank. (b) is stronger and worth pricing.
2. **The channel set per segment.** Enterprises: Channel 1 (registry) + Channel 2
   (bank-name = legal name). Hộ kinh doanh: Channel 3 (HKD certificate, human-reviewed) +
   Channel 2 (bank-name = proprietor name), since the registry covers HKD only partially.
   Confirm this split, and whether a document-upload channel is built now or deferred.
3. **Worth a T-VAN trial** (option 5, DPA-able official channel) over the keyless private
   mirror for the registry channel? Recommended for production; VietQR is the right *pilot*.

**Next step when the owner greenlights a build:** this stops being a research doc and
becomes an implementation plan — at which point it gets the both-ends reviewer pair (codex
+ Gemini) on the plan before any code, per the standing rule. The shared `WardPicker` /
account-type-switch surfaces it touches are the same ones the earlier handoff flagged for a
second opinion.

## Review trail

Dual external review, both families (owner's standing reviewer pair, 2026-07-23):
- **codex GPT-5.6 (sol, high)** and **Gemini** independently returned the SAME top finding
  — granting a business badge on a registry match alone is a control failure (public data,
  spoofable). The owner then set the shape: ONE badge, granted only after verification, no
  two-tier system — so that finding lands as "the single verification must include an
  ownership binding," not "add a second gate." Also adopted: the PDPL/DPA caveat on the
  Casso call, the FATF correction, and softening `code:'51'` from "proof of nonexistence"
  to "route to the official check".
- **Refuted with evidence:** Gemini flagged the "63→34 provinces" and "MPI merged into MoF"
  claims as hallucinations. Web-verified against primary reporting — Resolution
  202/2025/QH15 (63→34 provinces, district tier abolished, effective 2025-07-01) and Decree
  29/2025/ND-CP (MPI merged into the Ministry of Finance, Feb 2025) — **both are correct**;
  Gemini's training predates the mid-2025 reforms, and the live VietQR probe (Vinamilk's
  address as a ward directly under Hồ Chí Minh City, no district) corroborates. The
  address-matching landmine stands.

_All live claims probed 2026-07-23 from this machine; raw artifacts under the session
scratchpad. Re-verify endpoints before building — this is a fast-moving government surface._
