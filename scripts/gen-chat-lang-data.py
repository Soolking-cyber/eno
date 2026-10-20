#!/usr/bin/env python3
r"""
Regenerate src/lib/chat-lang-data.ts (chat language-ID weights; ships to the browser) and src/lib/vi-restore-data.ts
(Vietnamese mark restoration; server only) from eno's OWN text — live listings + the UI copy. No third-party word
lists: the frequency data that first prototyped this (wordfreq) is CC-BY-SA, so it is not used here.

Export the listing text READ-ONLY into a work folder OUTSIDE the repo (it is merchant text; delete it afterwards):

  W=~/eno-chat-lang-data; mkdir -p $W
  (set -a; . ./.env; set +a; export PGOPTIONS='-c default_transaction_read_only=on'
   psql "${DIRECT_URL%%\?*}" -At -c "copy (select \"sellerId\", replace(replace(coalesce(\"titleVi\",'') || ' ' || coalesce(\"descriptionVi\",''), E'\\t', ' '), E'\\n', ' ') from \"Listing\" where status in ('active','sold','expired') and \"titleVi\" is not null) to stdout" > $W/vi-listings.tsv
   psql "${DIRECT_URL%%\?*}" -At -c "copy (select \"sellerId\", replace(replace(title || ' ' || description, E'\\t', ' '), E'\\n', ' ') from \"Listing\" where status in ('active','sold','expired')) to stdout" > $W/en-listings.tsv)
  python3 -I scripts/gen-chat-lang-data.py $W .

Then run src/lib/chat-lang.test.ts and src/lib/vi-restore.test.ts — the hand-checked overrides below are where the
English/Vietnamese overlap is settled, and the tests pin the lines that matter.
"""
import json, math, re, sys, unicodedata
from collections import Counter, defaultdict

D, REPO = sys.argv[1], sys.argv[2]

# ── 1) frequency + restoration tables ─────────────────────────────


def deaccent(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.replace('đ', 'd').replace('Đ', 'D')

# Vietnamese listing text, seller-tagged: a word ships with a weight only if many DIFFERENT sellers write it (below).
vi_seller_rows = [r.rstrip('\n').partition('\t') for r in open(f'{D}/vi-listings.tsv', encoding='utf-8')]
vi_text = '\n'.join(text for _, _, text in vi_seller_rows)
# UI copy, Vietnamese side (curated translations) — values of the overrides map.
ov = open(f'{REPO}/src/generated/vi-overrides.ts', encoding='utf-8').read()
vi_ui = '\n'.join(m.group(2) for m in re.finditer(r'"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"', ov))
en_ui = '\n'.join(m.group(1) for m in re.finditer(r'"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"', ov))
# ⛔ The English word list SHIPS TO EVERY BROWSER, so it must never carry one seller's own token (a lowercase Zalo
# handle or shop name repeated in their listings). Each listing word is counted with the set of sellers using it,
# and only words used by MIN_SELLERS different sellers may ship (UI copy and the hand list are eno's own words).
MIN_SELLERS = 8
en_sellers = defaultdict(set)
en_lines = []
for row in open(f'{D}/en-listings.tsv', encoding='utf-8'):
    seller, _, text = row.rstrip('\n').partition('\t')
    en_lines.append(text)
    for m in re.finditer(r"[A-Za-z]+(?:'[a-z]+)?", text):
        w = m.group(0)
        if w[0].isupper() and not w.isupper():
            continue
        en_sellers[w.lower()].add(seller)
ui_words = {w.lower() for w in re.findall(r"[A-Za-z]+", en_ui)}
en_text = '\n'.join(en_lines) + '\n' + en_ui
vi_all = unicodedata.normalize('NFC', vi_text + '\n' + vi_ui)

VI_LETTERS = 'a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'
tok_vi = re.compile(f'[{VI_LETTERS}]+')
uni = defaultdict(Counter)
big = defaultdict(Counter)
vi_base = Counter()
for line in vi_all.lower().split('\n'):
    toks = tok_vi.findall(line)
    for t in toks:
        b = deaccent(t)
        uni[b][t] += 1
        vi_base[b] += 1
    for a, c in zip(toks, toks[1:]):
        big[deaccent(a) + ' ' + deaccent(c)][a + ' ' + c] += 1

# English: LOWER-CASE occurrences only, so capitalised Vietnamese names and places in English text do not count.
en = Counter()
for m in re.finditer(r"[A-Za-z]+(?:'[a-z]+)?", en_text):
    w = m.group(0)
    if w[0].isupper() and not w.isupper():
        continue
    en[w.lower()] += 1

Nv = sum(vi_base.values()); Ne = sum(en.values())
def z(c, N): return math.log10((c + 1) / N * 1e9)
json.dump({'vi_base': dict(vi_base.most_common(20000)), 'en': dict(en.most_common(40000)), 'Nv': Nv, 'Ne': Ne},
          open(f'{D}/freq.json', 'w'))

# Restoration tables: unigram best form (only where an accented form exists), bigram only where it beats the unigram pick.
# The restoration tables are committed and baked into the server image: a form ships only when several DIFFERENT sellers
# write it (or eno's UI copy does) — never one seller's own name or phrasing (reviewers, 2026-10-20). It also keeps one
# big importer's vocabulary (cars: 'lái', 'lốp') from deciding every chat line.
RESTORE_MIN_SELLERS = 3
form_sellers = defaultdict(set)
pair_sellers = defaultdict(set)
for seller, _, text in vi_seller_rows:
    toks = tok_vi.findall(unicodedata.normalize('NFC', text).lower())
    for t in toks:
        form_sellers[t].add(seller)
    for a, c in zip(toks, toks[1:]):
        pair_sellers[a + ' ' + c].add(seller)
ui_forms = set()
ui_pairs = set()
for line in unicodedata.normalize('NFC', vi_ui).lower().split('\n'):
    toks = tok_vi.findall(line)
    ui_forms.update(toks)
    ui_pairs.update(a + ' ' + c for a, c in zip(toks, toks[1:]))
def shared_form(f): return f in ui_forms or len(form_sellers.get(f, ())) >= RESTORE_MIN_SELLERS
# The PAIR itself must be eno's own copy or several sellers' — two UI words side by side in one seller's text is not.
def shared_pair(p): return p in ui_pairs or len(pair_sellers.get(p, ())) >= RESTORE_MIN_SELLERS

uni_best = {}
for b, c in uni.items():
    c = Counter({f: n for f, n in c.items() if shared_form(f)})
    if sum(c.values()) < 3: continue
    form, n = c.most_common(1)[0]
    uni_best[b] = form
big_best = {}
for pair, c in big.items():
    c = Counter({f: n for f, n in c.items() if shared_pair(f)})
    tot = sum(c.values())
    if tot < 4: continue
    form, n = c.most_common(1)[0]
    a, b = pair.split(' ')
    if form != f"{uni_best.get(a, a)} {uni_best.get(b, b)}" and n / tot >= 0.5:
        big_best[pair] = form
json.dump({'uni': uni_best, 'big': big_best}, open(f'{D}/restore.json', 'w'), ensure_ascii=False)
print('vi tokens', Nv, 'en tokens', Ne, 'uni', len(uni_best), 'big', len(big_best))

# ── 2) emit the TypeScript data modules ────────────────────────────
# from eno's OWN text (listings + UI copy) plus hand-checked overrides. No third-party word lists.
F = json.load(open(f'{D}/freq.json')); R = json.load(open(f'{D}/restore.json', encoding='utf-8'))
vi, en, Nv, Ne = F['vi_base'], F['en'], F['Nv'], F['Ne']

RHYMES = set('''a ac ach ai am an ang anh ao ap at au ay e ec ech em en eng enh eo ep et eu i ia ich iec iem ien ieng iep iet ieu im in inh ip it iu
o oa oac oach oai oam oan oang oanh oao oap oat oay oc oe oem oen oeo oet oi om on ong ooc oong op ot
u ua uan uang uat uay uc ue uech uenh ui um un ung uo uoc uoi uom uon uong uop uot uou up ut uu uy uya uych uyen uyet uynh uyp uyt uyu y yem yen yet yeu'''.split())
ONSETS = ['ngh','ng','gh','gi','kh','nh','ph','qu','th','tr','ch','b','c','d','g','h','k','l','m','n','p','r','s','t','v','x','']
GI_EXTRA = {'', 'n', 'm', 't', 'p', 'ch', 'nh', 'ng'}
def fits(o, r):
    if o == 'k': return r[:1] in ('e','i','y')
    if o == 'c': return r[:1] not in ('e','i','y')
    if o in ('gh','ngh'): return r[:1] in ('e','i')
    if o in ('g','ng'): return r[:1] not in ('e','i')
    if o == 'qu': return not re.match('^(u|oa|oe)', r)
    if o == 'gi': return not r.startswith('i')
    return True
def is_vi(t):
    if not re.fullmatch('[a-z]{1,7}', t): return False
    for o in ONSETS:
        if not t.startswith(o): continue
        r = t[len(o):]
        if o == 'gi' and r in GI_EXTRA: return True
        if r and r in RHYMES and fits(o, r):
            if re.match('^y[a-z]', r) and o not in ('', 'qu'): continue
            return True
    return False

def z(c, N): return math.log10((c + 1) / N * 1e9)
weights = {}
for b in set(vi) | {w for w in en if is_vi(w)}:
    if not is_vi(b): continue
    cv, ce = vi.get(b, 0), en.get(b, 0)
    if cv < 20 and ce < 20: continue
    d = z(cv, Nv) - z(ce, Ne)
    w = 2 if d >= 1.5 else 1 if d >= 0.75 else 0 if d > -0.75 else -1 if d > -1.5 else -2
    weights[b] = w
# ⛔ These weights ship to every browser too. Each is a single Vietnamese syllable shape, so no handle or shop name
# can be one — but a word still ships only when eno's own UI copy has it or MIN_SELLERS different sellers write it,
# the same bar as the English list (reviewers, 2026-10-20).
vi_sellers = defaultdict(set)
for seller, _, text in vi_seller_rows:
    for t in tok_vi.findall(text.lower()):
        vi_sellers[deaccent(t)].add(seller)
ui_vi_words = {deaccent(t) for t in tok_vi.findall(unicodedata.normalize('NFC', vi_ui).lower())}
weights = {b: w for b, w in weights.items()
           if b in ui_vi_words or b in ui_words or len(vi_sellers.get(b, ())) >= MIN_SELLERS or len(en_sellers.get(b, ())) >= MIN_SELLERS}
# Hand-checked overlap (the words frequent in BOTH languages) and chat words a listings corpus under-counts.
OVR = {**{w: 0 for w in 'an do me can long may day no so my he them than go ten men man son hot top tin tim nam hay bay sang gap mat hit sit pin bin map nap tap pop mop hop thin chin'.split()},
       **{w: -1 for w in 'to the that on it a be then'.split()},
       **{w: -2 for w in 'in at i not but by up'.split()},
       **{w: 2 for w in 'con ban hang la co o de em van ma ca da ve khong duoc minh toi cam chao xin anh chi nhe nha roi chua vang gi dau vay nhieu bao muon thue phong tien gia nhung cung voi cua nao sao gio ngay thang nam'.split()},
       **{w: 1 for w in 'song chat sup oi'.split()}}
weights.update({k: v for k, v in OVR.items() if is_vi(k)})
# An unlisted Vietnamese-shaped word defaults to +0.5, so only weights that DIFFER from that are worth shipping.
weights = {k: v for k, v in weights.items() if v != 0.5}

CHAT_EN = '''hi hello hey thanks thank you yes yeah yep please sorry okay sure great cool nice good fine morning evening night tonight tomorrow
today yesterday weekend available interested rent deposit contract teacher lesson lessons class classes student students parent parents kid kids
daughter what where when why who which would could should will how much many price prices room rooms flat apartment house viewing visit
still free week weeks month months year years about with from have has had this these those they their there here your yours our us we
are was were been being does did done get got want need like love see look looking help call text message send sent number address
location near far time times hour hours minute minutes day days sounds perfect awesome wonderful excellent welcome bye goodbye later'''.split()
en_words = {w for w, c in en.items() if c >= 3 and re.fullmatch('[a-z]+', w) and not is_vi(w)
            and (w in ui_words or len(en_sellers.get(w, ())) >= MIN_SELLERS)} | {w for w in CHAT_EN if not is_vi(w)}

out = ['// GENERATED by scripts/gen-chat-lang-data.py from eno listings + UI copy (2026-10-20) — do not edit by hand.',
       '// Weights: how much more often a Vietnamese-SHAPED word (written without marks) is Vietnamese than English in',
       "// eno's own text: +2/+1 Vietnamese, 0 both, -1/-2 English. Unlisted Vietnamese-shaped words count +0.5.",
       f'export const VI_WEIGHT: Record<string, number> = {json.dumps(dict(sorted(weights.items())), separators=(",", ":"))}',
       '// Common English words that CANNOT be a Vietnamese syllable — they tell English from other Latin languages.',
       f'export const EN_WORDS = {json.dumps(" ".join(sorted(en_words)))}',
       '']
open(f'{REPO}/src/lib/chat-lang-data.ts', 'w', encoding='utf-8').write('\n'.join(out))

r = ['// GENERATED by scripts/gen-chat-lang-data.py from eno\'s own Vietnamese text (2026-10-20) — do not edit by hand.',
     '// UNI: unaccented syllable → its most frequent written form. BIG: an unaccented pair whose usual form differs from',
     '// picking each word alone. Server-only: it is ~100 KB and only the translation route needs it.',
     "import 'server-only'",
     f'export const UNI: Record<string, string> = {json.dumps(R["uni"], ensure_ascii=False, separators=(",", ":"))}',
     f'export const BIG: Record<string, string> = {json.dumps(R["big"], ensure_ascii=False, separators=(",", ":"))}',
     '']
open(f'{REPO}/src/lib/vi-restore-data.ts', 'w', encoding='utf-8').write('\n'.join(r))
print('weights', len(weights), 'en_words', len(en_words))
