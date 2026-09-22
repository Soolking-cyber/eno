#!/usr/bin/env python3
"""
Emit SQL that undoes a run of attach-rever-photos.ts.  Usage:

    python3 scripts/rever-rollback.py /tmp/rever-images-backup-<stamp>.jsonl | psql "$DIRECT_URL" -v ON_ERROR_STOP=1

⛔ THIS EXISTS BECAUSE THE ROLLBACK USED TO BE A PRINTED SHELL ONE-LINER THAT HAD NEVER BEEN RUN.
It was `cat journal | while read l; do python3 -c ... "$l"; done`, and it failed on EVERY line:
`read` without `-r` eats the backslashes in the journal's escaped quotes, so json.loads threw
before a single row was restored.  Two reviewers flagged it and a test against a real journal
confirmed it.  A rollback you have not executed is not a safety net, so this one is a file that
can be tested.  ⚠️ psycopg2 is NOT installed on this machine — hence SQL on stdout into psql,
stdlib only.

⚠️ THE RESTORE IS CONDITIONAL, so replaying it twice is safe and it never clobbers a row somebody
else edited.  Journals written after 2026-09-22 carry both `old` and `next`, and the UPDATE matches
on `next` — exactly the rows this run wrote.  The first run's journal only carried `images` (the old
value); for those the guard falls back to "the row is currently re-hosted", which is the best
available proxy and still refuses to touch a row that has since been changed to anything else.
"""
import json, sys

TAG = "$enorb$"   # dollar-quoting tag; cannot occur in a url or in our json

def q(v: str) -> str:
    if TAG in v:
        raise SystemExit(f"refusing: value contains the quoting tag {TAG}")
    return TAG + v + TAG

def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: rever-rollback.py <journal.jsonl>")
    n = 0
    print("BEGIN;")
    with open(sys.argv[1], encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            old = r.get("old", r.get("images"))
            if old is None:
                raise SystemExit(f"journal line has neither 'old' nor 'images': {line[:80]}")
            rid = r["id"]
            nxt = r.get("next")
            if nxt is not None:
                where = f"id = {q(rid)} AND images = {q(nxt)}"
            else:
                where = f"id = {q(rid)} AND images LIKE '%sb.eno.vn%'"
            print(f'UPDATE "Listing" SET images = {q(old)} WHERE {where};')
            n += 1
    print("COMMIT;")
    # ⚠️ A NOTE TO THE OPERATOR, NOT A psql COMMAND. This used to print `\echo …` to stderr, which
    # reaches neither psql (wrong stream) nor the reader as a row count — it is the number of
    # statements EMITTED, and only psql's own "UPDATE n" lines say what was actually restored.
    print(f"-- emitted {n} conditional UPDATE(s); psql's UPDATE counts are the truth", file=sys.stderr)

if __name__ == "__main__":
    main()
