#!/usr/bin/env python3
"""
Which imported HCMC vehicle rentals are GONE at the source — the positive-signal list the weekly
refresh (scripts/vehicle-rentals-weekly.sh) passes to `import-vehicle-rentals.ts --gone`.

    python3 scripts/vehicle-rentals-gone.py --prev <snapshot dir> \
        --mioto ~/mioto_rentals_vn --bonbon ~/bonboncar_rentals_vn --bikes ~/motorbike_rentals_vn \
        --out gone.txt [--no-probe]

⛔ ABSENCE IS NOT A SIGNAL ON ITS OWN. A car missing from this week's search may simply be booked
in every window we asked about. So a row is written only on a POSITIVE answer from the source:
  · Mioto     — absent from every window of the fresh search AND /car/detail now answers an HTTP
                error or API error, or the car's own status is no longer 2 (active);
  · BonbonCar — absent from the fresh fleet AND /detail/<SKU> no longer carries a car (the site
                answers 200 for any SKU; see bonbon_gone), or its status is not 'Onboard';
  · shops     — the product is out of stock in the fresh scrape, or absent AND its page answers
                404/410.
A network failure (timeout, DNS, 5xx), any other API error, or a missing status field is UNKNOWN,
never gone — and every probe run is controlled by re-checking a known-live car (see `controlled`).

⛔ A SHORT SCRAPE RETIRES NOTHING. If a source returned fewer than 80% of last week's HCMC count, the
whole source is skipped this week: a half-failed scrape would otherwise read as a mass delisting,
and retirement is one-way (status is create-only in the importer).

Stdlib only; ~1 request/s per host.
"""
import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')
CTX = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if os.path.exists('/etc/ssl/cert.pem') \
    else ssl.create_default_context()
MIN_SHARE = 0.8
# An absent row with no positive answer is re-asked for this many weeks, then dropped from the baseline.
MAX_CARRIED = 4
UNRESOLVED = []  # absent MAX_CARRIED weeks with no answer: listed for the owner, never auto-retired
SHOPS = {'janmotorbike', 'theextramile', 'dungmotorbikes', 'tuanmotorbike', 'rentabikevn'}


def hcmc_mioto(rows):
    return {str(r['id']): r for r in rows if r.get('city') == 'TP. Hồ Chí Minh'}


def hcmc_bonbon(rows):
    return {str(r['sku']): r for r in rows if r.get('city') == 'Hồ Chí Minh'}


def hcmc_bikes(rows):
    return {f"{r['shop']}:{r['external_id']}": r for r in rows
            if r.get('shop') in SHOPS and 'Ho Chi Minh' in (r.get('city') or '')}


def load(path, pick):
    if not path or not os.path.exists(path):
        return None
    return pick(json.load(open(path, encoding='utf-8')))


_last = {}


def get(url, headers=None):
    """(status, body) — status 0 = network failure (unknown)."""
    host = url.split('/')[2]
    wait = _last.get(host, 0) + 1.0 - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.monotonic()
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''
    except Exception:  # noqa: BLE001 — timeout/DNS/TLS: unknown, never gone
        return 0, b''


MIOTO_NOT_FOUND = -10200  # what /car/detail answers for an id that does not exist (measured 2026-09-28)
CONTROL_EVERY = 50
_probes = {'mioto': 0, 'bonbon': 0}
_control_ok = {}


def mioto_detail(car_id):
    status, body = get(f'https://m-car.mioto.vn/car/detail?carId={car_id}',
                       {'Origin': 'https://www.mioto.vn', 'Referer': 'https://www.mioto.vn/'})
    try:
        j = json.loads(body) if status == 200 else None
    except ValueError:
        j = None
    return status, (j if isinstance(j, dict) else None)


def controlled(src, check):
    """⛔ Every CONTROL_EVERY probes, re-check a car that IS in this week's fleet. If it does not read
    as live, the source is blocking, rate-limiting or has changed shape — everything is unknown."""
    if _probes[src] % CONTROL_EVERY == 0:
        _control_ok[src] = check()
    _probes[src] += 1
    return _control_ok[src]


def mioto_gone(car_id, control_id):
    def live_control():
        st, j = mioto_detail(control_id)
        return bool(j) and j.get('error') == 0 and ((j.get('data') or {}).get('car') or {}).get('id') == control_id
    if not controlled('mioto', live_control):
        return False
    status, j = mioto_detail(car_id)
    if status in (404, 410):
        return live_control()  # a moved endpoint answering 404 must not read as a delisting
    if not j:
        return False
    car = (j.get('data') or {}).get('car') or {}
    # only the specific not-found code, or the car's own explicit status; any other answer is unknown
    verdict = j.get('error') == MIOTO_NOT_FOUND or (j.get('error') == 0 and 'status' in car and car['status'] != 2)
    # ⛔ CONFIRMED against the live control IMMEDIATELY after: -10200 is also Mioto's generic error, so
    # a block starting mid-run must not read as a delisting (plan reviewer).
    return verdict and live_control()


def page_gone(url, shop_url=None):
    """A shop product page answering 404/410 — confirmed by the shop's own homepage still answering
    200, so a redesign or a CDN outage that 404s everything is unknown, not a delisting."""
    status, _ = get(url)
    if status not in (404, 410):
        return False
    return not shop_url or get(shop_url)[0] == 200


BONBON_MARK = b'carDetail'  # inside escaped RSC flight strings, so no quotes around it


def bonbon_gone(sku, control_sku):
    """BonbonCar answers 200 for ANY /detail/<SKU> (a client-side not-found), so a status code proves
    nothing. A real car page carries the `carDetail` flight object the scraper parses; a delisted one
    does not. ⛔ CONTROLLED (see `controlled`): the marker is re-checked on a live car every
    CONTROL_EVERY probes — a challenge page or a markup change makes every answer unknown."""
    def live_control():
        st, body = get(f'https://www.bonboncar.vn/detail/{control_sku}')
        return st == 200 and BONBON_MARK in body
    if not controlled('bonbon', live_control):
        return False
    st, body = get(f'https://www.bonboncar.vn/detail/{sku}')
    verdict = st in (404, 410) or (st == 200 and len(body) > 20_000 and BONBON_MARK not in body)
    # ⛔ A challenge or error page also lacks the marker: confirm on the live control right away.
    return verdict and live_control()


def source(name, prev, cur, out, nxt, probe_absent, still_bad, prefix=''):
    """Append this source's gone externalIds to `out`, put next week's baseline in `nxt[name]`, and
    return a one-line report.

    ⛔ THE BASELINE CARRIES FORWARD WHAT WAS NOT CONFIRMED GONE. It is this week's rows PLUS every row
    that was absent but got no positive answer — so an inconclusive probe is asked again next week
    rather than dropping out of view with the listing still live. A skipped source keeps last week's
    baseline whole.
    """
    if prev is None or cur is None:
        nxt[name] = cur if prev is None else prev
        return f'{name}: {"no previous snapshot" if prev is None else "no fresh dataset"} — retire skipped'
    # The guard compares with last week's FRESH scrape, not with carried-forward rows, so unknowns
    # cannot ratchet the baseline up until every week reads as "short" (reviewer).
    fresh_prev = sum(1 for r in prev.values() if not r.get('_carried'))
    if len(cur) < MIN_SHARE * fresh_prev:
        nxt[name] = prev
        return f'{name}: fresh {len(cur)} < 80% of last week {fresh_prev} — retire SKIPPED, baseline kept'
    gone, unknown = [], {}
    for key, row in cur.items():
        if still_bad(row):
            gone.append(key)
    absent = [k for k in prev if k not in cur]
    for key in absent:
        if probe_absent(key, prev[key]):
            gone.append(key)
        elif int(prev[key].get('_carried') or 0) < MAX_CARRIED:
            unknown[key] = {**prev[key], '_carried': int(prev[key].get('_carried') or 0) + 1}
        else:
            # ⚠️ Never retired without a positive answer — handed to a human instead (unresolved.txt).
            UNRESOLVED.append(prefix + key)
    cur = {k: r for k, r in cur.items() if k not in set(gone)}
    # externalIds exactly as the importer writes them (vehicle-rental-listing.ts): mioto:<id>,
    # bonboncar:<sku>; bike keys are already <shop>:<external_id>.
    out.extend(prefix + k for k in gone)
    nxt[name] = {**unknown, **cur}
    return f'{name}: last week {len(prev)}, fresh {len(cur)}, absent {len(absent)} → gone {len(gone)}, unknown (carried forward) {len(unknown)}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prev', required=True, help="dir holding last week's mioto.json / bonbon.json / bikes.json")
    ap.add_argument('--mioto'); ap.add_argument('--bonbon'); ap.add_argument('--bikes')
    ap.add_argument('--out', required=True)
    ap.add_argument('--next-baseline', help='dir to write next week\'s baseline into (the weekly job promotes it after --apply)')
    ap.add_argument('--no-probe', action='store_true', help='report only; absent rows count as unknown')
    a = ap.parse_args()
    probe = not a.no_probe
    out, nxt, lines = [], {}, []

    cur = load(a.mioto and os.path.join(a.mioto, 'all_rentals.json'), hcmc_mioto)
    ctl = next((k for k, r in (cur or {}).items() if r.get('status') == 2), None)
    lines.append(source('mioto', load(os.path.join(a.prev, 'mioto.json'), hcmc_mioto), cur, out, nxt,
                        lambda k, _r: probe and ctl is not None and mioto_gone(k, ctl),
                        # ⛔ only an EXPLICIT status says anything; a missing field is unknown, never gone
                        lambda r: r.get('status') is not None and int(r['status']) != 2, 'mioto:'))
    cur = load(a.bonbon and os.path.join(a.bonbon, 'all_rentals.json'), hcmc_bonbon)
    ctl = next((k for k, r in (cur or {}).items() if r.get('status') == 'Onboard'), None)
    lines.append(source('bonboncar', load(os.path.join(a.prev, 'bonbon.json'), hcmc_bonbon), cur, out, nxt,
                        lambda k, _r: probe and ctl is not None and bonbon_gone(k, ctl),
                        lambda r: bool(r.get('status')) and r['status'] != 'Onboard', 'bonboncar:'))
    cur = load(a.bikes and os.path.join(a.bikes, 'all_rentals.json'), hcmc_bikes)
    lines.append(source('shops', load(os.path.join(a.prev, 'bikes.json'), hcmc_bikes), cur, out, nxt,
                        lambda k, r: probe and bool(r.get('source_url')) and page_gone(r['source_url'], r.get('shop_url')),
                        lambda r: 'out of stock' in (r.get('availability') or '').lower()))

    with open(a.out, 'w', encoding='utf-8') as f:
        for k in out:
            f.write(k + '\n')
    if a.next_baseline:
        os.makedirs(a.next_baseline, exist_ok=True)
        for name, fname in (('mioto', 'mioto.json'), ('bonboncar', 'bonbon.json'), ('shops', 'bikes.json')):
            if nxt.get(name) is not None:
                json.dump(list(nxt[name].values()), open(os.path.join(a.next_baseline, fname), 'w', encoding='utf-8'), ensure_ascii=False)
    if UNRESOLVED:
        with open(os.path.join(os.path.dirname(os.path.abspath(a.out)), 'unresolved.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(UNRESOLVED) + '\n')
        lines.append(f'UNRESOLVED {len(UNRESOLVED)}: absent {MAX_CARRIED} weeks, no answer — check by hand (unresolved.txt)')
    for line in lines:
        print('  ' + line)
    print(f'  gone total {len(out)} → {a.out}')


if __name__ == '__main__':
    sys.exit(main())
