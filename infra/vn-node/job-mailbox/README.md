# eno · job mailbox reader

Reads **LinkedIn job-alert emails** and **job posts the eno team forwards** ("JOB: …") from `alex@eno.vn`'s INBOX on the
VN box and hands them to the app's private job-post store (`POST /api/cron/job-posts` → `ExternalJobPost`), where the
teacher job-DM matcher picks them up. Part of the teacher job DMs (owner, 2026-10-20; plan
`~/eno-jobmatch-2026-10/PLAN.md`, v2 "MAIL").

| File | What |
|---|---|
| `eno-job-mailbox.py` | the reader — a host script, Python 3.12 standard library only (the host has no node, no pip) |
| `eno-job-mailbox.service` | oneshot unit: `/usr/bin/python3 -I /opt/eno/bin/eno-job-mailbox.py` |
| `eno-job-mailbox.timer` | every 30 minutes, 07:00–21:00 Vietnam time (written in UTC) |
| `test_eno_job_mailbox.py` | `python3 -B -m unittest -v test_eno_job_mailbox` (no network, no docker) |

## What it reads — and what it never touches

- ⛔ **One mailbox, read-only, no password.** Every mail call is
  `docker exec mailcowdockerized-dovecot-mailcow-1 doveadm …` with `-u alex@eno.vn`, mailbox `INBOX`, and only
  `mailbox status`, `search` and `fetch`. The script refuses any other doveadm command before docker starts. It never
  expunges, moves, flags, marks read or delivers anything: the team sees every message exactly as it arrived. The
  mailbox is a constant in the code, not a setting.
- ⛔ **Only two kinds of mail are ever candidates**, selected by the server-side search: mail **From** LinkedIn's
  saved-search alert sender `jobalerts-noreply@linkedin.com`, and mail with **Subject "JOB"** from a team address.
  Nothing else in the inbox is fetched. (LinkedIn's "jobs you may be interested in" mail — `jobs-listings@`,
  `jobs-noreply@` — is left out: it is not tied to an alert's search or place. The setting below can add it, with the
  Gmail filter's From widened to match.) The searches match substrings, so a stranger's mail with a team address in its
  display name is a candidate too: it is fetched (within the size cap) and dropped on its exact From — a candidate,
  never a post.
- ⛔ **Authenticated or skipped.**
  - LinkedIn: **the script's own DKIM check** — a valid `linkedin.com` signature that covers `From` **and** `To` (no
    `l=`), and `To` is our LinkedIn account `vietnameno@gmail.com` (exactly, capitals aside — a `+tag` or dotted
    spelling reaches our Gmail but can be another LinkedIn member's account) or `alex@eno.vn`, so an alert someone
    else subscribed to cannot be replayed in. The alerts reach `alex@eno.vn` through a Gmail filter's automatic
    forward, which resends the message unchanged — LinkedIn's signature still verifies (below: "LinkedIn alerts").
    **No `Authentication-Results` header is trusted**: outside mail reaches mailcow through Cloudflare → `eno-inbound-bridge`
    → `mx.eno.vn:465` as `bridge@eno.vn`, an *authenticated* submission, for which rspamd checks nothing and may write
    no header at all — and then a sender's own "dkim=pass" header would sit exactly where ours would. The check needs
    DNS (the host's resolver) for LinkedIn's key; DNS down = the alert is held and tried again each run, for up to
    `ENO_JOB_MAILBOX_GIVE_UP_HOURS` (below). At most 3 linkedin.com signatures are checked per message, so a forged
    mail full of them cannot turn one run into hundreds of DNS lookups.
  - Team: this server's Postfix hop must be an authenticated submission (`ESMTPSA`, `(Authenticated sender: x@eno.vn)`)
    by an address on the team list, and From must be that same address. `bridge@eno.vn` is never a team sender.
  - Both: a malformed header block, or a From/Subject/Date/Content-Type… that appears twice, is refused (DKIM signs the
    last copy of a field, the MIME parser reads the first — a replayed real alert with a second Subject would verify).
- **Size cap** 200 KB per message (bigger ones are skipped and logged). Text part preferred, HTML turned into text
  otherwise, attachments never read.
- **Logs** (journald) carry UIDs, counts, LinkedIn job ids, hashes, team addresses and reasons — never a body, a
  subject or an exception message.

It sends: LinkedIn — one post per job (`externalKey` = the job id, `url` = `https://www.linkedin.com/jobs/view/<id>/`
with every tracking parameter dropped, `title`/`company`/`locationText`, the alert's search as `sourceRef`, the email's
Date as `postedAt`). ⛔ Every link in an alert carries the recipient's own tokens (`midToken`, `midSig`, `otpToken`), so
nothing is ever taken from a link but the job id. Team — one post per email (`externalKey` = sha256 of the Message-ID,
the body as `text` with forwarded-header blocks, quoted replies and the sender's `-- ` signature cut, the `Apply:` line
as `applyText`, the subject after "JOB:" as `title`, `lang` vi/en). A forward without an `Apply:` line is still sent;
the server holds it as "no application path".

## LinkedIn alerts — the account and Gmail's forward (the owner, once)

The alerts come from the LinkedIn account **vietnameno@gmail.com** (owner, 2026-10-21). LinkedIn emails alerts only to an
account's **primary** address, so they land in that Gmail, and a Gmail filter forwards them, unchanged, to `alex@eno.vn`.
LinkedIn first, then Gmail: the "alert created" mails LinkedIn sends while the alerts are set up then stay in the
Gmail (a filter only acts on mail that comes after it), and the first thing forwarded is the next day's alerts.

**1 · LinkedIn** — signed in to the vietnameno@gmail.com account:

1. Me → **Settings & Privacy** → Sign in & security → **Email addresses**: `vietnameno@gmail.com` is **Primary**.
2. Settings & Privacy → **Notifications** → Searching for a job → **Job alerts**: Email on.
3. For each alert: **Jobs** → the keywords, and the location picked from the suggestions → switch the results page's
   **job alert** toggle on → **Manage alerts** → **Daily**, **Email** → Done.

| Keywords | Location |
|---|---|
| English teacher | Vietnam |
| ESL teacher | Vietnam |
| IELTS teacher | Vietnam |
| Teacher | Ho Chi Minh City |
| Teacher | Hanoi |
| Teacher | Da Nang |

At most 20 alerts per account. Since 2026 an alert lists jobs by meaning, not only by its words, so it brings
non-teaching jobs too — the app's own reading of each post decides what is a teaching job.

**2 · Gmail** — on a computer, signed in as vietnameno@gmail.com:

1. ⚙ → **See all settings** → **Forwarding and POP/IMAP** → **Add a forwarding address** → `alex@eno.vn` → Next →
   Proceed → OK.
2. Google mails `alex@eno.vn` a confirmation (from `forwarding-noreply@google.com`; it waits in alex@'s INBOX — this
   reader never touches it). Click its link, or type its code into the same tab → **Verify**.
3. Leave **Disable forwarding** selected on that tab: "Forward a copy of incoming mail" would send *all* of the
   account's mail. The filter does the forwarding:
4. Search bar → **Show search options** (the sliders) → From: `jobalerts-noreply@linkedin.com` → **Create filter** →
   tick **Forward it to:** `alex@eno.vn` and **Never send it to Spam** → **Create filter**. (Gmail never forwards what it
   files as Spam.)

- ⚠️ **Never test with Gmail's Forward button** (or "Forward as attachment"): it writes a NEW message, LinkedIn's
  signature no longer verifies, and the reader skips it. Only the filter's automatic forward keeps the message intact.
- ⚠️ **LinkedIn switches off an alert nobody has opened for 3 months, and writes two weeks before.** Nobody opens
  these. That mail, like its "alert created / deleted" mails, comes from the alert address, so it is forwarded too: the
  reader logs `LINKEDIN NOTICE <id>`, and from then on every run exits 5 and prints `LINKEDIN NOTICE waiting … <id>
  (uid=…)` until a person has read it — alex@'s webmail, or the Gmail — clicked what it asks, and run the command that
  line ends with: `python3 -I /opt/eno/bin/eno-job-mailbox.py --ack-notices <id>[,<id>…]`. Only the ids given are
  acknowledged (one that came later keeps waiting), and an acknowledged notice is never raised again — not by a
  `--since-days` re-read, not after the mailbox is rebuilt: its id is its Message-ID's. (Should LinkedIn ever send the
  warning from another address, the next point still catches the switch-off.)
- ⛔ **A silent LinkedIn fails every run.** 7 days without a LinkedIn alert with jobs — counted from the newest one
  read, or from the reader's first run until one comes — log `LINKEDIN SILENT` and exit 5 on every run until alerts
  come again, so the unit stays in `systemctl --failed`: the alerts switched off, the filter deleted, the forward
  stopped, the account's primary address changed, or a setup that never worked. So set the alerts up within a week of
  the first run (`ENO_JOB_MAILBOX_LINKEDIN_SILENT_DAYS`, below; `0` = off, e.g. if the LinkedIn alerts are dropped on
  purpose).

## Install (on the box, after the deploy that ships `/api/cron/job-posts`)

```bash
# as root, from the checkout — the units run the installed COPY, never the checkout (a deploy rewrites it)
install -m 0755 /opt/eno/app/infra/vn-node/job-mailbox/eno-job-mailbox.py /opt/eno/bin/eno-job-mailbox.py
install -m 0644 /opt/eno/app/infra/vn-node/job-mailbox/eno-job-mailbox.{service,timer} /etc/systemd/system/
install -d -m 0700 /var/lib/eno/job-mailbox
systemctl daemon-reload

# 1. a dry run first: reads the last 3 days, prints every message's verdict and the posts it WOULD send;
#    sends nothing, saves nothing (Gmail's forward set up longer ago? add --since-days N, up to 60)
python3 -I /opt/eno/bin/eno-job-mailbox.py --dry-run

# 2. then the timer, and one run now
systemctl enable --now eno-job-mailbox.timer
systemctl start eno-job-mailbox.service && journalctl -u eno-job-mailbox.service -n 50 --no-pager
systemctl list-timers 'eno-job-mailbox*'
```

Every deploy refreshes the installed copy and the units from its commit once they are installed (eno-deploy.sh step
13 — never the first install, and the timer stays enabled or not as it is).

## First run — what to look for

The dry run prints one line per message: `uid=<n> <linkedin|team>: <posts|skip|retry> — <reason>`.

- **No LinkedIn alerts yet** is normal until Gmail's forward and the alerts exist ("LinkedIn alerts", above). Nothing to
  do here; the timer picks them up when they arrive.
- **LinkedIn `posts … (auth: own DKIM check d=maild.linkedin.com …)`** (or `d=linkedin.com`) — working. LinkedIn signs
  twice; either signature is enough.
- **LinkedIn `posts — LINKEDIN NOTICE, no job in it (template …)`** — LinkedIn wrote from the alert address without
  jobs: an alert made or deleted (expected right after setting them up), the 3-month switch-off warning, or a layout
  this reader no longer reads. Open it in alex@'s webmail, then run the `--ack-notices <id>` command the `waiting` line
  prints (until then every run exits 5). If it is an ordinary alert with jobs, report it: it was read as done, so once
  the reader is fixed, `--since-days N` reads it again.
- **The first alert that arrives through the filter is the real test** of the whole path — Gmail's forward, Cloudflare,
  the bridge, mailcow: the tests only prove that headers added on top cannot break the check. Expect its
  `posts … (auth: own DKIM check …)` line in a dry run before relying on the feed. (Google's forwarding confirmation
  arriving in alex@'s INBOX already proves Gmail → Cloudflare → the bridge → mailcow.)
- **LinkedIn `skip — not authenticated as LinkedIn — own DKIM check: body hash mismatch`** — the message was changed
  on its way in, so no DKIM check can pass: a test with Gmail's Forward button (use the filter), or the bridge. Look at
  the bridge Worker only once a filter-forwarded alert shows it.
- **LinkedIn `skip — not authenticated as LinkedIn — own DKIM check: To is not signed`** — LinkedIn's signature does not
  cover `To`, so the replay rule cannot be checked and no alert is read. Report it (the rule needs a change in the code);
  do not work around it.
- **LinkedIn `skip — … signed, but not addressed to vietnameno@gmail.com or alex@eno.vn`** — the alerts belong to
  another LinkedIn account, or that account's primary address is another one (LinkedIn → Settings & Privacy → Email
  addresses). Only alerts to our account are read. If LinkedIn writes OUR address another way (a dot, a `+tag`), report
  it: `LINKEDIN_ALERT_TO` in the script is changed after a look — never loosened to "anything our Gmail receives".
- **No LinkedIn alerts at all, though LinkedIn says it sends them** — in the Gmail: the filter's **Never send it to
  Spam** and its forward to `alex@eno.vn` (Gmail's Spam is never forwarded). Then alex@eno.vn's **Junk** folder: only
  INBOX is read — move one back to INBOX and mark the sender as not spam; the next run reads it.
- **Once alerts arrive, check that the server-side search finds them** (a full-text index that tokenises addresses
  could return nothing, and the reader would never know): the count from
  `docker exec mailcowdockerized-dovecot-mailcow-1 doveadm search -u alex@eno.vn mailbox INBOX FROM jobalerts-noreply@linkedin.com | wc -l`
  must match the alerts you see in the inbox.
- **Team test**: from `lap@eno.vn` (webmail or a mail app on `mx.eno.vn`) send `alex@eno.vn` a mail with subject
  `JOB: test` and a body with an `Apply:` line, then dry-run again: expect `team: posts — 1 post, with Apply: line
  (submitted by lap@eno.vn)`. If it says `not an authenticated submission` or `no authenticated sender`, this
  Postfix does not record the SASL login on that path (`smtpd_sasl_authenticated_header`) — read the hop with the
  header block before changing anything:
  `docker exec mailcowdockerized-dovecot-mailcow-1 doveadm fetch -u alex@eno.vn hdr mailbox INBOX UID <uid> | grep -A6 '^Received'`.
  ⚠️ A forward skipped this way is not read again on its own: once the cause is fixed, `--since-days N` re-reads it.
- The test mail stays in the inbox (this script deletes nothing); delete it by hand.
- **`skip — too big (… bytes > 204800)`** on LinkedIn alerts: raise `ENO_JOB_MAILBOX_MAX_KB` (Settings), then
  `--since-days 3` to read them again.

## For the team — how to forward a job post

Send it **from your own eno.vn mailbox** to `alex@eno.vn`:

- Subject: `JOB: ` and a short title — `JOB: English teacher, Quận 7, weekends`.
- Body: **paste the post's text** — no screenshot or attachment: they cannot be read, and a mail over 200 KB is
  skipped whole.
- One line saying how to apply: `Apply: Zalo 0901 234 567 (Ms Lan)` / `Apply: hr@school.edu.vn` /
  `Apply: https://forms.gle/…`. Without it the post is kept but never sent to a teacher.
- One job per email. Mail from Gmail or any other address is ignored, even if it says it is from you.

## Settings

All optional — `/etc/default/eno-job-mailbox` (`KEY=value` lines; the unit reads it) — then nothing to restart:

| Variable | Default | |
|---|---|---|
| `ENO_JOB_MAILBOX_TEAM` | lap, danh, quynh, anh, thao, bao, support, alex, will, freya `@eno.vn` | who may forward (replaces the list; `bridge@eno.vn` is always removed) |
| `ENO_JOB_MAILBOX_LINKEDIN_SENDERS` | `jobalerts-noreply@linkedin.com` | linkedin.com addresses only (replaces the list) |
| `ENO_JOB_MAILBOX_LINKEDIN_SILENT_DAYS` | `7` | days without a LinkedIn alert with jobs (from the newest, or from the first run) before every run fails with `LINKEDIN SILENT` (0 = off, up to 60) |
| `ENO_JOB_MAILBOX_MTA_HOSTS` | `mail.eno.vn mx.eno.vn` | Postfix's `myhostname` (the Received "by") |
| `ENO_JOB_MAILBOX_MAX_KB` | `200` | per-message cap (16–10240) |
| `ENO_JOB_MAILBOX_GIVE_UP_HOURS` | `24` | how long a held message (a rejected post, or LinkedIn's key not found because DNS is down) is tried again before it is given up (1–720) |
| `ENO_JOB_MAILBOX_STATE` | `/var/lib/eno/job-mailbox/state.json` | the checkpoint |

## How it keeps its place

`state.json` = `{uidvalidity, lastUid, pending, updatedAt, linkedinAt, notices, acked}` (`linkedinAt`: the Date of the
newest LinkedIn alert with jobs read, or the first run's time until one comes, never ahead of now — the
`LINKEDIN SILENT` clock; a `--since-days` re-read moves it too, and a rebuilt mailbox keeps it. `notices`: the
`LINKEDIN NOTICE`s no one has acknowledged yet, id (12 hex of the Message-ID's sha256) → `{uid, at}` (uid as last read,
first seen); `acked`: id → when acknowledged — `--ack-notices` moves ids from one to the other and changes nothing else.
Neither list is ever cut short: a dropped notice is one nobody read, a dropped ack would raise it again). A run reads
`mailbox status`; nothing new past `lastUid` → exit 2 without searching. The checkpoint moves past a message only when **every post it produced was `accepted` or
`duplicate`** in the ingest's answer, or it produced none (skipped, not a job, too big). A message with a `rejected`
post (or one the answer did not mention) is held in `pending` and sent again each run — the server dedupes the rest —
for at most 24 h — and so is a LinkedIn alert whose key cannot be looked up (DNS down) — then given up with a `GIVING
UP` line that says why, and that run exits 3 (the unit shows in `systemctl --failed` until the next run):
`journalctl -u eno-job-mailbox.service --grep 'GIVING UP'` lists them; re-read with `--since-days N` once the cause is
gone. App or Dovecot unreachable → exit 4 and the checkpoint stays
where it was, with no deadline. A changed UIDVALIDITY (the mailbox rebuilt or restored), or a `uidnext` behind
`lastUid`, re-reads the last 3 days.

A run stops reading new messages after 400 s (the unit allows 600): what it read is sent and the checkpoint saved up
to it, and the next run carries on from there. A held message that is no longer in INBOX (moved, deleted) is dropped
with a `no longer a candidate` line.

`--since-days N` (1–60) re-reads the last N days (re-sends; the server answers `duplicate` for what it has) and leaves a
good checkpoint as it is — use it after a fix on the server side, or to recover messages skipped or given up.

Exit codes: `0` new mail read · `2` nothing new (success for the unit: `SuccessExitStatus=2`) · `3` a held message was
given up (the unit fails once) · `4` Dovecot or the app unreachable/refusing (the unit fails, visible in
`systemctl --failed`) · `5` LinkedIn needs a person, every run until it is done — a `LINKEDIN NOTICE` not yet
acknowledged (`--ack-notices`), or `LINKEDIN SILENT` — "LinkedIn alerts", above · `1` a bug or a bad setting.

## Rollback

```bash
systemctl disable --now eno-job-mailbox.timer
rm /etc/systemd/system/eno-job-mailbox.{service,timer} /opt/eno/bin/eno-job-mailbox.py
systemctl daemon-reload
rm -r /var/lib/eno/job-mailbox     # the checkpoint; without it a re-install starts from the last 3 days
```

Nothing in the mailbox changes either way. Posts already stored stay in `ExternalJobPost` until its 30-day retention;
the job-DM cron's own mode (`job-dms:mode`) decides whether anything is ever sent from them.
