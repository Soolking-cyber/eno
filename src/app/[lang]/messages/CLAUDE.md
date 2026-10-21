# src/app/[lang]/messages/ — landmine file: `[id]/page.tsx`

Loads when working under `src/app/[lang]/messages/`; moved out of the root CLAUDE.md on 2026-10-18. A regression here is a P0.

`messages/[id]/page.tsx` deserves its own note, because the invariant here is easy to state backwards. **Text mode DOES have a tap-Send button** (the Zalo/FB pattern). The real rule is *why* it's safe: `ChatSendButton` (`src/components/marketplace/chat-parts.tsx`) fires on **`onMouseDown` + `preventDefault`, never `onPointerDown`** — that holds the composer's focus, so the tap can't blur the field, dismiss the keyboard, and shift the button out from under the finger. That focus-hold is the invariant; "no tap-Send" was an earlier workaround and is **obsolete** — don't let anyone "restore" it. Pinned by `src/components/marketplace/chat-send-button.test.tsx`.

Enter still sends (`enterKeyHint="send"`), and the Counter button must stay gated by `negotiable !== false` (a counter sends an offer; on a fixed-price listing the server 409s and docks the buyer's trust).
