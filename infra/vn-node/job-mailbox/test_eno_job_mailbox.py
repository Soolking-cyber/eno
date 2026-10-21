"""
Tests for eno-job-mailbox.py — standard library only, no network, no docker, no mail server:

    cd infra/vn-node/job-mailbox && python3 -B -m unittest -v test_eno_job_mailbox

Every process the reader would start (docker exec doveadm / printenv, curl) goes through its `run` hook, which FakeBox
replaces: a little in-memory INBOX that answers doveadm the way Dovecot's flow/pager formatters print, and an ingest that
answers like src/app/api/cron/job-posts/route.ts.

The DKIM fixtures (stored zlib-compressed, byte-exact) were signed ONCE by dkimpy 1.1.8 (an independent DKIM
implementation) with throwaway 2048-bit keys made for these tests only (the private halves were deleted; only the public
TXT records below are kept) — so the verifier here is checked against someone else's canonicalisation, not its own.
SIGNED_ALERT_RELAXED: a LinkedIn job-alert digest (multipart/alternative, quoted-printable text + HTML,
c=relaxed/relaxed). SIGNED_LISTINGS_SIMPLE: an HTML-only "Jobs you may be interested in" mail (8bit, a folded Subject,
trailing spaces and blank lines in the body, c=simple/simple, From over-signed). Both: d=linkedin.com, s=test2026.
SIGNED_ALERT_2026: signed the way LinkedIn signs since mid-2026 (its comment).
"""
import base64
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
import re
import stat
import sys
import tempfile
import unittest
import unittest.mock
import zlib
from email.message import EmailMessage

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('eno_job_mailbox', os.path.join(HERE, 'eno-job-mailbox.py'))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

NOW = dt.datetime(2026, 10, 20, 3, 0, tzinfo=dt.timezone.utc)
#: ingest.ts LI_JOB — the only LinkedIn link the server stores.
LI_JOB = re.compile(r'^https://(www\.)?linkedin\.com/jobs/view/\d+/?$')

TEST_DKIM_TXT = ('v=DKIM1; k=rsa; p='
                 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyGCkuCf5V3OsWQrdZx4w3WXQNm1gLUiec+Is9NU+leD5Es1WV/qYiMOw'
                 '7abcv3NK+rb1fkpj+Ntd0+xpfVILKhSHyXbDHjRpDegAp2rJ4uUbKUopLtvd6R1AqJ8t8LXwfTVQrt21YJLIdcJ6asINYu9001r+'
                 'Z6nVH4vM0ZsrSiZjAvoXxIVP2ZbpsDqAxV8+m9lJ2Rai1zNFHptpG1h5lV9g7wEkM9x4dJ9Wb18CSa79ya5FVB6+X8MIPMQqkLbM'
                 'UcZvFz1FJq+qiJfbpn+w6owamFv0ZTiTt95YdSVG4aqe/+ZxmvIoOM/USTHSqGeB90uoZ6kdT89xJICoSNuLcwIDAQAB')
SIGNED_ALERT_RELAXED = zlib.decompress(base64.b64decode(
    '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'
))
SIGNED_LISTINGS_SIMPLE = zlib.decompress(base64.b64decode(
    'eNq1Vdty6jYUfWeGf9DwkGknh8iYi7HBnJNwDzgXcEg4b7ItbAVbciQZMF9fmaRp0kw702n74Ku011577bXtwWzqVJckpEhmHFtg'
    'Z9c6ANlcoKqIkN5sdYBvC5KkMYavlw4I7JjQLQ4IvfBZ0imXALF/fHoFXuyACigPsgOELbGQuqYrKGnXDFNvGHVDU2kie8NZAiwg'
    'GbAUisi8Z+xL9SJAEqtLgoVAIa6SQD34jEpMZVXmabFWhBapvchmCUynS6+2G45XPJ6No8aEt87Xo9XlwoGtrD/BrZbeZ9py5din'
    'EHvmerfHdb1t3lynSD45l3NG/af+YeQ59W0DTtw93rocb3c13m/q7jHepa50PdrWNQ3BR5/Gi3qkkK7IYrvUG3OxeZDBdHKp3Rs/'
    '2+5uEoSaljnRk4m8q6UJa/MJDszHWmpupLG5N7G/2K0OR2QSKUx82Csk54rtbyg6PLamx8NPmcmX7H5cT+L1GuKr9XG+e1gcxveP'
    'cX0yQcfG2shbSdKcLISmQT3LE/cmW8xwo1H04ry1n9SHwnMmjfV6TVKv/hTURgbWUf9ZH8u6vhFzE69XL8YS9mv7rR668eBZctHv'
    'D5/Ob6nZnunbXCEFrWwNZ3mT0nS1DxM39B7uVnf3oqm1k9VudocfNXi8fBnB50s+HI/vBuzJb5nIvb51Q9sul0aqRRaYn4wxpaD7'
    'zDxRjYmQhIbik2F65ZLLLIBifPiBKbvY0XJp+eoGC1yrMJCzDCQoBx4GRPmAK0vhQN0WvhnSUKFGwMXIjzAHG8bBjAQCIBqAhHFc'
    'Lg2UoSzgMPoN1Exwq0xWGBLodauhWZoGqpqhaeWS82a46cACXa9qGMafaTpTZ1hdYS4IoxaoXaig/psxXWVM5WV8kDCSSawGJ0Jc'
    'YGk/uKNq+8M+jqjYYF4dUp8p5NACbY/Icqlc6haBva7HgrxXPOm9v6++C4stAKi9EnkxLoIk73Vl0OsiEHG8sSuRlKmwINzv9xcf'
    'i4HqSGDRE7gjeA8bWqPZMtqmVoPfJUf+VjGbBvbhDCVpR/KtjZO4GrOQVXpdkoRAcP8P8EShIgXvB6/Y6CKlYUU1VNqVOaJhplQ9'
    'OUEFQ6QOxbDg+n/xlETGuNL7K2cUHFT6tPeJG1gRLClKwFlCgoCpb9cEEXAXMRp+e1/75ZZWBZH41y5MXzEufUl2OM4Bxz7PSOHu'
    'Yu1Uozrxf9eUt1r1otgvPTjpO3TG/4WqXxO9iXjHSYJ4/ruI79qpvGAYZD6SahZOFae9AQI36INc7yKNsrgATPAXaeC7c9N/RFtg'
    'xP3o+xbne8aD4i9zolfpLTFWwsSg2PUqyxuHM5+leed18t+/Sn3GU8bfaygIncavexriXjGV5dJvEERPIw=='
))

#: A 2026 alert, signed the way LinkedIn signed its real 11 Oct 2026 alert (research 2026-10-21): TWO signatures,
#: d=maild.linkedin.com on top and d=linkedin.com under it, c=relaxed/relaxed, a lower-case h= with spaces around the
#: colons and From listed twice (over-signed); To is the LinkedIn account, vietnameno@gmail.com; the text part's first
#: line runs into "Manage your job alerts: <link with the recipient's tokens>". Signed by dkimpy 1.1.8 with its own
#: throwaway key (the private half deleted), selectors test2026d / test2026b.
TEST_DKIM_TXT_2026 = ('v=DKIM1; k=rsa; p='
                      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyGq1HCdEgw9smfxRgTO7BUloCYaX2VXsrpdX4veQIObCJn1JE/VBB53x'
                      'aduZJUM9kcutUXQVDP92LlFDKwMoo9GssqQghQ07FMf3TH8Y+uG/7NMWrkPKyDGdjEkk/XCgnSqDsKDvoSNHIfQykbKyY0OymxmB'
                      'n8zWOxIjwl44ahv5rujVEcbjpmddJ3IBSBX4c/7qscN3PXF/YQHA5wTHvSbfFqGul6LHSlIc6XNaa0yHv0LraaGpsfZpXaNGKWyS'
                      'ZdJzh/Zhxus91ZENrkWCfHq5Q+2RVncl2vXmVZfjBl21+IIiHzho1fRaBpdIJoHx6rus8LZ2izwHe8ZprYCA8wIDAQAB')
SIGNED_ALERT_2026 = zlib.decompress(base64.b64decode(
    'eNrNV9ly2sASfaeKf5hyVfySyNpYBLbsCIEBs5jdNi+UlgEJtDGSWPz1t0dAbEic6yW36roMSK3W0ej06Z7ucqPeYvr2zNOimOAiWsn8'
    'JdJkEmpMaGlCNneJDJlgR9tgk93/XqZTyJRdzXbMC8f2Fti0vQvDdy+RLf/8k3kpm17IRpvoEoVyhMNI4IRcAhPJfL4gZOFcyl8iS3bs'
    'MGJiL4z10CC2jpnADyNURKd2VISbN8zhMcxUd8DrlSHCbuBoET62Go4WhmCK/ATA8L0IexETbQPq6NouZlaYhLbvwSk8bI4N+nQXh6E2'
    'w4xtwsmU+C78mAk4gNDzS6Rb8qKkZzvZrquP23orWklmedQS1NzGLjzy2ubOmXXLXGbd6OdCTqbvrst98znbz7tEvw2GSpNlv48LbK0/'
    '73LufKB2N1VxGBRGq/z4XhE6dX2wnfZYdj3vbsSsF+JFzTYbqtYGJP5RL9ftOs+rYTzV+gOenbm+9NwaeUFn5HTarhVtnueG5Q+eczZ+'
    'aHcb2VL7eXzX11u9Kg+4D9icql1A6q82hXgZLasVVyIh4cJe6XvzIV5I80eL1Wv1dTaQbp/UOquybGN2F0ffhWG+JDacUOrOGwZejmsP'
    'mUcMSNZ2UfeaZt302m3d7D6uV+XZOi6MYr8czqpz69l1ibdmZ9PHqc5vY8XXOpWaN6xKq/pTJdNfDMiowt5GNMzPs8d1NnbdwtLcdoyN'
    'pi6702b48FTJTTeVMBi3OKevjpvb8qK6GDaFmGyMQViJBYGfyXI6Vf6MxEHgRxqGdYC43yFr/fJY1JSKD8j6N1Ef6/y/y/pE1HD7J2S9'
    'EzXV6GdkHQynt05HNXEm07eyS/8hrhdm+npAZvOq0p3Oc9kHx79vDwzsV7LZTa1dLt/pXMfJC805z3/vrGrZ8hMgzX3RN6rNwW22VzFt'
    '86HOkmW7WVfW9Y2XUe646rjZtEbqKFsvS6XVc6dpD5eLNr5zW73vhmdw3b47fi6VKYOBuCCPY27V8r1cx+g9C5o4G42MzaZcawy7hdvx'
    'eplb5prTvlE2ektx2mg5vczwfhlZUstcLJ6VTrVtuxTpqZdbKxynNnKr/HopPpn5SqbD5XLSSHRX2VpLiduOKDWb97ja6mU6fDwd5kd1'
    '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'
    'jcYhJOxe6+wuW5IMvH5/FtNN+z+XORWl'
))


def dkim_lookup(name):
    if name in ('test2026d._domainkey.maild.linkedin.com', 'test2026b._domainkey.linkedin.com'):
        return [TEST_DKIM_TXT_2026]
    return [TEST_DKIM_TXT] if name == 'test2026._domainkey.linkedin.com' else []


def no_key(name):
    return []


def dns_down(name):
    raise m.DkimTemp('timeout')


# ── Building messages the way they sit in the mailbox ────

BRIDGE_AR = 'mail.eno.vn; auth=pass smtp.auth=bridge@eno.vn smtp.mailfrom=s-1@bounce.linkedin.com'


def delivered(raw, *, auth='bridge@eno.vn', proto='ESMTPSA', by='mail.eno.vn', helo='mx.cloudflare.net', ar=BRIDGE_AR,
              upstream=True):
    """`raw` as Dovecot stores it here: its delivery headers on top, then the hop this server's Postfix wrote (the bridge's
    authenticated submission by default), rspamd's Authentication-Results, and the hop before ours."""
    top = ('Return-Path: <s-1@bounce.linkedin.com>\n'
           'Delivered-To: alex@eno.vn\n'
           'Received: from mail.eno.vn ([172.22.1.253])\n'
           '\tby dovecot-mailcow with LMTPS\n'
           '\tid kD8sL5x0FGfUQgAAhY6GKw\n'
           '\t(envelope-from <s-1@bounce.linkedin.com>)\n'
           '\tfor <alex@eno.vn>; Tue, 20 Oct 2026 08:15:04 +0700\n')
    hop = (f'Received: from {helo} (unknown [104.30.0.10])\n'
           '\t(using TLSv1.3 with cipher TLS_AES_256_GCM_SHA384 (256/256 bits)\n'
           '\t key-exchange X25519 server-signature RSA-PSS (2048 bits) server-digest SHA256)\n'
           '\t(No client certificate requested)\n'
           + (f'\t(Authenticated sender: {auth})\n' if auth else '')
           + f'\tby {by} (Postfix) with {proto} id 4B2C11A0123\n'
           '\tfor <alex@eno.vn>; Tue, 20 Oct 2026 08:15:03 +0700 (+07)\n')
    arh = f'Authentication-Results: {ar}\n' if ar else ''
    up = 'Received: from mail-sa1.linkedin.com ([108.174.3.150]) by mx.cloudflare.net; Tue, 20 Oct 2026 01:15:01 +0000\n'
    return (top + hop + arh + 'X-Rspamd-Server: rspamd-mailcow\n' + (up if upstream else '')).encode() \
        + raw.replace(b'\r\n', b'\n')


#: What Gmail's AUTOMATIC forwarding (vietnameno@gmail.com's filter → alex@eno.vn) puts on top of the message it resends
#: unchanged — Received, ARC-*, X-Forwarded-*, a second Delivered-To / Return-Path, its own Authentication-Results: none
#: a field LinkedIn signed or one read_message allows only once (the headers of real Gmail forwards, 2015–2026).
GMAIL_FORWARD_TRACE = (
    b'Received: from mail-sor-f41.google.com (mail-sor-f41.google.com [209.85.220.41]) by mx.cloudflare.net; '
    b'Tue, 20 Oct 2026 01:15:03 +0000\n'
    b'ARC-Seal: i=2; a=rsa-sha256; t=1760922902; cv=pass; d=google.com; s=arc-20240605; b=QUJD\n'
    b'ARC-Message-Signature: i=2; a=rsa-sha256; c=relaxed/relaxed; d=google.com; s=arc-20240605;\n'
    b'\th=to:subject:message-id:date:from:mime-version:dkim-signature:delivered-to; bh=QUJD; b=QUJD\n'
    b'ARC-Authentication-Results: i=2; mx.google.com; dkim=pass header.i=@linkedin.com; spf=pass;\n'
    b'\tdmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=linkedin.com\n'
    b'X-Google-DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=1e100.net; s=20230601; h=x; bh=QUJD; b=QUJD\n'
    b'X-Forwarded-Encrypted: i=2; AJvYcCVexample@eno.vn\n'
    b'X-Gm-Message-State: AOJu0YwExample\n'
    b'X-Forwarded-To: alex@eno.vn\n'
    b'X-Forwarded-For: vietnameno@gmail.com alex@eno.vn\n'
    b'Delivered-To: vietnameno@gmail.com\n'
    b'Received: by 2002:a05:7010:1a2b:b0:3a1:1c2d:3e4f with SMTP id x11csp123456; Mon, 19 Oct 2026 18:15:02 -0700\n'
    b'Return-Path: <s-1@bounce.linkedin.com>\n'
    b'Received: from mail-sa1.linkedin.com (mail-sa1.linkedin.com. [108.174.3.150]) by mx.google.com with ESMTPS; '
    b'Mon, 19 Oct 2026 18:15:01 -0700\n'
    b'Authentication-Results: mx.google.com; dkim=pass header.i=@linkedin.com; dmarc=pass header.from=linkedin.com\n')


#: The run tests' synthetic alerts carry this instead of a LinkedIn DKIM signature (Runs.setUp honours it): the real
#: check is pinned in LinkedInAuth on genuinely signed fixtures; the run tests test the checkpoint, batching and acks.
def signed_for_test(raw: bytes) -> bytes:
    return b'X-Test-Signed: linkedin\n' + raw


def alert(plain=None, html=None, subject='“english teacher”: ILA Vietnam - English Teacher and more',
          sender='LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>', date='Tue, 20 Oct 2026 01:15:00 +0000'):
    msg = EmailMessage()
    msg['From'] = sender
    msg['To'] = 'alex@eno.vn'
    msg['Subject'] = subject
    msg['Date'] = date
    msg['Message-ID'] = '<alert-1@linkedin.com>'
    if plain is not None:
        msg.set_content(plain)
        if html is not None:
            msg.add_alternative(html, subtype='html')
    else:
        msg.set_content(html, subtype='html')
    return msg.as_bytes()


def forward(body='', *, sender='lap@eno.vn', subject='JOB: English teacher, District 7', html=None,
            message_id='<sogo-1@mail.eno.vn>', auth='lap@eno.vn', date='Tue, 20 Oct 2026 08:00:00 +0700', **kw):
    msg = EmailMessage()
    msg['From'] = f'Lap <{sender}>'
    msg['To'] = 'alex@eno.vn'
    msg['Subject'] = subject
    msg['Date'] = date
    if message_id:
        msg['Message-ID'] = message_id
    if html is not None:
        msg.set_content(html, subtype='html')
    else:
        msg.set_content(body)
    kw.setdefault('helo', 'mail.eno.vn')
    kw.setdefault('ar', 'mail.eno.vn; dkim=pass header.d=eno.vn header.s=dkim')
    kw.setdefault('upstream', False)
    return delivered(msg.as_bytes(), auth=auth, **kw)


def cfg(tmp=None, **env):
    env = {k.upper() if k.startswith('ENO') else 'ENO_JOB_MAILBOX_' + k.upper(): v for k, v in env.items()}
    if tmp:
        env['ENO_JOB_MAILBOX_STATE'] = os.path.join(tmp, 'state.json')
    return m.Config(env)


PLAIN_DIGEST = """Your job alert for english teacher in Ho Chi Minh City, Vietnam
10+ new jobs match your preferences.

English Teacher
ILA Vietnam
Ho Chi Minh City, Ho Chi Minh City, Vietnam
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=AbC%2B1%3D%3D&refId=Xyz%3D%3D&trk=eml-email_job_alert_digest_01-job_card-0-view_job&otpToken=MTAwNjE

---------------------------------------------------------

ESL Teacher (Kindergarten)
Apollo English
Thu Duc, Ho Chi Minh City, Vietnam
Actively recruiting
View job: https://www.linkedin.com/comm/jobs/view/4023456789/?trackingId=Def%3D%3D

---------------------------------------------------------

IELTS Instructor
British Council
Hanoi, Vietnam (Hybrid)
₫35M-₫45M / month
Be an early applicant
View job: https://www.linkedin.com/comm/jobs/view/4034567890/?trackingId=Ghi%3D%3D

---------------------------------------------------------

See all jobs: https://www.linkedin.com/comm/jobs/search?keywords=english%20teacher
Manage job alerts: https://www.linkedin.com/comm/jobs/alerts?trk=manage
Unsubscribe: https://www.linkedin.com/comm/job-alert/unsubscribe?trk=x
Help: https://www.linkedin.com/help/linkedin/answer/67

© 2026 LinkedIn Corporation, 1000 West Maude Avenue, Sunnyvale, CA 94085.
"""


# ── A fake box: Dovecot's INBOX + the app's ingest ────

class FakeBox:
    def __init__(self, messages, uidvalidity=1700000000, uidnext=None, received=None, answer=None):
        self.messages = dict(messages)
        self.uidvalidity = uidvalidity
        self.uidnext = uidnext or (max(self.messages, default=0) + 1)
        self.received = received or {}
        self.answer = answer or (lambda posts: {'accepted': [p['externalKey'] for p in posts], 'duplicate': [],
                                                'rejected': []})
        self.calls, self.posted, self.searches, self.fetched = [], [], [], []
        self.dovecot_down = self.app_down = False
        self.size_override = {}

    def __call__(self, argv, data=None, timeout=60):
        self.calls.append(list(argv))
        if argv[:3] == ['docker', 'exec', m.DOVECOT_CONTAINER]:
            assert argv[3] == 'doveadm'
            return self.doveadm(argv[4:])
        if argv == ['docker', 'exec', m.APP_CONTAINER, 'printenv', 'CRON_SECRET']:
            return 0, b'test-secret-123\n', b''
        if argv[0] == 'curl':
            return self.curl(argv, data)
        raise AssertionError(f'unexpected command {argv}')

    # ── doveadm ──
    def header(self, raw, name):
        mail = m.Mail(raw)
        return m.decode_words(mail.first(name) or '')

    def doveadm(self, a):
        if self.dovecot_down:
            return 75, b'', b'doveadm(alex@eno.vn): Error: Temporary failure'
        if a[:2] == ['-f', 'flow'] and a[2:4] == ['mailbox', 'status']:
            assert a[4:] == ['-u', 'alex@eno.vn', 'uidvalidity uidnext', 'INBOX'], a
            return 0, f'uidvalidity={self.uidvalidity} uidnext={self.uidnext}\n'.encode(), b''
        if a[0] == 'search':
            assert a[1:5] == ['-u', 'alex@eno.vn', 'mailbox', 'INBOX'], a
            q, uids = a[5:], set(self.messages)
            self.searches.append(q)
            i = 0
            while i < len(q):
                key, val = q[i], q[i + 1]
                i += 2
                if key == 'UID':
                    lo = int(val.split(':')[0])
                    top = max(self.messages, default=0)
                    # IMAP: "n:*" with n past the last UID still matches the last message
                    uids &= {u for u in self.messages if u >= lo or (lo > top and u == top)}
                elif key == 'SINCE':
                    since = dt.datetime.fromtimestamp(int(val), dt.timezone.utc)
                    uids &= {u for u in uids if self.received.get(u, NOW - dt.timedelta(hours=1)) >= since}
                elif key == 'FROM':
                    uids &= {u for u in uids if val.lower() in self.header(self.messages[u], 'from').lower()}
                elif key == 'SUBJECT':
                    uids &= {u for u in uids if val.lower() in self.header(self.messages[u], 'subject').lower()}
                else:
                    raise AssertionError(f'search key {key}')
            return 0, ''.join(f'8d1f3c1a2b3c4d5e6f708192a3b4c5d6 {u}\n' for u in sorted(uids)).encode(), b''
        if a[:2] == ['-f', 'flow'] and a[2] == 'fetch':
            assert a[3:8] == ['-u', 'alex@eno.vn', 'uid size.virtual', 'mailbox', 'INBOX'] and a[8] == 'UID', a
            lines = [f'uid={u} size.virtual={self.size_override.get(u, len(self.messages[u]))}'
                     for u in map(int, a[9].split(',')) if u in self.messages]
            return 0, ('\n'.join(lines) + '\n').encode() if lines else b'', b''
        if a[:2] == ['-f', 'pager'] and a[2] == 'fetch':
            assert a[3:8] == ['-u', 'alex@eno.vn', 'text', 'mailbox', 'INBOX'] and a[8] == 'UID', a
            u = int(a[9])
            self.fetched.append(u)
            if u not in self.messages:
                return 0, b'', b''
            return 0, b'text:\n' + self.messages[u] + b'\n\f\n', b''
        raise AssertionError(f'doveadm {a}')

    # ── the ingest ──
    def curl(self, argv, data):
        assert 'test-secret-123' not in ' '.join(argv), 'the secret reached argv'
        assert argv[argv.index('--max-time') + 1] == '120' and '--fail-with-body' in argv
        hdr = [argv[i + 1] for i, x in enumerate(argv) if x == '-H' and argv[i + 1].startswith('@')]
        assert len(hdr) == 1
        path = hdr[0][1:]
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
        assert stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode) == 0o700
        with open(path) as f:
            assert f.read() == 'Authorization: Bearer test-secret-123\n'
        self.header_files = getattr(self, 'header_files', []) + [path]
        assert 'Host: eno.vn' in argv and argv[argv.index('-X') + 1] == 'POST' and m.APP_URL in argv
        if self.app_down:
            return 7, b'', b'curl: (7) Failed to connect to 127.0.0.1 port 3001'
        if getattr(self, 'refuse_whole', None):
            return 22, json.dumps(self.refuse_whole).encode(), b'curl: (22) The requested URL returned error: 413'
        posts = json.loads(data)['posts']
        assert 1 <= len(posts) <= 50
        self.posted.append(posts)
        return 0, json.dumps(self.answer(posts)).encode(), b''


def run(box, tmp, *, now=NOW, lookup=dkim_lookup, **kw):
    out = io.StringIO()
    env = kw.pop('env', {})
    with contextlib.redirect_stdout(out):
        code = m.run_once(cfg(tmp, **env), runner=box, lookup=lookup, now=now, **kw)
    return code, out.getvalue()


def state(tmp):
    with open(os.path.join(tmp, 'state.json')) as f:
        return json.load(f)


def write_state(tmp, **st):
    with open(os.path.join(tmp, 'state.json'), 'w') as f:
        json.dump({'pending': {}, **st}, f)


# ── LinkedIn alert layouts ──────────────────

def cards(text, html_mode=False):
    return {j: c for j, c in m.parse_linkedin(text, html_mode)}


class LinkedInLayouts(unittest.TestCase):
    def test_plain_digest_three_line_cards(self):
        got = cards(m.clean_text(PLAIN_DIGEST))
        self.assertEqual(list(got), ['4012345678', '4023456789', '4034567890'])
        self.assertEqual(got['4012345678'][:3], ('English Teacher', 'ILA Vietnam', 'Ho Chi Minh City, Ho Chi Minh City, Vietnam'))
        self.assertEqual(got['4023456789'][:3], ('ESL Teacher (Kindergarten)', 'Apollo English', 'Thu Duc, Ho Chi Minh City, Vietnam'))
        title, company, location, snippet = got['4034567890']
        self.assertEqual((title, company, location), ('IELTS Instructor', 'British Council', 'Hanoi, Vietnam (Hybrid)'))
        self.assertEqual(snippet, ['₫35M-₫45M / month'])  # pay kept as the snippet; insights dropped

    def test_compact_company_dot_location_and_dash(self):
        text = ('Jobs you may be interested in\n\n'
                'English Teacher\nVUS English Center · Ho Chi Minh City, Vietnam\n'
                'https://www.linkedin.com/comm/jobs/view/3998877665?trk=eml-jobs_jymbii_digest\n\n'
                'Native English Teacher\nWall Street English - Hanoi, Vietnam\n'
                'https://www.linkedin.com/comm/jobs/view/3998877666?trk=eml-jobs_jymbii_digest\n')
        got = cards(text)
        self.assertEqual(got['3998877665'][:3], ('English Teacher', 'VUS English Center', 'Ho Chi Minh City, Vietnam'))
        self.assertEqual(got['3998877666'][:3], ('Native English Teacher', 'Wall Street English', 'Hanoi, Vietnam'))

    def test_title_at_company_with_a_slugged_public_url(self):
        text = ('Primary English Teacher at Global Education Vietnam\nHo Chi Minh City, Vietnam\n'
                'https://www.linkedin.com/jobs/view/primary-english-teacher-at-global-education-vietnam-4067890123\n')
        self.assertEqual(cards(text)['4067890123'][:3],
                         ('Primary English Teacher', 'Global Education Vietnam', 'Ho Chi Minh City, Vietnam'))

    def test_an_unknown_insight_line_does_not_shift_the_card(self):
        text = ('English Teacher\nILA Vietnam\nDa Nang, Vietnam\nYour profile matches several required qualifications\n'
                'View job: https://www.linkedin.com/comm/jobs/view/4011111111/\n')
        self.assertEqual(cards(text)['4011111111'][:3], ('English Teacher', 'ILA Vietnam', 'Da Nang, Vietnam'))

    def test_title_on_the_link_line_reads_forward(self):
        text = ('English Teacher: https://www.linkedin.com/comm/jobs/view/4078901234/?x=1\nILA Vietnam\nDa Nang, Vietnam\n'
                'ESL Tutor: https://www.linkedin.com/comm/jobs/view/4078901235/?x=1\nApollo · Hanoi, Vietnam\n')
        got = cards(text)
        self.assertEqual(got['4078901234'][:3], ('English Teacher', 'ILA Vietnam', 'Da Nang, Vietnam'))
        self.assertEqual(got['4078901235'][:3], ('ESL Tutor', 'Apollo', 'Hanoi, Vietnam'))

    def test_html_cards_read_forward_from_the_link(self):
        html = ('<html><head><title>x</title><style>p{}</style></head><body><p>Jobs you may be interested in</p><table>'
                '<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4045678901/?trk=logo"><img alt="LL"></a></td>'
                '<td><a href="https://www.linkedin.com/comm/jobs/view/4045678901/?trk=title">English Teacher for Kids</a>'
                '<p>Language Link Vietnam &middot; Hai Phong, Vietnam (On-site)</p><p>Actively recruiting</p></td></tr>'
                '<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4056789012/?trk=logo"><img alt="EMG"></a></td>'
                '<td><a href="https://www.linkedin.com/comm/jobs/view/4056789012/?trk=title">Primary Teacher</a>'
                '<p>EMG Education</p><p>Da Nang, Vietnam</p><p>Full-time</p></td></tr></table>'
                '<p><a href="https://www.linkedin.com/comm/jobs/search?keywords=teacher">See all jobs</a></p>'
                '<p>Some footer line nobody listed</p></body></html>')
        got = cards(m.html_to_text(html, links='marker'), html_mode=True)
        self.assertEqual(got['4045678901'][:3], ('English Teacher for Kids', 'Language Link Vietnam', 'Hai Phong, Vietnam (On-site)'))
        self.assertEqual(got['4056789012'], ('Primary Teacher', 'EMG Education', 'Da Nang, Vietnam', ['Full-time']))

    def test_html_title_above_a_view_job_button(self):
        html = ('<table><tr><td><p>English Teacher</p><p>ILA Vietnam &middot; Da Nang, Vietnam</p>'
                '<a href="https://www.linkedin.com/comm/jobs/view/4100000001/?trk=btn">View job</a></td></tr>'
                '<tr><td><p>ESL Teacher</p><p>Apollo English &middot; Hanoi, Vietnam</p>'
                '<a href="https://www.linkedin.com/comm/jobs/view/4100000002/?trk=btn">View job</a></td></tr></table>')
        got = cards(m.html_to_text(html, links='marker'), html_mode=True)
        self.assertEqual(got['4100000001'][:3], ('English Teacher', 'ILA Vietnam', 'Da Nang, Vietnam'))
        self.assertEqual(got['4100000002'][:3], ('ESL Teacher', 'Apollo English', 'Hanoi, Vietnam'))

    def test_vietnamese_interface_labels_are_noise(self):
        text = ('Giáo viên tiếng Anh\nTrung tâm Anh ngữ ABC\nThành phố Hồ Chí Minh, Việt Nam\nTuyển dụng tích cực\n'
                'Xem việc làm: https://www.linkedin.com/comm/jobs/view/4099999999/\n')
        self.assertEqual(cards(text)['4099999999'][:3],
                         ('Giáo viên tiếng Anh', 'Trung tâm Anh ngữ ABC', 'Thành phố Hồ Chí Minh, Việt Nam'))

    def test_insight_lines_and_vietnamese_place_names(self):
        # real alerts: "1 school alum" is an insight line like "25 school alumni" (Oct 2024), and a place can come as
        # "Thành Phố Quảng Ngãi" (June 2025) — with an unknown insight line under it the card must not shift either
        text = ('Graphic Design Intern\nRoots and Wings Legal\nSingapore\n1 school alum\nApply with resume & profile\n'
                'View job: https://www.linkedin.com/comm/jobs/view/4045964524/\n')
        self.assertEqual(cards(text)['4045964524'][:3], ('Graphic Design Intern', 'Roots and Wings Legal', 'Singapore'))
        self.assertTrue(m._is_loc('Thành Phố Quảng Ngãi') and m._is_loc('Tỉnh Bình Dương') and m._is_loc('TP. HCM'))
        text = ('Production Intern\nGE Vernova\nThành Phố Quảng Ngãi\nYour profile matches several required qualifications\n'
                'View job: https://www.linkedin.com/comm/jobs/view/4144064904/\n')
        self.assertEqual(cards(text)['4144064904'][:3], ('Production Intern', 'GE Vernova', 'Thành Phố Quảng Ngãi'))

    def test_alert_phrase(self):
        self.assertEqual(m.alert_phrase('“english teacher”: ILA Vietnam - English Teacher and more', ''), 'english teacher')
        self.assertEqual(m.alert_phrase('Your job alert for ESL teacher in Hanoi, Vietnam', ''), 'ESL teacher in Hanoi, Vietnam')
        self.assertEqual(m.alert_phrase('30+ new jobs for "IELTS"', ''), 'IELTS')
        self.assertIsNone(m.alert_phrase("Children's teacher at ABC and 9 more jobs", ''))
        self.assertEqual(m.alert_phrase('New jobs', 'Your job alert for kindergarten teacher\n...'), 'kindergarten teacher')
        # LinkedIn 2026 runs "Manage your job alerts: <link>" onto the line, and the link carries the recipient's own
        # tokens: the phrase stops before it, and nothing from a link is ever a phrase
        line = ('Your job alert for student in MumbaiManage your job alerts: https://www.linkedin.com/comm/jobs/alerts?'
                'lipi=urn%3Ali%3Apage%3Ax&midToken=AQHF&midSig=1x&otpToken=MTAw')
        self.assertEqual(m.alert_phrase('IN - Specialist: Full-time and Part-time at Apple', line + '\n\nx'), 'student in Mumbai')
        self.assertIsNone(m.alert_phrase('New jobs', 'Your job alert for https://www.linkedin.com/comm/jobs/alerts?midToken=AQ\n'))
        self.assertIsNone(m.alert_phrase('“www.linkedin.com/comm/x?midToken=AQ”', ''))
        self.assertEqual(m.alert_phrase('New jobs for "ESL/EFL teacher"', ''), 'ESL/EFL teacher')
        # LinkedIn's "alert created" mail (it carries jobs too — the first one through the Gmail forward, 2026-10-21)
        created = 'Your job alert for Teacher in Ho Chi Minh City, Vietnam has been created'
        self.assertEqual(m.alert_phrase(created, ''), 'Teacher in Ho Chi Minh City, Vietnam')
        self.assertEqual(m.alert_phrase('New jobs', created + '.\n...'), 'Teacher in Ho Chi Minh City, Vietnam')
        # …and only in that sentence: a quoted search keeps its words (codex, gate 10a)
        self.assertEqual(m.alert_phrase('New jobs for "art that has been created"', ''), 'art that has been created')
        # a refused quoted phrase does not hide the subject's own "job alert for …" (opus, gate 8a)
        self.assertEqual(m.alert_phrase('"a=b" job alert for ESL teacher', ''), 'ESL teacher')
        # a link with no scheme is a link too (opus, gate 8c); a slash between words is not
        self.assertEqual(m.alert_phrase('New jobs', 'Your job alert for teacher lnkd.in/eAbC12x?trk=1\n'), 'teacher')
        self.assertEqual(m.alert_phrase('New jobs', 'Your job alert for ESL/EFL teacher in Ha Noi\n'),
                         'ESL/EFL teacher in Ha Noi')


class Canonicalisation(unittest.TestCase):
    def test_tracking_and_per_recipient_forms_reduce_to_the_job_id(self):
        cases = {
            'View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=AbC%2B1%3D%3D&midToken=AQ': ['4012345678'],
            'https://vn.linkedin.com/jobs/view/english-teacher-at-ila-vietnam-4012345679?refId=x': ['4012345679'],
            '<www.linkedin.com/jobs/view/4012345680>': ['4012345680'],
            'https://lnkd.example/r?u=https%3A%2F%2Fwww.linkedin.com%2Fcomm%2Fjobs%2Fview%2F4012345681%2F%3Ftrk%3Dx': ['4012345681'],
            'https://www.linkedin.com/jobs/view/123456-teacher-4012345682/': ['4012345682'],
            'https://notlinkedin.com/jobs/view/4012345683': [],
            'https://www.linkedin.com/jobs/search/?currentJobId=4012345684': [],
            'https://www.linkedin.com/comm/jobs/view/12345/': [],  # too short to be a job id
        }
        for line, ids in cases.items():
            self.assertEqual(m._job_ids(line), ids, line)

    def test_canonical_url_is_what_the_ingest_stores(self):
        url = m.linkedin_url('4012345678')
        self.assertEqual(url, 'https://www.linkedin.com/jobs/view/4012345678/')
        self.assertRegex(url, LI_JOB)

    def test_alert_posts_carry_only_canonical_urls(self):
        posts, why = m.linkedin_posts(m.Mail(delivered(alert(PLAIN_DIGEST))), NOW)
        self.assertEqual(why, '3 job(s)')
        for p in posts:
            self.assertRegex(p['url'], LI_JOB)
            self.assertNotIn('trackingId', json.dumps(p))
        self.assertEqual(posts[0], {
            'source': 'linkedin', 'externalKey': '4012345678', 'sourceName': 'LinkedIn', 'sourceRef': 'english teacher',
            'url': 'https://www.linkedin.com/jobs/view/4012345678/', 'title': 'English Teacher', 'company': 'ILA Vietnam',
            'locationText': 'Ho Chi Minh City, Ho Chi Minh City, Vietnam',
            'text': 'English Teacher · ILA Vietnam · Ho Chi Minh City, Ho Chi Minh City, Vietnam', 'lang': 'en',
            'postedAt': '2026-10-20T01:15:00Z'})
        self.assertEqual(posts[2]['text'], 'IELTS Instructor · British Council · Hanoi, Vietnam (Hybrid)\n₫35M-₫45M / month')

    def test_html_only_when_the_text_part_has_no_jobs(self):
        html = ('<p><a href="https://www.linkedin.com/comm/jobs/view/4045678901/?trk=t">English Teacher for Kids</a></p>'
                '<p>Language Link Vietnam · Hai Phong, Vietnam</p>')
        posts, _ = m.linkedin_posts(m.Mail(delivered(alert('This message needs an HTML viewer.', html))), NOW)
        self.assertEqual([(p['externalKey'], p['title'], p['company']) for p in posts],
                         [('4045678901', 'English Teacher for Kids', 'Language Link Vietnam')])

    def test_the_same_job_twice_is_one_post(self):
        text = (PLAIN_DIGEST + '\nEnglish Teacher\nILA Vietnam\nHo Chi Minh City, Vietnam\n'
                'View job: https://www.linkedin.com/comm/jobs/view/4012345678/?again=1\n')
        posts, _ = m.linkedin_posts(m.Mail(delivered(alert(text))), NOW)
        self.assertEqual([p['externalKey'] for p in posts].count('4012345678'), 1)

    def test_dates(self):
        old, _ = m.linkedin_posts(m.Mail(delivered(alert(PLAIN_DIGEST, date='Tue, 01 Jul 2026 01:00:00 +0000'))), NOW)
        self.assertEqual(old, [])  # older than ingest's 60 days: skipped here instead of rejected there
        ahead, _ = m.linkedin_posts(m.Mail(delivered(alert(PLAIN_DIGEST, date='Fri, 23 Oct 2026 01:00:00 +0000'))), NOW)
        self.assertTrue(ahead and all('postedAt' not in p for p in ahead))  # a future Date is dropped, the jobs kept


# ── Authentication ──────────────────────────

def li_auth(raw, lookup=no_key, **env):
    return m.linkedin_auth(m.Mail(raw), cfg(**env), lookup, NOW)


class LinkedInAuth(unittest.TestCase):
    def test_no_authentication_results_header_is_ever_trusted(self):
        # codex, gate 7a: on the bridge path (an authenticated submission) rspamd may write no header at all, and a
        # sender's own "Authentication-Results: mail.eno.vn; dkim=pass header.d=linkedin.com" — written at the very top of
        # its message, no Received of its own under ours — would sit exactly where ours would. So none counts.
        headers = [
            'mail.eno.vn;\n\tdkim=pass header.d=linkedin.com header.s=d2048-2023 header.b=AbCd;\n\tspf=pass smtp.mailfrom=s@bounce.linkedin.com',
            'mx.eno.vn; dkim=none; dmarc=pass (policy=reject) header.from=linkedin.com',
            BRIDGE_AR, None,
        ]
        for ar in headers:
            for upstream in (True, False):
                verdict, why = li_auth(delivered(alert(PLAIN_DIGEST), ar=ar, upstream=upstream))
                self.assertEqual((verdict, why), ('fail', 'own DKIM check: no DKIM signature by linkedin.com'), (ar, upstream))
        forged = b'Authentication-Results: mail.eno.vn; dkim=pass header.d=linkedin.com\n' + alert(PLAIN_DIGEST)
        self.assertEqual(li_auth(delivered(forged, ar=None, upstream=False))[0], 'fail')

    def test_own_dkim_check_proves_what_the_bridge_path_cannot(self):
        raw = delivered(SIGNED_ALERT_RELAXED)
        verdict, why = li_auth(raw, lookup=dkim_lookup)
        self.assertEqual(verdict, 'pass')
        self.assertIn('own DKIM check d=linkedin.com s=test2026', why)
        self.assertEqual(li_auth(delivered(SIGNED_LISTINGS_SIMPLE), lookup=dkim_lookup)[0], 'pass')

    def test_own_dkim_check_refuses_changes(self):
        tampered = [
            SIGNED_ALERT_RELAXED.replace(b'ILA Vietnam', b'ILA Vietnan', 1),         # the Subject (signed)
            SIGNED_ALERT_RELAXED.replace(b'4023456789', b'4023456780', 1),            # the body (bh)
            SIGNED_LISTINGS_SIMPLE.replace(b'From: LinkedIn <', b'From: LinkedIn  <', 1),  # simple: one space counts
        ]
        for raw in tampered:
            self.assertEqual(li_auth(delivered(raw), lookup=dkim_lookup)[0], 'fail')
        self.assertEqual(li_auth(delivered(SIGNED_ALERT_RELAXED), lookup=no_key)[0], 'fail')

    def test_signed_but_for_someone_else_is_refused(self):
        # opus, gate 7a: a genuine alert another subscriber received, replayed into this mailbox — To is signed (below),
        # so it cannot be rewritten, and it is not our subscriber. Ours: the LinkedIn account vietnameno@gmail.com, whose
        # Gmail filter forwards here (owner, 2026-10-21), or alex@eno.vn itself.
        self.assertEqual(m.LINKEDIN_ALERT_TO, ('vietnameno@gmail.com', 'alex@eno.vn'))
        real = m.dkim_verify
        try:
            m.dkim_verify = lambda *a, **k: ('pass', 'd=linkedin.com s=test')
            for to, want in (('vietnameno@gmail.com', 'pass'), ('Eno Vietnam <VietnamEno@gmail.com>', 'pass'),
                             ('alex@eno.vn', 'pass'), ('Alex <alex@eno.vn>, x@example.com', 'pass'),
                             ('someone@example.com', 'fail'), ('vietnameno@gmail.com.evil.example', 'fail'),
                             ('"vietnameno@gmail.com" <x@example.com>', 'fail'),
                             # ⛔ Gmail delivers these to our inbox, but to LinkedIn they can be ANOTHER member's account
                             # (opus, gate 8g): exact, case aside
                             ('vietnameno+jobs@gmail.com', 'fail'), ('viet.nameno@gmail.com', 'fail'),
                             ('vietnameno@googlemail.com', 'fail')):
                raw = delivered(alert(PLAIN_DIGEST).replace(b'To: alex@eno.vn', b'To: ' + to.encode(), 1))
                verdict, why = li_auth(raw)
                self.assertEqual(verdict, want, to)
            self.assertIn('not addressed to vietnameno@gmail.com or alex@eno.vn', why)
        finally:
            m.dkim_verify = real

    def test_an_alert_auto_forwarded_by_gmail_still_verifies(self):
        raw = delivered(GMAIL_FORWARD_TRACE + SIGNED_ALERT_RELAXED)
        self.assertEqual(li_auth(raw, lookup=dkim_lookup)[0], 'pass')
        o = m.read_message(raw, cfg(), dkim_lookup, NOW)
        self.assertEqual((o.status, o.kind), ('posts', 'linkedin'), o.why)
        self.assertTrue(o.posts)

    def test_the_2026_signing_two_signatures_lower_case_and_over_signed(self):
        mail = m.Mail(delivered(SIGNED_ALERT_2026))
        self.assertEqual(m.dkim_verify(mail, 'linkedin.com', dkim_lookup, NOW, required=('from', 'to')),
                         ('pass', 'd=maild.linkedin.com s=test2026d'))
        # the d=linkedin.com signature under it is found when the top one cannot be checked
        only = lambda name: dkim_lookup(name) if name.endswith('._domainkey.linkedin.com') else []  # noqa: E731
        self.assertEqual(m.dkim_verify(mail, 'linkedin.com', only, NOW, required=('from', 'to')),
                         ('pass', 'd=linkedin.com s=test2026b'))
        self.assertEqual(m.dkim_verify(mail, 'linkedin.com', no_key, NOW, required=('from', 'to'))[0], 'fail')

    def test_a_2026_alert_forwarded_by_gmail_gives_clean_posts(self):
        o = m.read_message(delivered(GMAIL_FORWARD_TRACE + SIGNED_ALERT_2026), cfg(), dkim_lookup, NOW)
        self.assertEqual((o.status, o.kind, o.notice), ('posts', 'linkedin', ''), o.why)
        self.assertEqual([(p['externalKey'], p['title'], p['company'], p['locationText'], p['url']) for p in o.posts], [
            ('4412345678', 'English Teacher', 'ILA Vietnam', 'Ho Chi Minh City, Vietnam',
             'https://www.linkedin.com/jobs/view/4412345678/'),
            ('4423456789', 'Giáo viên tiếng Anh', 'Trung tâm Anh ngữ ABC', 'Thành Phố Quảng Ngãi',
             'https://www.linkedin.com/jobs/view/4423456789/')])
        self.assertEqual({p['sourceRef'] for p in o.posts}, {'english teacher in Vietnam'})
        # ⛔ the recipient's tokens (every link in the mail carries them) reach no field
        sent = json.dumps(o.posts)
        for token in ('midToken', 'midSig', 'otpToken', 'AQHtest', 'trackingId', 'lipi', '?'):
            self.assertNotIn(token, sent)

    def test_only_saved_search_alerts_by_default(self):
        self.assertEqual(cfg().linkedin_senders, ('jobalerts-noreply@linkedin.com',))
        # a "jobs you may be interested in" mail (jobs-listings@) is not LinkedIn here unless the setting adds its sender
        o = m.read_message(delivered(SIGNED_LISTINGS_SIMPLE), cfg(), dkim_lookup, NOW)
        self.assertEqual((o.status, o.why), ('skip', 'sender is on neither list'))
        both = cfg(linkedin_senders='jobalerts-noreply@linkedin.com jobs-listings@linkedin.com')
        self.assertEqual(m.read_message(delivered(SIGNED_LISTINGS_SIMPLE), both, dkim_lookup, NOW).kind, 'linkedin')

    def test_a_second_to_header_is_refused(self):
        raw = delivered(SIGNED_ALERT_RELAXED.replace(b'From: LinkedIn', b'To: alex@eno.vn\r\nFrom: LinkedIn', 1))
        o = m.read_message(raw, cfg(), dkim_lookup, NOW)
        self.assertEqual((o.status, o.why), ('skip', 'to header more than once'))

    def test_at_most_three_linkedin_signatures_are_checked(self):
        # opus, gate 7b3: hundreds of d=linkedin.com signatures, each its own selector, would be a DNS lookup each
        sig = b'DKIM-Signature: v=1; a=rsa-sha256; d=linkedin.com; s=s%d; h=from:to; bh=AAAA; b=AAAA\n'
        raw = delivered(b''.join(sig % i for i in range(50)) + alert(PLAIN_DIGEST))
        asked = []
        verdict, why = li_auth(raw, lookup=lambda name: asked.append(name) or [])
        self.assertEqual(verdict, 'fail')
        self.assertLessEqual(len(asked), m.MAX_LINKEDIN_SIGNATURES)
        self.assertIn('the rest not checked', why)

    def test_dns_down_is_temporary(self):
        self.assertEqual(li_auth(delivered(SIGNED_ALERT_RELAXED), lookup=dns_down)[0], 'temp')

    def test_a_second_from_header_is_refused(self):
        raw = delivered(alert(PLAIN_DIGEST).replace(b'From:', b'From: lap@eno.vn\nFrom:', 1),
                        ar='mail.eno.vn; dkim=pass header.d=linkedin.com')
        o = m.read_message(raw, cfg(), no_key, NOW)
        self.assertEqual((o.status, o.why), ('skip', 'from header more than once'))
        self.assertIsNone(m.from_address(m.Mail(raw)))

    def test_an_unsigned_subject_over_a_signed_one_is_refused(self):
        # a genuine signed alert replayed with a second Subject on top: DKIM still verifies (it signs the last one) …
        raw = delivered(SIGNED_ALERT_RELAXED.replace(b'From: LinkedIn', b'Subject: FREE MONEY\r\nFrom: LinkedIn', 1))
        self.assertEqual(li_auth(raw, lookup=dkim_lookup)[0], 'pass')
        # … so the reader refuses the message before reading anything out of it
        o = m.read_message(raw, cfg(), dkim_lookup, NOW)
        self.assertEqual((o.status, o.why), ('skip', 'subject header more than once'))

    def test_a_malformed_header_line_is_refused(self):
        for bad in (b'Subject : spaced name\n', b'Not a header line\n', b'X Bad: name with a space\n'):
            raw = delivered(alert(PLAIN_DIGEST).replace(b'To:', bad + b'To:', 1), ar='mail.eno.vn; dkim=pass header.d=linkedin.com')
            o = m.read_message(raw, cfg(), no_key, NOW)
            self.assertEqual((o.status, o.why), ('skip', 'malformed header block'), bad)

    def test_dkim_tags_that_are_refused(self):
        mail = m.Mail(delivered(SIGNED_ALERT_RELAXED))
        idx, field = next((i, f) for i, (n, f) in enumerate(mail.fields) if n == 'dkim-signature')
        tags = m.parse_tags(field.split(b':', 1)[1].decode())
        for change, why in (({'l': '100'}, 'l='), ({'a': 'rsa-sha1'}, 'rsa-sha1'), ({'h': 'to:subject'}, 'From is not signed'),
                            ({'x': '1000'}, 'expired'), ({'i': '@evil.example'}, 'i=')):
            ok, reason = m._dkim_one(mail, idx, field, {**tags, **change}, dkim_lookup, NOW)
            self.assertFalse(ok)
            self.assertIn(why, reason)
        # LinkedIn's check needs To signed too (the replay rule)
        ok, reason = m._dkim_one(mail, idx, field, {**tags, 'h': 'from:subject:date'}, dkim_lookup, NOW, required=('from', 'to'))
        self.assertEqual((ok, reason), (False, 'To is not signed'))
        # a tag value the sender wrote reaches a reason (and so the log) only as a short plain token
        ok, reason = m._dkim_one(mail, idx, field, {**tags, 'a': 'rsa-sha256; Call 0909 123 456 now'}, dkim_lookup, NOW)
        self.assertNotIn(' ', reason.split('algorithm ')[1].split(' not checked')[0])


class TeamAuth(unittest.TestCase):
    def check(self, raw, sender='lap@eno.vn', **env):
        return m.team_auth(m.Mail(raw), sender, cfg(**env))

    def test_an_authenticated_team_submission(self):
        self.assertEqual(self.check(forward('x')), (True, 'submitted by lap@eno.vn'))

    def test_refusals(self):
        cases = [
            (forward('x', auth='danh@eno.vn'), 'From is not the authenticated sender'),
            (forward('x', auth=None, proto='ESMTPS'), 'not an authenticated submission (with ESMTPS)'),
            (forward('x', auth='bridge@eno.vn'), 'relayed from outside by the inbound bridge'),
            (forward('x', auth='vanngoc@eno.vn', sender='vanngoc@eno.vn'), 'not on the team list'),
            (forward('x', by='mail.evil.example'), 'not by this mail server'),
            (forward('x', auth=None, proto='ESMTPSA'), 'no single authenticated sender'),
        ]
        for raw, why in cases:
            sender = 'vanngoc@eno.vn' if b'vanngoc' in raw else 'lap@eno.vn'
            ok, reason = self.check(raw, sender)
            self.assertFalse(ok, why)
            self.assertIn(why, reason)

    def test_a_helo_that_writes_its_own_authentication_is_refused(self):
        evil = 'x (Authenticated sender: lap@eno.vn) by mail.eno.vn (Postfix) with ESMTPSA id 1'
        ok, why = self.check(forward('x', auth=None, proto='ESMTPS', helo=evil))
        self.assertFalse(ok)
        self.assertEqual(why, 'our Received hop is not a single Postfix hop')

    def test_a_received_header_written_into_the_message_is_not_ours(self):
        body = forward('x', auth=None, proto='ESMTP')  # sent to port 25 from outside, with a fake hop of its own below
        raw = body.replace(b'From: Lap', b'Received: from a (b [1.2.3.4]) (Authenticated sender: lap@eno.vn) by mail.eno.vn '
                                         b'(Postfix) with ESMTPSA id 9 for <alex@eno.vn>; Tue, 20 Oct 2026 08:00:00 +0700\nFrom: Lap', 1)
        self.assertFalse(self.check(raw)[0])

    def test_the_bridge_is_never_a_team_sender(self):
        c = cfg(team='lap@eno.vn, bridge@eno.vn')
        self.assertEqual(c.team, ('lap@eno.vn',))
        self.assertTrue(any('bridge@eno.vn removed' in n for n in c.notes))

    def test_the_settings_file_is_read_by_hand_runs_too(self):
        # opus, gate 7c: `--since-days` / `--dry-run` by hand must see the timer's settings (the unit's EnvironmentFile)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'eno-job-mailbox')
            with open(path, 'w') as f:
                f.write('# settings\nENO_JOB_MAILBOX_MAX_KB=400\nENO_JOB_MAILBOX_TEAM="lap@eno.vn will@eno.vn"\n'
                        'PATH=/evil\nnot a line\n')
            env = m.with_settings_file({'ENO_JOB_MAILBOX_TEAM': 'freya@eno.vn'}, path)
            self.assertEqual(env, {'ENO_JOB_MAILBOX_TEAM': 'freya@eno.vn', 'ENO_JOB_MAILBOX_MAX_KB': '400'})  # set wins
            self.assertEqual(m.Config(m.with_settings_file({}, path)).max_bytes, 400 * 1024)
            self.assertEqual(m.Config(m.with_settings_file({}, path)).team, ('lap@eno.vn', 'will@eno.vn'))
            self.assertEqual(m.with_settings_file({'X': '1'}, os.path.join(d, 'absent')), {'X': '1'})

    def test_settings_are_checked(self):
        for env in ({'team': 'not-an-address'}, {'max_kb': 'lots'}, {'give_up_hours': 'inf'}, {'give_up_hours': 'nan'},
                    {'give_up_hours': '0'}, {'give_up_hours': '1000'},
                    {'team': 'jobalerts-noreply@linkedin.com'}, {'dovecot_container': 'x; rm -rf /'},
                    {'linkedin_silent_days': '61'}, {'linkedin_silent_days': '-1'}, {'linkedin_silent_days': 'week'},
                    {'linkedin_silent_days': '2.5'}, {'linkedin_silent_days': '²'}, {'linkedin_silent_days': '٣'}):
            with self.assertRaises(m.ConfigError, msg=env):
                cfg(**env)
        self.assertEqual(cfg(linkedin_senders='jobs@linkedin.com evil@example.com').linkedin_senders, ('jobs@linkedin.com',))
        self.assertEqual([cfg(**e).silent_days for e in ({}, {'linkedin_silent_days': '0'}, {'linkedin_silent_days': '14'})],
                         [7, 0, 14])


# ── Team forwards ───────────────────────────

POST_EN = ('Hiring a native English teacher for kids 6-10, Saturday + Sunday mornings, District 7.\n'
           'Pay 450k/hour. Must have TEFL.\n'
           'Apply: Zalo 0901 234 567 (Ms Lan)\n')


class TeamForwards(unittest.TestCase):
    def test_with_an_apply_line(self):
        signature = '\n-- \nLap\nMarketing, eno.vn\nZalo: https://zalo.me/0912345678\n'
        posts, why = m.team_posts(m.Mail(forward(POST_EN + signature)), NOW)
        self.assertEqual(why, '1 post, with Apply: line')
        self.assertEqual(posts, [{
            'source': 'intake', 'externalKey': hashlib.sha256(b'<sogo-1@mail.eno.vn>').hexdigest(),
            'sourceName': 'Forwarded by the eno team', 'title': 'English teacher, District 7',
            'applyText': 'Zalo 0901 234 567 (Ms Lan)', 'text': POST_EN.strip(), 'lang': 'en', 'postedAt': '2026-10-20T01:00:00Z'}])
        self.assertNotIn('url', posts[0])  # ingest refuses a url on an intake post

    def test_without_an_apply_line_still_sent(self):
        posts, why = m.team_posts(m.Mail(forward('Need a cover teacher tomorrow 6pm, Thu Duc.')), NOW)
        self.assertEqual(why, '1 post, NO Apply: line')
        self.assertNotIn('applyText', posts[0])

    def test_apply_on_the_next_line_and_html_links_kept(self):
        html = ('<div>Teacher wanted, Binh Thanh, 25tr/month.</div><div>APPLY:</div>'
                '<div><a href="https://forms.gle/abc123">Google Form</a></div>')
        posts, _ = m.team_posts(m.Mail(forward(html=html)), NOW)
        self.assertEqual(posts[0]['applyText'], 'Google Form <https://forms.gle/abc123>')
        self.assertIn('Teacher wanted, Binh Thanh', posts[0]['text'])

    def test_vietnamese_post(self):
        body = ('Trung tâm Anh ngữ tại Quận 7 cần tuyển giáo viên nước ngoài dạy tiếng Anh cho trẻ em, '
                'lương 400.000đ/giờ, dạy cuối tuần.\nApply: gửi CV qua Zalo 0901234567')
        posts, _ = m.team_posts(m.Mail(forward(body, subject='Fwd: JOB: GV tiếng Anh Q7')), NOW)
        self.assertEqual((posts[0]['lang'], posts[0]['title']), ('vi', 'GV tiếng Anh Q7'))

    def test_an_older_quoted_apply_line_is_not_this_jobs(self):
        # codex, gate 7a: read from the post itself, after the quoted reply is cut — never a "> Apply:" line
        body = ('Need a cover teacher tomorrow 6pm, Thu Duc.\n\nOn Mon, 19 Oct 2026 Lan wrote:\n'
                '> Teacher wanted, Q7\n> Apply: Zalo 0909 999 999\n')
        posts, why = m.team_posts(m.Mail(forward(body)), NOW)
        self.assertEqual(why, '1 post, NO Apply: line')
        self.assertNotIn('applyText', posts[0])
        self.assertIsNone(m.apply_line('> Apply: Zalo 0909 999 999'))

    def test_forwarded_headers_quotes_and_signature_are_cut(self):
        body = ('---------- Forwarded message ---------\nFrom: Ms Lan <lan@school.example>\nDate: Mon, 19 Oct 2026\n'
                'Subject: tuyen GV\nTo: lap@eno.vn\n\n' + POST_EN + '\nOn Mon, 19 Oct 2026 Lan wrote:\n> old\n> thread\n')
        posts, _ = m.team_posts(m.Mail(forward(body)), NOW)
        self.assertEqual(posts[0]['text'], POST_EN.strip())

    def test_a_dash_line_inside_a_long_post_is_kept(self):
        body = 'Job A\n--\n' + '\n'.join(f'line {i}' for i in range(12))
        posts, _ = m.team_posts(m.Mail(forward(body)), NOW)
        self.assertTrue(posts[0]['text'].endswith('line 11'))

    def test_subjects(self):
        for subject, ok in (('JOB: x', True), ('job : x', True), ('Fwd: JOB: x', True), ('TR: Job: x', True),
                            ('Re: JOB: x', False), ('Jobs update', False), ('[JOB] x', False)):
            posts, _ = m.team_posts(m.Mail(forward('Teacher wanted', subject=subject)), NOW)
            self.assertEqual(bool(posts), ok, subject)

    def test_no_message_id_gives_a_stable_key(self):
        raw = forward('Teacher wanted', message_id=None)
        a, _ = m.team_posts(m.Mail(raw), NOW)
        b, _ = m.team_posts(m.Mail(raw), NOW)
        self.assertEqual(a[0]['externalKey'], b[0]['externalKey'])
        self.assertRegex(a[0]['externalKey'], r'^[0-9a-f]{64}$')

    def test_text_is_clipped_in_js_units(self):
        posts, _ = m.team_posts(m.Mail(forward('Teacher wanted \U0001F600 ' * 600)), NOW)
        self.assertLessEqual(len(posts[0]['text'].encode('utf-16-le')) // 2, m.TEXT_MAX)

    def test_a_contact_in_the_subject_never_becomes_the_title(self):
        for subject in ('JOB: GV Q7 call 0901 234 567', 'JOB: teacher, mail hr@school.edu.vn', 'JOB: zalo.me/0901234567'):
            posts, _ = m.team_posts(m.Mail(forward('Teacher wanted', subject=subject)), NOW)
            self.assertNotIn('title', posts[0], subject)
        posts, _ = m.team_posts(m.Mail(forward('Teacher wanted', subject='JOB: school year 2026-2027, D7')), NOW)
        self.assertEqual(posts[0]['title'], 'school year 2026-2027, D7')

    def test_an_empty_forward_gives_nothing(self):
        posts, why = m.team_posts(m.Mail(forward('', subject='JOB:')), NOW)
        self.assertEqual(posts, [])
        self.assertIn('no text', why)


class Language(unittest.TestCase):
    def test_guess(self):
        self.assertEqual(m.guess_lang('Cần tuyển giáo viên tiếng Anh bản ngữ dạy lớp mẫu giáo, lương cao'), 'vi')
        self.assertEqual(m.guess_lang('English teacher needed in Thủ Đức and Quận 7, weekends, 500k per hour'), 'en')
        self.assertEqual(m.guess_lang('Tuyển GV / Hiring teacher: dạy tiếng Anh cho trẻ em tại Hà Nội, lương tốt'), 'vi')
        # decomposed (NFD) Vietnamese, as some phones paste it
        import unicodedata
        self.assertEqual(m.guess_lang(unicodedata.normalize('NFD', 'Cần tuyển giáo viên tiếng Anh')), 'vi')
        self.assertEqual(m.guess_lang('12345 !!!'), 'en')


# ── DKIM building blocks, DNS, HTML, doveadm output ────

class Building(unittest.TestCase):
    def test_rfc6376_canonicalisation_example(self):  # RFC 6376 §3.4.6
        self.assertEqual(m.canon_header(b'A: X', 'relaxed'), b'a:X\r\n')
        self.assertEqual(m.canon_header(b'B : Y\t\r\n\tZ  ', 'relaxed'), b'b:Y Z\r\n')
        self.assertEqual(m.canon_header(b'B : Y\t\r\n\tZ  ', 'simple'), b'B : Y\t\r\n\tZ  \r\n')
        body = b' C \r\nD \t E\r\n\r\n\r\n'
        self.assertEqual(m.canon_body(body, 'relaxed'), b' C\r\nD E\r\n')
        self.assertEqual(m.canon_body(body, 'simple'), b' C \r\nD \t E\r\n')
        self.assertEqual((m.canon_body(b'', 'simple'), m.canon_body(b'', 'relaxed')), (b'\r\n', b''))

    def test_key_records(self):
        n, e = m.parse_key_record(TEST_DKIM_TXT)
        self.assertEqual((n.bit_length(), e), (2048, 65537))
        self.assertIsNone(m.parse_key_record('v=DKIM1; k=rsa; p='))  # revoked
        self.assertIsNone(m.parse_key_record(TEST_DKIM_TXT + '; t=y'))  # testing
        self.assertIsNone(m.parse_key_record(TEST_DKIM_TXT.replace('k=rsa', 'k=ed25519')))
        self.assertIsNone(m.parse_key_record('v=DKIM1; p=not base64!'))

    def test_rsa_rejects_junk(self):
        n, e = m.parse_key_record(TEST_DKIM_TXT)
        digest = hashlib.sha256(b'x').digest()
        self.assertFalse(m.rsa_verify(n, e, b'', digest))
        self.assertFalse(m.rsa_verify(n, e, b'\x01' * 256, digest))
        self.assertFalse(m.rsa_verify(n, e, n.to_bytes(256, 'big'), digest))

    def test_dns_txt_answer(self):
        q = m.dns_query('test2026._domainkey.linkedin.com', 0x1234)
        self.assertEqual(q[:2], b'\x12\x34')
        self.assertIn(b'\x08test2026\x0a_domainkey\x08linkedin\x03com\x00\x00\x10\x00\x01', q)
        rr = b'\xc0\x0c' + b'\x00\x10\x00\x01' + b'\x00\x00\x0e\x10'
        rdata = b'\x0dv=DKIM1; p=AB' + b'\x02CD'
        answer = (b'\x12\x34\x81\x80\x00\x01\x00\x01\x00\x00\x00\x00' + q[12:q.index(b'\x00\x10\x00\x01') + 4]
                  + rr + len(rdata).to_bytes(2, 'big') + rdata)
        self.assertEqual(m.dns_txt_answer(answer, 0x1234), ['v=DKIM1; p=ABCD'])
        self.assertEqual(m.dns_txt_answer(b'\x12\x34\x81\x83' + b'\x00' * 8, 0x1234), [])  # NXDOMAIN: no key, for good
        with self.assertRaises(m.DkimTemp):
            m.dns_txt_answer(b'\x12\x34\x81\x82' + b'\x00' * 8, 0x1234)  # SERVFAIL: try later
        with self.assertRaises(m.DkimTemp):
            m.dns_txt_answer(answer, 0x9999)  # not our question
        with self.assertRaises(m._Truncated):
            m.dns_txt_answer(b'\x12\x34\x83\x80' + b'\x00' * 8, 0x1234)

    def test_resolvers(self):
        with tempfile.NamedTemporaryFile('w', suffix='.conf', delete=False) as f:
            f.write('# x\nnameserver 127.0.0.53\noptions edns0\nnameserver fe80::1%eth0\n')
        try:
            self.assertEqual(m.resolvers(f.name), ['127.0.0.53', 'fe80::1'])
        finally:
            os.unlink(f.name)
        self.assertEqual(m.resolvers('/nonexistent/resolv.conf'), ['127.0.0.53'])

    def test_html_to_text(self):
        html = ('<html><head><title>T</title><style>.a{}</style><script>var x=1</script>'
                '<body><p>Teacher &amp; tutor&nbsp;wanted</p><p>Apply: <a href="https://forms.gle/x">form</a></p>'
                '<a href="https://x.example/y">https://x.example/y</a><br>end')
        self.assertEqual(m.html_to_text(html), 'Teacher & tutor wanted\nApply: form <https://forms.gle/x>\n<https://x.example/y>\nend')

    def test_html_links_around_blocks(self):
        html = '<a href="https://x.example/card"><div>Card title</div><div>second line</div></a><p>after</p>'
        self.assertEqual(m.html_to_text(html), 'Card title second line <https://x.example/card>\nafter')
        self.assertEqual(m.html_to_text(html, links='marker'), '<https://x.example/card>\nCard title\nsecond line\nafter')
        self.assertEqual(m.html_to_text('<p>a</p><p>b</p><br><br>c<head><title>never closed'), 'a\nb\n\nc')

    def test_a_parser_error_never_puts_content_in_the_log(self):
        real = m.from_address
        m.from_address = lambda mail: (_ for _ in ()).throw(ValueError('Ms Lan 0901234567 secret post text'))
        try:
            o = m.read_message(forward('x'), cfg(), no_key, NOW)
        finally:
            m.from_address = real
        self.assertEqual(o.status, 'skip')
        self.assertTrue(o.why.startswith('unreadable message (ValueError at line'))
        self.assertNotIn('0901234567', o.why)

    def test_doveadm_output(self):
        self.assertEqual(m.parse_status(b'uidvalidity=1700000000 uidnext=42\n'), (1700000000, 42))
        self.assertEqual(m.parse_status(b'uidvalidity: 1700000000\nuidnext: 42\n\x0c\n'), (1700000000, 42))
        with self.assertRaises(m.DovecotError):
            m.parse_status(b'')
        self.assertEqual(m.parse_search(b'8d1f3c 5\n8d1f3c 7\n\n'), {5, 7})
        with self.assertRaises(m.DovecotError):
            m.parse_search(b'Warning: something odd\n')
        self.assertEqual(m.parse_sizes(b'uid=5 size.virtual=1234\nuid=7 size.virtual=99\n'), {5: 1234, 7: 99})
        msg = b'From: a@b.c\nSubject: x\n\nbody\n'
        self.assertEqual(m.parse_fetch_text(b'text:\n' + msg + b'\x0c\n'), msg)
        self.assertEqual(m.parse_fetch_text(b'text:\n' + msg + b'\n\x0c\n'), msg + b'\n')  # an added line end: harmless
        self.assertEqual(m.parse_fetch_text(b'text: ' + msg + b'\x0c\n'), msg)
        self.assertIsNone(m.parse_fetch_text(b''))
        with self.assertRaises(m.DovecotError):
            m.parse_fetch_text(b'hdr: x')

    def test_only_read_commands_on_one_mailbox(self):
        dove = m.Dovecot(cfg(), runner=lambda *a, **k: (0, b'', b''))
        for args in (['expunge', '-u', 'alex@eno.vn', 'mailbox', 'INBOX', 'all'],
                     ['flags', 'add', '-u', 'alex@eno.vn', '\\Seen', 'mailbox', 'INBOX', 'all'],
                     ['move', '-u', 'alex@eno.vn', 'Trash', 'mailbox', 'INBOX', 'all'],
                     ['fetch', '-u', 'lap@eno.vn', 'text', 'mailbox', 'INBOX', 'all'],
                     ['search', '-A', 'mailbox', 'INBOX', 'all'],
                     ['fetch', '-u', 'alex@eno.vn', 'text', 'mailbox', 'Sent', 'all'],
                     ['mailbox', 'status', '-u', 'alex@eno.vn', 'messages', 'Sent']):
            with self.assertRaises(AssertionError, msg=args):
                dove._doveadm(args)


# ── Runs: the checkpoint, acks, failures ────

class Runs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='eno-job-mailbox-test-')
        real = m.linkedin_auth
        self.addCleanup(setattr, m, 'linkedin_auth', real)
        m.linkedin_auth = lambda mail, c, lookup, now: (('pass', 'test signature') if mail.first('x-test-signed') == 'linkedin'
                                                        else real(mail, c, lookup, now))

    def tearDown(self):
        for root, dirs, files in os.walk(self.tmp, topdown=False):
            for f in files:
                os.unlink(os.path.join(root, f))
            for d in dirs:
                os.rmdir(os.path.join(root, d))
        os.rmdir(self.tmp)

    def inbox(self):
        """uid 3: an unrelated mail · 5: a LinkedIn alert proven by our own DKIM check · 6: a team forward ·
        8: a spoofed team forward through the bridge · 9: a (test-)signed alert · 10: an unsigned alert with a forged
        "dkim=pass" header of ours on top — refused."""
        return {
            3: delivered(alert('hello', sender='Someone <someone@example.com>', subject='Lunch?')),
            5: delivered(SIGNED_ALERT_RELAXED),
            6: forward(POST_EN),
            8: forward(POST_EN, auth='bridge@eno.vn', helo='mx.cloudflare.net', message_id='<spoof@x>'),
            9: signed_for_test(delivered(alert('ESL Tutor\nApollo English\nHanoi, Vietnam\nView job: https://www.linkedin.com/comm/jobs/view/4090000001/'))),
            10: delivered(alert('Fake Job\nScam Co\nHanoi, Vietnam\nView job: https://www.linkedin.com/comm/jobs/view/4099999999/'),
                          ar='mail.eno.vn; dkim=pass header.d=linkedin.com', upstream=False),
        }

    def test_first_run_reads_the_last_3_days_and_sets_the_checkpoint(self):
        box = FakeBox(self.inbox(), uidnext=12)
        code, out = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_OK, out)
        since = int(box.searches[0][1])
        self.assertEqual(box.searches[0][0], 'SINCE')
        self.assertEqual(since, int((NOW - dt.timedelta(days=3)).timestamp()))
        self.assertEqual(sorted(box.fetched), [5, 6, 8, 9, 10])  # uid 3 is never opened
        sent = [p for batch in box.posted for p in batch]
        self.assertEqual(sorted(p['externalKey'] for p in sent if p['source'] == 'linkedin'),
                         ['4012345678', '4023456789', '4034567890', '4090000001'])
        self.assertEqual([p['source'] for p in sent].count('intake'), 1)  # uid 8 (spoofed) was skipped
        self.assertTrue(all(len({p['source'] for p in batch}) == 1 for batch in box.posted))  # one source per request
        self.assertEqual(state(self.tmp), {'version': 1, 'uidvalidity': 1700000000, 'lastUid': 11, 'pending': {},
                                           'updatedAt': '2026-10-20T03:00:00Z',
                                           'linkedinAt': '2026-10-20T01:15:00Z'})  # the newest alert with jobs: its Date
        self.assertIn('uid=8 team: skip', out)
        self.assertIn('uid=10 linkedin: skip — not authenticated as LinkedIn — own DKIM check: no DKIM signature', out)
        self.assertNotIn('Hiring a native English teacher', out)  # no content in the log
        self.assertNotIn('English teacher, District 7', out)
        self.assertFalse(os.path.exists(box.header_files[0]))  # the secret file is gone

    def test_only_read_commands_were_run(self):
        box = FakeBox(self.inbox(), uidnext=12)
        run(box, self.tmp)
        for argv in box.calls:
            if argv[:2] == ['docker', 'exec'] and argv[3] == 'doveadm':
                cmd = argv[6:] if argv[4] == '-f' else argv[4:]
                verb = tuple(cmd[:2]) if cmd[0] == 'mailbox' else (cmd[0],)
                self.assertIn(verb, {('mailbox', 'status'), ('search',), ('fetch',)})
                self.assertEqual(cmd[cmd.index('-u') + 1], 'alex@eno.vn')

    def test_nothing_new_exits_2_without_searching(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11)
        box = FakeBox(self.inbox(), uidnext=12)
        code, out = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_NOTHING)
        self.assertEqual(box.searches, [])
        self.assertIn('nothing new', out)

    def test_new_unrelated_mail_moves_the_checkpoint_and_exits_2(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11)
        box = FakeBox({**self.inbox(), 12: delivered(alert('x', sender='a@example.com', subject='hi'))}, uidnext=13)
        code, _ = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_NOTHING)
        self.assertEqual(state(self.tmp)['lastUid'], 12)
        self.assertEqual(box.posted, [])

    def test_by_uid_from_the_checkpoint_and_the_imap_star_quirk(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=9)
        box = FakeBox(self.inbox(), uidnext=10)
        code, _ = run(box, self.tmp)  # uidnext-1 == lastUid: nothing to search
        self.assertEqual(code, m.EXIT_NOTHING)
        write_state(self.tmp, uidvalidity=1700000000, lastUid=9)
        inbox = {u: raw for u, raw in self.inbox().items() if u != 10}
        box = FakeBox(inbox, uidnext=12)  # "UID 10:*" also returns uid 9 (IMAP) — never read again
        code, _ = run(box, self.tmp)
        self.assertEqual(box.searches[0][:2], ['UID', '10:*'])
        self.assertEqual(box.fetched, [])
        self.assertEqual((code, state(self.tmp)['lastUid']), (m.EXIT_NOTHING, 11))

    def test_uidvalidity_change_reads_the_last_days_again(self):
        write_state(self.tmp, uidvalidity=1600000000, lastUid=500, pending={'501': '2026-10-19T00:00:00Z'})
        box = FakeBox(self.inbox(), uidnext=12)
        code, out = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_OK)
        self.assertIn('UIDVALIDITY changed (1600000000 -> 1700000000)', out)
        self.assertEqual(box.searches[0][0], 'SINCE')
        self.assertEqual(state(self.tmp)['uidvalidity'], 1700000000)
        self.assertEqual((state(self.tmp)['lastUid'], state(self.tmp)['pending']), (11, {}))

    def test_uidnext_behind_the_checkpoint_starts_over(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=40)  # same UIDVALIDITY, but the mailbox only reaches 11
        box = FakeBox(self.inbox(), uidnext=12)
        code, out = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_OK)
        self.assertIn('uidnext 12 is behind lastUid 40', out)
        self.assertEqual((box.searches[0][0], state(self.tmp)['lastUid']), ('SINCE', 11))

    def test_duplicates_count_as_acks(self):
        box = FakeBox(self.inbox(), uidnext=12,
                      answer=lambda posts: {'accepted': [], 'duplicate': [p['externalKey'] for p in posts], 'rejected': []})
        code, _ = run(box, self.tmp)
        self.assertEqual((code, state(self.tmp)['lastUid']), (m.EXIT_OK, 11))

    def test_a_rejected_post_holds_its_message_then_is_given_up(self):
        def answer(posts):
            bad = [p['externalKey'] for p in posts if p['externalKey'] == '4023456789']
            return {'accepted': [p['externalKey'] for p in posts if p['externalKey'] not in bad], 'duplicate': [],
                    'rejected': [{'key': k, 'reason': 'text'} for k in bad]}
        box = FakeBox(self.inbox(), uidnext=12, answer=answer)
        code, out = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_OK)
        st = state(self.tmp)
        self.assertEqual((st['lastUid'], st['pending']), (4, {'5': '2026-10-20T03:00:00Z'}))  # uid 5 holds the line
        self.assertIn('rejected linkedin 4023456789: text', out)
        self.assertEqual(sum(len(b) for b in box.posted), 5)  # everything else was still sent
        # an hour later: sent again (the server dedupes the rest), still held, the first-held time kept
        box = FakeBox(self.inbox(), uidnext=12, answer=answer)
        code, _ = run(box, self.tmp, now=NOW + dt.timedelta(hours=1))
        self.assertEqual(box.searches[0][:2], ['UID', '5:*'])
        self.assertEqual(state(self.tmp)['pending'], {'5': '2026-10-20T03:00:00Z'})
        # past GIVE_UP_HOURS: given up, loudly, and the checkpoint moves on
        box = FakeBox(self.inbox(), uidnext=12, answer=answer)
        code, out = run(box, self.tmp, now=NOW + dt.timedelta(hours=25))
        self.assertIn('uid=5: GIVING UP after 1 day, 0:00:00 — a post was rejected or never answered', out)
        self.assertEqual(code, m.EXIT_GAVE_UP)  # the unit fails once: visible in systemctl --failed
        self.assertEqual((state(self.tmp)['lastUid'], state(self.tmp)['pending']), (11, {}))

    def test_a_key_missing_from_the_answer_holds(self):
        box = FakeBox(self.inbox(), uidnext=12, answer=lambda posts: {
            'accepted': [p['externalKey'] for p in posts if p['source'] == 'linkedin'], 'duplicate': [], 'rejected': []})
        code, out = run(box, self.tmp)
        self.assertEqual(state(self.tmp)['lastUid'], 5)  # uid 6's intake post got no verdict
        self.assertEqual(list(state(self.tmp)['pending']), ['6'])
        self.assertIn('no verdict for intake', out)

    def test_app_down_exits_4_and_keeps_the_checkpoint(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=4)
        box = FakeBox(self.inbox(), uidnext=12)
        box.app_down = True
        code, out = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_UNREACHABLE)
        self.assertEqual((state(self.tmp)['lastUid'], state(self.tmp)['pending']), (4, {}))  # no give-up clock
        self.assertIn('app unreachable or refusing: curl exit 7', out)

    def test_a_request_refused_whole_says_the_servers_code(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=4)
        box = FakeBox(self.inbox(), uidnext=12)
        box.refuse_whole = {'error': 'too_many_posts', 'max': 50, 'text': 'Call Ms Lan 0909'}
        code, out = run(box, self.tmp)
        self.assertEqual((code, state(self.tmp)['lastUid']), (m.EXIT_UNREACHABLE, 4))
        self.assertIn('app unreachable or refusing: curl exit 22 (too_many_posts)', out)
        self.assertNotIn('0909', out)
        # an "error" that is not a plain code is not logged at all
        for bad in ({'error': 'call 0909123456'}, {'error': 'call0909123456'}, {'error': {'text': 'Call 0909'}}, ['x'], 'nope'):
            box = FakeBox(self.inbox(), uidnext=12)
            box.refuse_whole = bad
            code, out = run(box, self.tmp)
            self.assertIn('app unreachable or refusing: curl exit 22: ', out, bad)
            self.assertNotIn('0909', out, bad)

    def test_a_200_without_the_three_lists_is_an_app_failure(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=4)
        box = FakeBox(self.inbox(), uidnext=12, answer=lambda posts: {'ok': False, 'skipped': 'marketplace_only'})
        code, _ = run(box, self.tmp)
        self.assertEqual((code, state(self.tmp)['lastUid']), (m.EXIT_UNREACHABLE, 4))

    def test_dovecot_down_exits_4_and_saves_nothing(self):
        box = FakeBox(self.inbox(), uidnext=12)
        box.dovecot_down = True
        code, out = run(box, self.tmp)
        self.assertEqual(code, m.EXIT_UNREACHABLE)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, 'state.json')))
        self.assertIn('dovecot unreachable', out)

    def test_dns_down_holds_the_alert_but_not_the_rest(self):
        box = FakeBox(self.inbox(), uidnext=12)
        code, _ = run(box, self.tmp, lookup=dns_down)
        self.assertEqual(code, m.EXIT_OK)
        st = state(self.tmp)
        self.assertEqual((st['lastUid'], list(st['pending'])), (4, ['5']))
        self.assertTrue(any(p['externalKey'] == '4090000001' for b in box.posted for p in b))
        # DNS still down past GIVE_UP_HOURS: given up, saying why, and the unit fails once (codex + opus, gate 7a)
        box = FakeBox(self.inbox(), uidnext=12)
        code, out = run(box, self.tmp, lookup=dns_down, now=NOW + dt.timedelta(hours=25))
        self.assertIn('uid=5: GIVING UP after 1 day, 0:00:00 — its DKIM key could not be looked up', out)
        self.assertEqual((code, state(self.tmp)['lastUid']), (m.EXIT_GAVE_UP, 11))

    def test_skips_and_empty_messages_move_the_checkpoint(self):
        inbox = {
            5: delivered(alert(PLAIN_DIGEST), ar='mail.eno.vn; dkim=fail header.d=linkedin.com'),  # fails auth
            6: forward('Teacher wanted', subject='Re: JOB: x'),                                    # a reply
            7: signed_for_test(delivered(alert('No jobs today.'))),                                # no jobs
        }
        nid = m.notice_id(m.Mail(inbox[7]))
        self.assertEqual(nid, hashlib.sha256(b'<alert-1@linkedin.com>').hexdigest()[:12])  # the MESSAGE, not its UID
        box = FakeBox(inbox, uidnext=8)
        code, out = run(box, self.tmp, lookup=no_key)
        # uid 7 — LinkedIn wrote from the alert address with no job in it — is a notice a person must read (LinkedIn
        # switches off an alert nobody opens for 3 months, and writes first): read once, the checkpoint moves past it …
        self.assertEqual((code, state(self.tmp)['lastUid'], box.posted), (m.EXIT_NOTICE, 7, []))
        self.assertEqual(state(self.tmp)['notices'], {nid: {'uid': 7, 'at': '2026-10-20T03:00:00Z'}})
        self.assertIn(f'uid=7 linkedin: posts — LINKEDIN NOTICE {nid}, no job in it (template -)', out)
        self.assertIn('open it in alex@eno.vn', out)
        self.assertNotIn('No jobs today', out)  # never its content
        # … and it WAITS: every run fails until someone has read it and acknowledged it (codex + opus, gates 8a–8d)
        for _ in range(2):
            code, out = run(FakeBox(inbox, uidnext=8), self.tmp, lookup=no_key)
            self.assertEqual(code, m.EXIT_NOTICE, out)
            self.assertIn(f'LINKEDIN NOTICE waiting since 2026-10-20T03:00:00Z: 1 not acknowledged — {nid} (uid=7)', out)
            self.assertIn(f'python3 -I /opt/eno/bin/eno-job-mailbox.py --ack-notices {nid}', out)

        def ack(*ids):
            with contextlib.redirect_stdout(io.StringIO()) as said:
                code = m.ack_notices(cfg(self.tmp), list(ids), now=NOW + dt.timedelta(hours=1))
            return code, said.getvalue()

        fd = m.take_lock(os.path.join(self.tmp, 'state.json'))  # a run in progress: try again later
        try:
            self.assertEqual(ack(nid)[0], m.EXIT_ERROR)
        finally:
            os.close(fd)
        # only ids that are waiting, all or nothing (opus, gate 8e: never one that came after the line was read)
        code, said = ack(nid, '0123456789ab')
        self.assertEqual(code, m.EXIT_ERROR)
        self.assertIn(f'not waiting: 0123456789ab — nothing acknowledged. Waiting now: {nid}', said)
        self.assertIn(nid, state(self.tmp)['notices'])
        code, said = ack(nid)
        self.assertEqual(code, m.EXIT_OK)
        self.assertIn(f'acknowledged 1 LinkedIn notice(s): {nid}', said)
        st = state(self.tmp)
        self.assertEqual((st['lastUid'], st.get('notices'), st['acked']), (7, None, {nid: '2026-10-20T04:00:00Z'}))
        self.assertEqual(run(FakeBox(inbox, uidnext=8), self.tmp, lookup=no_key)[0], m.EXIT_NOTHING)
        # ⛔ an acknowledged notice is never raised again — a --since-days re-read (codex + opus, gate 8e) …
        code, out = run(FakeBox(inbox, uidnext=8), self.tmp, lookup=no_key, since_days=3)
        self.assertEqual(code, m.EXIT_OK, out)
        self.assertIn(f'uid=7: LINKEDIN NOTICE {nid} was acknowledged 2026-10-20T04:00:00Z — not raised again', out)
        self.assertNotIn('notices', state(self.tmp))
        # … or a rebuilt mailbox, where the same message has another UID
        write_state(self.tmp, uidvalidity=1800000000, lastUid=0, linkedinAt=m.iso(NOW),
                    acked=state(self.tmp)['acked'])
        code, out = run(FakeBox({3: inbox[7]}, uidvalidity=1900000000, uidnext=4), self.tmp, lookup=no_key)
        self.assertEqual(code, m.EXIT_OK, out)
        self.assertIn('not raised again', out)
        # a dry run says a waiting notice and never exits 5
        dry = tempfile.mkdtemp(prefix='eno-job-mailbox-test-')
        self.addCleanup(os.rmdir, dry)
        code, out = run(FakeBox(inbox, uidnext=8), dry, lookup=no_key, dry_run=True)
        self.assertEqual(code, m.EXIT_OK)
        self.assertIn('LINKEDIN NOTICE waiting', out)

    def test_a_waiting_notice_is_the_message_not_its_uid(self):
        notice = signed_for_test(delivered(alert('No jobs today.')))
        nid = m.notice_id(m.Mail(notice))
        # with no Message-ID, the id is what every delivery leaves as it was — not the per-delivery trace on top
        bare = alert('No jobs today.').replace(b'Message-ID: <alert-1@linkedin.com>\n', b'')
        self.assertNotIn(b'Message-ID', bare)
        self.assertEqual(m.notice_id(m.Mail(delivered(bare))), m.notice_id(m.Mail(GMAIL_FORWARD_TRACE + delivered(bare))))
        self.assertNotEqual(m.notice_id(m.Mail(delivered(bare))),
                            m.notice_id(m.Mail(delivered(bare.replace(b'No jobs today.', b'No jobs today!')))))
        run(FakeBox({7: notice}, uidnext=8), self.tmp, lookup=no_key)
        # the mailbox is rebuilt and the same message comes back as uid 2: still one notice, first seen when it was
        write_state(self.tmp, **{**state(self.tmp), 'uidvalidity': 1800000000})
        code, out = run(FakeBox({2: notice}, uidvalidity=1900000000, uidnext=3), self.tmp, lookup=no_key,
                        now=NOW + dt.timedelta(hours=2))
        self.assertEqual((code, state(self.tmp)['notices']), (m.EXIT_NOTICE, {nid: {'uid': 2, 'at': m.iso(NOW)}}))

    def test_waiting_notices_are_checked_and_never_dropped(self):
        many = {f'{u:012x}': {'uid': u, 'at': '2026-10-19T00:00:00Z'} for u in range(100, 160)}
        junk = {'x': {'uid': 1, 'at': '2026-10-19T00:00:00Z'}, 'abcdefabcdef': {'uid': 'one', 'at': 'not a time'},
                '0123456789ab': '2026-10-19T00:00:00Z'}
        write_state(self.tmp, uidvalidity=1700000000, lastUid=2, notices={**many, **junk},
                    acked={'ffffffffffff': '2026-10-19T00:00:00Z', 'nope': 'x'})
        loaded = m.load_state(os.path.join(self.tmp, 'state.json'))
        self.assertEqual((sorted(loaded['notices']), loaded['acked']),
                         (sorted(many), {'ffffffffffff': '2026-10-19T00:00:00Z'}))  # junk dropped on load
        # sixty waiting and one more: none is dropped — a dropped one is one nobody read (codex, gate 8f) — and the new one,
        # with a LOWER uid than the old ones (they came before a rebuild), is there too
        notice = signed_for_test(delivered(alert('No jobs today.')))
        nid = m.notice_id(m.Mail(notice))
        code, out = run(FakeBox({3: notice}, uidnext=4), self.tmp, lookup=no_key)
        kept = state(self.tmp)['notices']
        self.assertEqual((code, sorted(kept)), (m.EXIT_NOTICE, sorted([*many, nid])))
        self.assertIn('61 not acknowledged', out)
        self.assertIn(f'--ack-notices {",".join(sorted(many))},{nid}', out)  # oldest first, all of them
        # an acknowledged id is kept however many there are: it is never raised again
        ids = list(kept)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.ack_notices(cfg(self.tmp), ids), m.EXIT_OK)
        self.assertEqual(sorted(state(self.tmp)['acked']), sorted([*ids, 'ffffffffffff']))
        # a notice a --since-days re-read finds waits too, though that re-read leaves the checkpoint alone
        write_state(self.tmp, uidvalidity=1700000000, lastUid=3, linkedinAt=m.iso(NOW))
        code, _ = run(FakeBox({3: notice}, uidnext=4), self.tmp, lookup=no_key, since_days=3)
        self.assertEqual((code, state(self.tmp)['lastUid'], state(self.tmp)['notices']),
                         (m.EXIT_NOTICE, 3, {nid: {'uid': 3, 'at': m.iso(NOW)}}))

    def test_a_silent_linkedin_fails_every_run_until_an_alert_with_jobs_comes(self):
        # codex + opus, gate 8a: a one-run exit 5 is gone at the next timer run, and a switched-off alert, a deleted
        # Gmail filter or a stopped forward all look like "nothing new" — so silence itself is what fails, every run.
        quiet = NOW - dt.timedelta(days=8)
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11, linkedinAt=m.iso(quiet))
        for _ in range(2):  # the "nothing new" path, run after run
            code, out = run(FakeBox(self.inbox(), uidnext=12), self.tmp)
            self.assertEqual(code, m.EXIT_NOTICE, out)
            self.assertIn('LINKEDIN SILENT: no LinkedIn alert with jobs since 2026-10-12T03:00:00Z (8 days)', out)
            self.assertIn('vietnameno@gmail.com', out)
        # a dry run says it and exits as usual; the setting 0 turns it off; 7 days is not yet silence
        code, out = run(FakeBox(self.inbox(), uidnext=12), self.tmp, dry_run=True)
        self.assertEqual(code, m.EXIT_NOTHING)
        self.assertIn('LINKEDIN SILENT', out)
        self.assertEqual(run(FakeBox(self.inbox(), uidnext=12), self.tmp, env={'linkedin_silent_days': '0'})[0],
                         m.EXIT_NOTHING)
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11, linkedinAt=m.iso(NOW - dt.timedelta(days=7)))
        self.assertEqual(run(FakeBox(self.inbox(), uidnext=12), self.tmp)[0], m.EXIT_NOTHING)
        # a checkpoint with no clock in it is not silence yet — a quiet run starts the clock there (codex, gate 8c) …
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11)
        self.assertEqual(run(FakeBox(self.inbox(), uidnext=12), self.tmp)[0], m.EXIT_NOTHING)
        self.assertEqual((state(self.tmp)['lastUid'], state(self.tmp)['linkedinAt']), (11, m.iso(NOW)))
        # … so a week of quiet runs after it is silence
        code, out = run(FakeBox(self.inbox(), uidnext=12), self.tmp, now=NOW + dt.timedelta(days=8))
        self.assertEqual(code, m.EXIT_NOTICE, out)
        # a --since-days re-read leaves the checkpoint where it is, but an alert it recovers moves the clock (codex, 8b)
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11, linkedinAt=m.iso(quiet))
        code, out = run(FakeBox(self.inbox(), uidnext=12), self.tmp, since_days=3)
        st = state(self.tmp)
        self.assertEqual((code, st['lastUid'], st['linkedinAt']), (m.EXIT_OK, 11, '2026-10-20T01:15:00Z'), out)
        self.assertEqual(run(FakeBox(self.inbox(), uidnext=12), self.tmp)[0], m.EXIT_NOTHING)  # the next timer run
        # silent, then an alert with jobs arrives: the run reads it, records its Date, and the silence is over
        write_state(self.tmp, uidvalidity=1700000000, lastUid=8, linkedinAt=m.iso(quiet))
        code, out = run(FakeBox(self.inbox(), uidnext=12), self.tmp)
        self.assertEqual(code, m.EXIT_OK, out)
        self.assertNotIn('LINKEDIN SILENT', out)
        self.assertEqual(state(self.tmp)['linkedinAt'], '2026-10-20T01:15:00Z')
        # a clock ahead of now (the box's clock stepped back, a hand edit) cannot mute the check (codex, gate 8e): a quiet
        # run puts it back to now, and a run that reads an alert dated a day ahead keeps it at now
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11, linkedinAt=m.iso(NOW + dt.timedelta(days=30)))
        self.assertEqual(run(FakeBox(self.inbox(), uidnext=12), self.tmp)[0], m.EXIT_NOTHING)
        self.assertEqual(state(self.tmp)['linkedinAt'], m.iso(NOW))
        self.assertEqual(run(FakeBox(self.inbox(), uidnext=12), self.tmp, now=NOW + dt.timedelta(days=8))[0],
                         m.EXIT_NOTICE)
        ahead = {12: signed_for_test(delivered(alert('ESL Tutor\nApollo English\nHanoi, Vietnam\n'
                                                     'View job: https://www.linkedin.com/comm/jobs/view/4090000002/',
                                                     date='Tue, 20 Oct 2026 20:00:00 +0000')))}
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11, linkedinAt=m.iso(quiet))
        self.assertEqual(run(FakeBox(ahead, uidnext=13), self.tmp)[0], m.EXIT_OK)
        self.assertEqual(state(self.tmp)['linkedinAt'], m.iso(NOW))
        # a mailbox rebuilt (UIDVALIDITY changed) keeps the clock: it is about LinkedIn, not the mailbox
        write_state(self.tmp, uidvalidity=1600000000, lastUid=99, linkedinAt=m.iso(quiet))
        inbox = {u: raw for u, raw in self.inbox().items() if u not in (5, 9)}  # no LinkedIn alert left in the window
        code, out = run(FakeBox(inbox, uidnext=12), self.tmp)
        self.assertEqual((code, state(self.tmp)['linkedinAt']), (m.EXIT_NOTICE, m.iso(quiet)), out)

    def test_a_feed_broken_from_the_first_run_fails_too(self):
        # codex + opus, gate 8b: no alert with jobs EVER — the filter, the forward or the account's address wrong from
        # the start — must not read as "nothing new" for ever: the clock runs from the reader's first run
        inbox = {6: forward(POST_EN), 7: signed_for_test(delivered(alert('No jobs today.')))}  # a team post, a notice
        code, _ = run(FakeBox(inbox, uidnext=8), self.tmp)
        self.assertEqual((code, state(self.tmp)['linkedinAt']), (m.EXIT_NOTICE, m.iso(NOW)))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.ack_notices(cfg(self.tmp), list(state(self.tmp)['notices'])), m.EXIT_OK)  # read; clock runs
        code, out = run(FakeBox(inbox, uidnext=8), self.tmp, now=NOW + dt.timedelta(days=6))
        self.assertEqual(code, m.EXIT_NOTHING, out)
        code, out = run(FakeBox(inbox, uidnext=8), self.tmp, now=NOW + dt.timedelta(days=8))
        self.assertEqual(code, m.EXIT_NOTICE, out)
        self.assertIn('LINKEDIN SILENT: no LinkedIn alert with jobs since 2026-10-20T03:00:00Z (8 days)', out)

    def test_a_spent_time_budget_saves_what_was_read_and_the_next_run_carries_on(self):
        # opus, gate 7b3: a run that would outlast the unit's timeout stops READING; the checkpoint covers what it read
        budget = m.RUN_BUDGET_S
        m.RUN_BUDGET_S = -1  # spent after the first message
        try:
            box = FakeBox(self.inbox(), uidnext=12)
            code, out = run(box, self.tmp)
            self.assertIn('time budget', out)
            self.assertEqual(box.fetched, [5])
            self.assertEqual(state(self.tmp)['lastUid'], 5)
            box = FakeBox(self.inbox(), uidnext=12)
            run(box, self.tmp)
            self.assertEqual(box.fetched, [6])
            self.assertEqual(state(self.tmp)['lastUid'], 6)
        finally:
            m.RUN_BUDGET_S = budget

    def test_a_held_message_that_is_gone_is_said_not_silently_dropped(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=4, pending={'5': '2026-10-20T02:00:00Z'})
        inbox = {u: raw for u, raw in self.inbox().items() if u != 5}  # uid 5 was moved out of INBOX
        code, out = run(FakeBox(inbox, uidnext=12), self.tmp)
        self.assertIn('uid=5: held since 2026-10-20T02:00:00Z, no longer a candidate', out)
        self.assertEqual(state(self.tmp)['pending'], {})

    def test_a_message_over_the_cap_is_never_fetched(self):
        box = FakeBox(self.inbox(), uidnext=12)
        box.size_override[6] = 300 * 1024
        code, out = run(box, self.tmp)
        self.assertNotIn(6, box.fetched)
        self.assertIn('uid=6 -: skip — too big (307200 bytes > 204800)', out)
        self.assertEqual(state(self.tmp)['lastUid'], 11)

    def test_batches_of_at_most_50(self):
        jobs = '\n\n'.join(f'Teacher {i}\nSchool {i}\nHanoi, Vietnam\nView job: https://www.linkedin.com/comm/jobs/view/40{i:08d}/'
                           for i in range(40))
        inbox = {u: signed_for_test(delivered(alert(jobs.replace('/40', f'/4{u}')))) for u in (1, 2)}
        box = FakeBox(inbox, uidnext=3)
        code, _ = run(box, self.tmp)
        self.assertEqual([len(b) for b in box.posted], [50, 30])
        self.assertEqual(state(self.tmp)['lastUid'], 2)

    def test_dry_run_sends_nothing_and_saves_nothing(self):
        box = FakeBox(self.inbox(), uidnext=12)
        code, out = run(box, self.tmp, dry_run=True)
        self.assertEqual(code, m.EXIT_OK)
        self.assertEqual([c for c in box.calls if c[0] == 'curl' or 'printenv' in c], [])
        self.assertEqual(os.listdir(self.tmp), [])  # no state, no lock
        self.assertIn('would POST 4 linkedin post(s)', out)
        self.assertIn('"externalKey": "4012345678"', out)
        self.assertIn('would move lastUid 0 -> 11', out)

    def test_since_days_re_reads_and_leaves_the_checkpoint(self):
        write_state(self.tmp, uidvalidity=1700000000, lastUid=11)
        box = FakeBox(self.inbox(), uidnext=12)
        code, out = run(box, self.tmp, since_days=7)
        self.assertEqual(code, m.EXIT_OK)
        self.assertEqual(box.searches[0][:2], ['SINCE', str(int((NOW - dt.timedelta(days=7)).timestamp()))])
        self.assertEqual(state(self.tmp)['lastUid'], 11)
        self.assertTrue(box.posted)

    def test_a_held_lock_means_another_run(self):
        fd = m.take_lock(os.path.join(self.tmp, 'state.json'))
        try:
            code, out = run(FakeBox(self.inbox(), uidnext=12), self.tmp)
        finally:
            os.close(fd)
        self.assertEqual(code, m.EXIT_NOTHING)
        self.assertIn('another run holds the lock', out)

    def test_a_corrupt_state_file_starts_over(self):
        with open(os.path.join(self.tmp, 'state.json'), 'w') as f:
            f.write('{"uidvalidity": "x"')
        code, out = run(FakeBox(self.inbox(), uidnext=12), self.tmp)
        self.assertEqual((code, state(self.tmp)['lastUid']), (m.EXIT_OK, 11))
        self.assertIn('state file unreadable', out)

    def test_the_units(self):
        with open(os.path.join(HERE, 'eno-job-mailbox.service')) as f:
            service = f.read()
        with open(os.path.join(HERE, 'eno-job-mailbox.timer')) as f:
            timer = f.read()
        for line in ('Type=oneshot', 'ExecStart=/usr/bin/python3 -I /opt/eno/bin/eno-job-mailbox.py', 'SuccessExitStatus=2',
                     'Nice=10', 'MemoryMax=256M', 'TimeoutStartSec=600'):
            self.assertIn(f'\n{line}\n', service)
        self.assertNotIn('MemoryHigh', service.replace('a MemoryHigh would', ''))  # no swap on the box
        # every 30 minutes 07:00-21:00 ICT (UTC+7), written in UTC — expand the two OnCalendar lines
        times = set()
        for spec in re.findall(r'^OnCalendar=(.*)$', timer, re.M):
            mm = re.fullmatch(r'\*-\*-\* (\d\d)(?:\.\.(\d\d))?:(\d\d(?:,\d\d)*):00 UTC', spec)
            self.assertTrue(mm, spec)
            for h in range(int(mm.group(1)), int(mm.group(2) or mm.group(1)) + 1):
                times |= {((h + 7) % 24, int(mi)) for mi in mm.group(3).split(',')}
        want = {(h, mi) for h in range(7, 21) for mi in (0, 30)} | {(21, 0)}
        self.assertEqual(times, want)
        self.assertIn('\nPersistent=true\n', timer)
        self.assertIn('\nRandomizedDelaySec=60\n', timer)

    def test_main_usage_errors_exit_1_not_2(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as e:
            m.main(['--since-days', '0'])
        self.assertEqual(e.exception.code, m.EXIT_ERROR)
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as e:
            m.main(['--nope'])
        self.assertEqual(e.exception.code, m.EXIT_ERROR)
        for bad in (['--ack-notices', '0123456789ab', '--dry-run'], ['--ack-notices', '0123456789ab', '--since-days', '3'],
                    ['--ack-notices'], ['--ack-notices', ','], ['--ack-notices', '7'], ['--ack-notices', 'uid=7']):
            with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as e:
                m.main(bad)
            self.assertEqual(e.exception.code, m.EXIT_ERROR, bad)

    def test_main_ack_notices_uses_the_settings_state_file(self):
        waiting = {'0123456789ab': {'uid': 7, 'at': '2026-10-20T03:00:00Z'},
                   'ba9876543210': {'uid': 9, 'at': '2026-10-20T03:30:00Z'}}
        write_state(self.tmp, uidvalidity=1700000000, lastUid=9, notices=waiting)
        env = {'ENO_JOB_MAILBOX_STATE': os.path.join(self.tmp, 'state.json')}
        with unittest.mock.patch.dict(os.environ, env), contextlib.redirect_stdout(io.StringIO()) as said:
            self.assertEqual(m.main(['--ack-notices', ' 0123456789AB ']), m.EXIT_OK)
        self.assertIn('acknowledged 1 LinkedIn notice(s): 0123456789ab — 1 still waiting', said.getvalue())
        self.assertEqual(list(state(self.tmp)['notices']), ['ba9876543210'])
        self.assertEqual(list(state(self.tmp)['acked']), ['0123456789ab'])


if __name__ == '__main__':
    unittest.main()
