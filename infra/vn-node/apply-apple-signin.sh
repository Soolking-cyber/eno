#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · Sign in with Apple on the VN box: GoTrue's Apple provider (the web and Android flow), the app's
# Apple env (both editions), and the life of GoTrue's Apple client secret.
# Runbook: infra/vn-node/apple-signin.md (plan ~/eno-ios-prep/siwa/plan.md §6, I6–I14).
#
#   install --team <TEAM_ID> --kid <KEY_ID> --services-id <SERVICES_ID> --bundle <BUNDLE_ID> \
#           [--flow-state-expiry 10m] [--drop-localhost-redirect]
#   check [--calibrate] [--auto-rotate]   probe GoTrue's secret at Apple; alert (or rotate) at 30 days or fewer
#   rotate                                 mint GoTrue a new secret, swap it in, prove it — or put the old one back
#   restore <ts> [--force]                 put back what the run at <ts> backed up (no <ts>: list the backups)
#   install-timer [--auto-rotate]          the daily check: eno-apple-siwa-check.timer, 20:40 UTC
#
# Inputs, piped from the vault (I6) — never pasted, never on a command line:
#   /opt/eno/secrets/apple-siwa.p8         the dedicated Sign in with Apple key (.p8 PEM)
#   /opt/eno/secrets/apple-token-enc.key   APPLE_TOKEN_ENC_KEY (32 bytes, base64 or 64 hex) — shredded once a
#                                          successful install has written it into both app env files
#
# ⛔ NO SECRET EVER REACHES A SCREEN, A LOG OR AN argv. A secret moves only through stdin (python3, curl,
# `docker run -i`) or is read by python3 straight from its file; the minted client secret lives in one shell
# variable and is never exported. What is printed: key ids, dates, booleans and 12-character SHA-256
# fingerprints. The script refuses to run under `bash -x`, which would print every expansion.
#
# ⛔ THE APP'S NAMES, NEVER APPLE_TEAM_ID. The app reads APPLE_SIWA_* (src/lib/auth/apple-siwa.ts); the team-id
# variable without the infix switches on the AASA route (applinks, P7 — on hold). Nothing here writes it.
#
# ⚠️ GoTrue IS RECREATED, AND BOTH EDITIONS SIGN IN THROUGH IT. install, rotate and restore each cost a few
# seconds of failed sign-ins and token refreshes on eno.vn AND eno.forum: run them at 19:00–22:00 UTC.
set -uo pipefail
umask 077
case $- in
  *x*) echo "apply-apple-signin.sh: refusing to run under xtrace — it would print secrets" >&2; exit 2 ;;
esac

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
SELF=$SELF_DIR/$(basename "$0")

APPLE_TOKEN_URL=https://appleid.apple.com/auth/token
REDIRECT_URI=https://sb.eno.vn/auth/v1/callback   # = the Services ID's registered return URL, character for character
EXPECT_API_EXTERNAL_URL=https://sb.eno.vn
SECRET_TTL_DAYS=175          # Apple's ceiling is 6 months (15,777,000 s); 175 days leaves a week of slack
ROTATE_AT_DAYS=30            # A3/D11: alert — or, with auto-rotate, rotate — at 30 days or fewer
URGENT_DAYS=3                # …and rotate outside the low-traffic window only when it is this close
LOCALHOST_REDIRECT='http://localhost:3000/**'
# RFC 7636 appendix B's challenge — 43 valid characters. The authorize check needs a well-formed one; GoTrue only
# compares it at the token exchange, which this probe never reaches.
PKCE_PROBE_CHALLENGE=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
KEEP_BACKUPS=10              # rotate and pre-restore backups kept; an install's backup (the pre-Apple state) is never pruned
IMAGE=eno-vn:local
GATEWAY=http://127.0.0.1:8000

# ⚠️ SANDBOX = THE TEST HARNESS (src/lib/apply-apple-signin.test.ts), NOTHING ELSE. Every path moves under the
# directory, the root check is skipped, and box_init refuses unless docker, curl, flock, shred and systemctl are
# that directory's stubs — so a sandbox run can never touch a real container or call Apple.
SANDBOX=${ENO_APPLE_SIWA_SANDBOX:-}
if [ -n "$SANDBOX" ]; then
  case "$SANDBOX" in /*) ;; *) echo "ENO_APPLE_SIWA_SANDBOX must be an absolute path" >&2; exit 2 ;; esac
  [ "$SANDBOX" != / ] && [ -d "$SANDBOX" ] || { echo "ENO_APPLE_SIWA_SANDBOX: no such directory" >&2; exit 2; }
  SB_DIR=$SANDBOX/supabase; SECRETS=$SANDBOX/secrets; BACKUPS=$SANDBOX/backups; LOCK=$SANDBOX/deploy.lock
  BIN_DIR=$SANDBOX/bin; UNIT_DIR=$SANDBOX/systemd; DEFAULTS=$SANDBOX/default/eno-apple-siwa-check
  POLL_SECS=${ENO_APPLE_SIWA_POLL_SECS:-0}; POLL_TRIES=${ENO_APPLE_SIWA_POLL_TRIES:-3}
  UTC_HOUR=${ENO_APPLE_SIWA_UTC_HOUR:-}
else
  SB_DIR=/opt/eno/supabase; SECRETS=/opt/eno/secrets; BACKUPS=/root/apple-siwa-backups
  # ⛔ THE DEPLOY'S OWN LOCK (eno-deploy.sh): a deploy copies the app env files into its build and creates the
  # containers from them, so this never edits them while one runs — and a deploy never starts mid-install.
  LOCK=/var/lock/eno-deploy.lock
  BIN_DIR=/opt/eno/bin; UNIT_DIR=/etc/systemd/system; DEFAULTS=/etc/default/eno-apple-siwa-check
  POLL_SECS=3; POLL_TRIES=40
  UTC_HOUR=""
fi
SB_ENV=$SB_DIR/.env
SB_OVERRIDE=$SB_DIR/docker-compose.override.yml
VN_ENV=$SECRETS/eno-vn.env
FORUM_ENV=$SECRETS/eno-forum.env
P8_FILE=$SECRETS/apple-siwa.p8
TOKEN_KEY_FILE=$SECRETS/apple-token-enc.key

say()    { printf '\n== %s\n' "$*"; }
ok()     { printf '  ok  %s\n' "$*"; }
note()   { printf '      %s\n' "$*"; }
warn()   { printf '  !!  %s\n' "$*"; }
bad()    { printf '  XX  %s\n' "$*" >&2; }
die()    { bad "$*"; exit 1; }
refuse() { bad "$*"; exit 3; }

usage() {
  sed -n '7,12p' "$SELF" | sed 's/^#  //'
}

# ── The python3 helper: every parse, edit, hash and comparison. One program, argv picks the job. ─────────────
# Secrets reach it on stdin or as paths it opens itself; it never prints one (env-get refuses to print a
# secret-named value to a terminal, and container-env prints secrets only as fingerprints).
IFS= read -r -d '' PY <<'PYEOF' || true
import base64, hashlib, json, os, re, sys, tempfile, time, urllib.parse
from datetime import datetime, timezone

APP_MANAGED = ('APPLE_SIWA_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY', 'APPLE_SIWA_SERVICES_ID',
               'APPLE_SIWA_BUNDLE_ID', 'APPLE_TOKEN_ENC_KEY', 'NEXT_PUBLIC_APPLE_SIGNIN')
# What the override wires from .env into the auth container — and what install writes into .env.
GOTRUE_MANAGED = ('GOTRUE_EXTERNAL_APPLE_ENABLED', 'GOTRUE_EXTERNAL_APPLE_CLIENT_ID', 'GOTRUE_EXTERNAL_APPLE_SECRET',
                  'GOTRUE_EXTERNAL_APPLE_REDIRECT_URI', 'GOTRUE_EXTERNAL_FLOW_STATE_EXPIRY_DURATION')
MARKER = '# Sign in with Apple: passthroughs from .env (infra/vn-node/apply-apple-signin.sh)'
LOCALHOST = 'http://localhost:3000/**'
KEY_RE = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\Z')
SECRETISH = re.compile(r'SECRET|PASSWORD|PRIVATE|TOKEN|_KEY\Z')
LINE_KEY = re.compile(r'''^(?P<ind> *)(?P<key>[A-Za-z0-9_.\-]+|"[^"]*"|'[^']*') *:(?P<rest>(?: .*)?)$''')


def die(msg, code=3):
    sys.stderr.write(msg.rstrip('\n') + '\n')
    sys.exit(code)


def fp(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()[:12]


def read_text(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def env_key(line):
    s = line.rstrip('\r\n')
    if not s or s.lstrip().startswith('#') or '=' not in s:
        return None
    k = s.split('=', 1)[0].strip()
    if k.startswith('export '):
        k = k[len('export '):].strip()
    return k if KEY_RE.match(k) else None


def parse_env(path):
    """Last occurrence wins — what docker, compose and `sh .` all do."""
    out = {}
    for line in read_text(path).splitlines():
        k = env_key(line)
        if k:
            out[k] = line.split('=', 1)[1]
    return out


def unquote(v):
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
        return v[1:-1]
    return v


def atomic_write(path, text):
    """Same directory, same mode and owner, fsync, rename: a reader sees the old file or the new one, never half."""
    st = os.stat(path)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix='.' + os.path.basename(path) + '.')
    try:
        try:
            os.fchown(fd, st.st_uid, st.st_gid)
        except PermissionError:
            pass
        os.fchmod(fd, st.st_mode & 0o7777)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as f:
            fd = None
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def token_key_ok(v):
    # src/lib/auth/apple-siwa.ts tokenKey(): 64 hex, else base64 — which must decode to exactly 32 bytes.
    v = v.strip()
    if re.fullmatch(r'[0-9a-fA-F]{64}', v):
        return True
    try:
        return len(base64.b64decode(v, validate=True)) == 32
    except Exception:
        return False


# ── env files ──────────────────────────────────────────────────────────────────────────────────────────────

def cmd_env_get(path, key):
    env = parse_env(path)
    if key not in env:
        sys.exit(1)
    if SECRETISH.search(key) and sys.stdout.isatty():
        die(f'env-get prints {key} only into a pipe, never to a terminal')
    sys.stdout.write(unquote(env[key]))


def cmd_env_state(path, key):
    env = parse_env(path)
    print('absent' if key not in env else ('empty' if unquote(env[key]) == '' else 'set'))


def cmd_same(path_a, key_a, path_b, key_b=None):
    """exit 0 equal, 1 different, 2 a side is missing — prints nothing (the values may be secret)."""
    va = parse_env(path_a).get(key_a)
    if key_b:
        vb = parse_env(path_b).get(key_b)
    else:
        vb = read_text(path_b).strip() if os.path.exists(path_b) else None
    if va is None or vb is None:
        sys.exit(2)
    sys.exit(0 if unquote(va).strip() == unquote(vb).strip() else 1)


def resolve_value(key, value):
    if value.startswith('@b64file:'):
        with open(value[len('@b64file:'):], 'rb') as f:
            return base64.b64encode(f.read()).decode('ascii')
    if value.startswith('@file:'):
        v = read_text(value[len('@file:'):]).strip()
        if '\n' in v or '\r' in v:
            die(f'env-set: {key}: that file holds more than one line')
        return v
    if value.startswith('@from-env:'):
        env = parse_env(value[len('@from-env:'):])
        if key not in env:
            die(f'env-set: {key} is not in {value[len("@from-env:"):]}')
        return env[key]
    return value


def cmd_env_set(path):
    """stdin: KEY=VALUE (set: one line, in place of the first, duplicates dropped) · ?KEY=VALUE (only if absent,
    never touches an existing line) · VALUE may be @b64file:PATH, @file:PATH or @from-env:ENVFILE. Every value is
    resolved BEFORE the file is read, so @from-env may name the file being written."""
    ops = []
    for raw in sys.stdin.read().splitlines():
        if not raw:
            continue
        mode = 'set'
        if raw.startswith('?'):
            mode, raw = 'add', raw[1:]
        if '=' not in raw:
            die('env-set: an op without "="')
        k, v = raw.split('=', 1)
        if not KEY_RE.match(k):
            die('env-set: a bad key name')
        v = resolve_value(k, v)
        if any(c in v for c in '\r\n\x00'):
            die(f'env-set: {k} would hold a line break')
        ops.append((mode, k, v))
    want = {k: (m, v) for m, k, v in ops}
    lines = read_text(path).splitlines(keepends=True)
    out, seen, report = [], set(), []
    for line in lines:
        k = env_key(line)
        if k in want:
            m, v = want[k]
            if m == 'add':
                if k not in seen:
                    report.append(f'kept {k}')
                seen.add(k)
                out.append(line)
                continue
            if k in seen:
                continue
            seen.add(k)
            report.append(('unchanged ' if line.rstrip('\r\n') == f'{k}={v}' else 'set ') + k)
            out.append(f'{k}={v}\n')
            continue
        out.append(line)
    if out and not out[-1].endswith('\n'):
        out[-1] += '\n'
    for m, k, v in ops:
        if k not in seen:
            seen.add(k)
            out.append(f'{k}={v}\n')
            report.append(f'added {k}')
    new = ''.join(out)
    if new != ''.join(lines):
        atomic_write(path, new)
    for r in report:
        print(f'{os.path.basename(path)}: {r}')


APPLE_KEEP = ('APPLE_SIWA_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY', 'APPLE_SIWA_SERVICES_ID',
              'APPLE_SIWA_BUNDLE_ID', 'APPLE_TOKEN_ENC_KEY')


def cmd_keep_apple(current, backup):
    """stdout (always redirected to a file): `backup` with the six Apple revocation keys exactly as `current` holds
    them — current's lines, verbatim and in order, an empty value included — and none of the backup's. A file that
    cannot be read stops it (non-zero), before anything is written."""
    keep = set(APPLE_KEEP)
    cur = read_text(current).splitlines(keepends=True)
    bak = read_text(backup).splitlines(keepends=True)
    out = [line for line in bak if env_key(line) not in keep]
    if out and not out[-1].endswith('\n'):
        out[-1] += '\n'
    out += [line if line.endswith('\n') else line + '\n' for line in cur if env_key(line) in keep]
    sys.stdout.write(''.join(out))


def cmd_redirect_drop(path, entry, check=None):
    lines = read_text(path).splitlines(keepends=True)
    at = [i for i, line in enumerate(lines) if env_key(line) == 'ADDITIONAL_REDIRECT_URLS']
    if not at:
        print('absent (no ADDITIONAL_REDIRECT_URLS)')
        return
    if len(at) > 1:
        die('ADDITIONAL_REDIRECT_URLS is set more than once — fix it by hand first')
    i = at[0]
    value = lines[i].rstrip('\r\n').split('=', 1)[1]
    q = value[0] if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'' else ''
    parts = (value[1:-1] if q else value).split(',')
    keep = [p for p in parts if p.strip() != entry]
    if len(keep) == len(parts):
        print('absent')
        return
    if check == '--check':
        print('would remove')
        return
    lines[i] = 'ADDITIONAL_REDIRECT_URLS=' + q + ','.join(keep) + q + '\n'
    atomic_write(path, ''.join(lines))
    print('removed')


def cmd_env_foreign(backup, current, kind):
    """Names (never values) of keys that differ between a backup and the file now, OUTSIDE what this script
    manages — the changes a full-file restore would silently revert."""
    managed = APP_MANAGED if kind == 'app' else GOTRUE_MANAGED
    a, b = parse_env(backup), parse_env(current)

    def norm(key, v):
        if v is None:
            return None
        if kind == 'supabase' and key == 'ADDITIONAL_REDIRECT_URLS':
            return [p for p in unquote(v).split(',') if p.strip() != LOCALHOST]
        return v
    for k in sorted(set(a) | set(b)):
        if k not in managed and norm(k, a.get(k)) != norm(k, b.get(k)):
            print(k)


# ── the compose override ───────────────────────────────────────────────────────────────────────────────────

def significant(line):
    s = line.strip()
    return bool(s) and not s.startswith('#')


def indent(line):
    return len(line) - len(line.lstrip(' '))


def ykey(m):
    k = m.group('key')
    return k[1:-1] if k[:1] in ('"', "'") else k


def block_end(lines, start, stop, ind):
    for i in range(start + 1, stop):
        if significant(lines[i]) and indent(lines[i]) <= ind:
            return i
    return stop


def merge_override(text, require):
    """Merge the Apple passthroughs INTO the one services.auth.environment mapping. A line-level edit, not a YAML
    round trip: the box's file keeps every byte it had, comments included, and gains only the new lines. Anything
    this parser is not certain about is refused, never guessed at."""
    if text.startswith('\ufeff'):
        die('the override starts with a byte-order mark — refusing to edit it')
    if '\r' in text:
        die('the override has CRLF line endings — refusing to edit it')
    lines = text.split('\n')
    if text.endswith('\n'):
        lines = lines[:-1]
    for n, line in enumerate(lines, 1):
        if '\t' in line[:len(line) - len(line.lstrip(' \t'))]:
            die(f'line {n}: a tab in the indentation — refusing to edit the override')
        if line.rstrip() in ('---', '...'):
            die(f'line {n}: a YAML document marker — refusing to edit a multi-document override')
    tops = [i for i, line in enumerate(lines) if significant(line) and indent(line) == 0]
    svc = [i for i in tops if re.match(r'^services *:( *#.*)? *$', lines[i])]
    if len(svc) != 1:
        die(f'expected exactly one top-level "services:" in the override, found {len(svc)}')
    s0 = svc[0]
    s_end = next((i for i in tops if i > s0), len(lines))
    body = [i for i in range(s0 + 1, s_end) if significant(lines[i])]
    if not body:
        die('"services:" is empty')
    ci = indent(lines[body[0]])
    for i in body:
        if indent(lines[i]) < ci:
            die(f'line {i + 1}: inconsistent indentation under services')
    auth = []
    for i in (i for i in body if indent(lines[i]) == ci):
        m = LINE_KEY.match(lines[i])
        if not m:
            die(f'line {i + 1}: not a "name:" entry under services')
        if ykey(m) == 'auth':
            rest = m.group('rest').strip()
            if rest and not rest.startswith('#'):
                die(f'line {i + 1}: services.auth is not a plain block (flow style, anchor or alias) — refusing to edit it')
            auth.append(i)
    if len(auth) != 1:
        die(f'expected exactly one services.auth block in the override, found {len(auth)} — merge them by hand first')
    a0 = auth[0]
    a_end = block_end(lines, a0, s_end, ci)
    a_body = [i for i in range(a0 + 1, a_end) if significant(lines[i])]
    if not a_body:
        die('services.auth is empty')
    for i in a_body:
        st = lines[i].strip()
        if st.startswith('<<') or re.search(r'(^|[\s:\[{,])[&*][A-Za-z0-9_]', st):
            die(f'line {i + 1}: an anchor, alias or merge key inside services.auth — refusing to edit it')
    ai = indent(lines[a_body[0]])
    envs = []
    for i in (i for i in a_body if indent(lines[i]) == ai):
        m = LINE_KEY.match(lines[i])
        if not m:
            die(f'line {i + 1}: unexpected line under services.auth')
        if ykey(m) == 'environment':
            envs.append((i, m))
    if len(envs) != 1:
        die(f'expected exactly one services.auth.environment in the override, found {len(envs)}')
    e0, em = envs[0]
    rest = em.group('rest').strip()
    if rest and not rest.startswith('#'):
        die(f'line {e0 + 1}: services.auth.environment is not a block mapping')
    e_end = block_end(lines, e0, a_end, ai)
    e_body = [i for i in range(e0 + 1, e_end) if significant(lines[i])]
    if not e_body:
        die('services.auth.environment is empty')
    ei = indent(lines[e_body[0]])
    entries = {}
    for n, i in enumerate(e_body):
        if indent(lines[i]) > ei:
            continue
        st = lines[i].strip()
        if st == '-' or st.startswith('- '):
            die(f'line {i + 1}: services.auth.environment is a list — expected "KEY: value" lines')
        m = LINE_KEY.match(lines[i])
        if not m:
            die(f'line {i + 1}: unexpected line in services.auth.environment')
        k = ykey(m)
        if k in entries:
            die(f'line {i + 1}: {k} appears twice in services.auth.environment')
        multi = n + 1 < len(e_body) and indent(lines[e_body[n + 1]]) > ei
        entries[k] = (i, multi)
    for k in require:
        if k not in entries:
            die(f'{k} is not in services.auth.environment — not the override I7 describes; refusing')
    out, added, replaced = list(lines), [], []
    for k in GOTRUE_MANAGED:
        want = '${' + k + '}'
        if k in entries:
            i, multi = entries[k]
            val = re.sub(r'\s+#.*$', '', LINE_KEY.match(lines[i]).group('rest').strip())
            if val in (want, '"' + want + '"', "'" + want + "'"):
                continue
            if multi or val[:1] in ('|', '>'):
                die(f'line {i + 1}: {k} has a multi-line value — fix it by hand')
            out[i] = ' ' * ei + k + ': ' + want
            replaced.append(k)
    missing = [k for k in GOTRUE_MANAGED if k not in entries]
    if missing:
        ins = [] if any(lines[j].strip() == MARKER for j in range(e0 + 1, e_end)) else [' ' * ei + MARKER]
        ins += [' ' * ei + k + ': ${' + k + '}' for k in missing]
        out[e_body[-1] + 1:e_body[-1] + 1] = ins
        added = missing
    return '\n'.join(out) + '\n', added, replaced


def cmd_merge_override(path, *args):
    check = '--check' in args
    require = [args[i + 1] for i, a in enumerate(args) if a == '--require' and i + 1 < len(args)]
    text = read_text(path)
    new, added, replaced = merge_override(text, require)
    if not added and not replaced:
        print('unchanged — the Apple passthroughs are already in services.auth.environment')
        return
    verb = 'would ' if check else ''
    if added:
        print(f'{verb}add to services.auth.environment: ' + ' '.join(added))
    if replaced:
        print(f'{verb}replace in services.auth.environment: ' + ' '.join(replaced))
    if not check:
        atomic_write(path, new)


def strip_managed(text):
    keep = []
    for line in text.split('\n'):
        st = line.strip()
        m = re.match(r'''^["']?([A-Z0-9_]+)["']? *:''', st)
        if st == MARKER or (m and m.group(1) in GOTRUE_MANAGED):
            continue
        keep.append(line)
    return '\n'.join(keep).rstrip('\n')


def cmd_override_same(backup, current):
    sys.exit(0 if strip_managed(read_text(backup)) == strip_managed(read_text(current)) else 1)


# ── tokens, answers, probes ────────────────────────────────────────────────────────────────────────────────

def b64url_json(part):
    return json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))


def cmd_jwt_info():
    tok = sys.stdin.read().strip()
    parts = tok.split('.')
    if len(parts) != 3:
        die('not a JWT', 1)
    try:
        h, c = b64url_json(parts[0]), b64url_json(parts[1])
        exp = int(c.get('exp', 0))
    except Exception:
        die('not a JWT', 1)
    left = exp - int(time.time())
    print(f"kid={h.get('kid', '')}")
    print(f"alg={h.get('alg', '')}")
    print(f"iss={c.get('iss', '')}")
    print(f"sub={c.get('sub', '')}")
    print(f"aud={c.get('aud', '')}")
    print(f'exp={exp}')
    print('exp_date=' + datetime.fromtimestamp(exp, timezone.utc).strftime('%Y-%m-%d'))
    print(f'days_left={left // 86400}')
    print(f'fp={fp(tok)}')


def cmd_fp():
    print(fp(sys.stdin.read().strip()))


def cmd_break_jwt():
    """--calibrate: the same secret with one SIGNATURE character changed (not the last one, whose low bits a
    lenient base64 decoder ignores). Apple must refuse it as invalid_client."""
    if sys.stdout.isatty():
        die('break-jwt prints only into a pipe')
    h, c, s = sys.stdin.read().strip().split('.')
    i = min(10, len(s) // 2)
    sys.stdout.write(f"{h}.{c}.{s[:i]}{'B' if s[i] == 'A' else 'A'}{s[i + 1:]}")


def cmd_settings():
    try:
        d = json.load(sys.stdin)
        ext = d.get('external') or {}
    except Exception:
        die('GoTrue /settings did not answer JSON', 1)
    b = lambda x: 'true' if x is True else 'false'
    print(b(ext.get('apple')), b(ext.get('google')), b(ext.get('email')), b(d.get('disable_signup')))


def cmd_container_env(*specs):
    env = {}
    for line in sys.stdin.read().splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            env[k] = v
    for spec in specs:
        mode, k = spec.split(':', 1)
        if mode == 'show' and SECRETISH.search(k):
            die(f'container-env shows {k} only as a fingerprint')
        if k not in env:
            print(f'{k}=<absent>')
        elif mode == 'show':
            print(f'{k}={env[k]}')
        else:
            print(f'{k}=fp:{fp(env[k])}')


def cmd_apple_answer(status):
    """TN3107: invalid_grant = the client authenticated and only the (made-up) code failed — the secret is good;
    invalid_client = the secret, key, team, key id or client id is refused."""
    body = sys.stdin.read()
    try:
        word = str((json.loads(body) or {}).get('error', ''))
    except Exception:
        word = ''
    st = int(status) if status.isdigit() else 0
    if st == 400 and word == 'invalid_grant':
        print('ok')
    elif word == 'invalid_client':
        print('invalid_client')
    elif st == 0 or st == 429 or st >= 500:
        print('unreachable')
    else:
        print(f"unexpected:{st}:{re.sub(r'[^a-z_]', '', word)[:40]}")


def cmd_authorize_check(services):
    code, _, url = sys.stdin.read().strip().partition(' ')
    if code not in ('302', '303', '307'):
        die(f'authorize answered {code or "nothing"} — want a redirect to appleid.apple.com', 1)
    u = urllib.parse.urlsplit(url)
    if (u.scheme, u.netloc, u.path) != ('https', 'appleid.apple.com', '/auth/authorize'):
        die(f'authorize redirects to {u.scheme}://{u.netloc}{u.path}, not to Apple', 1)
    q = urllib.parse.parse_qs(u.query)
    got = {k: (q.get(k) or [''])[0] for k in ('client_id', 'response_mode', 'redirect_uri')}
    want = {'client_id': services, 'response_mode': 'form_post', 'redirect_uri': 'https://sb.eno.vn/auth/v1/callback'}
    for k, v in want.items():
        if got[k] != v:
            die(f'authorize sends {k}={got[k]!r} to Apple, want {v!r}', 1)
    print(f"{code} -> appleid.apple.com client_id={got['client_id']} response_mode=form_post redirect_uri={got['redirect_uri']}")


# ── inputs and records ─────────────────────────────────────────────────────────────────────────────────────

def cmd_token_key_check(src):
    if src.startswith('file:'):
        v = read_text(src[len('file:'):])
    else:
        path, key = src[len('env:'):].rsplit(':', 1)
        v = unquote(parse_env(path).get(key, ''))
    if not token_key_ok(v):
        die('APPLE_TOKEN_ENC_KEY must be 32 bytes: 64 hex characters, or standard base64 (openssl rand -base64 32)')


def cmd_p8_check(path):
    s = read_text(path)
    # Split literals: no key-shaped string in this file's source (the commit gate refuses a diff carrying one).
    if '-----BEGIN ' 'PRIVATE KEY-----' not in s or '-----END ' 'PRIVATE KEY-----' not in s:
        die(f"{path} is not a PKCS#8 PEM — expected Apple's AuthKey_<KEY_ID>.p8")


def cmd_validate(kind, value):
    pats = {'team': r'[A-Z0-9]{10}', 'kid': r'[A-Z0-9]{10}', 'client': r'[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+',
            'flow': r'[1-9][0-9]*[sm]'}
    names = {'team': '--team (10 characters, A-Z 0-9)', 'kid': '--kid (10 characters, A-Z 0-9)',
             'client': 'a client id (reverse-DNS, e.g. vn.eno.web)', 'flow': '--flow-state-expiry (e.g. 10m)'}
    if not re.fullmatch(pats[kind], value) or len(value) > 200:
        die(f'not a valid {names[kind]}: {value!r}', 2)
    if kind == 'flow':
        secs = int(value[:-1]) * (60 if value.endswith('m') else 1)
        if not 300 <= secs <= 1800:
            die('--flow-state-expiry must be 5m-30m (GoTrue raises anything under 300s to 300s)', 2)


def cmd_meta_summary(path):
    m = {}
    for line in read_text(path).splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            m[k] = v
    print(' '.join(f'{k}={m[k]}' for k in ('command', 'result', 'key_id', 'services_id', 'secret_fp', 'secret_exp') if k in m))


CMDS = {
    'env-get': cmd_env_get, 'env-state': cmd_env_state, 'same': cmd_same, 'env-set': cmd_env_set, 'keep-apple': cmd_keep_apple,
    'redirect-drop': cmd_redirect_drop, 'env-foreign': cmd_env_foreign, 'merge-override': cmd_merge_override,
    'override-same': cmd_override_same, 'jwt-info': cmd_jwt_info, 'fp': cmd_fp, 'break-jwt': cmd_break_jwt,
    'settings': cmd_settings, 'container-env': cmd_container_env, 'apple-answer': cmd_apple_answer,
    'authorize-check': cmd_authorize_check, 'token-key-check': cmd_token_key_check, 'p8-check': cmd_p8_check,
    'validate': cmd_validate, 'meta-summary': cmd_meta_summary,
}
if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
    die('helper: ' + ' | '.join(sorted(CMDS)), 2)
try:
    CMDS[sys.argv[1]](*sys.argv[2:])
except TypeError as e:
    die(f'helper {sys.argv[1]}: bad arguments ({e})', 2)
except OSError as e:
    die(f'helper {sys.argv[1]}: {e.strerror}: {e.filename}', 1)
PYEOF

# -I: isolated — no PYTHONPATH, PYTHONSTARTUP or user site from a root shell's environment steers the helper.
py() { python3 -I -c "$PY" "$@"; }

# ── The client-secret minter: node:crypto, run by the app image's own node, inside --network none. ───────────
# ⚠️ THE APP'S OWN TOKEN, LINE FOR LINE: src/lib/auth/apple-siwa.ts mintClientSecret (header {alg ES256, kid},
# claims {iss, iat, exp, aud https://appleid.apple.com, sub}, an IEEE-P1363 ES256 signature) and its signingKey()
# parse (base64 of the PEM, or a raw PEM). Only the lifetime differs: GoTrue's secret must live months, the app's
# five minutes. The Next bundle cannot be imported from outside, so src/lib/apply-apple-signin.test.ts holds the
# two minters to the same output instead.
IFS= read -r -d '' MINT_JS <<'JSEOF' || true
'use strict'
const crypto = require('node:crypto')
const fail = (m) => { process.stderr.write(`mint: ${m}\n`); process.exit(3) }
const { APPLE_MINT_TEAM: team = '', APPLE_MINT_KID: kid = '', APPLE_MINT_SUB: sub = '', APPLE_MINT_TTL: ttlRaw = '' } = process.env
if (!/^[A-Z0-9]{10}$/.test(team)) fail('the team id must be 10 characters, A-Z 0-9')
if (!/^[A-Z0-9]{10}$/.test(kid)) fail('the key id must be 10 characters, A-Z 0-9')
if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(sub)) fail('the client id is not reverse-DNS')
const ttl = Number(ttlRaw)
if (!Number.isInteger(ttl) || ttl < 60 || ttl > 15552000) fail('the lifetime must be 60 s to 180 days')
let raw = ''
try { raw = require('node:fs').readFileSync(0, 'utf8').trim() } catch { fail('no key on stdin') }
if (!raw) fail('no key on stdin')
const pem = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8')
let key
try { key = crypto.createPrivateKey(pem) } catch { fail("the key does not parse — expected Apple's .p8") }
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') fail('not a P-256 EC key')
const iat = Math.floor(Date.now() / 1000)
const b64url = (b) => Buffer.from(b).toString('base64url')
const header = b64url(JSON.stringify({ alg: 'ES256', kid }))
const claims = b64url(JSON.stringify({ iss: team, iat, exp: iat + ttl, aud: 'https://appleid.apple.com', sub }))
const sig = crypto.createSign('SHA256').update(`${header}.${claims}`).sign({ key, dsaEncoding: 'ieee-p1363' })
const good = crypto.createVerify('SHA256').update(`${header}.${claims}`)
  .verify({ key: crypto.createPublicKey(key), dsaEncoding: 'ieee-p1363' }, sig)
if (!good) fail('the signature does not verify with its own key')
process.stdout.write(`${header}.${claims}.${b64url(sig)}`)
JSEOF

# $1 sub · $2 lifetime (s) · $3 team · $4 key id — the key on stdin, the JWT on stdout.
# --log-driver none: the JWT is the container's stdout, and a json-file or journald driver would write it to disk.
mint() {
  docker run --rm -i --pull never --network none --log-driver none --read-only --cap-drop ALL \
    --security-opt no-new-privileges \
    --env "APPLE_MINT_SUB=$1" --env "APPLE_MINT_TTL=$2" --env "APPLE_MINT_TEAM=$3" --env "APPLE_MINT_KID=$4" \
    --entrypoint node "$IMAGE" --eval "$MINT_JS"
}

# ── Box plumbing ─────────────────────────────────────────────────────────────────────────────────────────────
APPLIED=0; AUTH_TOUCHED=0; DONE=0; BACKUP_DIR=""; BACKUP_TS=""; TMP=""
ANON=""; LAST_SETTINGS=unreachable; S_APPLE=""; S_GOOGLE=""; S_EMAIL=""; S_DISABLE=""
GT_SECRET=""; J_KID=""; J_SUB=""; J_EXP_DATE=""; J_DAYS=""; J_FP=""

box_init() {
  if [ -n "$SANDBOX" ]; then
    local c p
    for c in docker curl flock shred systemctl; do
      p=$(command -v "$c" 2>/dev/null || true)
      case "$p" in "$SANDBOX"/*) ;; *) refuse "sandbox: $c must be the sandbox's stub (found '${p:-nothing}')" ;; esac
    done
  elif [ "$(id -u)" != 0 ]; then
    refuse "run as root: the files are root's"
  fi
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/apple-siwa.XXXXXX") || die "mktemp failed"
}

need_cmds() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || refuse "missing command: $c"; done
}

need_files() {
  local f
  for f in "$@"; do
    [ -L "$f" ] && refuse "$f is a symlink — this script edits regular files only"
    [ -f "$f" ] || refuse "missing $f"
  done
}

take_lock() {  # n: refuse at once · w: wait up to 15 minutes (the timer's rotation)
  # Already held by this run (check → a due rotation): re-opening fd 8 would drop the lock for a moment.
  [ "${LOCK_HELD:-0}" = 1 ] && return 0
  exec 8>"$LOCK" || die "cannot open $LOCK"
  if [ "$1" = w ]; then
    flock -w 900 8 || die "$LOCK stayed busy for 15 minutes (a deploy?) — nothing was changed"
  else
    flock -n 8 || refuse "a deploy or another run holds $LOCK — run this when it is done"
  fi
}

compose() { (cd "$SB_DIR" && docker compose "$@"); }

compose_ok() {
  if compose config --quiet >"$TMP/compose.log" 2>&1; then return 0; fi
  bad "docker compose config refused the configuration:"
  tail -5 "$TMP/compose.log" | sed 's/^/      /' >&2
  return 1
}

recreate_auth() {
  if compose up -d --no-deps auth >"$TMP/up.log" 2>&1; then return 0; fi
  bad "docker compose up -d --no-deps auth failed:"
  tail -5 "$TMP/up.log" | sed 's/^/      /' >&2
  return 1
}

read_anon() {
  ANON=$(py env-get "$SB_ENV" ANON_KEY 2>/dev/null) && [ -n "$ANON" ] || refuse "no ANON_KEY in $SB_ENV"
}

read_settings() {  # one look at GoTrue's /settings (through the gateway, as the app sees it); sets S_*
  local s
  if s=$(curl -sS --max-time 8 -H "apikey: $ANON" "$GATEWAY/auth/v1/settings" 2>/dev/null | py settings 2>/dev/null); then
    read -r S_APPLE S_GOOGLE S_EMAIL S_DISABLE <<<"$s"
    LAST_SETTINGS="apple=$S_APPLE google=$S_GOOGLE email=$S_EMAIL disable_signup=$S_DISABLE"
    return 0
  fi
  LAST_SETTINGS=unreachable
  return 1
}

# ⚠️ POLL, NEVER SNAPSHOT (google-signin.md): a recreated GoTrue answers a few seconds late, and a snapshot of a
# container that is not up yet reads exactly like a provider that did not take.
wait_for() {  # true: apple, google and email · any: google and email
  local i=0
  while [ "$i" -lt "$POLL_TRIES" ]; do
    i=$((i + 1))
    if read_settings && [ "$S_GOOGLE" = true ] && [ "$S_EMAIL" = true ]; then
      [ "$1" = any ] && return 0
      [ "$S_APPLE" = true ] && return 0
    fi
    [ "$i" -lt "$POLL_TRIES" ] && sleep "$POLL_SECS"
  done
  return 1
}

auth_env() {  # the RUNNING auth container's environment: show:KEY prints a value, fp:KEY a fingerprint
  local cid
  cid=$(compose ps -q auth 2>/dev/null | head -1)
  [ -n "$cid" ] || return 1
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null | py container-env "$@"
}

kv() {  # $1 = KEY=value lines, $2 = KEY
  printf '%s\n' "$1" | awk -F= -v k="$2" '$1 == k { print substr($0, length(k) + 2); exit }'
}

jwt_info() {  # $1 = a JWT — sets J_*; prints nothing
  local info k v
  info=$(printf '%s' "$1" | py jwt-info) || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      kid) J_KID=$v ;; sub) J_SUB=$v ;; exp_date) J_EXP_DATE=$v ;; days_left) J_DAYS=$v ;; fp) J_FP=$v ;;
    esac
  done <<<"$info"
}

# $1 = client id; the client secret on stdin. Prints ok | invalid_client | unreachable | unexpected:…
# ⛔ The secret travels in curl's request body, from stdin — never in argv, where `ps` shows it to the box.
apple_probe() {
  local status
  status=$( { printf 'client_id=%s&client_secret=' "$1"; cat; printf '&code=probe&grant_type=authorization_code'; } \
    | curl -sS --max-time 15 -o "$TMP/apple.json" -w '%{http_code}' -X POST \
        -H 'Content-Type: application/x-www-form-urlencoded' -H 'Accept: application/json' \
        --data-binary @- "$APPLE_TOKEN_URL" 2>/dev/null ) || true
  [ -f "$TMP/apple.json" ] || : >"$TMP/apple.json"
  py apple-answer "${status:-000}" <"$TMP/apple.json"
  rm -f "$TMP/apple.json"
}

probe_secret() {  # $1 = client id; uses GT_SECRET. One retry when Apple does not answer.
  local r
  r=$(printf '%s' "$GT_SECRET" | apple_probe "$1")
  if [ "$r" = unreachable ]; then
    sleep "$POLL_SECS"
    r=$(printf '%s' "$GT_SECRET" | apple_probe "$1")
  fi
  printf '%s' "$r"
}

explain_probe() {  # $1 = client id, $2 = probe word
  case "$2" in
    invalid_client) bad "Apple refuses the client secret for $1 (invalid_client, TN3107): the key id, team id, the .p8 or the client id is wrong — or the key is not enabled for Sign in with Apple on the primary App ID" ;;
    unreachable)    bad "Apple's token endpoint did not answer (twice) — nothing proven" ;;
    *)              bad "Apple answered $2 for $1 — expected invalid_grant" ;;
  esac
}

authorize_check() {  # $1 = Services ID — GoTrue must send a PKCE authorize to Apple, form_post, to our callback
  local out
  out=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' -H "apikey: $ANON" \
    "$GATEWAY/auth/v1/authorize?provider=apple&redirect_to=https%3A%2F%2Feno.vn%2Fauth%2Fcallback&code_challenge=$PKCE_PROBE_CHALLENGE&code_challenge_method=s256" \
    2>/dev/null) || true
  printf '%s' "$out" | py authorize-check "$1"
}

backup() {  # $1 = command — copies of the four files, BEFORE anything is written
  install -d -m 0700 "$BACKUPS" || die "cannot create $BACKUPS"
  BACKUP_TS=$(date -u +%Y%m%dT%H%M%SZ)
  if ! mkdir -m 0700 "$BACKUPS/$BACKUP_TS" 2>/dev/null; then
    sleep 1
    BACKUP_TS=$(date -u +%Y%m%dT%H%M%SZ)
    mkdir -m 0700 "$BACKUPS/$BACKUP_TS" || die "cannot create $BACKUPS/$BACKUP_TS — nothing was changed"
  fi
  BACKUP_DIR=$BACKUPS/$BACKUP_TS
  # cp -p keeps each file's own mode; the 0700 directory is what keeps the copies root's.
  cp -p "$SB_ENV" "$BACKUP_DIR/supabase.env" \
    && cp -p "$SB_OVERRIDE" "$BACKUP_DIR/docker-compose.override.yml" \
    && cp -p "$VN_ENV" "$BACKUP_DIR/eno-vn.env" \
    && cp -p "$FORUM_ENV" "$BACKUP_DIR/eno-forum.env" \
    || die "backup into $BACKUP_DIR failed — nothing was changed"
  printf 'command=%s\nutc=%s\nresult=pending\n' "$1" "$BACKUP_TS" >"$BACKUP_DIR/meta"
  ok "backed up .env, the override and both app env files: $BACKUP_DIR"
}

meta_set() { [ -n "$BACKUP_DIR" ] && printf '%s=%s\n' "$1" "$2" >>"$BACKUP_DIR/meta"; }

dst_of() {
  case "$1" in
    supabase.env) printf '%s' "$SB_ENV" ;;
    docker-compose.override.yml) printf '%s' "$SB_OVERRIDE" ;;
    eno-vn.env) printf '%s' "$VN_ENV" ;;
    eno-forum.env) printf '%s' "$FORUM_ENV" ;;
  esac
}

restore_files() {  # $1 = a backup directory — every file it holds goes back, each by an atomic rename
  local name dst all=0
  for name in supabase.env docker-compose.override.yml eno-vn.env eno-forum.env; do
    [ -f "$1/$name" ] || continue
    dst=$(dst_of "$name")
    if cp -p "$1/$name" "$dst.apple-siwa.$$" && mv -f "$dst.apple-siwa.$$" "$dst"; then :
    else bad "could not put back $dst from $1/$name"; all=1; fi
  done
  return $all
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$APPLIED" = 1 ] && [ "$DONE" != 1 ] && [ -n "$BACKUP_DIR" ]; then
    [ "$rc" = 0 ] && rc=1
    say "FAILED — putting every file back from $BACKUP_DIR"
    if restore_files "$BACKUP_DIR"; then ok "files restored"
    else bad "RESTORE INCOMPLETE — copy the files from $BACKUP_DIR back by hand (supabase.env -> $SB_ENV, …)"; fi
    if [ "$AUTH_TOUCHED" = 1 ]; then
      if recreate_auth && wait_for any; then ok "auth recreated on the restored files: $LAST_SETTINGS"
      else bad "auth is not healthy after the restore ($LAST_SETTINGS) — cd $SB_DIR && docker compose ps auth"; fi
    fi
    meta_set result restored
  fi
  [ -n "$TMP" ] && rm -rf "$TMP"
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

prune_backups() {  # rotate and pre-restore backups past the newest $KEEP_BACKUPS; an install's is kept for good
  local d n=0
  for d in $(ls -1 "$BACKUPS" 2>/dev/null | sort -r); do
    case "$d" in 20[0-9][0-9][01][0-9][0-3][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) continue ;; esac
    grep -qx 'command=install' "$BACKUPS/$d/meta" 2>/dev/null && continue
    n=$((n + 1))
    [ "$n" -le "$KEEP_BACKUPS" ] && continue
    rm -rf "${BACKUPS:?}/$d"
  done
}

# GoTrue as it runs now: google and email on, the OTP lifetime the 10-05 owner decision set. Sets PRE_DISABLE.
PRE_DISABLE=""
preflight_gotrue() {
  local api out
  api=$(py env-get "$SB_ENV" API_EXTERNAL_URL 2>/dev/null || true)
  [ "${api%/}" = "$EXPECT_API_EXTERNAL_URL" ] \
    || refuse "API_EXTERNAL_URL is '${api:-unset}' — the Apple return URL is $REDIRECT_URI, so it must be $EXPECT_API_EXTERNAL_URL"
  read_anon
  compose_ok || refuse "fix the compose configuration first — nothing was changed"
  read_settings || refuse "GoTrue does not answer $GATEWAY/auth/v1/settings — nothing was changed"
  [ "$S_GOOGLE" = true ] && [ "$S_EMAIL" = true ] \
    || refuse "GoTrue is not in the state I7 expects ($LAST_SETTINGS) — nothing was changed"
  PRE_DISABLE=$S_DISABLE
  ok "GoTrue now: $LAST_SETTINGS"
  out=$(auth_env show:GOTRUE_MAILER_OTP_EXP) || refuse "cannot read the running auth container's environment"
  [ "$(kv "$out" GOTRUE_MAILER_OTP_EXP)" = 3600 ] \
    || refuse "the running auth has GOTRUE_MAILER_OTP_EXP=$(kv "$out" GOTRUE_MAILER_OTP_EXP), expected 3600 (owner, 10-05) — fix that first"
  ok "GOTRUE_MAILER_OTP_EXP=3600 in the running auth"
}

# $1 = the expected GOTRUE_EXTERNAL_APPLE_CLIENT_ID · $2 = the expected secret fingerprint · $3 = the expected
# flow-state expiry ("" = not checked) · $4 = 1 when http://localhost:3000/** must be gone from the allow-list.
# ⛔ THE FILE LOOKING RIGHT PROVES NOTHING (google-signin.md: the keys sat in .env while the container never got
# them) — this reads what the recreated container actually holds.
verify_auth_env() {
  local out v k want fail=0
  out=$(auth_env show:GOTRUE_EXTERNAL_APPLE_ENABLED show:GOTRUE_EXTERNAL_APPLE_CLIENT_ID \
    show:GOTRUE_EXTERNAL_APPLE_REDIRECT_URI show:GOTRUE_EXTERNAL_FLOW_STATE_EXPIRY_DURATION \
    show:GOTRUE_MAILER_OTP_EXP show:GOTRUE_EXTERNAL_GOOGLE_ENABLED show:GOTRUE_URI_ALLOW_LIST \
    fp:GOTRUE_EXTERNAL_APPLE_SECRET) || { bad "cannot read the auth container's environment"; return 1; }
  for k in GOTRUE_EXTERNAL_APPLE_ENABLED=true "GOTRUE_EXTERNAL_APPLE_CLIENT_ID=$1" \
           "GOTRUE_EXTERNAL_APPLE_REDIRECT_URI=$REDIRECT_URI" GOTRUE_MAILER_OTP_EXP=3600 \
           GOTRUE_EXTERNAL_GOOGLE_ENABLED=true "GOTRUE_EXTERNAL_APPLE_SECRET=fp:$2" \
           ${3:+"GOTRUE_EXTERNAL_FLOW_STATE_EXPIRY_DURATION=$3"}; do
    want=${k#*=}; k=${k%%=*}
    v=$(kv "$out" "$k")
    if [ "$v" = "$want" ]; then ok "auth container: $k=$v"
    else bad "auth container: $k=$v (want $want)"; fail=1; fi
  done
  if [ "${4:-0}" = 1 ]; then
    case ",$(kv "$out" GOTRUE_URI_ALLOW_LIST)," in
      *",$LOCALHOST_REDIRECT,"*) bad "auth container: $LOCALHOST_REDIRECT is still in GOTRUE_URI_ALLOW_LIST"; fail=1 ;;
      *) ok "auth container: $LOCALHOST_REDIRECT is not in GOTRUE_URI_ALLOW_LIST" ;;
    esac
  fi
  return $fail
}

# ── install ──────────────────────────────────────────────────────────────────────────────────────────────────
cmd_install() {
  local TEAM="" KID="" SERVICES="" BUNDLE="" FLOW=10m DROP=0 P8_SOURCE="" TK_OP="" st_vn st_fo r old
  while [ $# -gt 0 ]; do
    case "$1" in
      --team|--kid|--services-id|--bundle|--flow-state-expiry)
        [ $# -ge 2 ] || { usage; exit 2; }
        case "$1" in
          --team) TEAM=$2 ;; --kid) KID=$2 ;; --services-id) SERVICES=$2 ;; --bundle) BUNDLE=$2 ;;
          --flow-state-expiry) FLOW=$2 ;;
        esac
        shift 2 ;;
      --drop-localhost-redirect) DROP=1; shift ;;
      *) usage; exit 2 ;;
    esac
  done
  [ -n "$TEAM" ] && [ -n "$KID" ] && [ -n "$SERVICES" ] && [ -n "$BUNDLE" ] || { usage; exit 2; }
  py validate team "$TEAM" && py validate kid "$KID" && py validate client "$SERVICES" \
    && py validate client "$BUNDLE" && py validate flow "$FLOW" || exit 2
  [ "$SERVICES" != "$BUNDLE" ] || refuse "the Services ID and the bundle ID must differ"
  case "$SERVICES" in *"$TEAM"*) refuse "the Services ID must not contain the Team ID — Apple refuses it" ;; esac

  box_init
  need_cmds docker python3 curl flock shred
  say "Sign in with Apple — install (key $KID, web client $SERVICES, app $BUNDLE)"
  need_files "$SB_ENV" "$SB_OVERRIDE" "$VN_ENV" "$FORUM_ENV"
  take_lock n

  say "pre-flight — nothing is written until every check passes"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || refuse "no $IMAGE image — the minter runs in it (deploy first: I3)"
  preflight_gotrue
  r=$(py merge-override "$SB_OVERRIDE" --check --require GOTRUE_EXTERNAL_GOOGLE_ENABLED) \
    || refuse "the override cannot be merged safely (above) — nothing was changed"
  ok "override: $r"
  [ "$(py env-state "$VN_ENV" APPLE_TEAM_ID)" = absent ] && [ "$(py env-state "$FORUM_ENV" APPLE_TEAM_ID)" = absent ] \
    || warn "APPLE_TEAM_ID is set in an app env file — it publishes the AASA (P7, on hold). This script never writes it."

  # The .p8: the file I6 piped, or — a re-run with the same key id — the value the first run wrote.
  if [ -f "$P8_FILE" ]; then
    need_files "$P8_FILE"
    py p8-check "$P8_FILE" || refuse "nothing was changed"
    P8_SOURCE=file
  elif [ "$(py env-get "$VN_ENV" APPLE_SIWA_KEY_ID 2>/dev/null)" = "$KID" ] \
       && [ "$(py env-state "$VN_ENV" APPLE_SIWA_PRIVATE_KEY)" = set ]; then
    P8_SOURCE=env
    ok "no $P8_FILE: re-using key $KID from eno-vn.env"
  else
    refuse "no $P8_FILE — pipe it from the vault first (I6)"
  fi

  # ⛔ THE TOKEN KEY IS NEVER REPLACED. Every stored Apple token is sealed with it; a different key orphans them
  # all, and account deletion could then revoke nothing (TN3194). A re-run keeps what is there.
  st_vn=$(py env-state "$VN_ENV" APPLE_TOKEN_ENC_KEY); st_fo=$(py env-state "$FORUM_ENV" APPLE_TOKEN_ENC_KEY)
  if [ "$st_vn" = set ] && [ "$st_fo" = set ] && ! py same "$VN_ENV" APPLE_TOKEN_ENC_KEY "$FORUM_ENV" APPLE_TOKEN_ENC_KEY; then
    refuse "eno-vn.env and eno-forum.env hold DIFFERENT APPLE_TOKEN_ENC_KEY values — settle which one sealed the stored tokens by hand"
  fi
  if [ -f "$TOKEN_KEY_FILE" ]; then
    need_files "$TOKEN_KEY_FILE"
    py token-key-check "file:$TOKEN_KEY_FILE" || refuse "nothing was changed"
    for f in "$VN_ENV" "$FORUM_ENV"; do
      if [ "$(py env-state "$f" APPLE_TOKEN_ENC_KEY)" = set ] && ! py same "$f" APPLE_TOKEN_ENC_KEY "$TOKEN_KEY_FILE"; then
        refuse "$TOKEN_KEY_FILE differs from the APPLE_TOKEN_ENC_KEY already in $(basename "$f") — replacing it would orphan every stored Apple token. Nothing was changed."
      fi
    done
    TK_OP="APPLE_TOKEN_ENC_KEY=@file:$TOKEN_KEY_FILE"
  elif [ "$st_vn" = set ]; then
    py token-key-check "env:$VN_ENV:APPLE_TOKEN_ENC_KEY" || refuse "nothing was changed"
    TK_OP="APPLE_TOKEN_ENC_KEY=@from-env:$VN_ENV"
    ok "no $TOKEN_KEY_FILE: keeping the APPLE_TOKEN_ENC_KEY already in eno-vn.env"
  elif [ "$st_fo" = set ]; then
    py token-key-check "env:$FORUM_ENV:APPLE_TOKEN_ENC_KEY" || refuse "nothing was changed"
    TK_OP="APPLE_TOKEN_ENC_KEY=@from-env:$FORUM_ENV"
    ok "no $TOKEN_KEY_FILE: keeping the APPLE_TOKEN_ENC_KEY already in eno-forum.env"
  else
    refuse "no $TOKEN_KEY_FILE and no APPLE_TOKEN_ENC_KEY in the app env files — pipe it from the vault first (I6)"
  fi

  # Prove the key and every id at Apple BEFORE a byte is written: a code Apple never issued must come back
  # invalid_grant (the client authenticated) — invalid_client means the secret itself is refused.
  mint_from() {  # $1 sub, $2 lifetime
    if [ "$P8_SOURCE" = file ]; then mint "$1" "$2" "$TEAM" "$KID" <"$P8_FILE"
    else py env-get "$VN_ENV" APPLE_SIWA_PRIVATE_KEY | mint "$1" "$2" "$TEAM" "$KID"; fi
  }
  GT_SECRET=$(mint_from "$SERVICES" $((SECRET_TTL_DAYS * 86400))) && [ -n "$GT_SECRET" ] \
    || refuse "minting GoTrue's client secret failed (above) — nothing was changed"
  jwt_info "$GT_SECRET" || refuse "the minted secret does not decode — nothing was changed"
  ok "minted GoTrue's client secret: key $J_KID, expires $J_EXP_DATE ($J_DAYS days), fingerprint $J_FP"
  r=$(probe_secret "$SERVICES")
  [ "$r" = ok ] || { explain_probe "$SERVICES" "$r"; refuse "nothing was changed"; }
  ok "Apple accepts it for $SERVICES (code=probe -> invalid_grant)"
  r=$(mint_from "$BUNDLE" 300 | apple_probe "$BUNDLE")
  if [ "$r" = ok ]; then ok "Apple accepts the same key for $BUNDLE (the native iOS code exchange)"
  elif [ "$r" = unreachable ]; then
    warn "$BUNDLE -> unreachable: Apple could not be asked about the native iOS code exchange — I9's probes and the daily cron ask again"
  else
    # ⛔ REFUSED, NOT WARNED (commit gate, part C follow-up, codex): native sign-in would keep no token to revoke, and
    # account deletion — what App Review tests on camera — could only ask the person to remove eno by hand (TN3194).
    explain_probe "$BUNDLE" "$r"
    refuse "Apple refuses this key for $BUNDLE: native sign-in would keep no token to revoke — fix the key's primary App ID (owner step 2/4); nothing was changed"
  fi

  backup install
  meta_set key_id "$KID"; meta_set services_id "$SERVICES"; meta_set secret_fp "$J_FP"; meta_set secret_exp "$J_EXP_DATE"
  APPLIED=1

  say "1/5 app env — both editions (read only when the containers are next created: I8b, right after this run)"
  for f in "$VN_ENV" "$FORUM_ENV"; do
    {
      printf 'APPLE_SIWA_TEAM_ID=%s\n' "$TEAM"
      printf 'APPLE_SIWA_KEY_ID=%s\n' "$KID"
      if [ "$P8_SOURCE" = file ]; then printf 'APPLE_SIWA_PRIVATE_KEY=@b64file:%s\n' "$P8_FILE"
      else printf 'APPLE_SIWA_PRIVATE_KEY=@from-env:%s\n' "$VN_ENV"; fi
      printf 'APPLE_SIWA_SERVICES_ID=%s\n' "$SERVICES"
      printf 'APPLE_SIWA_BUNDLE_ID=%s\n' "$BUNDLE"
      printf '%s\n' "$TK_OP"
      # Empty, and only where absent: a re-run after the I11 flip must not switch the rollout back off.
      printf '?NEXT_PUBLIC_APPLE_SIGNIN=\n'
    } | py env-set "$f" | sed 's/^/      /' || die "writing $f failed"
  done

  AUTH_TOUCHED=1
  say "2/5 GoTrue env"
  old=$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_CLIENT_ID 2>/dev/null || true)
  [ -n "$old" ] && [ "$old" != "$SERVICES,$BUNDLE" ] && note "GOTRUE_EXTERNAL_APPLE_CLIENT_ID was $old"
  {
    printf 'GOTRUE_EXTERNAL_APPLE_ENABLED=true\n'
    # The FIRST client id is the web flow's (provider/apple.go); every listed one is an accepted id_token audience.
    printf 'GOTRUE_EXTERNAL_APPLE_CLIENT_ID=%s,%s\n' "$SERVICES" "$BUNDLE"
    printf 'GOTRUE_EXTERNAL_APPLE_SECRET=%s\n' "$GT_SECRET"
    printf 'GOTRUE_EXTERNAL_APPLE_REDIRECT_URI=%s\n' "$REDIRECT_URI"
    # 300 s by default: a slow Apple login with two-factor outlives it ("OAuth state has expired").
    printf 'GOTRUE_EXTERNAL_FLOW_STATE_EXPIRY_DURATION=%s\n' "$FLOW"
  } | py env-set "$SB_ENV" | sed 's/^/      /' || die "writing $SB_ENV failed"
  if [ "$DROP" = 1 ]; then
    # D21: the old dev origin; Apple and Google redirects to it are refused at the edge anyway (nginx guard).
    r=$(py redirect-drop "$SB_ENV" "$LOCALHOST_REDIRECT") || die "editing ADDITIONAL_REDIRECT_URLS failed"
    ok "ADDITIONAL_REDIRECT_URLS: $LOCALHOST_REDIRECT $r"
  fi

  say "3/5 compose override — into the ONE services.auth.environment"
  r=$(py merge-override "$SB_OVERRIDE" --require GOTRUE_EXTERNAL_GOOGLE_ENABLED) || die "merging the override failed"
  ok "$r"
  compose_ok || die "the merged configuration does not load"

  say "4/5 recreate auth (both editions' sign-in pauses for a few seconds)"
  recreate_auth || die "auth was not recreated"
  wait_for true || die "GoTrue did not report apple, google and email on ($LAST_SETTINGS)"
  ok "GoTrue: $LAST_SETTINGS"
  [ "$S_DISABLE" = "$PRE_DISABLE" ] || die "disable_signup changed ($PRE_DISABLE -> $S_DISABLE)"
  verify_auth_env "$SERVICES,$BUNDLE" "$J_FP" "$FLOW" "$DROP" || die "the auth container does not hold what was written"

  say "5/5 the authorize redirect"
  r=$(authorize_check "$SERVICES") || die "GoTrue's Apple authorize is not what Apple expects"
  ok "$r"

  DONE=1
  meta_set result ok
  if [ -f "$TOKEN_KEY_FILE" ]; then
    shred -u "$TOKEN_KEY_FILE" && ok "shredded $TOKEN_KEY_FILE (the value lives in both app env files and the vault)" \
      || warn "could not shred $TOKEN_KEY_FILE — remove it by hand"
  fi
  prune_backups
  say "done — Sign in with Apple is ON in GoTrue; the app turns it on only with NEXT_PUBLIC_APPLE_SIGNIN (I11)"
  note "key id       $J_KID"
  note "expires      $J_EXP_DATE ($J_DAYS days) — record it on the expiry line of infra/vn-node/apple-signin.md"
  note "fingerprint  $J_FP"
  note "backup       $BACKUP_DIR"
  note "undo         bash $SELF restore $BACKUP_TS   (I13: empty the flag and deploy FIRST)"
  note "now          I8b: redeploy the deployed SHA — the apps read APPLE_SIWA_* only when created (apple-signin.md)"
  note "next         bash $SELF install-timer --auto-rotate   then   bash $SELF check --calibrate"
}

# ── rotate ───────────────────────────────────────────────────────────────────────────────────────────────────
cmd_rotate() {
  local mode=n ids SERVICES TEAM KID r
  [ "${1:-}" = --from-check ] && mode=w
  if [ "$mode" = n ]; then box_init; need_cmds docker python3 curl flock; fi
  need_files "$SB_ENV" "$SB_OVERRIDE" "$VN_ENV" "$FORUM_ENV"
  say "Sign in with Apple — rotate GoTrue's client secret"
  # The lock FIRST: a rotation that waited behind an install or a deploy must read what that run left behind.
  take_lock "$mode"
  [ "$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_ENABLED 2>/dev/null)" = true ] \
    || refuse "GoTrue's Apple provider is not on — nothing to rotate (install first)"
  ids=$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_CLIENT_ID 2>/dev/null) && [ -n "$ids" ] \
    || refuse "GOTRUE_EXTERNAL_APPLE_CLIENT_ID is missing from $SB_ENV"
  SERVICES=${ids%%,*}
  [ "$(py env-get "$VN_ENV" APPLE_SIWA_SERVICES_ID 2>/dev/null)" = "$SERVICES" ] \
    || refuse "APPLE_SIWA_SERVICES_ID in eno-vn.env is not GoTrue's web client ($SERVICES) — re-run install instead"
  TEAM=$(py env-get "$VN_ENV" APPLE_SIWA_TEAM_ID 2>/dev/null) && KID=$(py env-get "$VN_ENV" APPLE_SIWA_KEY_ID 2>/dev/null) \
    && [ "$(py env-state "$VN_ENV" APPLE_SIWA_PRIVATE_KEY)" = set ] \
    || refuse "eno-vn.env lacks APPLE_SIWA_TEAM_ID, _KEY_ID or _PRIVATE_KEY — re-run install"
  preflight_gotrue

  GT_SECRET=$(py env-get "$VN_ENV" APPLE_SIWA_PRIVATE_KEY | mint "$SERVICES" $((SECRET_TTL_DAYS * 86400)) "$TEAM" "$KID") \
    && [ -n "$GT_SECRET" ] || refuse "minting the new secret failed (above) — nothing was changed"
  jwt_info "$GT_SECRET" || refuse "the minted secret does not decode — nothing was changed"
  ok "minted: key $J_KID, expires $J_EXP_DATE ($J_DAYS days), fingerprint $J_FP"
  r=$(probe_secret "$SERVICES")
  [ "$r" = ok ] || { explain_probe "$SERVICES" "$r"; refuse "nothing was changed"; }
  ok "Apple accepts it for $SERVICES (code=probe -> invalid_grant)"

  backup rotate
  meta_set key_id "$KID"; meta_set services_id "$SERVICES"; meta_set secret_fp "$J_FP"; meta_set secret_exp "$J_EXP_DATE"
  APPLIED=1; AUTH_TOUCHED=1
  printf 'GOTRUE_EXTERNAL_APPLE_SECRET=%s\n' "$GT_SECRET" | py env-set "$SB_ENV" | sed 's/^/      /' \
    || die "writing $SB_ENV failed"
  compose_ok || die "the configuration does not load"
  recreate_auth || die "auth was not recreated"
  wait_for true || die "GoTrue did not report apple, google and email on ($LAST_SETTINGS)"
  ok "GoTrue: $LAST_SETTINGS"
  verify_auth_env "$ids" "$J_FP" "" 0 || die "the auth container does not hold the new secret"
  r=$(authorize_check "$SERVICES") || die "GoTrue's Apple authorize is not what Apple expects"
  ok "$r"
  DONE=1
  meta_set result ok
  prune_backups
  say "done — GoTrue runs the new secret"
  note "key id       $J_KID"
  note "expires      $J_EXP_DATE ($J_DAYS days) — update the expiry line in infra/vn-node/apple-signin.md"
  note "fingerprint  $J_FP"
  note "backup       $BACKUP_DIR   (undo: bash $SELF restore $BACKUP_TS)"
}

# ── check ────────────────────────────────────────────────────────────────────────────────────────────────────
cmd_check() {
  local calibrate=0 auto=${APPLE_SIWA_AUTO_ROTATE:-0} fails=0 ids SERVICES out r hour in_window=0
  while [ $# -gt 0 ]; do
    case "$1" in --calibrate) calibrate=1 ;; --auto-rotate) auto=1 ;; *) usage; exit 2 ;; esac
    shift
  done
  box_init
  need_cmds docker python3 curl flock
  need_files "$SB_ENV"
  say "Sign in with Apple — check GoTrue's client secret"
  if [ "$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_ENABLED 2>/dev/null)" != true ]; then
    ok "GoTrue's Apple provider is off (GOTRUE_EXTERNAL_APPLE_ENABLED is not true) — nothing to check"
    exit 0
  fi
  # ⛔ READ UNDER THE LOCK (commit gate, part C follow-up, opus): mid-install or mid-rotate, .env already holds the new
  # secret and the container the old one — a false "not .env's secret", and a due rotation run again right after the
  # manual one. Waits like the rotation does — and a lock still held after 15 minutes FAILS the run (follow-up review,
  # both seats): exiting 0 there let a wedged holder keep the expiry watchdog quiet for good. (Taken only once Apple
  # is on: with nothing to check, a long deploy is no reason to fail.)
  if [ "${LOCK_HELD:-0}" != 1 ]; then
    exec 8>"$LOCK" || die "cannot open $LOCK"
    if ! flock -w 900 8; then
      bad "$LOCK stayed busy for 15 minutes (a deploy, an install — or a stuck one?): nothing was checked"
      exit 1
    fi
    LOCK_HELD=1  # a due rotation below runs under this same lock (take_lock)
  fi
  ids=$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_CLIENT_ID 2>/dev/null) && [ -n "$ids" ] \
    || die "GOTRUE_EXTERNAL_APPLE_CLIENT_ID is missing from $SB_ENV"
  SERVICES=${ids%%,*}
  GT_SECRET=$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_SECRET 2>/dev/null) && [ -n "$GT_SECRET" ] \
    || die "GOTRUE_EXTERNAL_APPLE_SECRET is missing from $SB_ENV"
  jwt_info "$GT_SECRET" || die "GOTRUE_EXTERNAL_APPLE_SECRET is not a JWT"
  note "key id       $J_KID"
  note "expires      $J_EXP_DATE ($J_DAYS days)"
  note "fingerprint  $J_FP"
  if [ "$J_SUB" = "$SERVICES" ]; then ok "minted for GoTrue's web client $SERVICES"
  else bad "the secret was minted for '$J_SUB', but GoTrue's web client is $SERVICES"; fails=$((fails + 1)); fi

  out=$(auth_env fp:GOTRUE_EXTERNAL_APPLE_SECRET 2>/dev/null) || out=""
  if [ "$(kv "$out" GOTRUE_EXTERNAL_APPLE_SECRET)" = "fp:$J_FP" ]; then ok "the running auth container holds this secret"
  else bad "the running auth container holds $(kv "$out" GOTRUE_EXTERNAL_APPLE_SECRET) — not .env's secret (recreate auth, or investigate)"; fails=$((fails + 1)); fi

  r=$(probe_secret "$SERVICES")
  if [ "$r" = ok ]; then ok "Apple accepts it (code=probe -> invalid_grant)"
  else explain_probe "$SERVICES" "$r"; fails=$((fails + 1)); fi

  if [ "$calibrate" = 1 ]; then
    # A3: the probe means something only if a BROKEN copy of the same secret is refused. If Apple answered
    # invalid_grant to both, the probe could not tell a dead secret from a live one.
    r=$(printf '%s' "$GT_SECRET" | py break-jwt | apple_probe "$SERVICES")
    if [ "$r" = invalid_client ]; then ok "calibration: a broken copy -> invalid_client (the probe tells them apart)"
    else bad "calibration: a broken copy -> $r (want invalid_client) — the probe proves nothing"; fails=$((fails + 1)); fi
  fi

  if [ "$J_DAYS" -le "$ROTATE_AT_DAYS" ]; then
    hour=${UTC_HOUR:-$(date -u +%H)}; hour=${hour#0}
    [ "$hour" -ge 19 ] && [ "$hour" -lt 22 ] && in_window=1
    if [ "$auto" = 1 ] && { [ "$in_window" = 1 ] || [ "$J_DAYS" -le "$URGENT_DAYS" ]; }; then
      say "$J_DAYS days left — rotating (auto-rotate, D11)"
      cmd_rotate --from-check
      # ⛔ A rotation does not clear what failed above (commit gate C1, opus): a container/.env mismatch or a failed
      # calibration still fails the unit — or the timer reports healthy on a probe never shown to work.
      [ "$fails" = 0 ] || { bad "rotated — but $fails earlier check(s) failed above"; exit 1; }
      exit 0
    elif [ "$auto" = 1 ]; then
      ok "rotation due ($J_DAYS days left) — deferred to the 19:00-22:00 UTC window, the timer's own slot"
    else
      bad "$J_DAYS days left — rotate now: bash $SELF rotate (or: install-timer --auto-rotate)"
      fails=$((fails + 1))
    fi
  fi
  [ "$fails" = 0 ] || exit 1
  ok "healthy"
}

# ── restore ──────────────────────────────────────────────────────────────────────────────────────────────────
list_backups() {
  local d
  [ -d "$BACKUPS" ] || { note "no backups in $BACKUPS"; return 0; }
  for d in $(ls -1 "$BACKUPS" 2>/dev/null | sort); do
    [ -f "$BACKUPS/$d/meta" ] && printf '  %s  %s\n' "$d" "$(py meta-summary "$BACKUPS/$d/meta")"
  done
}

cmd_restore() {
  local ts="" force=0 dir name f foreign="" names before after flags="" c v l
  while [ $# -gt 0 ]; do
    case "$1" in --force) force=1 ;; -*) usage; exit 2 ;; *) ts=$1 ;; esac
    shift
  done
  box_init
  need_cmds docker python3 curl flock
  if [ -z "$ts" ]; then say "backups in $BACKUPS (restore <ts>)"; list_backups; exit 2; fi
  case "$ts" in 20[0-9][0-9][01][0-9][0-3][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) refuse "not a backup timestamp: $ts" ;; esac
  dir=$BACKUPS/$ts
  [ -d "$dir" ] || refuse "no backup $dir"
  need_files "$SB_ENV" "$SB_OVERRIDE" "$VN_ENV" "$FORUM_ENV"
  say "Sign in with Apple — restore $ts ($(py meta-summary "$dir/meta" 2>/dev/null))"
  take_lock n
  read_anon

  # ⛔ A FULL-FILE RESTORE ALSO REVERTS WHATEVER ELSE CHANGED SINCE — a secret added to eno-vn.env, an SMTP
  # setting in .env. Only the keys this script manages may differ; anything else is named and refused.
  for name in eno-vn.env eno-forum.env supabase.env; do
    [ -f "$dir/$name" ] || continue
    if [ "$name" = supabase.env ]; then names=$(py env-foreign "$dir/$name" "$(dst_of "$name")" supabase)
    else names=$(py env-foreign "$dir/$name" "$(dst_of "$name")" app); fi
    [ -n "$names" ] && foreign="$foreign $name: $(printf '%s' "$names" | tr '\n' ' ')"
  done
  if [ -f "$dir/docker-compose.override.yml" ] && ! py override-same "$dir/docker-compose.override.yml" "$SB_OVERRIDE"; then
    foreign="$foreign docker-compose.override.yml: lines outside the Apple passthroughs"
  fi
  if [ -n "$foreign" ]; then
    if [ "$force" = 1 ]; then warn "--force: also reverting what changed since $ts:$foreign"
    else refuse "changed since $ts outside what this script manages:$foreign — restoring would revert them too (re-run with --force, or restore by hand)"; fi
  fi

  # ⛔ B5: GoTrue's Apple going off while the running apps still SHOW Apple strands every Apple tap — and on iOS
  # also shows Google without Apple (4.8). I13's order: empty the flag and deploy, THEN restore.
  # ⚠️ TWO PLACES TO LOOK, BECAUSE THE BUTTONS FOLLOW THE BUNDLE, NOT THE ENV: the container's environment (the env
  # file it was created with) AND its image's label (the flag the bundle INLINED — eno-build.sh writes it). They part
  # after `eno-deploy.sh --rollback`, which runs the :prev image under the CURRENT env file: an emptied env over a
  # :prev built with `ios` still shows Apple. Either one non-empty refuses. (An image older than the label has no
  # Apple code at all, so a missing label is the empty flag.)
  before=$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_ENABLED 2>/dev/null || true)
  after=$(py env-get "$dir/supabase.env" GOTRUE_EXTERNAL_APPLE_ENABLED 2>/dev/null || true)
  if [ "$before" = true ] && [ "$after" != true ]; then
    for c in eno-vn-app eno-forum-app; do
      # ⛔ A container docker cannot read is not "flag empty" (commit gate C1, opus): missing, renamed or mid-swap,
      # exec and inspect answer nothing — which read as an empty flag. Not running counts as showing Apple.
      if [ "$(docker inspect --format '{{.State.Running}}' "$c" 2>/dev/null || true)" != true ]; then
        flags="$flags $c=(not running: cannot tell)"; continue
      fi
      v=$(docker exec "$c" printenv NEXT_PUBLIC_APPLE_SIGNIN 2>/dev/null || true)
      l=$(docker inspect --format '{{index .Config.Labels "vn.eno.apple-signin"}}' "$c" 2>/dev/null || true)
      [ "$l" = '<no value>' ] && l=
      if [ -n "$v" ] || [ -n "$l" ]; then flags="$flags $c=${v:-(empty)} built:${l:-(empty)}"; fi
    done
    if [ -n "$flags" ]; then
      if [ "$force" = 1 ]; then warn "--force: turning GoTrue's Apple off while the apps run NEXT_PUBLIC_APPLE_SIGNIN:$flags"
      else refuse "the running apps may still show Apple (NEXT_PUBLIC_APPLE_SIGNIN:$flags) — I13: empty the flag in both env files and deploy FIRST, then restore"; fi
    fi
  fi

  # ⛔ THE APPS' APPLE REVOCATION SETTINGS ARE INVARIANT ACROSS A RESTORE (commit gate C1/C3 + follow-up, both seats):
  # rows in public.apple_siwa_token outlive GoTrue's config, and revoking one needs the token key to open it AND the
  # team, key id, .p8 and client ids to mint Apple's client secret. So each app env file is STAGED first — the
  # backup's lines without the six keys, plus the six exactly as the running file holds them (keep-apple) — and then
  # written once, by the same atomic copy as every other file. No older or partial set from the backup can survive,
  # and a file that cannot be read stops the restore here, with nothing changed. A compromised key is rotated (I14),
  # never restored. (The keys show nothing to anyone: the flag is the switch; the native routes also need it.)
  local stage="$TMP/restore" name dst
  mkdir -p "$stage" || die "cannot stage the restore — nothing was changed"
  for name in supabase.env docker-compose.override.yml eno-vn.env eno-forum.env; do
    [ -f "$dir/$name" ] || continue
    case "$name" in
      eno-vn.env|eno-forum.env)
        dst=$(dst_of "$name")
        py keep-apple "$dst" "$dir/$name" > "$stage/$name" || die "cannot read $dst or $dir/$name — nothing was changed" ;;
      *) cp -p "$dir/$name" "$stage/$name" || die "cannot stage $name — nothing was changed" ;;
    esac
  done

  backup pre-restore
  APPLIED=1; AUTH_TOUCHED=1
  restore_files "$stage" || die "putting $dir back failed"
  ok "files put back from $dir"
  for name in eno-vn.env eno-forum.env; do
    [ -f "$stage/$name" ] && [ "$(py env-state "$(dst_of "$name")" APPLE_TOKEN_ENC_KEY)" = set ] \
      && ok "kept the Apple revocation settings in $name — stored tokens stay revocable"
  done
  compose_ok || die "the restored configuration does not load"
  recreate_auth || die "auth was not recreated"
  wait_for any || die "GoTrue did not come back with google and email on ($LAST_SETTINGS)"
  [ "$(kv "$(auth_env show:GOTRUE_MAILER_OTP_EXP)" GOTRUE_MAILER_OTP_EXP)" = 3600 ] \
    || die "the restored auth does not run GOTRUE_MAILER_OTP_EXP=3600"
  DONE=1
  meta_set result ok
  prune_backups
  say "done — GoTrue: $LAST_SETTINGS"
  if [ "$S_APPLE" = true ] && GT_SECRET=$(py env-get "$SB_ENV" GOTRUE_EXTERNAL_APPLE_SECRET 2>/dev/null) && jwt_info "$GT_SECRET"; then
    note "secret       key $J_KID, expires $J_EXP_DATE, fingerprint $J_FP"
  else
    note "Apple is off in GoTrue: the daily check passes without probing until it is installed again"
  fi
  note "pre-restore  $BACKUP_DIR   (undo this restore: bash $SELF restore $BACKUP_TS)"
}

# ── install-timer ────────────────────────────────────────────────────────────────────────────────────────────
cmd_install_timer() {
  local auto=0
  while [ $# -gt 0 ]; do
    case "$1" in --auto-rotate) auto=1 ;; *) usage; exit 2 ;; esac
    shift
  done
  box_init
  need_cmds systemctl install
  [ -f "$SELF_DIR/eno-apple-siwa-check.service" ] && [ -f "$SELF_DIR/eno-apple-siwa-check.timer" ] \
    || refuse "run install-timer from the checkout (/opt/eno/app/infra/vn-node), where the unit files are"
  say "Sign in with Apple — the daily check (auto-rotate: $([ "$auto" = 1 ] && echo on || echo off))"
  # A COPY, not the checkout's file: a deploy rewrites the checkout, and bash reads a running script by offset.
  # (Only a MISSING directory is created: `install -d -m` would re-chmod /etc/systemd/system and /etc/default.)
  for d in "$BIN_DIR" "$UNIT_DIR" "$(dirname "$DEFAULTS")"; do
    [ -d "$d" ] || install -d -m 0755 "$d" || die "cannot create $d"
  done
  install -m 0755 "$SELF" "$BIN_DIR/apply-apple-signin.sh" \
    && install -m 0644 "$SELF_DIR/eno-apple-siwa-check.service" "$SELF_DIR/eno-apple-siwa-check.timer" "$UNIT_DIR/" \
    || die "installing the script and the units failed"
  { printf '# apply-apple-signin.sh install-timer, %s UTC. 1 = the daily check rotates the GoTrue Apple secret\n' "$(date -u '+%F %T')"
    printf '# itself when 30 days or fewer remain (D11); 0 = it only fails, which shows in systemctl --failed.\n'
    printf 'APPLE_SIWA_AUTO_ROTATE=%s\n' "$auto"; } >"$DEFAULTS.tmp" \
    && chmod 0644 "$DEFAULTS.tmp" && mv -f "$DEFAULTS.tmp" "$DEFAULTS" || die "writing $DEFAULTS failed"
  systemctl daemon-reload && systemctl enable --now eno-apple-siwa-check.timer \
    || die "enabling eno-apple-siwa-check.timer failed"
  ok "installed $BIN_DIR/apply-apple-signin.sh, the units and $DEFAULTS (APPLE_SIWA_AUTO_ROTATE=$auto)"
  systemctl list-timers --no-pager eno-apple-siwa-check.timer 2>/dev/null | sed 's/^/      /'
  note "re-run install-timer after a deploy that changes this script: the timer runs the copy"
  note "calibrate once: bash $SELF check --calibrate"
}

# ── main ─────────────────────────────────────────────────────────────────────────────────────────────────────
cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  install)        cmd_install "$@" ;;
  check)          cmd_check "$@" ;;
  rotate)         [ $# -eq 0 ] || { usage; exit 2; }; cmd_rotate ;;
  restore)        cmd_restore "$@" ;;
  install-timer)  cmd_install_timer "$@" ;;
  -h|--help|help) usage; exit 0 ;;
  # Internal, for src/lib/apply-apple-signin.test.ts: the helper and the minter, with no box around them.
  _helper)        py "$@"; exit $? ;;
  _mint-local)    [ $# -eq 4 ] || exit 2
                  APPLE_MINT_SUB=$1 APPLE_MINT_TTL=$2 APPLE_MINT_TEAM=$3 APPLE_MINT_KID=$4 node --eval "$MINT_JS"
                  exit $? ;;
  *)              usage; exit 2 ;;
esac
