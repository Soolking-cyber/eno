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
- ⛔ **Only two kinds of mail are ever candidates**, selected by the server-side search: mail **From** a LinkedIn alert
  sender (`jobalerts-noreply@`, `jobs-listings@`, `jobalerts@linkedin.com`), and mail with **Subject "JOB"** from a team
  address. Nothing else in the inbox is fetched. The searches match substrings, so a stranger's mail with a team address
  in its display name is a candidate too: it is fetched (within the size cap) and dropped on its exact From — a
  candidate, never a post.
- ⛔ **Authenticated or skipped.**
  - LinkedIn: **the script's own DKIM check** — a valid `linkedin.com` signature that covers `From` **and** `To` (no
    `l=`), and `To` is `alex@eno.vn`, so an alert someone else subscribed to cannot be replayed in. **No
    `Authentication-Results` header is trusted**: outside mail reaches mailcow through Cloudflare → `eno-inbound-bridge`
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
Date as `postedAt`). Team — one post per email (`externalKey` = sha256 of the Message-ID, the body as `text` with
forwarded-header blocks, quoted replies and the sender's `-- ` signature cut, the `Apply:` line as `applyText`, the
subject after "JOB:" as `title`, `lang` vi/en). A forward without an `Apply:` line is still sent; the server holds it
as "no application path".

## Install (on the box, after the deploy that ships `/api/cron/job-posts`)

```bash
# as root, from the checkout — the units run the installed COPY, never the checkout (a deploy rewrites it)
install -m 0755 /opt/eno/app/infra/vn-node/job-mailbox/eno-job-mailbox.py /opt/eno/bin/eno-job-mailbox.py
install -m 0644 /opt/eno/app/infra/vn-node/job-mailbox/eno-job-mailbox.{service,timer} /etc/systemd/system/
install -d -m 0700 /var/lib/eno/job-mailbox
systemctl daemon-reload

# 1. a dry run first: reads the last 3 days, prints every message's verdict and the posts it WOULD send;
#    sends nothing, saves nothing
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

- **No LinkedIn alerts yet** is normal until the owner has signed up `alex@eno.vn` on LinkedIn and saved the job
  alerts. Nothing to do here; the timer picks them up when they arrive.
- **LinkedIn `posts … (auth: own DKIM check d=linkedin.com …)`** — working.
- **LinkedIn `skip — not authenticated as LinkedIn — own DKIM check: body hash mismatch`** — the message was changed
  on its way in (the bridge), so no DKIM check can pass. Look at the bridge Worker before anything here.
- **LinkedIn `skip — not authenticated as LinkedIn — own DKIM check: To is not signed`** — LinkedIn's signature does not
  cover `To`, so the replay rule cannot be checked and no alert is read. Report it (the rule needs a change in the code);
  do not work around it.
- **LinkedIn `skip — … signed, but not addressed to alex@eno.vn`** — an alert for another subscriber (or the alerts were
  set up on another address). Only alerts sent to `alex@eno.vn` itself are read.
- **No LinkedIn alerts at all, though LinkedIn says it sends them** — look in alex@eno.vn's **Junk** folder: only INBOX
  is read. Move one back to INBOX and mark the sender as not spam; the next run reads it.
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
| `ENO_JOB_MAILBOX_LINKEDIN_SENDERS` | `jobalerts-noreply@linkedin.com jobs-listings@linkedin.com jobalerts@linkedin.com` | linkedin.com addresses only |
| `ENO_JOB_MAILBOX_MTA_HOSTS` | `mail.eno.vn mx.eno.vn` | Postfix's `myhostname` (the Received "by") |
| `ENO_JOB_MAILBOX_MAX_KB` | `200` | per-message cap (16–10240) |
| `ENO_JOB_MAILBOX_GIVE_UP_HOURS` | `24` | how long a held message (a rejected post, or LinkedIn's key not found because DNS is down) is tried again before it is given up (1–720) |
| `ENO_JOB_MAILBOX_STATE` | `/var/lib/eno/job-mailbox/state.json` | the checkpoint |

## How it keeps its place

`state.json` = `{uidvalidity, lastUid, pending, updatedAt}`. A run reads `mailbox status`; nothing new past `lastUid`
→ exit 2 without searching. The checkpoint moves past a message only when **every post it produced was `accepted` or
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
`systemctl --failed`) · `1` a bug or a bad setting.

## Rollback

```bash
systemctl disable --now eno-job-mailbox.timer
rm /etc/systemd/system/eno-job-mailbox.{service,timer} /opt/eno/bin/eno-job-mailbox.py
systemctl daemon-reload
rm -r /var/lib/eno/job-mailbox     # the checkpoint; without it a re-install starts from the last 3 days
```

Nothing in the mailbox changes either way. Posts already stored stay in `ExternalJobPost` until its 30-day retention;
the job-DM cron's own mode (`job-dms:mode`) decides whether anything is ever sent from them.
