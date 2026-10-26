"""Unit checks of server.py's Trim — the voice's own silence cut after a sentence — on synthetic sentences (stdlib + numpy,
so it also runs inside the image). Trim is taken out of server.py by its AST: importing the server loads the models.

  python -I test_trim.py [server.py]
"""
import ast, sys
import numpy as np
src = open(sys.argv[1] if len(sys.argv) > 1 else __file__.replace('test_trim.py', 'server.py')).read()
keep = [node for node in ast.parse(src).body
        if (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and (t.id.startswith('TRIM_') or t.id == '_EMPTY') for t in node.targets))
        or (isinstance(node, ast.ClassDef) and node.name == 'Trim')]
ns = {'np': np}
exec(compile(ast.Module(body=keep, type_ignores=[]), 'trim', 'exec'), ns)
Trim, TAIL = ns['Trim'], ns['TRIM_TAIL_MS']
R = 24000
ms = lambda n: int(R * n / 1000)
tone = lambda n, a=0.2: (a * np.sin(2 * np.pi * 220 * np.arange(ms(n)) / R)).astype(np.float32)
quiet = lambda n: np.zeros(ms(n), dtype=np.float32)
fails = []


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f' — {detail}'))
    if not ok:
        fails.append(name)


def run(x, chunk):
    t = Trim(R)
    out = [t.push(x[i:i + chunk]) for i in range(0, len(x), chunk)]
    out.append(t.flush())
    return np.concatenate(out) if out else np.zeros(0, np.float32)


# A Phonon-like sentence: 130 ms of lead, 400 ms of voice, a 200 ms comma pause, 300 ms of voice, 700 ms of tail.
x = np.concatenate([quiet(130), tone(400), quiet(200), tone(300), quiet(700)])
for chunk in (ms(160), ms(240), 1, 999, len(x)):
    y = run(x, chunk)
    check(f'chunk {chunk}: everything up to the last sound kept as it was (lead, comma pause, voice)', np.array_equal(y[:ms(1030)], x[:ms(1030)]))
    check(f'chunk {chunk}: the tail is TRIM_TAIL_MS', abs(len(y) - ms(1030 + TAIL)) <= ms(10), len(y) / R)
same = [run(x, c) for c in (1, 7, ms(160), len(x))]
check('chunked == one-shot', all(np.array_equal(same[0], s) for s in same))
check('never sounds → exactly as it went in', np.array_equal(run(quiet(900), ms(160)), quiet(900)))
floor = (10 ** (-65 / 20) * np.random.default_rng(1).standard_normal(ms(900))).astype(np.float32)
check('a quiet floor that never sounds → exactly as it went in', np.array_equal(run(floor, ms(160)), floor))
check('empty → nothing', len(run(np.zeros(0, np.float32), 10)) == 0)
y = run(np.concatenate([tone(300), quiet(50)]), ms(160))
check('a tail shorter than TRIM_TAIL_MS → kept as is', abs(len(y) - ms(350)) <= 1, len(y))
y = run(np.concatenate([quiet(10), tone(300)]), ms(160))
check('voice to the very end → nothing cut', abs(len(y) - ms(310)) <= 1, len(y))
# Phonon's lead: a -53 dBFS blip, then ~100 ms near -75 dBFS, then a soft /f/ at -65 dBFS before the vowel — all kept.
blip = tone(10, 10 ** (-53 / 20) * 1.414)
soft = tone(80, 10 ** (-65 / 20) * 1.414)
x3 = np.concatenate([blip, quiet(100), soft, tone(300), quiet(600)])
y = run(x3, ms(160))
check('the lead (blip, near-silence, a soft onset) kept whole', np.array_equal(y[:ms(490)], x3[:ms(490)]), len(y) / R)
# A soft ending (-58 dBFS, above TRIM_QUIET_DBFS) is sound: kept whole, then the tail.
fric = tone(150, 10 ** (-58 / 20) * 1.414)
x4 = np.concatenate([tone(300), fric, quiet(600)])
y = run(x4, ms(160))
check('a soft ending (-58 dBFS) kept whole, then TRIM_TAIL_MS', np.array_equal(y[:ms(450)], x4[:ms(450)]) and abs(len(y) - ms(450 + TAIL)) <= ms(10), len(y) / R)
# Over a quiet floor the cut tail fades: the last sample out is ~0.
x2 = (np.concatenate([quiet(150), tone(300), quiet(700)]) + (10 ** (-65 / 20) * np.random.default_rng(2).standard_normal(ms(1150))).astype(np.float32)).astype(np.float32)
y = run(x2, ms(160))
check('the cut tail fades out (last sample ≈ 0)', abs(y[-1]) < 1e-6, y[-1])
check('over a floor: 150 + 300 + TRIM_TAIL_MS', abs(len(y) - ms(450 + TAIL)) <= ms(10), len(y) / R)
print('FAILED: ' + ', '.join(fails) if fails else 'ALL PASS')
sys.exit(1 if fails else 0)
