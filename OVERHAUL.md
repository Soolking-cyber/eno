# ENO Overhaul — Airbnb ↔ FINN

Simple, elegant marketplace UI: Airbnb's warmth/photography/motion + FINN's breadth/speed/trust.
On top of the existing flat single-canvas, one-accent (#0A66C2), faceted explorer, Leaflet map, 5-language engine.

Effort: S ≈ quick · M ≈ half-feature · L ≈ feature

- [x] **1. Design foundation** — type scale, spacing & elevation tokens · M
- [x] **2. Homepage** — search-first hero + curated horizontal rows · M
- [x] **3. Listing cards 2.0** — photo carousel + refined hierarchy · L
- [x] **4. Listing detail page** — gallery mosaic + sticky contact · L
- [x] **5. Smart search & suggestions** — category + area + keyword, instant results · M
- [x] **6. Trust layer** — ratings, reviews & seller profiles · M
- [x] **7. Persistent favorites / Saved** · M
- [x] **8. Motion & feedback system** — hover/zoom/heart/skeleton/transitions · S–M
- [x] **9. Mobile refinement** — bottom nav + sticky CTA (filter sheet deferred: facet pills wrap on mobile) · L
- [x] **10. Post-a-listing flow + footer/info pages** · M–L  ✅ OVERHAUL COMPLETE

## #1 — Design foundation (done)
- Soft neutral canvas `--background: #fafafa` (white surfaces gain depth, no boxes reintroduced).
- Elevation tokens: `--shadow-pop` (popovers), `--shadow-card` (hover lift), `--shadow-overlay` (modals)
  + utilities `.shadow-pop` `.shadow-overlay` `.lift`.
- Type scale tokens (`--text-display/title/section/body/small/caption`, 1.25 ratio, 15px base)
  + semantic classes `.h-display` `.h-title` `.h-section` `.eyebrow`. 8pt spacing rhythm documented.
- Applied: listing-card hover lift (image shadow) + title underline; homepage hero eyebrow,
  "Browse by Category" eyebrow, "Recommendations" `.h-section`; dialog uses `.shadow-overlay`.
- All tokens live at the top of `src/app/globals.css`.
