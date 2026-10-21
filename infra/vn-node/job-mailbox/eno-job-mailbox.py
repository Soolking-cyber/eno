#!/usr/bin/env python3
"""
eno · the JOB MAILBOX reader — LinkedIn job-alert emails and the job posts the eno team forwards, read from alex@eno.vn's
INBOX on the box and handed to the app's ingest, POST /api/cron/job-posts (teacher job DMs, owner 2026-10-20: "daily job
hunting … all in the box, all on auto"). Plan: ~/eno-jobmatch-2026-10/PLAN.md, v2 "MAIL".

Run by eno-job-mailbox.timer (every 30 minutes, 07:00–21:00 Vietnam time) as the installed copy /opt/eno/bin/
eno-job-mailbox.py. Python 3.12 STANDARD LIBRARY ONLY: the host has no node and no pip packages. Tests:
`python3 -B -m unittest test_eno_job_mailbox` in this directory.

⛔ READ-ONLY, ONE MAILBOX, NO PASSWORD. Every mail operation is `docker exec <dovecot> doveadm …` with `-u alex@eno.vn`,
mailbox INBOX, and only the read commands `mailbox status`, `search` and `fetch` — Dovecot._doveadm refuses anything
else. Nothing is ever expunged, moved, flagged, marked read or delivered: the team keeps seeing every message exactly as it
arrived. doveadm runs inside the mail container as the mail system, so no credential exists anywhere in this script. The
mailbox is a CONSTANT, not a setting: no environment can point this script at another person's mail.

⛔ ONLY TWO KINDS OF MAIL ARE EVER CANDIDATES, selected server-side: (a) LinkedIn job alerts, From one of the LinkedIn
senders; (b) team forwards, Subject "JOB: …" From an address on the team list. Any other message is never fetched. But
IMAP FROM/SUBJECT searches are SUBSTRING matches — a stranger's `From: "lap@eno.vn" <x@example.com>` with "JOB:" is a
candidate too (codex, gate 7a) — so every candidate is fetched (≤ the size cap, ≤ MAX_MESSAGES_PER_RUN a run) and
classified again on its exact, parsed From address (from_address) before anything is read out of it; a crafted name
makes a message a candidate, never a post.

⛔ AUTHENTICATED OR SKIPPED (plan v2 and both plan reviews: "anyone can email JOB: …"):
  · LinkedIn — THIS SCRIPT'S OWN DKIM CHECK, and nothing else: a valid linkedin.com signature (dkim_verify: RSA-SHA256
    in plain Python, the key from DNS) that covers From AND To, no l= — and To is OUR LinkedIn subscriber
    (LINKEDIN_ALERT_TO), so a genuine alert someone else subscribed to cannot be replayed into this mailbox (opus, 7a).
    The LinkedIn account is vietnameno@gmail.com (owner, 2026-10-21): a Gmail filter AUTO-forwards its alerts here,
    and automatic forwarding resends the message itself — From, To, the body and LinkedIn's signature unchanged.
    ⛔ NO Authentication-Results HEADER IS EVER TRUSTED (codex, gate 7a). Outside mail reaches mailcow through
    Cloudflare → the eno-inbound-bridge Worker → mx.eno.vn:465 as the SASL user bridge@eno.vn
    (eno-cf-inbound-bridge-traps) — an AUTHENTICATED submission, for which rspamd checks nothing (dkim `check_authed`
    is false by default) and may write no header at all; then the first "Authentication-Results: mail.eno.vn; dkim=pass
    header.d=linkedin.com" under our hop is one the SENDER wrote. No position in the header block tells ours from
    theirs on that path, so the header path is gone, and with it two settings (…_AUTHSERV_IDS, …_LOCAL_DKIM).
  · Team — this server's own Received hop (the first one under Dovecot's delivery hop) is ONE Postfix hop "by <ours>
    (Postfix) with ESMTP(S)A" with "(Authenticated sender: x@eno.vn)" right before its "by", x on the team list, and
    From is exactly x. ⛔ bridge@eno.vn is NEVER a team sender, whatever the settings say: the bridge submits the whole
    outside world's mail, so its login says nothing about who wrote a message.
  · Both — a malformed header block, or a From/Subject/Date/Content-Type… field that appears twice, is refused before
    anything else: DKIM signs the LAST instance of a field and the MIME parser reads the FIRST, so a replayed genuine
    alert with an unsigned second Subject on top still verifies (dkimpy agrees) — read_message's _SINGLE_FIELDS.
  A message that fails is skipped and logged with its reason (never its content), and not read again.

⛔ THE CHECKPOINT IS UIDVALIDITY + lastUid, AND ONLY ACKS MOVE IT (the ingest contract: "a sender marks a post as shipped
ONLY when its key is in accepted or duplicate"). It moves past a message when every post the message produced was
accepted or duplicate, or it produced none (skipped, not a job, too big). A message with a REJECTED post or a post the
answer did not mention — or a LinkedIn alert whose DKIM key could not be looked up (DNS down) — is held and tried again
on the next runs (the server dedupes by externalKey) for at most GIVE_UP_HOURS, then given up, LOUDLY: a GIVING UP line
naming why, and the run exits 3, so the unit shows in `systemctl --failed` — re-read it with --since-days once the cause
is gone. One stuck message must not pin the checkpoint — re-sending everything after it, past the per-run cap — forever. A TRANSPORT failure (app down, non-200, a 200 without the
three lists) holds with no deadline: nothing was decided, so it is all sent again later. A changed UIDVALIDITY (the
mailbox was rebuilt), or a uidnext behind the checkpoint, re-reads the last RESET_DAYS days.

⛔ THE SECRET NEVER TOUCHES argv. CRON_SECRET is read from the RUNNING app container (eno-cron.sh's rule: it cannot drift
from what the app validates) and reaches curl as `-H @<file>` — a 0600 file in a 0700 temporary directory, gone when the
request ends — so `ps` never shows it.

⚠️ LOGS CARRY NO MAIL CONTENT: no bodies, no subjects, no exception messages (a parser's error can quote a header). Only
UIDs, counts, keys (LinkedIn job ids, hashes), team addresses and reasons. --dry-run prints the posts it would send — it
is run by hand in a terminal, never by the timer.

Exit codes: 0 new mail read (and sent) · 2 nothing new (the unit counts it as success: SuccessExitStatus=2) · 3 a held
message was given up this run (the unit fails, once — README) · 4 Dovecot or the app unreachable or refusing (the unit
fails; the checkpoint stayed where it was) · 5 LinkedIn needs a person, every run until it is done: a LINKEDIN NOTICE not
yet acknowledged (LinkedIn wrote from the alert address with no job in it — it switches off an alert nobody opens for 3
months, and writes first; read it, then --ack-notices <its id>), or LINKEDIN SILENT (no alert with jobs for
LINKEDIN_SILENT_DAYS) · 1 a bug or a bad setting.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import email
import email.header
import email.policy
import email.utils
import fcntl
import hashlib
import hmac
import html.parser
import json
import os
import re
import secrets
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.parse

# ── Fixed facts and settings ────────────────

#: ⛔ A constant on purpose (module header): the only mailbox this script may ever read.
MAILBOX_USER = 'alex@eno.vn'
#: ⛔ Whose LinkedIn alerts are read — the signed To must name one of these (the replay rule, module header). The
#: account is vietnameno@gmail.com (owner, 2026-10-21: "Linkedin already exists so set with that gmail"); a Gmail filter
#: forwards its alerts to MAILBOX_USER. MAILBOX_USER itself stays for an alert ever sent here directly.
LINKEDIN_ALERT_TO = ('vietnameno@gmail.com', MAILBOX_USER)
MAILBOX = 'INBOX'
DOVECOT_CONTAINER = 'mailcowdockerized-dovecot-mailcow-1'
#: CRON_SECRET is read from here (the eno.vn edition — the ingest route is marketplace-only).
APP_CONTAINER = 'eno-vn-app'
APP_URL = 'http://127.0.0.1:3001/api/cron/job-posts'
APP_HOST = 'eno.vn'
STATE_PATH = '/var/lib/eno/job-mailbox/state.json'
#: The unit's EnvironmentFile — read by the script too (with_settings_file), so a run by hand uses the timer's settings.
SETTINGS_PATH = '/etc/default/eno-job-mailbox'

#: Who may forward a job post (ENO_JOB_MAILBOX_TEAM replaces the list). will@ and freya@ are the teacher-outreach team
#: (with danh@ and lap@) — the people most likely to forward a Zalo job post.
DEFAULT_TEAM = ('lap@eno.vn', 'danh@eno.vn', 'quynh@eno.vn', 'anh@eno.vn', 'thao@eno.vn', 'bao@eno.vn', 'support@eno.vn',
                'alex@eno.vn', 'will@eno.vn', 'freya@eno.vn')
#: The SAVED-SEARCH alerts' sender, and only it (measured 2026-10-21 on 16 real alerts, Oct 2024 – 11 Oct 2026, all
#: X-LinkedIn-Class SAVEDSEARCH): jobs-listings@ and jobs-noreply@ send recommendations that are not tied to an alert's
#: search or place (a 2026 one offered a Lebanon teaching job) in a layout read here as the wrong fields, and no real mail
#: from jobalerts@ was found. ENO_JOB_MAILBOX_LINKEDIN_SENDERS can add them back.
DEFAULT_LINKEDIN_SENDERS = ('jobalerts-noreply@linkedin.com',)
LINKEDIN_DOMAIN = 'linkedin.com'
#: ⛔ The Cloudflare inbound bridge's SASL login: every outside message arrives authenticated as this (module header).
BRIDGE_SENDER = 'bridge@eno.vn'
#: This mail server's names: Postfix's myhostname (its Received "by") and the HELO/PTR name. ENO_JOB_MAILBOX_MTA_HOSTS
#: replaces them when the box's headers say otherwise (README, "First run").
DEFAULT_SERVER_NAMES = ('mail.eno.vn', 'mx.eno.vn')

#: The ingest's limits (src/lib/teachers/job-dms/ingest.ts INGEST_LIMITS): ≤50 posts a request, text ≤6000 and the short
#: fields ≤200 — counted in JS string length (UTF-16 code units), so clip() counts the same way.
BATCH_MAX = 50
TEXT_MAX = 6000
SHORT_MAX = 200
#: ingest.ts refuses postedAt more than a day ahead ('postedAt_future') or older than 60 days ('postedAt_old').
POSTED_MAX_AGE_DAYS = 60
POSTED_MAX_AHEAD = dt.timedelta(days=1)

RESET_DAYS = 3
MAX_KB = 200
MAX_MESSAGES_PER_RUN = 300
#: ⛔ AN OUTSIDER CANNOT STALL THE READER (opus, gate 7b3): a forged "LinkedIn" mail can carry hundreds of d=linkedin.com
#: signatures, each with its own selector — a DNS lookup each. At most this many are checked per message, and a run
#: stops READING after RUN_BUDGET_S (the unit allows 600 s): what it read is sent and the checkpoint saved up to it, so
#: the next run carries on from there — never the same killed run again.
MAX_LINKEDIN_SIGNATURES = 3
RUN_BUDGET_S = 400
MAX_JOBS_PER_ALERT = 50
GIVE_UP_HOURS = 24.0
#: ⛔ THE FEED MUST NOT DIE QUIETLY (codex + opus, gate 8a). Nobody opens these alerts, so LinkedIn switches them off
#: after 3 months; a deleted Gmail filter, a changed primary address or a broken forward look the same from here —
#: nothing arrives, and every run would say "nothing new". So this many days without an alert with jobs — counted from
#: the newest one read, or from the reader's first run until one comes — fail EVERY run (EXIT_NOTICE, "LINKEDIN
#: SILENT") until alerts come again. Six daily alerts across Vietnam go a week without one new job only when something
#: is broken. 0 (the setting) turns it off.
LINKEDIN_SILENT_DAYS = 7

LINKEDIN_SOURCE_NAME = 'LinkedIn'
TEAM_SOURCE_NAME = 'Forwarded by the eno team'

EXIT_OK, EXIT_ERROR, EXIT_NOTHING, EXIT_GAVE_UP, EXIT_UNREACHABLE, EXIT_NOTICE = 0, 1, 2, 3, 4, 5

_ADDR = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
                   r'[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$')
_HOST = re.compile(r'^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$')


class ConfigError(Exception):
    pass


def _list(raw: str | None, default: tuple[str, ...], pattern: re.Pattern, what: str) -> tuple[str, ...]:
    if raw is None or not raw.strip():
        return default
    items = tuple(dict.fromkeys(x.strip().lower() for x in re.split(r'[,\s]+', raw) if x.strip()))
    bad = [x for x in items if not pattern.match(x)]
    if bad or not items:
        raise ConfigError(f'{what}: not a list of {"addresses" if pattern is _ADDR else "host names"}')
    return items


class Config:
    """Settings from the environment (/etc/default/eno-job-mailbox through the unit). Bad values stop the run (exit 1)."""

    def __init__(self, env: dict[str, str]):
        self.notes: list[str] = []
        team = _list(env.get('ENO_JOB_MAILBOX_TEAM'), DEFAULT_TEAM, _ADDR, 'ENO_JOB_MAILBOX_TEAM')
        if BRIDGE_SENDER in team:
            self.notes.append(f'{BRIDGE_SENDER} removed from the team list: the inbound bridge relays outside mail')
        self.team = tuple(a for a in team if a != BRIDGE_SENDER)
        senders = _list(env.get('ENO_JOB_MAILBOX_LINKEDIN_SENDERS'), DEFAULT_LINKEDIN_SENDERS, _ADDR,
                        'ENO_JOB_MAILBOX_LINKEDIN_SENDERS')
        # ⛔ Only linkedin.com addresses: the DKIM/DMARC proof is for linkedin.com, so another domain could never pass
        # honestly — and must not be read as LinkedIn.
        self.linkedin_senders = tuple(a for a in senders if _domain_ok(a.rpartition('@')[2], LINKEDIN_DOMAIN))
        if len(self.linkedin_senders) != len(senders):
            self.notes.append('non-linkedin.com addresses removed from the LinkedIn sender list')
        overlap = set(self.team) & set(self.linkedin_senders)
        if overlap:
            raise ConfigError('an address is on both the team and the LinkedIn lists')
        self.mta_hosts = _list(env.get('ENO_JOB_MAILBOX_MTA_HOSTS'), DEFAULT_SERVER_NAMES, _HOST,
                               'ENO_JOB_MAILBOX_MTA_HOSTS')
        self.dovecot_container = (env.get('ENO_JOB_MAILBOX_DOVECOT_CONTAINER') or DOVECOT_CONTAINER).strip()
        if not re.match(r'^[A-Za-z0-9][A-Za-z0-9_.-]*$', self.dovecot_container):
            raise ConfigError('ENO_JOB_MAILBOX_DOVECOT_CONTAINER is not a container name')
        self.state_path = env.get('ENO_JOB_MAILBOX_STATE') or STATE_PATH
        try:
            self.max_bytes = int(env.get('ENO_JOB_MAILBOX_MAX_KB') or MAX_KB) * 1024
            self.give_up = dt.timedelta(hours=float(env.get('ENO_JOB_MAILBOX_GIVE_UP_HOURS') or GIVE_UP_HOURS))
        except (ValueError, OverflowError):  # "lots", "nan", "inf"
            raise ConfigError('ENO_JOB_MAILBOX_MAX_KB / ENO_JOB_MAILBOX_GIVE_UP_HOURS must be numbers') from None
        # ⚠️ At least an hour: 0 would give up a LinkedIn alert on its first DNS hiccup (opus, gate 7b); at most 30 days.
        if not 16 * 1024 <= self.max_bytes <= 10 * 1024 * 1024 or not dt.timedelta(hours=1) <= self.give_up <= dt.timedelta(days=30):
            raise ConfigError('ENO_JOB_MAILBOX_MAX_KB (16-10240) / ENO_JOB_MAILBOX_GIVE_UP_HOURS (1-720) out of range')
        raw_silent = (env.get('ENO_JOB_MAILBOX_LINKEDIN_SILENT_DAYS') or '').strip()
        if raw_silent and not re.fullmatch(r'[0-9]{1,3}', raw_silent):  # not isdigit(): "²" is a digit to it (opus, 8e)
            raise ConfigError('ENO_JOB_MAILBOX_LINKEDIN_SILENT_DAYS must be a whole number of days')
        self.silent_days = int(raw_silent) if raw_silent else LINKEDIN_SILENT_DAYS
        if self.silent_days > 60:
            raise ConfigError('ENO_JOB_MAILBOX_LINKEDIN_SILENT_DAYS out of range (0 = off, up to 60)')


def with_settings_file(env: dict[str, str], path: str = SETTINGS_PATH) -> dict[str, str]:
    """`env` plus the settings file's ENO_JOB_MAILBOX_* lines — the unit's EnvironmentFile, read here as well, so a run by
    hand (--dry-run, --since-days, the README's recovery steps) uses the same settings and state file as the timer's
    (opus, gate 7c). A variable already set wins (under the unit they are the same values). KEY=value lines only; one
    pair of surrounding quotes is dropped; nothing is expanded."""
    try:
        with open(path, encoding='utf-8') as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return env
    except (OSError, UnicodeDecodeError) as e:
        raise ConfigError(f'{path} unreadable ({type(e).__name__})') from None
    out = dict(env)
    for line in lines:
        key, sep, value = line.strip().partition('=')
        key, value = key.strip(), value.strip()
        if not sep or not re.match(r'^ENO_JOB_MAILBOX_[A-Z_]+$', key):
            continue  # a comment, a blank line, or not ours
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        out.setdefault(key, value)
    return out


# ── Small helpers ───────────────────────────

def log(msg: str) -> None:
    print(msg, flush=True)


def iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_iso(s: str) -> dt.datetime | None:
    try:
        t = dt.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ')
    except (TypeError, ValueError):
        return None
    return t.replace(tzinfo=dt.timezone.utc)


def clip(s: str, units: int) -> str:
    """`s` cut to at most `units` UTF-16 code units — JS `.length`, what the ingest counts — never inside a character."""
    if len(s) <= units // 2 or len(s.encode('utf-16-le')) // 2 <= units:
        return s
    out, n = [], 0
    for ch in s:
        n += 2 if ord(ch) > 0xFFFF else 1
        if n > units:
            break
        out.append(ch)
    return ''.join(out)


def fold(s: str) -> str:
    """Lower case, no diacritics, đ → d — what every pattern below reads (src/lib/fold.ts does the same for the app)."""
    s = s.replace('đ', 'd').replace('Đ', 'D')
    s = unicodedata.normalize('NFKD', s)
    return ''.join(ch for ch in s if not unicodedata.combining(ch)).lower()


def _domain_ok(domain: str, want: str) -> bool:
    d = domain.lower().rstrip('.')
    return d == want or d.endswith('.' + want)


def _short(b: bytes, n: int = 160) -> str:
    """The first line of a tool's stderr, for a log line (doveadm/curl/docker errors carry no mail content)."""
    line = b.decode('utf-8', 'replace').strip().splitlines()
    return (line[0] if line else '')[:n]


def run(argv: list[str], data: bytes | None = None, timeout: float = 60) -> tuple[int, bytes, bytes]:
    """The ONE place a process starts (the tests replace it). rc -1 = could not start or timed out."""
    kw = {'input': data} if data is not None else {'stdin': subprocess.DEVNULL}
    try:
        p = subprocess.run(argv, capture_output=True, timeout=timeout, check=False, **kw)
    except subprocess.TimeoutExpired:
        return -1, b'', b'timed out'
    except OSError as e:
        return -1, b'', type(e).__name__.encode()
    return p.returncode, p.stdout, p.stderr


# ── Dovecot — read-only doveadm inside the mailcow container ────

class DovecotError(Exception):
    pass


#: ⛔ The only doveadm commands this script may run (module header). Everything else is refused before docker starts.
_READ_COMMANDS = (('mailbox', 'status'), ('search',), ('fetch',))


class Dovecot:
    def __init__(self, cfg: Config, runner=run):
        self.container = cfg.dovecot_container
        self.runner = runner

    def _doveadm(self, args: list[str], timeout: float = 60) -> bytes:
        cmd = args[2:] if args[:1] == ['-f'] else args
        verb = next((c for c in _READ_COMMANDS if tuple(cmd[:len(c)]) == c), None)
        rest = cmd[len(verb):] if verb else []
        on_inbox = rest[-1:] == [MAILBOX] if verb == ('mailbox', 'status') else any(
            rest[k:k + 2] == ['mailbox', MAILBOX] for k in range(len(rest) - 1))
        if verb is None or rest[:2] != ['-u', MAILBOX_USER] or not on_inbox:
            raise AssertionError(f'refused: not a read-only doveadm command on {MAILBOX_USER} {MAILBOX}')
        rc, out, err = self.runner(['docker', 'exec', self.container, 'doveadm', *args], timeout=timeout)
        if rc != 0:
            raise DovecotError(f'doveadm {" ".join(cmd[:2])} exit {rc}: {_short(err)}')
        return out

    def status(self) -> tuple[int, int]:
        out = self._doveadm(['-f', 'flow', 'mailbox', 'status', '-u', MAILBOX_USER, 'uidvalidity uidnext', MAILBOX])
        return parse_status(out)

    def search(self, query: list[str]) -> set[int]:
        return parse_search(self._doveadm(['search', '-u', MAILBOX_USER, 'mailbox', MAILBOX, *query]))

    def sizes(self, uids: list[int]) -> dict[int, int]:
        if not uids:
            return {}
        # size.VIRTUAL — the message's own size: if Dovecot compresses mail files, the physical size is the smaller one
        out = self._doveadm(['-f', 'flow', 'fetch', '-u', MAILBOX_USER, 'uid size.virtual', 'mailbox', MAILBOX,
                             'UID', ','.join(str(u) for u in sorted(uids))])
        return parse_sizes(out)

    def text(self, uid: int) -> bytes | None:
        out = self._doveadm(['-f', 'pager', 'fetch', '-u', MAILBOX_USER, 'text', 'mailbox', MAILBOX, 'UID', str(uid)],
                            timeout=120)
        return parse_fetch_text(out)


def parse_status(out: bytes) -> tuple[int, int]:
    s = out.decode('ascii', 'replace')
    v = re.search(r'\buidvalidity[=:]\s*(\d+)', s)
    n = re.search(r'\buidnext[=:]\s*(\d+)', s)
    if not v or not n or int(v.group(1)) == 0:
        raise DovecotError('mailbox status: unreadable answer')
    return int(v.group(1)), int(n.group(1))


def parse_search(out: bytes) -> set[int]:
    """`doveadm search` prints "<mailbox-guid> <uid>" per message. Strict: an unreadable line fails the run rather than
    silently missing a message the checkpoint would then step over."""
    uids = set()
    for line in out.decode('ascii', 'replace').splitlines():
        tok = line.split()
        if not tok:
            continue
        last = tok[-1].split('=', 1)[-1]
        if not last.isdigit():
            raise DovecotError('search: unreadable answer')
        uids.add(int(last))
    return uids


def parse_sizes(out: bytes) -> dict[int, int]:
    return {int(m.group(1)): int(m.group(2))
            for m in re.finditer(rb'\buid[=:]\s*(\d+)\s+size\.virtual[=:]\s*(\d+)', out)}


def parse_fetch_text(out: bytes) -> bytes | None:
    """The raw message out of `doveadm -f pager fetch text`: "text:" then the message (after a newline, or a space), the
    record closed by a form feed. Empty = the message was expunged since the search."""
    if not out.strip():
        return None
    if not out.startswith(b'text:'):
        raise DovecotError('fetch: unexpected answer')
    msg = out[5:]
    if msg.startswith(b'\r\n'):
        msg = msg[2:]
    elif msg[:1] in (b'\n', b' '):
        msg = msg[1:]
    # A line end the formatter may add before the form feed only makes trailing empty lines, which neither MIME nor
    # DKIM (both canonicalisations drop them) reads.
    if msg.endswith(b'\f\n'):
        msg = msg[:-2]
    elif msg.endswith(b'\f'):
        msg = msg[:-1]
    return msg


# ── One message ─────────────────────────────

def _bytes_text(b: bytes) -> str:
    try:
        return b.decode('utf-8')
    except UnicodeDecodeError:
        return b.decode('latin-1')


def decode_words(v: str) -> str:
    """RFC 2047 encoded words ("=?UTF-8?B?…?=") → text; the raw value when they do not decode."""
    try:
        return str(email.header.make_header(email.header.decode_header(v)))
    except Exception:  # noqa: BLE001 — a header that does not decode is read as it is
        return v


class Mail:
    """One raw message: its header fields exactly as stored (the DKIM check needs the bytes) and a MIME view of it."""

    def __init__(self, raw: bytes):
        self.raw = raw
        data = re.sub(rb'\r?\n', b'\r\n', raw)
        if data.startswith(b'\r\n'):
            head, body = b'', data[2:]
        else:
            head, sep, body = data.partition(b'\r\n\r\n')
            if not sep:
                head, body = data.rstrip(b'\r\n'), b''
        self.body = body
        #: (lower-case name or None for a line that is not a field, the field's raw bytes without the last CRLF)
        self.fields: list[tuple[str | None, bytes]] = []
        #: a header line that is not "name:value" (RFC 5322 ftext names) — the standard library would end the header
        #: block there while this parser reads on, so the DKIM view and the MIME view of the message could differ
        self.malformed = False
        for line in head.split(b'\r\n') if head else []:
            if line[:1] in (b' ', b'\t') and self.fields:
                name, f = self.fields[-1]
                self.fields[-1] = (name, f + b'\r\n' + line)
                continue
            name, colon, _ = line.partition(b':')
            ok = bool(colon) and re.fullmatch(rb'[!-9;-~]+', name) is not None
            self.malformed = self.malformed or not ok
            self.fields.append((name.decode('ascii').lower() if ok else None, line))

    def indexed(self, name: str) -> list[tuple[int, str]]:
        """(position, unfolded value) of every field called `name`, top to bottom."""
        out = []
        for i, (n, f) in enumerate(self.fields):
            if n == name:
                v = re.sub(rb'\r\n(?=[ \t])', b'', f.split(b':', 1)[1])
                out.append((i, _bytes_text(v).strip()))
        return out

    def values(self, name: str) -> list[str]:
        return [v for _, v in self.indexed(name)]

    def first(self, name: str) -> str | None:
        v = self.values(name)
        return v[0] if v else None

    def mime(self):
        return email.message_from_bytes(self.raw, policy=email.policy.default)


def from_address(mail: Mail) -> str | None:
    """The one From mailbox, lower case — or None. ⛔ Exactly one From field with exactly one address, read the same by a
    strict angle-address match AND the standard library: a header two parsers read differently is refused (a crafted
    From is how a spoof gets past an address list)."""
    vals = mail.values('from')
    if len(vals) != 1:
        return None
    v = vals[0]
    angles = re.findall(r'<([^<>]*)>', v)
    if len(angles) > 1 or v.count('<') != len(angles) or v.count('>') != len(angles):
        return None
    cand = (angles[0] if angles else v).strip()
    if not _ADDR.match(cand):
        return None
    try:
        pairs = email.utils.getaddresses([v])
    except Exception:  # noqa: BLE001
        return None
    if len(pairs) != 1 or pairs[0][1].strip().lower() != cand.lower():
        return None
    return cand.lower()


def posted_at(mail: Mail, now: dt.datetime) -> tuple[str | None, bool]:
    """(the Date header as ingest's postedAt, too_old). A missing, unreadable or future Date gives no postedAt."""
    raw = mail.first('date')
    if not raw:
        return None, False
    try:
        t = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        return None, False
    if t is None:
        return None, False
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    if t > now + POSTED_MAX_AHEAD:
        return None, False
    if now - t > dt.timedelta(days=POSTED_MAX_AGE_DAYS):
        return None, True
    return iso(t), False


# ── the text of a message ──

#: Zero-width spaces/joiners, BOM, the combining grapheme joiner and soft hyphens LinkedIn pads its preheader with.
_ZERO_WIDTH = dict.fromkeys(map(ord, '\u200b\u200c\u200d\u2060\ufeff\u034f\u00ad'), None)


def clean_text(s: str) -> str:
    """NFC, no zero-width padding or control characters, spaces collapsed per line, at most one blank line in a row."""
    s = unicodedata.normalize('NFC', s).translate(_ZERO_WIDTH)
    s = s.replace('\r\n', '\n').replace('\r', '\n').replace('\xa0', ' ')
    s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
    out: list[str] = []
    for line in s.split('\n'):
        line = ' '.join(line.split())
        if not line and (not out or not out[-1]):
            continue
        out.append(line)
    return '\n'.join(out).strip()


class _HtmlText(html.parser.HTMLParser):
    """HTML → lines of text, standard library only. Blocks break lines; HTML whitespace collapses inside a line.

    links='marker' (LinkedIn): a link's URL goes on its OWN line BEFORE the link's content — a job card's text follows
    its link in LinkedIn's HTML (logo link, title link, then company · location), so the parser reads a card forward
    from the marker. links='inline' (team posts): "text <URL>" after the link's text, so an "Apply: <a>form</a>" line
    keeps its URL on the same line.
    """

    BLOCK = frozenset('address article aside blockquote br caption center dd div dl dt fieldset figcaption figure footer '
                      'form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td tfoot th thead tr '
                      'ul'.split())
    SKIP = frozenset('script style head title noscript template svg'.split())

    def __init__(self, links: str):
        super().__init__(convert_charrefs=True)
        self.links = links
        self.parts: list[str] = []
        self.skip = 0
        self.href: str | None = None
        self.anchor: list[str] = []
        self.line_start = True

    def handle_starttag(self, tag, attrs):
        if tag == 'body':
            self.skip = 0  # an unclosed <head>/<title> must not swallow the whole message
            return
        if tag in self.SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if tag == 'a':
            self._close_anchor()
            href = (dict(attrs).get('href') or '').strip()
            if href.lower().startswith(('http://', 'https://')):
                if self.links == 'marker':
                    self.parts.append(f'\n<{href}>\n')
                    self.line_start = True
                else:
                    self.href, self.anchor = href, []
            return
        if tag in self.BLOCK:
            self._break(tag == 'br')

    def handle_startendtag(self, tag, attrs):
        if tag in self.SKIP or self.skip:
            return
        if tag == 'a':
            self.handle_starttag(tag, attrs)
            self._close_anchor()
        elif tag in self.BLOCK:
            self._break(tag == 'br')

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag == 'a':
            self._close_anchor()
        elif tag in self.BLOCK:
            self._break(False)

    def handle_data(self, data):
        if self.skip:
            return
        data = re.sub(r'\s+', ' ', data)
        if self.href is not None:
            self.anchor.append(data)
            return
        self.parts.append(data)
        if data.strip():
            self.line_start = False

    def _break(self, hard: bool):
        """A block edge ends the line once (</div><div> is one break, not a blank line); every <br> breaks."""
        if self.href is not None:
            self.anchor.append(' ')  # a block inside an inline link stays on the link's line
        elif hard or not self.line_start:
            self.parts.append('\n')
            self.line_start = True

    def _close_anchor(self):
        if self.href is None:
            return
        text = ' '.join(''.join(self.anchor).split())
        href, self.href, self.anchor = self.href, None, []
        self.parts.append(f'{text} <{href}>' if text and text != href else f' <{href}> ')
        self.line_start = False

    def result(self) -> str:
        self._close_anchor()
        return ''.join(self.parts)


def html_to_text(src: str, links: str = 'inline') -> str:
    p = _HtmlText(links)
    try:
        p.feed(src)
        p.close()
    except Exception:  # noqa: BLE001 — broken HTML costs its broken tail, never the run
        pass
    return clean_text(p.result())


def _part_text(part) -> str:
    try:
        content = part.get_content()
        if isinstance(content, str):
            return content
    except Exception:  # noqa: BLE001 — an unknown charset or a bad transfer encoding: decode by hand below
        pass
    payload = part.get_payload(decode=True) or b''
    charset = part.get_content_charset() or 'utf-8'
    try:
        return payload.decode(charset, 'replace')
    except LookupError:
        return payload.decode('utf-8', 'replace')


def body_texts(mail: Mail) -> tuple[str, str]:
    """(text/plain, text/html) of the message body — attachments are never read (get_body skips them)."""
    msg = mail.mime()
    plain = msg.get_body(preferencelist=('plain',))
    htm = msg.get_body(preferencelist=('html',))
    return (_part_text(plain) if plain is not None else ''), (_part_text(htm) if htm is not None else '')


# ── Authentication — team forwards (this server's Received hop) ────

_LMTP_HOP = re.compile(r'\bwith\s+LMTPS?A?\b', re.I)
_POSTFIX_BY = re.compile(r'\bby\s+(\S+)\s+\(Postfix\)\s+with\s+(\S+)', re.I)
_AUTH_SENDER_END = re.compile(r'\(Authenticated sender:\s*([^()\s]+)\)\s*$', re.I)
_AUTH_PROTOCOLS = ('ESMTPA', 'ESMTPSA', 'UTF8SMTPA', 'UTF8SMTPSA')


def our_hop(mail: Mail) -> tuple[int, str] | None:
    """(position, value) of the Received header THIS server's Postfix wrote: the first one under Dovecot's LMTP delivery
    hop(s). Everything above it was written here at delivery; everything under it came with the message."""
    for i, v in mail.indexed('received'):
        v = ' '.join(v.split())
        if _LMTP_HOP.search(v):
            continue
        return i, v
    return None


def team_auth(mail: Mail, sender: str, cfg: Config) -> tuple[bool, str]:
    hop = our_hop(mail)
    if hop is None:
        return False, 'no Received header from this mail server'
    v = hop[1]
    bys = list(_POSTFIX_BY.finditer(v))
    # ⛔ ONE Postfix "by" and ONE authenticated-sender comment: a client's HELO (or a crafted recipient) is printed in
    # this same header, so a second copy of either means someone wrote one in.
    if len(bys) != 1 or v.count('(Postfix)') != 1:
        return False, 'our Received hop is not a single Postfix hop'
    host, proto = bys[0].group(1).lower(), bys[0].group(2).upper()
    if host not in cfg.mta_hosts:
        return False, f'received by {host}, not by this mail server'
    if proto not in _AUTH_PROTOCOLS:
        return False, f'not an authenticated submission (with {proto})'
    if v.lower().count('(authenticated sender:') != 1:
        return False, 'no single authenticated sender on our hop'
    m = _AUTH_SENDER_END.search(v[:bys[0].start()])
    if not m:
        return False, 'no authenticated sender right before our hop'
    who = m.group(1).lower()
    if who == BRIDGE_SENDER:
        return False, 'relayed from outside by the inbound bridge'
    if who not in cfg.team:
        return False, f'authenticated sender {who} is not on the team list'
    if who != sender:
        return False, 'From is not the authenticated sender'
    return True, f'submitted by {who}'


# ── Authentication — LinkedIn: our own DKIM check (RFC 6376, rsa-sha256 only), never a header ──


class DkimTemp(Exception):
    """The key could not be looked up now (DNS down) — the message is held and tried again, never skipped for it."""


_TAG_NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
_FWS = rb'(?:(?:\s*\r?\n)?\s+)?'
#: dkimpy's b= remover (the reference verifier the tests cross-check against): the tag's value — base64 and folding
#: whitespace — is emptied; "b=" itself and what precedes it stay.
_B_TAG = re.compile(rb'([;\s]b' + _FWS + rb'=)(?:' + _FWS + rb'[a-zA-Z0-9+/=])*(?:\r?\n\Z)?')
_SHA256_INFO = (bytes.fromhex('3031300d060960864801650304020105000420'), bytes.fromhex('302f300b0609608648016503040201'
                                                                                         '0420'))
_RSA_OID = bytes.fromhex('2a864886f70d010101')


def parse_tags(value: str) -> dict[str, str]:
    tags: dict[str, str] = {}
    for part in value.split(';'):
        part = part.strip()
        if not part:
            continue
        name, eq, val = part.partition('=')
        name = name.strip()
        if not eq or not _TAG_NAME.match(name) or name in tags:
            raise ValueError('tag list')
        tags[name] = ' '.join(val.split())
    return tags


def canon_header(field: bytes, mode: str) -> bytes:
    if mode == 'simple':
        return field + b'\r\n'
    name, _, value = field.partition(b':')
    value = re.sub(rb'[ \t]+', b' ', value.replace(b'\r\n', b'')).strip(b' ')
    return name.strip(b' \t').lower() + b':' + value + b'\r\n'


def canon_body(body: bytes, mode: str) -> bytes:
    if mode == 'simple':
        return re.sub(rb'(?:\r\n)+\Z', b'', body) + b'\r\n'
    lines = [re.sub(rb'[ \t]+', b' ', line).rstrip(b' ') for line in body.split(b'\r\n')]
    out = re.sub(rb'(?:\r\n)+\Z', b'', b'\r\n'.join(lines))
    return out + b'\r\n' if out else b''


def _der(data: bytes, pos: int) -> tuple[int, bytes, int]:
    if pos + 2 > len(data):
        raise ValueError('der')
    tag, n = data[pos], data[pos + 1]
    pos += 2
    if n & 0x80:
        k = n & 0x7F
        if not 0 < k <= 4 or pos + k > len(data):
            raise ValueError('der')
        n = int.from_bytes(data[pos:pos + k], 'big')
        pos += k
    if pos + n > len(data):
        raise ValueError('der')
    return tag, data[pos:pos + n], pos + n


def rsa_public_key(der: bytes, depth: int = 0) -> tuple[int, int]:
    """(n, e) from a SubjectPublicKeyInfo (what DKIM keys publish) or a bare PKCS#1 RSAPublicKey."""
    tag, seq, _ = _der(der, 0)
    if tag != 0x30 or depth > 1:
        raise ValueError('der')
    t1, v1, pos = _der(seq, 0)
    if t1 == 0x02:
        t2, v2, _ = _der(seq, pos)
        if t2 != 0x02:
            raise ValueError('der')
        return int.from_bytes(v1, 'big'), int.from_bytes(v2, 'big')
    if t1 != 0x30:
        raise ValueError('der')
    to, oid, _ = _der(v1, 0)
    if to != 0x06 or oid != _RSA_OID:
        raise ValueError('not rsa')
    tb, bits, _ = _der(seq, pos)
    if tb != 0x03 or not bits or bits[0] != 0:
        raise ValueError('der')
    return rsa_public_key(bits[1:], depth + 1)


def rsa_verify(n: int, e: int, sig: bytes, digest: bytes) -> bool:
    """PKCS#1 v1.5 / SHA-256: the WHOLE decoded block is rebuilt and compared — never parsed — which is what keeps a
    forged signature from slipping through loose padding checks."""
    k = (n.bit_length() + 7) // 8
    s = int.from_bytes(sig, 'big')
    if not sig or len(sig) > k or s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, 'big')
    for info in _SHA256_INFO:
        t = info + digest
        if k < len(t) + 11:
            return False
        if hmac.compare_digest(em, b'\x00\x01' + b'\xff' * (k - len(t) - 3) + b'\x00' + t):
            return True
    return False


def parse_key_record(txt: str) -> tuple[int, int] | None:
    try:
        tags = parse_tags(txt)
    except ValueError:
        return None
    if tags.get('v', 'DKIM1') != 'DKIM1' or tags.get('k', 'rsa').lower() != 'rsa':
        return None
    if 'h' in tags and 'sha256' not in [x.strip().lower() for x in tags['h'].split(':')]:
        return None
    if 's' in tags and not {x.strip() for x in tags['s'].split(':')} & {'*', 'email'}:
        return None
    if 'y' in [x.strip().lower() for x in tags.get('t', '').split(':')]:
        return None  # "testing": RFC 6376 says treat the message as unsigned
    p = re.sub(r'\s+', '', tags.get('p', ''))
    if not p:
        return None  # revoked
    try:
        n, e = rsa_public_key(base64.b64decode(p, validate=True))
    except (ValueError, TypeError):
        return None
    if n.bit_length() < 1024 or e < 3 or e % 2 == 0 or e >= n:
        return None
    return n, e


def _tok(v: str) -> str:
    """A header's tag value as a log may carry it — the sender wrote it, so only a short, plain token (opus, gate 7a)."""
    return re.sub(r'[^A-Za-z0-9._/-]', '?', v)[:32] or '?'


def _dkim_one(mail: Mail, idx: int, field: bytes, tags: dict[str, str], lookup, now: dt.datetime,
              required: tuple[str, ...] = ('from',)) -> tuple[bool, str]:
    if tags.get('v') != '1':
        return False, 'not DKIM v=1'
    if tags.get('a', '').lower() != 'rsa-sha256':
        return False, f'algorithm {_tok(tags.get("a", ""))} not checked here'
    if 'l' in tags:
        return False, 'l= (a signature over part of the body) is refused'
    if tags.get('q', 'dns/txt').lower().split(':')[0] != 'dns/txt':
        return False, 'q= not dns/txt'
    d, s = tags.get('d', '').lower().rstrip('.'), tags.get('s', '')
    if not re.match(r'^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,62})$', s) or not _HOST.match(d):
        return False, 'bad d= or s='
    signed = [h.strip().lower() for h in tags.get('h', '').split(':') if h.strip()]
    for name in required:
        if name not in signed:
            return False, f'{name.capitalize()} is not signed'
    if tags.get('i') and not _domain_ok(tags['i'].rpartition('@')[2], d):
        return False, 'i= outside d='
    if tags.get('x'):
        if not tags['x'].isdigit() or int(tags['x']) < now.timestamp():
            return False, 'signature expired'
    c = tags.get('c', 'simple/simple').lower()
    hc, _, bc = c.partition('/')
    bc = bc or 'simple'
    if hc not in ('simple', 'relaxed') or bc not in ('simple', 'relaxed'):
        return False, f'c={_tok(c)} unknown'
    try:
        bh = base64.b64decode(re.sub(r'\s+', '', tags.get('bh', '')), validate=True)
        b = base64.b64decode(re.sub(r'\s+', '', tags.get('b', '')), validate=True)
    except (ValueError, TypeError):
        return False, 'bad base64'
    if not hmac.compare_digest(hashlib.sha256(canon_body(mail.body, bc)).digest(), bh):
        return False, 'body hash mismatch'
    key = None
    for txt in lookup(f'{s}._domainkey.{d}'):
        key = parse_key_record(txt)
        if key:
            break
    if key is None:
        return False, f'no usable key at {s}._domainkey.{d}'
    # The signed fields, each the LAST not-yet-used instance of its name (bottom-up); a listed name with no instance left
    # contributes nothing (RFC 6376 §5.4.2). The signature being checked is never one of them.
    used: set[int] = set()
    data = b''
    for name in signed:
        for k in range(len(mail.fields) - 1, -1, -1):
            if k not in used and k != idx and mail.fields[k][0] == name:
                used.add(k)
                data += canon_header(mail.fields[k][1], hc)
                break
    # The signature's own field last, b= emptied, without its line end (dkimpy also drops whitespace trailing b=).
    fname, _, fvalue = field.partition(b':')
    data += canon_header(fname + b':' + _B_TAG.sub(rb'\1', fvalue), hc).rstrip(b' \t\r\n')
    if rsa_verify(key[0], key[1], b, hashlib.sha256(data).digest()):
        return True, f'd={d} s={s}'
    return False, 'signature does not verify'


def dkim_verify(mail: Mail, domain: str, lookup, now: dt.datetime,
                required: tuple[str, ...] = ('from',)) -> tuple[str, str]:
    """('pass' | 'fail' | 'temp', why) for the message's DKIM signatures by `domain` (or a subdomain of it), each
    covering every field in `required`."""
    why, temp, tried = f'no DKIM signature by {domain}', False, 0
    for idx, (name, field) in enumerate(mail.fields):
        if name != 'dkim-signature':
            continue
        try:
            tags = parse_tags(_bytes_text(field.split(b':', 1)[1]))
        except ValueError:
            why = 'unreadable DKIM-Signature'
            continue
        if not _domain_ok(tags.get('d', ''), domain):
            continue
        tried += 1
        if tried > MAX_LINKEDIN_SIGNATURES:
            why = f'{why}; more than {MAX_LINKEDIN_SIGNATURES} {domain} signatures — the rest not checked'
            break
        try:
            ok, why = _dkim_one(mail, idx, field, tags, lookup, now, required)
        except DkimTemp as e:
            temp, why = True, f'key lookup failed ({e})'
            continue
        if ok:
            return 'pass', why
    return ('temp' if temp else 'fail'), why


# ── DNS TXT, standard library only (the host's resolver) ──

class _Truncated(Exception):
    pass


def resolvers(path: str = '/etc/resolv.conf') -> list[str]:
    out = []
    try:
        with open(path, encoding='ascii', errors='replace') as f:
            for line in f:
                p = line.split()
                if len(p) >= 2 and p[0] == 'nameserver':
                    out.append(p[1].split('%')[0])
    except OSError:
        pass
    return out[:3] or ['127.0.0.53']


def dns_query(name: str, qid: int) -> bytes:
    q = struct.pack('>HHHHHH', qid, 0x0100, 1, 0, 0, 1)
    for label in name.rstrip('.').split('.'):
        b = label.encode('ascii')
        if not 0 < len(b) < 64:
            raise ValueError('name')
        q += bytes([len(b)]) + b
    # TXT IN, then an EDNS0 OPT record offering 4096-byte UDP answers (a 2048-bit key does not fit in 512)
    return q + b'\x00' + struct.pack('>HH', 16, 1) + b'\x00' + struct.pack('>HHIH', 41, 4096, 0, 0)


def _skip_name(data: bytes, pos: int) -> int:
    for _ in range(128):
        if pos >= len(data):
            raise DkimTemp('malformed answer')
        n = data[pos]
        if n == 0:
            return pos + 1
        if n & 0xC0 == 0xC0:
            return pos + 2
        pos += 1 + n
    raise DkimTemp('malformed answer')


def dns_txt_answer(data: bytes, qid: int) -> list[str]:
    """TXT strings out of a DNS answer. [] = no such name or no TXT (a permanent "no key"); DkimTemp = try later."""
    if len(data) < 12:
        raise DkimTemp('short answer')
    rid, flags, qd, an, _, _ = struct.unpack('>HHHHHH', data[:12])
    if rid != qid or not flags & 0x8000:
        raise DkimTemp('answer does not match the question')
    if flags & 0x0200:
        raise _Truncated()
    rcode = flags & 0x000F
    if rcode == 3:
        return []
    if rcode != 0:
        raise DkimTemp(f'rcode {rcode}')
    pos = 12
    for _ in range(qd):
        pos = _skip_name(data, pos) + 4
    out = []
    for _ in range(an):
        pos = _skip_name(data, pos)
        if pos + 10 > len(data):
            raise DkimTemp('malformed answer')
        rtype, rclass, _, rdlen = struct.unpack('>HHIH', data[pos:pos + 10])
        pos += 10
        rdata = data[pos:pos + rdlen]
        pos += rdlen
        if len(rdata) != rdlen:
            raise DkimTemp('malformed answer')
        if rtype == 16 and rclass == 1:
            chunks, j = [], 0
            while j < len(rdata):
                chunks.append(rdata[j + 1:j + 1 + rdata[j]])
                j += 1 + rdata[j]
            out.append(b''.join(chunks).decode('ascii', 'replace'))
    return out


def _recv_exact(s: socket.socket, n: int) -> bytes:
    buf = b''
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise OSError('closed')
        buf += chunk
    return buf


def dns_txt(name: str, servers: list[str] | None = None, timeout: float = 3.0) -> list[str]:
    servers = servers or resolvers()
    last = 'no resolver answered'
    for server in servers:
        family = socket.AF_INET6 if ':' in server else socket.AF_INET
        for _ in range(2):
            qid = secrets.randbits(16)
            q = dns_query(name, qid)
            try:
                with socket.socket(family, socket.SOCK_DGRAM) as s:
                    s.settimeout(timeout)
                    s.connect((server, 53))  # connected UDP: only the resolver's own answers are read
                    s.send(q)
                    data = s.recv(65535)
                try:
                    return dns_txt_answer(data, qid)
                except _Truncated:
                    with socket.create_connection((server, 53), timeout=timeout) as t:
                        t.sendall(struct.pack('>H', len(q)) + q)
                        data = _recv_exact(t, struct.unpack('>H', _recv_exact(t, 2))[0])
                    return dns_txt_answer(data, qid)
            except DkimTemp as e:
                last = str(e)
            except (OSError, _Truncated) as e:
                last = type(e).__name__
    raise DkimTemp(last)


def to_addresses(mail: Mail) -> set[str]:
    """Every address in the (single — _SINGLE_FIELDS) To field, lower case."""
    try:
        return {a.strip().lower() for _, a in email.utils.getaddresses(mail.values('to')) if a.strip()}
    except Exception:  # noqa: BLE001
        return set()


def linkedin_auth(mail: Mail, cfg: Config, lookup, now: dt.datetime) -> tuple[str, str]:
    """('pass' | 'fail' | 'temp', why) — the module header's LinkedIn rule: our own DKIM check of a linkedin.com
    signature covering From and To, and To is our subscriber (LINKEDIN_ALERT_TO). No Authentication-Results header is
    consulted.
    ⛔ To is compared EXACTLY, case aside — never as "the inbox it reaches" (opus, gate 8g): Gmail delivers
    vietnameno+x@ and viet.nameno@ to our inbox, but to LinkedIn they can be another member's account, and that
    member's alerts must not count as ours. LinkedIn writes the address as the account stores it; if a dry run shows
    another spelling of ours, LINKEDIN_ALERT_TO is changed — by a person, after looking."""
    verdict, own = dkim_verify(mail, LINKEDIN_DOMAIN, lookup, now, required=('from', 'to'))
    if verdict != 'pass':
        return verdict, f'own DKIM check: {own}'
    if not to_addresses(mail) & {a.lower() for a in LINKEDIN_ALERT_TO}:
        return 'fail', f'signed, but not addressed to {" or ".join(LINKEDIN_ALERT_TO)} — an alert someone else subscribed to'
    return 'pass', f'own DKIM check {own}'


# ── LinkedIn alert → jobs ───────────────────

#: Any linkedin.com job page link — the per-recipient /comm/ form, a slugged public URL, a country subdomain — and
#: its id.
_JOB_URL = re.compile(r'(?<![a-z0-9-])(?:https?://)?(?:[a-z0-9-]+\.)*linkedin\.com/(?:comm/)?jobs/view/'
                      r'(?:[^\s/?#"\'<>]*?-)?(\d{6,20})(?![\w-])', re.I)
_ANY_URL = re.compile(r'<?(?:https?://|www\.)[^\s<>]+>?', re.I)
_SEPARATOR = re.compile(r'^[\s\-=_*~·•.|]{5,}$')

#: Lines that are never a title, a company or a location (folded text, whole line).
_NOISE = re.compile(r'^(?:' + '|'.join([
    r'(?:view|see|open|check out) (?:this |the )?(?:job|position|role|posting|details)(?: details)?:?',
    r'apply(?: now| here)?:?', r'easy apply', r'apply with (?:your )?(?:resume|profile).*',
    r'promoted(?: by hirer)?', r'(?:this company is )?(?:actively )?(?:recruiting|hiring)(?: now)?',
    r'(?:be an )?early applicant', r'new', r'reposted.*', r'top applicant',
    r"you(?:'re| are) (?:a|one of the) top applicants?.*", r'how you match.*',
    r'(?:over )?\d[\d,.]*\+? applicants?',
    r'\d+ (?:company |school )?alum(?:ni|nae|nus|na)?(?: works? here)?', r'\d+ connections?(?: works? here)?',
    r'alum(?:ni|nae|nus|na)?',
    r'in your network', r'responses managed off linkedin',
    r'(?:hiring|recruiting) (?:multiple|\d+) (?:candidates|people)',
    r'(?:posted |reposted )?\d+ (?:second|minute|hour|day|week|month)s? ago', r'just now', r'today', r'yesterday',
    r'your job alert for .*', r'(?:\d+\+? )?new jobs? (?:match|matches|for|in|similar|near) .*',
    r'jobs? you may be interested in', r'(?:top )?job picks for you', r'based on your .*',
    r'see all (?:\d+\+? )?jobs.*', r'see more jobs.*', r'(?:search|find) (?:for )?(?:more|other|similar) jobs.*',
    r'(?:manage|edit) (?:your )?(?:job )?alerts?.*',
    r'unsubscribe.*', r'help(?: center| centre)?', r'learn why we included this.*', r'this email was intended for .*',
    r"you(?:'re| are) receiving .*", r'(?:©|\(c\)|copyright) .*', r'linkedin(?: corporation)?',
    r'.*registered trademarks? of linkedin.*',
    r'.*1000 w(?:est)? maude.*', r'job alerts?', r'(?:try|get|reactivate) premium.*',
    r'job search smarter with premium.*',
    r'premium', r'(?:hi|hello|dear) [^,]{1,40},',
    r'verified', r'(?:medical|dental|vision) benefits?', r'\d+ benefits?',
    r'xem (?:viec lam|cong viec|chi tiet).*', r'ung tuyen(?: de dang| ngay)?:?', r'(?:dang )?tuyen dung tich cuc',
    r'duoc quang cao',
    r'moi', r'[\-=_*~·•.|:]*',
]) + r')$')
_SALARY_START = re.compile(r'^(?:[₫$€£]|vnd|usd)?\s?\d')
_SALARY_MARK = re.compile(r'[₫$€£]|\bvnd\b|\busd\b|\btr\b|trieu|million|\d\s?[km]\b|'
                          r'/\s?(?:month|mo|hour|hr|h|year|yr|week|wk)\b|'
                          r'\bper (?:month|hour|year|week|lesson|session|class)\b')
_META = re.compile(r'^(?:(?:salary|luong|pay)\b.*|on-?site|hybrid|remote|(?:full-?time|part-?time|contract|temporary|'
                   r'internship|volunteer|freelance|toan thoi gian|ban thoi gian)(?:\s?[·,|]\s?.*)?|'
                   r'(?:entry|associate|mid-senior|senior|director|executive|internship) level)$')
_VN_PLACES = ('ho chi minh', 'hcm', 'hcmc', 'tp hcm', 'tp. hcm', 'tphcm', 'thanh pho ho chi minh', 'saigon',
              'sai gon', 'ha noi', 'hanoi', 'da nang', 'danang', 'hai phong', 'haiphong', 'can tho', 'nha trang',
              'bien hoa', 'vung tau', 'ba ria', 'binh duong', 'thu dau mot', 'di an', 'thuan an', 'dong nai',
              'long an', 'thu duc', 'hue', 'quang ninh', 'ha long', 'halong', 'da lat', 'dalat', 'lam dong',
              'phu quoc', 'kien giang', 'khanh hoa', 'bac ninh', 'hai duong', 'hung yen', 'vinh phuc',
              'thai nguyen', 'nam dinh', 'ninh binh', 'thanh hoa', 'nghe an', 'vinh', 'quy nhon', 'binh dinh',
              'buon ma thuot', 'dak lak', 'quang nam', 'hoi an', 'quang ngai', 'tay ninh', 'tien giang',
              'ben tre', 'an giang', 'dong thap', 'vinh long', 'soc trang', 'ca mau', 'bac giang', 'phu tho',
              r'district \d+', r'quan \d+')
#: A place may come as "Thành Phố Quảng Ngãi" even in an English alert (a real one, June 2025): "city/province of" first.
_LOCATION = re.compile(r'(?:^|,\s*)(?:viet ?nam|vn)\s*(?:\((?:remote|hybrid|on-?site)\))?$|'
                       r'\b(?:remote|hybrid|on-?site)\b|\bmetropolitan area\b|'
                       r'^(?:(?:thanh pho|tinh|tp\.?)\s+)?'
                       r'(?:' + '|'.join(p.replace('.', r'\.') if '\\' not in p else p for p in _VN_PLACES) + r')\b')


def _job_ids(line: str) -> list[str]:
    found = []
    for text in (line, urllib.parse.unquote(line)) if '%' in line else (line,):
        for m in _JOB_URL.finditer(text):
            if m.group(1) not in found:
                found.append(m.group(1))
    return found


def _strip_urls(line: str) -> str:
    return ' '.join(_ANY_URL.sub(' ', line).split()).strip(' :|·•-–—')


def _is_meta(f: str) -> bool:
    return bool(_META.match(f)) or bool(_SALARY_START.match(f) and _SALARY_MARK.search(f))


def _is_loc(s: str) -> bool:
    return bool(_LOCATION.search(fold(s)))


def _dot_split(s: str) -> list[str]:
    return [p.strip() for p in re.split(r'\s+[·•|]\s+', s) if p.strip()]


def _split_at(s: str) -> tuple[str, str | None]:
    m = re.match(r'^(.{2,}?)\s+at\s+(.{2,})$', s)
    return (m.group(1), m.group(2)) if m else (s, None)


def _split_dash(s: str) -> tuple[str, str | None]:
    for sep in (' – ', ' — ', ' - ', ' | '):
        if sep in s:
            left, right = s.rsplit(sep, 1)
            if _is_loc(right):
                return left.strip(), right.strip()
    return s, None


def _card_lines(region: list[str]) -> tuple[list[str], list[str]]:
    """(candidate lines for title/company/location, snippet lines: pay, workplace, contract, a description)."""
    keep, snippet = [], []
    for raw in region:
        t = _strip_urls(raw)
        if not t or _SEPARATOR.match(t):
            continue
        f = fold(t)
        if _NOISE.match(f):
            continue
        if _is_meta(f):
            snippet.append(t)
        elif len(t) > 160:
            snippet.append(clip(t, 300))
        else:
            keep.append(t)
    return keep, snippet


def _card_before(region: list[str]):
    """The plain-text layout: Title / Company / Location (or "Company · Location") / … / "View job: <url>"."""
    c, snippet = _card_lines(region)
    if not c:
        return None
    title = company = location = None
    parts = _dot_split(c[-1])
    if len(parts) >= 2:
        if len(c) >= 2:
            title, company, location = c[-2], parts[0], ' · '.join(parts[1:])
        elif len(parts) >= 3:
            title, company, location = parts[0], parts[1], ' · '.join(parts[2:])
        elif _is_loc(parts[1]):
            title, location = parts
        else:
            title, company = parts
    elif len(c) >= 3:
        # an insight line the noise list does not know, under the location, must not shift the three
        if len(c) >= 4 and not _is_loc(c[-1]) and _is_loc(c[-2]):
            title, company, location = c[-4], c[-3], c[-2]
        else:
            title, company, location = c[-3], c[-2], c[-1]
    elif len(c) == 2:
        title = c[0]
        company, location = _split_dash(c[1])  # "Wall Street English - Hanoi, Vietnam"
        if location is None and _is_loc(c[1]):
            (title, company), location = _split_at(c[0]), c[1]
    else:
        title, company = _split_at(c[0])
    return title, company, location, snippet


def _card_after(head: str, region: list[str]):
    """The HTML layout (and "Title: <url>" lines): the link first, then Title / "Company · Location" or Company /
    Location. The region runs to the next job's link, so only the card's first lines are read and a location must look
    like one — the last card's region runs into the footer."""
    c, snippet = _card_lines(region[:40])
    c = c[:8]
    if head:
        c = [head] + c
    if not c:
        return None
    title, rest = c[0], c[1:]
    company = location = None
    tparts = _dot_split(title)
    if len(tparts) >= 2 and not rest:
        title, company, location = tparts[0], tparts[1], ' · '.join(tparts[2:]) or None
        if location is None and _is_loc(company):
            company, location = None, company
    elif rest:
        parts = _dot_split(rest[0])
        if len(parts) >= 2:
            company, location = parts[0], ' · '.join(parts[1:])
        else:
            company, location = _split_dash(rest[0])
            if location is None and _is_loc(rest[0]):
                company, location = None, rest[0]
            elif location is None and len(rest) >= 2 and _is_loc(rest[1]):
                location = rest[1]
    if company is None and location is None:
        title, company = _split_at(title)
    return title, company, location, snippet


def parse_linkedin(text: str, html_mode: bool) -> list[tuple[str, tuple]]:
    """[(job id, (title, company, location, snippet lines))] in the order the alert lists them. Format-tolerant: every
    linkedin.com/(comm/)jobs/view/<id> link is a job; its card is read backward from the link in plain text (the card
    ends with "View job: <url>") and forward from it in HTML, each falling back to the other."""
    lines = text.split('\n')
    ids_at = {i: ids for i, line in enumerate(lines) if (ids := _job_ids(line))}
    url_lines = sorted(ids_at)
    seen: set[str] = set()
    jobs = []
    for n, i in enumerate(url_lines):
        for j in ids_at[i]:
            if j in seen:
                continue
            seen.add(j)
            # back to the previous link line (i is j's FIRST line, so every earlier link is another job's) …
            lo = url_lines[n - 1] + 1 if n else 0
            for k in range(i - 1, lo - 1, -1):
                if _SEPARATOR.match(lines[k].strip()):
                    lo = k + 1
                    break
            # … forward to the next line linking another job (a card's own second link — logo, title — is inside it)
            hi = next((url_lines[q] for q in range(n + 1, len(url_lines)) if any(x != j for x in ids_at[url_lines[q]])),
                      len(lines))
            for k in range(i + 1, hi):
                if _SEPARATOR.match(lines[k].strip()):
                    hi = k
                    break
            head = _strip_urls(lines[i])
            fh = fold(head)
            if not head or _NOISE.match(fh) or _is_meta(fh):
                head = ''
            if head:
                card = _card_after(head, lines[i + 1:hi])
            elif html_mode:
                # a link whose own text is a label ("View job" button) closes a card written ABOVE it; a logo or
                # title link opens one written below it
                first = next((t for t in map(_strip_urls, lines[i + 1:hi]) if t), '')
                if first and _NOISE.match(fold(first)):
                    card = _card_before(lines[lo:i]) or _card_after('', lines[i + 1:hi])
                else:
                    card = _card_after('', lines[i + 1:hi]) or _card_before(lines[lo:i])
            else:
                card = _card_before(lines[lo:i]) or _card_after('', lines[i + 1:hi])
            jobs.append((j, card))
    return jobs


_QUOTED = re.compile(r'(?:^|[\s(:])[“"«‘\']([^“”"«»‘’\']{2,120})[”"»’\'](?=$|[\s:,.)!?])')
#: ⛔ Where a search phrase ends. LinkedIn's 2026 text part runs its "Manage your job alerts: <link>" onto the opening
#: line — "Your job alert for student in MumbaiManage your job alerts: https://…&midToken=…&midSig=…" (a real alert,
#: 11 Oct 2026) — and those links carry the recipient's own tokens (midToken, midSig, otpToken: treated as sign-in
#: material), so nothing from a link may ever reach sourceRef.
_PHRASE_END = re.compile(r'manage (?:your )?(?:job )?alerts?|https?:|www\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}/', re.I)
#: LinkedIn's mail confirming a NEW alert — it carries jobs too — says "Your job alert for Teacher in Ho Chi Minh City,
#: Vietnam has been created" (measured 2026-10-21, the first alert through the Gmail forward): in that sentence, and
#: only there, the search is what comes before "has been created" (codex, gate 10a).
_ALERT_FOR = r'job alert for\s+(.+?)(?:\s+has been created)?[\s.!:]*$'


def _phrase(s: str) -> str | None:
    s = re.sub(r'[\s.!:]+$', '', _PHRASE_END.split(s, 1)[0].strip())
    if not s or re.search(r'linkedin\.com|[?=]', s, re.I):
        return None
    return clip(s, SHORT_MAX)


def alert_phrase(subject: str, text: str) -> str | None:
    """The alert's search ("english teacher") when the subject names it — quoted, or "job alert for …" — else the
    "Your job alert for …" line of the body; cut where a link or LinkedIn's "Manage your job alerts" starts."""
    for m in (_QUOTED.search(subject), re.search(r'\b' + _ALERT_FOR, subject, re.I),
              re.search(r'\bnew jobs? for\s+(.+?)[\s.!:]*$', subject, re.I)):
        if m and (p := _phrase(m.group(1))):
            return p
    for line in text.split('\n')[:15]:
        m = re.match(r'^your ' + _ALERT_FOR, line.strip(), re.I)
        if m:
            return _phrase(m.group(1))
    return None


def linkedin_url(job_id: str) -> str:
    """The canonical job page: tracking parameters and the per-recipient /comm/ form dropped (ingest.ts LI_JOB)."""
    return f'https://www.linkedin.com/jobs/view/{job_id}/'


def guess_lang(text: str) -> str:
    """'vi' when Vietnamese dominates: words carrying Vietnamese letters (ă â đ ê ô ơ ư or a tone mark) are ≥35% of the
    words — Vietnamese prose runs 60–80% (a third of its syllables carry no mark), English with Vietnamese place names
    stays under 15%, so 35% means Vietnamese is at least about half the post."""
    words = re.findall(r'[^\W\d_]+', unicodedata.normalize('NFC', text))
    if not words:
        return 'en'
    vi = sum(1 for w in words if any(ch in _VI_LETTERS for ch in w.lower()))
    return 'vi' if vi / len(words) >= 0.35 else 'en'


_VI_LETTERS = frozenset('àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ')


NO_JOBS = 'no LinkedIn job links in the alert'


def linkedin_posts(mail: Mail, now: dt.datetime) -> tuple[list[dict], str]:
    plain, htm = body_texts(mail)
    subject = decode_words(mail.first('subject') or '')
    jobs, text = [], ''
    if plain.strip():
        text = clean_text(plain)
        jobs = [j for j in parse_linkedin(text, html_mode=False) if j[1] and j[1][0]]
    if not jobs and htm.strip():
        text = html_to_text(htm, links='marker')
        jobs = [j for j in parse_linkedin(text, html_mode=True) if j[1] and j[1][0]]
    if not jobs:
        return [], NO_JOBS
    when, too_old = posted_at(mail, now)
    if too_old:
        return [], f'the alert is older than {POSTED_MAX_AGE_DAYS} days'
    ref = alert_phrase(subject, text)
    posts = []
    for job_id, (title, company, location, snippet) in jobs[:MAX_JOBS_PER_ALERT]:
        title, company, location = (clip(x.strip(), SHORT_MAX) if x and x.strip() else None
                                    for x in (title, company, location))
        if not title:
            continue
        body = ' · '.join(x for x in (title, company, location) if x)
        if snippet:
            body += '\n' + '\n'.join(dict.fromkeys(snippet[:4]))
        post = {'source': 'linkedin', 'externalKey': job_id, 'sourceName': LINKEDIN_SOURCE_NAME, 'sourceRef': ref,
                'url': linkedin_url(job_id), 'title': title, 'company': company, 'locationText': location,
                'text': clip(body, TEXT_MAX), 'lang': guess_lang(body), 'postedAt': when}
        posts.append({k: v for k, v in post.items() if v is not None})
    more = f' (first {MAX_JOBS_PER_ALERT} of {len(jobs)})' if len(jobs) > MAX_JOBS_PER_ALERT else ''
    return posts, f'{len(posts)} job(s){more}'


# ── Team forward → one post ─────────────────

#: "JOB: …", also under "Fwd:"/"Fw:"/"TR:"/"Chuyển tiếp:" — never "Re: JOB:" (a reply is a conversation, not a post).
_JOB_SUBJECT = re.compile(r'^\s*(?:(?:fwd?|fw|tr|chuyển tiếp|chuyen tiep)\s*[:：]\s*)*job\s*[:：]\s*(.*)$', re.I | re.S)
_APPLY = re.compile(r'^\s*(?:[-*•]\s*)?apply\s*[:：]\s*(.*)$', re.I)
_FWD_BANNER = re.compile(r'^(?:-{2,}\s*(?:forwarded message|original message|tin nhắn đã chuyển tiếp|'
                         r'thư đã chuyển tiếp)\s*-{2,}|begin forwarded message:?)$', re.I)
_FWD_FIELD = re.compile(r'^(?:from|date|sent|subject|to|cc|reply-to|từ|ngày|gửi|chủ đề|tới|đến)\s*:', re.I)
_QUOTE_INTRO = re.compile(r'^(?:on .{4,200} wrote:|vào .{4,200} đã viết:)$', re.I)
#: A contact in the subject: the title is dropped here (it is optional; the post's own text keeps the line), on top of
#: ingest.ts, which masks every printed short field too since part 7a. The same four patterns as ingest.ts maskContacts.
_CONTACT = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:https?://)?(?:zalo\.me|wa\.me|m\.me|t\.me|line\.me|fb\.me)/\S+|'
                      r'(?:\+?84|0)(?:[\s.-]?\d){8,10}\b|\+\d{1,3}(?:[\s.-]?\d){7,12}\b', re.I)


def apply_line(text: str) -> str | None:
    """The team's "Apply: …" line (any case), or the line under a bare "Apply:" — the post's application path."""
    lines = text.split('\n')
    for i, line in enumerate(lines):
        m = _APPLY.match(line)
        if not m:
            continue
        v = m.group(1).strip()
        if not v:
            v = next((x.strip() for x in lines[i + 1:i + 3] if x.strip()), '')
        if v:
            return clip(v, SHORT_MAX)
    return None


def team_body(text: str) -> str:
    """The post itself: forwarded-header blocks (third-party addresses), a trailing quoted reply and the sender's own
    signature (a last "--" line with at most 8 lines under it) are cut. Never anything in the middle of the post."""
    lines = text.split('\n')
    out: list[str] = []
    i = 0
    while i < len(lines):
        if _FWD_BANNER.match(lines[i].strip()):
            # the banner, blank lines under it, then the forwarded message's From:/Date:/Subject:/To: lines
            i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1
            while i < len(lines) and _FWD_FIELD.match(lines[i].strip()):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    while out and (not out[-1].strip() or out[-1].lstrip().startswith('>')):
        out.pop()
    if out and _QUOTE_INTRO.match(out[-1].strip()):
        out.pop()
    sig = [k for k, line in enumerate(out) if line.strip() in ('--', '-- ')]
    if sig and sig[-1] > 0 and sum(1 for line in out[sig[-1] + 1:] if line.strip()) <= 8:
        out = out[:sig[-1]]
    return clean_text('\n'.join(out))


def team_posts(mail: Mail, now: dt.datetime) -> tuple[list[dict], str]:
    subject = decode_words(mail.first('subject') or '')
    m = _JOB_SUBJECT.match(subject)
    if not m:
        return [], 'subject is not "JOB: …"'
    title = clip(' '.join(m.group(1).split()), SHORT_MAX) or None
    if title and _CONTACT.search(title):
        title = None
    plain, htm = body_texts(mail)
    text = clean_text(plain) if plain.strip() else html_to_text(htm, links='inline') if htm.strip() else ''
    # The Apply line of the POST — read after the quoted reply, forwarded headers and signature are cut, and never a
    # "> Apply:" line: an older job's contact quoted under a new one is not this job's (codex, gate 7a).
    text = team_body(text)
    apply = apply_line(text)
    text = text or (title or '')
    if not text:
        return [], 'no text (a screenshot alone cannot be read — paste the post)'
    when, too_old = posted_at(mail, now)
    if too_old:
        return [], f'the forward is older than {POSTED_MAX_AGE_DAYS} days'
    mid = (mail.first('message-id') or '').strip()
    key = hashlib.sha256(mid.encode('utf-8') if mid else
                         b'no-message-id\n' + mail.raw).hexdigest()
    post = {'source': 'intake', 'externalKey': key, 'sourceName': TEAM_SOURCE_NAME, 'title': title, 'applyText': apply,
            'text': clip(text, TEXT_MAX), 'lang': guess_lang(text), 'postedAt': when}
    return [{k: v for k, v in post.items() if v is not None}], f'1 post, {"with" if apply else "NO"} Apply: line'


# ── Reading one message ─────────────────────

class Outcome:
    """What one message gave: posts to send ('posts'), nothing (skip — done for good), or try again later (retry).
    `notice`: LinkedIn wrote, but not jobs — the notice's id (notice_id); a person must read it (EXIT_NOTICE)."""

    def __init__(self, status: str, kind: str = '-', posts: list[dict] | None = None, why: str = '',
                 notice: str = ''):
        self.status, self.kind, self.posts, self.why, self.notice = status, kind, posts or [], why, notice


#: ⛔ Fields a message carries at most once (RFC 5322 §3.6). DKIM signs the LAST instance of a name and the MIME parser
#: reads the FIRST, so a second, unsigned Subject/Date/Content-Type written above a genuine signed one would be read
#: as LinkedIn's — refused instead.
_SINGLE_FIELDS = ('from', 'sender', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type',
                  'content-transfer-encoding')


def read_message(raw: bytes, cfg: Config, lookup, now: dt.datetime) -> Outcome:
    try:
        mail = Mail(raw)
        if mail.malformed:
            return Outcome('skip', why='malformed header block')
        twice = [n for n in _SINGLE_FIELDS if len(mail.values(n)) > 1]
        if twice:
            return Outcome('skip', why=f'{twice[0]} header more than once')
        sender = from_address(mail)
        if sender is None:
            return Outcome('skip', why='From is not exactly one readable address')
        if sender in cfg.linkedin_senders:
            verdict, why = linkedin_auth(mail, cfg, lookup, now)
            if verdict == 'temp':
                return Outcome('retry', 'linkedin', why=why)
            if verdict != 'pass':
                return Outcome('skip', 'linkedin', why=f'not authenticated as LinkedIn — {why}')
            posts, what = linkedin_posts(mail, now)
            if what == NO_JOBS:
                # ⚠️ LinkedIn writes from the alert address without jobs too — an alert made or deleted, and two weeks
                # before it switches off an alert nobody has opened for 3 months (this reader never opens one) — and a
                # changed layout reads as no jobs as well. Either way a person must look (research 2026-10-21).
                tpl, nid = _tok(mail.first('x-linkedin-template') or '-'), notice_id(mail)
                return Outcome('posts', 'linkedin', [], f'LINKEDIN NOTICE {nid}, no job in it (template {tpl}): an alert '
                               f'made or deleted, LinkedIn about to switch off an alert nobody opened for 3 months, or '
                               f'a layout this reader no longer reads — open it in {MAILBOX_USER} (auth: {why})',
                               notice=nid)
            return Outcome('posts', 'linkedin', posts, f'{what} (auth: {why})')
        if sender in cfg.team:
            ok, why = team_auth(mail, sender, cfg)
            if not ok:
                return Outcome('skip', 'team', why=f'not a team submission — {why}')
            posts, what = team_posts(mail, now)
            return Outcome('posts', 'team', posts, f'{what} ({why})')
        return Outcome('skip', why='sender is on neither list')  # the FROM search matched a substring
    except DkimTemp as e:
        return Outcome('retry', 'linkedin', why=f'key lookup failed ({e})')
    except Exception as e:  # noqa: BLE001 — never a message's content in the log: the type and our line only
        tb = e.__traceback__
        while tb and tb.tb_next:
            tb = tb.tb_next
        return Outcome('skip', why=f'unreadable message ({type(e).__name__} at line {tb.tb_lineno if tb else "?"})')


# ── The app — POST /api/cron/job-posts ──────

class AppError(Exception):
    pass


class App:
    def __init__(self, runner=run):
        self.runner = runner
        self._secret: str | None = None

    def secret(self) -> str:
        if self._secret is None:
            rc, out, err = self.runner(['docker', 'exec', APP_CONTAINER, 'printenv', 'CRON_SECRET'], timeout=30)
            s = out.decode('utf-8', 'replace').rstrip('\r\n') if rc == 0 else ''
            if not s or '\n' in s or '\r' in s:
                raise AppError(f'no CRON_SECRET in {APP_CONTAINER} (exit {rc}: {_short(err)})')
            self._secret = s
        return self._secret

    def post(self, posts: list[dict]) -> dict:
        """One request; the answer's three lists, or AppError (nothing stored that the reader may rely on)."""
        body = json.dumps({'posts': posts}, ensure_ascii=True, separators=(',', ':')).encode('ascii')
        with tempfile.TemporaryDirectory(prefix='eno-job-mailbox-') as d:
            path = os.path.join(d, 'auth')
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as f:
                f.write(f'Authorization: Bearer {self.secret()}\n')
            rc, out, err = self.runner(['curl', '--fail-with-body', '-sS', '--max-time', '120', '-X', 'POST', APP_URL,
                                        '-H', f'Host: {APP_HOST}', '-H', 'Content-Type: application/json',
                                        '-H', f'@{path}', '--data-binary', '@-'], data=body, timeout=150)
        if rc != 0:
            # A request refused WHOLE (a 4xx/5xx; curl 8.5 on the box): its error CODE says why — logged only when it IS a
            # plain code like the door's ("too_many_posts"), never anything else from the body (opus, 7b4 + fix7).
            try:
                code = json.loads(out).get('error') if rc == 22 and out else None
            except (ValueError, AttributeError):
                code = None
            why = f' ({code})' if isinstance(code, str) and re.fullmatch(r'[a-z_]{1,40}', code) else ''
            raise AppError(f'curl exit {rc}{why}: {_short(err)}')
        try:
            res = json.loads(out)
        except ValueError:
            raise AppError('the answer is not JSON') from None
        ok = (isinstance(res, dict) and all(isinstance(res.get(k), list) for k in ('accepted', 'duplicate', 'rejected'))
              and all(isinstance(x, str) for k in ('accepted', 'duplicate') for x in res[k])
              and all(isinstance(r, dict) and isinstance(r.get('key'), str) for r in res['rejected']))
        if not ok:
            raise AppError('the answer has no accepted/duplicate/rejected lists')
        return res


# ── State — the checkpoint ──────────────────

def load_state(path: str) -> dict | None:
    try:
        with open(path, encoding='utf-8') as f:
            st = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        log('state file unreadable — starting from the last days again (the server dedupes)')
        return None
    ok = (isinstance(st, dict) and isinstance(st.get('uidvalidity'), int) and st['uidvalidity'] > 0
          and isinstance(st.get('lastUid'), int) and st['lastUid'] >= 0
          and isinstance(st.get('pending', {}), dict))
    if not ok:
        log('state file malformed — starting from the last days again (the server dedupes)')
        return None
    st['pending'] = {k: v for k, v in st.get('pending', {}).items()
                     if isinstance(k, str) and k.isdigit() and isinstance(v, str) and parse_iso(v)}
    if not (isinstance(st.get('linkedinAt'), str) and parse_iso(st['linkedinAt'])):
        st.pop('linkedinAt', None)
    notices = st.pop('notices', None)
    if isinstance(notices, dict):
        kept = {k: v for k, v in notices.items() if isinstance(k, str) and _NOTICE_ID.match(k) and isinstance(v, dict)
                and isinstance(v.get('uid'), int) and isinstance(v.get('at'), str) and parse_iso(v['at'])}
        if kept:
            st['notices'] = kept
    acked = st.pop('acked', None)
    if isinstance(acked, dict):
        kept = {k: v for k, v in acked.items() if isinstance(k, str) and _NOTICE_ID.match(k) and isinstance(v, str)
                and parse_iso(v)}
        if kept:
            st['acked'] = kept
    return st


#: ⛔ A notice is the MESSAGE, not its UID (codex + opus, gate 8e): a UID means something only until the mailbox is
#: rebuilt, and a re-read (--since-days, a rebuild's window) must find an acknowledged notice acknowledged. So its id is
#: its Message-ID's hash (notice_id), the waiting ones are kept as id → {uid (now), at (first seen)}, and acknowledged
#: ids stay in `acked`. ⛔ NEITHER LIST IS CAPPED (codex, gate 8f): dropping a waiting notice forgets one nobody has read,
#: and dropping an acknowledged id raises it again. Both grow only as fast as LinkedIn writes notices and a person reads
#: them — a few a year.
_NOTICE_ID = re.compile(r'^[0-9a-f]{12}$')


def notice_id(mail: Mail) -> str:
    """The Message-ID's hash — or, with none, the hash of what each delivery leaves as it was (Date, Subject, the body),
    never of the raw message: every delivery puts its own Received and Delivered-To on top (opus, gate 8g)."""
    mid = (mail.first('message-id') or '').strip()
    basis = (mid.encode('utf-8') if mid else
             b'\n'.join(((mail.first('date') or '').encode('utf-8'), (mail.first('subject') or '').encode('utf-8'),
                         mail.body)))
    return hashlib.sha256(basis).hexdigest()[:12]


def notices_waiting(notices: dict[str, dict]) -> None:
    """Say, every run, which LINKEDIN NOTICEs no one has acknowledged yet (they fail the unit until then), and the exact
    command that acknowledges THESE — never one that arrives after this line was read."""
    ids = sorted(notices, key=lambda k: (notices[k]['at'], k))
    listed = ', '.join(f'{k} (uid={notices[k]["uid"]})' for k in ids)
    log(f'LINKEDIN NOTICE waiting since {notices[ids[0]]["at"]}: {len(ids)} not acknowledged — {listed}. Read them in '
        f'{MAILBOX_USER} (LinkedIn may be about to switch an alert off), click what they ask, then: '
        f'python3 -I /opt/eno/bin/eno-job-mailbox.py --ack-notices {",".join(ids)}')


def ack_notices(cfg: Config, ids: list[str], now: dt.datetime | None = None) -> int:
    """--ack-notices ID[,ID…]: a person has read THESE notices, so they stop failing the unit and a re-read never raises
    them again. Only ids that are waiting; nothing else in the state changes."""
    now = now or dt.datetime.now(dt.timezone.utc)
    lock = take_lock(cfg.state_path)
    if lock is None:
        log('a run holds the lock — try again in a minute')
        return EXIT_ERROR
    try:
        st = load_state(cfg.state_path) or {}
        waiting = st.get('notices') or {}
        unknown = [i for i in ids if i not in waiting]
        if unknown:
            log(f'not waiting: {",".join(unknown)} — nothing acknowledged. Waiting now: '
                f'{",".join(sorted(waiting)) or "none"} (the last "LINKEDIN NOTICE waiting" line has the command)')
            return EXIT_ERROR
        acked = {**(st.get('acked') or {}), **{i: iso(now) for i in ids}}
        left = {k: v for k, v in waiting.items() if k not in ids}
        rest = {k: v for k, v in st.items() if k not in ('notices', 'acked')}
        save_state(cfg.state_path, {**rest, 'acked': acked, **({'notices': left} if left else {})})
        log(f'acknowledged {len(ids)} LinkedIn notice(s): {",".join(ids)}' + (f' — {len(left)} still waiting' if left
                                                                               else ''))
        return EXIT_OK
    finally:
        os.close(lock)


def linkedin_silence(cfg: Config, at: dt.datetime | None, now: dt.datetime, dry_run: bool) -> bool:
    """True when LinkedIn has gone quiet — no alert with jobs for cfg.silent_days days since the last one read, or since
    the reader's first run (LINKEDIN_SILENT_DAYS) — said in the log every run it lasts; a dry run only says it."""
    if not cfg.silent_days or at is None or now - at <= dt.timedelta(days=cfg.silent_days):
        return False
    log(f'LINKEDIN SILENT: no LinkedIn alert with jobs since {iso(at)} ({(now - at).days} days). LinkedIn switches off '
        f'alerts nobody opens for 3 months, and a deleted Gmail filter or a stopped forward look the same: check the '
        f'job alerts of the LinkedIn account {LINKEDIN_ALERT_TO[0]} and its Gmail filter (README, "LinkedIn alerts"). '
        'ENO_JOB_MAILBOX_LINKEDIN_SILENT_DAYS=0 turns this check off.')
    return not dry_run


def save_state(path: str, st: dict) -> None:
    d = os.path.dirname(path) or '.'
    os.makedirs(d, mode=0o750, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.state-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(st, f, indent=1, sort_keys=True)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    try:
        dfd = os.open(d, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except OSError:
        pass


def take_lock(state_path: str) -> int | None:
    d = os.path.dirname(state_path) or '.'
    os.makedirs(d, mode=0o750, exist_ok=True)
    fd = os.open(os.path.join(d, 'lock'), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    return fd


# ── One run ─────────────────────────────────

def run_once(cfg: Config, *, dry_run: bool = False, since_days: int | None = None, runner=run, lookup=None,
             now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(dt.timezone.utc)
    for note in cfg.notes:
        log(f'setting: {note}')
    lock = None
    if not dry_run:
        lock = take_lock(cfg.state_path)
        if lock is None:
            log('another run holds the lock — nothing done')
            return EXIT_NOTHING
    try:
        return _run(cfg, dry_run, since_days, runner, lookup, now)
    finally:
        if lock is not None:
            os.close(lock)


def _run(cfg: Config, dry_run: bool, since_days: int | None, runner, lookup, now: dt.datetime) -> int:
    dove = Dovecot(cfg, runner)
    state = load_state(cfg.state_path)
    try:
        uidvalidity, uidnext = dove.status()
    except DovecotError as e:
        log(f'dovecot unreachable: {e}')
        return EXIT_UNREACHABLE
    valid = state is not None and state['uidvalidity'] == uidvalidity and state['lastUid'] < uidnext
    if state is not None and state['uidvalidity'] != uidvalidity:
        log(f'UIDVALIDITY changed ({state["uidvalidity"]} -> {uidvalidity}): the mailbox was rebuilt; '
            f'reading the last {since_days or RESET_DAYS} days again')
    elif state is not None and not valid:
        # Same UIDVALIDITY but uidnext behind the checkpoint: UIDs are being handed out again (a restore that kept the
        # UIDVALIDITY). Waiting for uidnext to pass lastUid would skip every message in between — start over instead.
        log(f'uidnext {uidnext} is behind lastUid {state["lastUid"]}: reading the last {since_days or RESET_DAYS} '
            'days again')
    last_uid = state['lastUid'] if valid else 0
    pending: dict[str, str] = dict(state['pending']) if valid else {}
    # The newest LinkedIn alert with jobs read so far (its Date) — kept through a mailbox reset: it is about LinkedIn.
    # ⚠️ Never ahead of now (codex, gate 8e): a clock set in the future — the box's clock stepped back, a hand edit —
    # would keep the silence check quiet until that time; a quiet run and a reading run both bring it back to now.
    known = linkedin_at = parse_iso(state.get('linkedinAt', '')) if state is not None else None
    # ⛔ LINKEDIN NOTICEs no one has acknowledged — kept through a reset too, and failing every run until --ack-notices
    # (codex + opus, gates 8a–8d: a one-run exit 5 is gone at the next timer run, before anyone has looked) — and the
    # acknowledged ones, which a re-read never raises again (gate 8e).
    notices: dict[str, dict] = dict(state.get('notices') or {}) if state is not None else {}
    read_notices: dict[str, str] = dict(state.get('acked') or {}) if state is not None else {}
    by_uid = valid and since_days is None
    # A --since-days re-read on a good checkpoint sends that window again (the server dedupes) and leaves the
    # checkpoint alone: the window need not reach back to it.
    moves = not (valid and since_days is not None)
    if by_uid and last_uid >= uidnext - 1:
        log(f'nothing new (lastUid {last_uid}, uidnext {uidnext})')
        if (known is None or known > now) and not dry_run:
            # a checkpoint with no clock (written before it existed, or by hand) or one ahead of now starts it here: a
            # quiet inbox must not keep the silence check off for ever (codex, gates 8c, 8e)
            linkedin_at = now
            save_state(cfg.state_path, {**state, 'linkedinAt': iso(now)})
        if notices:
            notices_waiting(notices)
        silent = linkedin_silence(cfg, linkedin_at, now, dry_run)
        return EXIT_NOTICE if (silent or notices) and not dry_run else EXIT_NOTHING
    if by_uid:
        span = ['UID', f'{last_uid + 1}:*']
    else:
        span = ['SINCE', str(int((now - dt.timedelta(days=since_days or RESET_DAYS)).timestamp()))]
    found: set[int] = set()
    try:
        for s in cfg.linkedin_senders:
            found |= dove.search([*span, 'FROM', s])
        for a in cfg.team:
            found |= dove.search([*span, 'FROM', a, 'SUBJECT', 'JOB'])
    except DovecotError as e:
        log(f'dovecot unreachable: {e}')
        return EXIT_UNREACHABLE
    # UIDs at or past the uidnext read BEFORE the searches belong to the next run: a message that arrived between two
    # searches may be in one and missing from another.
    cands = sorted(u for u in found if u < uidnext and (not by_uid or u > last_uid))
    capped = len(cands) > MAX_MESSAGES_PER_RUN
    cands = cands[:MAX_MESSAGES_PER_RUN]

    outcomes: dict[int, Outcome] = {}
    dovecot_failed = False
    cache: dict[str, list[str]] = {}

    def cached_lookup(name: str) -> list[str]:
        if name not in cache:
            cache[name] = (lookup or dns_txt)(name)
        return cache[name]

    try:
        sizes = dove.sizes(cands)
    except DovecotError as e:
        log(f'dovecot unreachable: {e}')
        sizes, dovecot_failed = {}, True
    started = time.monotonic()
    for uid in [] if dovecot_failed else cands:
        if outcomes and time.monotonic() - started > RUN_BUDGET_S:
            # The rest is 'unsent' below: the checkpoint stops at the first message not read, and the next run starts there.
            log(f'time budget ({RUN_BUDGET_S} s) used after {len(outcomes)} message(s) — the rest next run')
            break
        size = sizes.get(uid)
        if size is not None and size > cfg.max_bytes:
            outcomes[uid] = Outcome('skip', why=f'too big ({size} bytes > {cfg.max_bytes})')
        else:
            try:
                raw = dove.text(uid)
            except DovecotError as e:
                log(f'dovecot unreachable: {e}')
                dovecot_failed = True
                break
            if raw is None:
                outcomes[uid] = Outcome('skip', why='gone (expunged since the search)')
            elif len(raw) > cfg.max_bytes:
                outcomes[uid] = Outcome('skip', why=f'too big ({len(raw)} bytes > {cfg.max_bytes})')
            else:
                outcomes[uid] = read_message(raw, cfg, cached_lookup, now)
        o = outcomes[uid]
        log(f'uid={uid} {o.kind}: {o.status} — {o.why}')

    # One request per source (a LinkedIn id and an intake hash then never share a key space), ≤50 posts each, every
    # (source, key) once — the same job in two alerts is one post whose answer settles both messages.
    queue: dict[str, dict[str, dict]] = {'linkedin': {}, 'intake': {}}
    for o in outcomes.values():
        for p in o.posts:
            queue[p['source']].setdefault(p['externalKey'], p)
    verdict: dict[tuple[str, str], str] = {}
    app_failed = False
    sent = {'accepted': 0, 'duplicate': 0, 'rejected': 0}
    if dry_run:
        for source, posts in queue.items():
            items = list(posts.values())
            for i in range(0, len(items), BATCH_MAX):
                log(f'--dry-run: would POST {len(items[i:i + BATCH_MAX])} {source} post(s):')
                print(json.dumps({'posts': items[i:i + BATCH_MAX]}, ensure_ascii=False, indent=1), flush=True)
                for p in items[i:i + BATCH_MAX]:
                    verdict[(source, p['externalKey'])] = 'ack'
    else:
        app = App(runner)
        for source, posts in queue.items():
            items = list(posts.values())
            for i in range(0, len(items), BATCH_MAX):
                batch = items[i:i + BATCH_MAX]
                if app_failed:
                    continue
                try:
                    res = app.post(batch)
                except AppError as e:
                    log(f'app unreachable or refusing: {e}')
                    app_failed = True
                    continue
                acked = set(res['accepted']) | set(res['duplicate'])
                refused = {r['key']: str(r.get('reason', '?'))[:60] for r in res['rejected']}
                sent['accepted'] += len(res['accepted'])
                sent['duplicate'] += len(res['duplicate'])
                sent['rejected'] += len(res['rejected'])
                for p in batch:
                    k = p['externalKey']
                    if k in acked:
                        verdict[(source, k)] = 'ack'
                    elif k in refused:
                        verdict[(source, k)] = 'rejected'
                        log(f'rejected {source} {k}: {refused[k]}')
                    else:
                        verdict[(source, k)] = 'no-verdict'
                        log(f'no verdict for {source} {k} in the answer')

    # The checkpoint: the longest run of settled messages from the old one. In a window read, everything before the
    # window's first message counts as settled (older than the window — the reset rule).
    new_last = last_uid if by_uid else (cands[0] - 1 if cands else uidnext - 1)
    held: dict[str, str] = {}
    blocked = False
    gave_up = False
    for uid in cands:
        o = outcomes.get(uid)
        if o is None:
            state_of = 'unsent'  # never read: Dovecot failed before it
        elif o.status == 'skip' or (o.status == 'posts' and not o.posts):
            state_of = 'done'
        elif o.status == 'retry':
            state_of = 'held'
        else:
            vs = [verdict.get((p['source'], p['externalKey']), 'unsent') for p in o.posts]
            state_of = 'done' if all(v == 'ack' for v in vs) else 'unsent' if 'unsent' in vs else 'held'
        key = str(uid)
        if state_of == 'held':
            first = pending.get(key) or iso(now)
            since = parse_iso(first) or now
            if now - since >= cfg.give_up:
                why = ('its DKIM key could not be looked up' if o is not None and o.status == 'retry'
                       else 'a post was rejected or never answered')
                log(f'uid={uid}: {"--dry-run: would give up" if dry_run else "GIVING UP"} after {cfg.give_up} — {why} '
                    f'(first held {first}); once fixed: python3 -I /opt/eno/bin/eno-job-mailbox.py --since-days N')
                gave_up = True
                state_of = 'done'
            else:
                held[key] = first
        elif state_of == 'unsent' and key in pending:
            held[key] = pending[key]
        if state_of == 'done' and not blocked:
            new_last = uid
        else:
            blocked = True
    if not blocked and not capped and not dovecot_failed:
        new_last = max(new_last, uidnext - 1)
    new_last = max(new_last, last_uid) if by_uid else new_last
    held = {k: v for k, v in held.items() if int(k) > new_last}
    if moves and not dry_run:
        # Held before, and now not even a candidate — moved, deleted, or its sender no longer on a list: said, never
        # dropped silently (codex, gate 7b3). (A message read this run was settled above, held or done.)
        for k in sorted(set(pending) - set(held) - {str(u) for u in cands if outcomes.get(u) is not None}, key=int):
            log(f'uid={k}: held since {pending[k]}, no longer a candidate (moved, deleted or not matched) — dropped')

    dated = [t for o in outcomes.values() if o.kind == 'linkedin' for p in o.posts
             if (t := parse_iso(p.get('postedAt') or ''))]
    # Until a first alert with jobs comes, the clock runs from the reader's first run (codex + opus, gate 8b): a feed
    # broken from the day it was set up — the filter, the forward, the account's address — must fail too. An alert may
    # be dated up to a day ahead (posted_at); the clock never is.
    linkedin_at = min(max([t for t in (linkedin_at, *dated) if t], default=None) or now, now)
    known_notices = {k: dict(v) for k, v in notices.items()}
    for uid in sorted(outcomes):
        nid = outcomes[uid].notice
        if nid and nid in read_notices:
            log(f'uid={uid}: LINKEDIN NOTICE {nid} was acknowledged {read_notices[nid]} — not raised again')
        elif nid:
            # the same message read again (a re-read, a rebuilt mailbox) is the same notice: first seen stays, uid is now
            notices[nid] = {'uid': uid, 'at': notices.get(nid, {}).get('at') or iso(now)}
    posts_total = sum(len(q) for q in queue.values())
    summary = (f'{len(cands)} message(s){" (capped)" if capped else ""}, {posts_total} post(s)'
               + ('' if dry_run else f' — accepted {sent["accepted"]}, duplicate {sent["duplicate"]}, '
                                     f'rejected {sent["rejected"]}'))
    ledger = {**({'notices': notices} if notices else {}), **({'acked': read_notices} if read_notices else {})}
    if dry_run:
        log(f'--dry-run: {summary}; would move lastUid {last_uid} -> {new_last if moves else last_uid} '
            '(if every post is acked); nothing sent, nothing saved')
    elif moves:
        save_state(cfg.state_path, {'version': 1, 'uidvalidity': uidvalidity, 'lastUid': new_last, 'pending': held,
                                    'updatedAt': iso(now), 'linkedinAt': iso(linkedin_at), **ledger})
        log(f'{summary}; lastUid {last_uid} -> {new_last}' + (f', {len(held)} held' if held else ''))
    else:
        # The checkpoint is left alone, but an alert this re-read recovered still moves the clock (codex, gate 8b), and a
        # notice it read waits like any other.
        if linkedin_at != known or notices != known_notices:
            rest = {k: v for k, v in state.items() if k not in ('notices', 'acked')}
            save_state(cfg.state_path, {**rest, 'linkedinAt': iso(linkedin_at), **ledger})
        log(f'{summary}; --since-days re-read: checkpoint left at lastUid {last_uid}')
    # Said before any exit code is chosen: a run that also gave something up (3) or could not send (4) still logs them.
    if notices:
        notices_waiting(notices)
    silent = linkedin_silence(cfg, linkedin_at, now, dry_run)
    if dovecot_failed or app_failed:
        return EXIT_UNREACHABLE
    if gave_up and not dry_run:
        return EXIT_GAVE_UP
    if (silent or notices) and not dry_run:
        return EXIT_NOTICE
    return EXIT_OK if cands else EXIT_NOTHING


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse exits 2 on a usage error — 2 means "nothing new" here
        self.print_usage(sys.stderr)
        print(f'{self.prog}: {message}', file=sys.stderr)
        sys.exit(EXIT_ERROR)


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(errors='replace')  # a non-UTF-8 terminal must not crash a --dry-run print
    except (AttributeError, ValueError):
        pass
    ap = _Parser(prog='eno-job-mailbox', description='Read LinkedIn job alerts and team "JOB:" forwards from '
                                                     f'{MAILBOX_USER} and send them to the job-post ingest.')
    ap.add_argument('--dry-run', action='store_true', help='print what would be sent; send nothing, save nothing')
    ap.add_argument('--since-days', type=int, metavar='N',
                    help='read the last N days (1-60) instead of from the checkpoint; the server dedupes')
    ap.add_argument('--ack-notices', metavar='ID[,ID…]',
                    help='these LINKEDIN NOTICEs (ids from the "waiting" line) have been read: they stop failing the '
                         'unit and are never raised again (nothing else runs)')
    args = ap.parse_args(argv)
    if args.since_days is not None and not 1 <= args.since_days <= POSTED_MAX_AGE_DAYS:
        ap.error(f'--since-days must be 1-{POSTED_MAX_AGE_DAYS}')
    ack = None
    if args.ack_notices is not None:
        ack = list(dict.fromkeys(x.strip().lower() for x in args.ack_notices.split(',') if x.strip()))
        if not ack or not all(_NOTICE_ID.match(x) for x in ack):
            ap.error('--ack-notices takes the ids the "LINKEDIN NOTICE waiting" line prints (12 hex characters each)')
        if args.dry_run or args.since_days is not None:
            ap.error('--ack-notices runs alone')
    try:
        cfg = Config(with_settings_file(dict(os.environ)))
    except ConfigError as e:
        log(f'bad setting: {e}')
        return EXIT_ERROR
    try:
        if ack is not None:
            return ack_notices(cfg, ack)
        return run_once(cfg, dry_run=args.dry_run, since_days=args.since_days)
    except Exception as e:  # noqa: BLE001 — a bug: the unit fails (1); the type and our line, never content
        tb = e.__traceback__
        while tb and tb.tb_next:
            tb = tb.tb_next
        log(f'internal error: {type(e).__name__} at line {tb.tb_lineno if tb else "?"}')
        return EXIT_ERROR


if __name__ == '__main__':
    sys.exit(main())
