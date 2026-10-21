# src/lib/visa/ — sync-paired files

Loads when working under `src/lib/visa/`; moved out of the root CLAUDE.md on 2026-10-18.

⚠️ `src/lib/sync-pairs.test.ts` byte-couples six `src/lib/visa/*` files
(`mrz` · `image-quality` · `image-normalization` · `checkpoints` · `schema` · `crypto`) to their
forum copies under `apps/forum/src/lib/visa/`, so editing one of those on the eno.vn side **fails the
root vitest suite** — and CI's "Visa sync pairs are in lockstep" step (`npm run sync:visa`) — until the
pair is mirrored or retired from the test. Check that list before touching `src/lib/visa/**`, and
prefer putting new visa logic in files that are not sync-paired.

Why it is a gate and not tidiness (the CI step's own comment): both apps decrypt and RE-ENCRYPT the
same `visa_applications` rows, and `visaPayloadSchema` is `z.object()`, not `.strict()`, so zod silently
STRIPS unknown keys — a payload field the root gains and the forum copy lacks is deleted from the
ciphertext by the next forum admin edit, with no error and no log.

Mirroring is generated, not manual: edit the root file, then `node scripts/sync-visa-pairs.mjs --write`
(the forum copies are generated — never hand-edit them), and never "fix" a failure by deleting a pair.
Steps: headers of `scripts/sync-visa-pairs.mjs` and `src/lib/sync-pairs.test.ts`.
