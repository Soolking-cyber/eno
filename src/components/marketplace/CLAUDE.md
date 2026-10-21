# src/components/marketplace/ — landmine files

Loads when working under `src/components/marketplace/`; moved out of the root CLAUDE.md on 2026-10-18.

These carry invariants recorded in their own comments. Read the comments before editing; a regression here is a P0:
`listing-card.tsx` · `listing-gallery.tsx` (cover-beat video: eager overlay is the LCP, no `poster` attr) · `listings-explorer.tsx` (pagination sentinel must never be `hidden` — a hidden sentinel is never intersected and pagination dies silently; cache adoption is a reference check) · `listings-map.tsx` (popup height-sync; touch two-step) · `post-wizard.tsx` (the title field's id must stay exactly `pw-title` — `scrollToMissing()` does `getElementById('pw-' + key)`) · `CardVideo` (`card-video.tsx`).

`ChatSendButton` lives in `chat-parts.tsx` and is rendered by `src/app/[lang]/messages/[id]/page.tsx`: it fires on `onMouseDown` + `preventDefault`, never `onPointerDown`. The full invariant is in `src/app/[lang]/messages/CLAUDE.md`; `chat-send-button.test.tsx` pins it.
