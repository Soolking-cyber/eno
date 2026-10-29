"""Unit checks of server.py's Vietnamese speed gate — hold_play (how the app plays a line) and vi_verdict (ON or OFF) — on
chunk timings like ZeroTTS's (stdlib only, so it also runs inside the image). Both, and the gate's limits, are taken out of
server.py by its AST: importing the server loads the models.

  python -I test_vi_gate.py [server.py]
"""
import ast, sys
src = open(sys.argv[1] if len(sys.argv) > 1 else __file__.replace('test_vi_gate.py', 'server.py')).read()
LIMITS = {'VI_CHECK_MIN_S', 'VI_FIRST_MAX_S', 'VI_RTF_MAX', 'VI_JITTER_S', 'VI_HOLD_S'}
keep = [node for node in ast.parse(src).body
        if (isinstance(node, ast.FunctionDef) and node.name in ('hold_play', 'vi_verdict'))
        or (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in LIMITS for t in node.targets))]
ns = {}
exec(compile(ast.Module(body=keep, type_ignores=[]), 'gate', 'exec'), ns)
hold_play, vi_verdict = ns['hold_play'], ns['vi_verdict']
INF = float('inf')
fails = []


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f' — {detail}'))
    if not ok:
        fails.append(name)


def zerotts(rtf, max_frames, first=0.17, frames=88, cost=0.02):
    """ZeroTTS's stream: chunks of 1, 2, 4… frames (80 ms each) up to max_frames, each made at rtf, plus a per-chunk cost."""
    t, out, done, k = first, [], 0, 1
    while done < frames:
        n = min(k, max_frames, frames - done)
        if out:
            t += n * 0.08 * rtf + cost
        out.append((t, n * 0.08))
        done, k = done + n, k * 2
    return out


slack = lambda arrivals: hold_play(arrivals, 0.35)[1]

# hold_play — exact: 0.4 s in hand at 1.0 (it starts); the next 0.4 s lands at 1.3 (0.1 s early), the next at 1.85 (0.05 s late).
start, s = hold_play([(0.8, 0.2), (1.0, 0.2), (1.3, 0.4), (1.85, 0.4)], 0.35)
check('it starts once the hold is in hand, then each chunk is held against the voice queued ahead of it', start == 1.0 and abs(s + 0.05) < 1e-9, (start, s))
check('a line shorter than the hold plays whole at its end: it starts then, and cannot run dry', hold_play([(0.1, 0.08), (0.2, 0.16)], 0.35) == (0.2, INF))
check('a line made in one piece: it starts when it lands', hold_play([(0.5, 7.0)], 0.35) == (0.5, INF))
check('no voice at all: never starts', hold_play([], 0.35) == (INF, INF))
# What the box measured (2026-10-29): chunks capped at 4 frames played smoothly at RTF 0.84-0.92; ZeroTTS's own 16 chopped.
for rtf in (0.85, 0.92):
    check(f'4-frame chunks at RTF {rtf}: smooth with the app\'s 350 ms, with room for the network (≥ 50 ms)', slack(zerotts(rtf, 4)) >= 0.05, slack(zerotts(rtf, 4)))
    check(f'16-frame chunks at RTF {rtf}: runs dry (the chop the owner heard)', slack(zerotts(rtf, 16)) < 0, slack(zerotts(rtf, 16)))
check('slower than real time: runs dry, however small the chunks', slack(zerotts(1.05, 4)) < 0)

# vi_verdict — the start-up decision, one refusal at a time (each case breaks exactly one rule).
check('every limit taken from server.py, the hold the app\'s 350 ms', all(k in ns for k in LIMITS) and ns['VI_HOLD_S'] == 0.35, sorted(k for k in LIMITS if k not in ns))
smooth = zerotts(0.85, 4)
made = sum(v for _, v in smooth)  # 7.04 s
took = smooth[-1][0]              # RTF ~0.93
seen, on = vi_verdict(smooth, made, took)
check('a smooth, whole line: ON, and what it measured is shown', on and set(seen) == {'first_s', 'start_s', 'rtf', 'slack_s', 'line_s', 'heard_s'}, seen)
check('a line cut short (< 6 s made): OFF', not vi_verdict(smooth[:12], sum(v for _, v in smooth[:12]), smooth[11][0])[1])
check('the voice handed over does not add up to the seconds made: OFF', not vi_verdict(smooth, made + 0.5, took)[1])
late = [(at + 1.0, v) for at, v in smooth]  # the same line, everything 1 s later
check('the app would start playing ≥ 1 s after the ask: OFF', not vi_verdict(late, made, took)[1])
# codex, commit review: a first chunk at once, then nothing until 1.1 s — the app cannot start until its hold is in hand.
seen, on = vi_verdict([(0.1, 0.08), (1.1, 6.96)], 7.04, 1.1)
check('a fast first chunk, the hold only at 1.1 s: OFF (the AUDIBLE start counts)', not on and seen['first_s'] == 0.1 and seen['start_s'] == 1.1, seen)
check('made at ≥ 0.95 of real time: OFF', not vi_verdict(smooth, made, 0.96 * made)[1])
chop = zerotts(0.85, 16)
check('the hold runs dry (16-frame chunks), however fast: OFF', not vi_verdict(chop, sum(v for _, v in chop), 0.85 * sum(v for _, v in chop))[1])
tight = smooth[:3] + [(at + 0.24, v) for at, v in smooth[3:]]  # every later chunk only ~30 ms early
check('less than VI_JITTER_S to spare: OFF', 0 < slack(tight) < 0.05 and not vi_verdict(tight, made, took)[1], slack(tight))
check('nothing made at all: OFF, and /health stays JSON (no infinity)',
      vi_verdict([], 0.0, 0.5) == ({'first_s': 99.0, 'start_s': 99.0, 'rtf': 99.0, 'slack_s': 9.99, 'line_s': 0.0, 'heard_s': 0.0}, False), vi_verdict([], 0.0, 0.5))

print('ALL PASS' if not fails else f'{len(fails)} FAILED: {fails}')
sys.exit(1 if fails else 0)
