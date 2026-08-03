// ── MRZ, on a neutral import path ───────────────────────────────────────────────────────────────
//
// Identity/KYC code imports MRZ parsing from HERE, never from `@/lib/visa/mrz` directly.
//
// ⚠️ THIS DOES **NOT** REMOVE `lib/visa` FROM eno.vn'S MODULE GRAPH, AND AN EARLIER VERSION OF THIS
// COMMENT CLAIMED IT DID. codex and agy both called that out and they are right: a re-export is a
// compile-time alias, so the visa module is still bundled, still in stack traces, still in
// sourcemaps. If the licensing concern is real, this file does not answer it — only MOVING the
// source here (and having the visa modules re-export from it) does, which is a follow-up because it
// changes the bytes of a sync-paired file and must land on the forum side in the same commit.
//
// What this file DOES buy, honestly stated:
//   1. ONE import path for compliance code, so the eventual move is a one-line change here rather
//      than a sweep across every KYC call site.
//   2. `src/lib/visa/mrz.ts` IS BYTE-LOCKED — `src/lib/sync-pairs.test.ts` couples it to the forum
//      copy, so any edit to suit KYC fails the root suite until both sides are mirrored. Routing
//      through this file makes that constraint visible at the boundary instead of surprising
//      someone mid-change.
//
// ⚠️ THIS RE-EXPORTS RATHER THAN COPIES, ON PURPOSE. A second implementation of ICAO 9303 check
// digits is the exact shape of bug this repo has already paid for once — three copies of the
// ranking formula drifting apart in silence. One implementation, one behaviour.
//
// The clean end state is the reverse: move the source HERE and have the visa modules re-export from
// it. That is a follow-up, because it changes the bytes of a sync-paired file and therefore has to
// land on the forum side in the same commit.

export { parsePassportMrz, type PassportMrzResult } from '@/lib/visa/mrz'
