# Import from Facebook: the reading worker

Facebook has no API for a person's Marketplace listings. This reads their pages with a logged-in browser **in a container on the box** (owner, 2026-11-05). It is against Facebook's terms and the owner has accepted that for this account; it can be locked at any time, and then imports stop.

⛔ **Never:** stealth or fingerprint tricks, proxies, solving a checkpoint, a replacement account to carry on after a lock, or copying a session here (that locked an account on 2026-11-04: the login is typed in by a person, in the box's own browser, `--login`). Never the leads account: `secrets/never-read-as.txt` names what `login.mjs` refuses. A wall stops the worker and mails support@eno.vn; a person answers Facebook.

⛔ **A match proves nothing.** A copy of a profile photo on another account has the same bytes (measured 2026-11-05), so name and picture only point at a profile, and the product must never call an import verified. Two profiles matching means nothing is imported; a copycat who hides from the search isn't caught. The owner accepted this (2026-11-05): anyone can already copy a public listing to eno by hand.

| | |
|---|---|
| Runs as | container `eno-fb-worker`, image `eno-fb-reader`, its own network `eno-fb`, 1.5 CPUs and 2 GB, real Chrome, headless, one job at a time |
| Talks to | `POST /api/fb-import/worker/{claim,report}` on https://eno.vn with `FB_IMPORT_WORKER_TOKEN` |
| Pace | fixed gaps, at most `FB_PAGES_PER_DAY` pages a day (300) and 100 items a seller, so about 2 to 3 sellers a day |
| Keeps | `/opt/eno/fb-reader/home`: `profile` (the login: treat it as a password), `state/`, and the token. Logs hold job ids and counts only |
| Sends | Only the matched seller's own live listings. Strangers in the search results are never sent or kept |

Everything is `infra/vn-node/apply-fb-import.sh` from a Mac: no argument before a deploy, `--after-deploy` after it, `--login` to log in (also after a wall; it clears `state/STOP`), `--stop` to stop reading.
Check it on the box: `docker logs --tail 20 eno-fb-worker`, `cat /opt/eno/fb-reader/home/state/STOP`.
