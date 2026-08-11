# Third-party artwork notice — `public/icons/`

Every SVG under `public/icons/rest/` and `public/icons/selected/` is derived from the **Solar**
icon set.

| | |
|---|---|
| Set | Solar |
| Author | 480 Design |
| Source | <https://www.figma.com/community/file/1166831539721848736> |
| Distributed as | Iconify `@iconify-json/solar` |
| Licence | **CC BY 4.0** (`CC-BY-4.0`) |
| Licence text | <https://creativecommons.org/licenses/by/4.0/> |

## Provenance

The set JSON these files were derived from is deliberately **not** committed — it is ~6 MB against
the ~40 KB it produces — so the block below is the record of which bytes were used. It is
**rewritten by the generator on every run**, so it cannot drift from the artwork: regenerating from
a different Solar release changes these lines in the same commit as the SVGs.

<!-- provenance:begin -->
<!-- ⚠️ WRITTEN BY scripts/gen-category-icons.mjs ON EVERY RUN — edit the generator, not this. -->

```
set          Solar — CC BY 4.0 (CC-BY-4.0)
author       480 Design
licence      https://creativecommons.org/licenses/by/4.0/
icons        7627 in file (info.total 7476)
sha256       7a517b459acfd403c3c030893479890e7e07171a25cca0e249450ce277656b18
```
<!-- provenance:end -->

The generator's mapping table names the upstream icon behind every slug, so each file can be traced
back to one named glyph in that source.

## What the licence requires of us

CC BY 4.0 is permissive — it allows commercial use, redistribution and modification, including in a
closed-source product — in exchange for **attribution**. Specifically, when we share the material
(and shipping these files to a browser is sharing it) we must:

1. **Credit the creator** — 480 Design, named above.
2. **Link to the licence** — the URL above.
3. **State that changes were made**, and ideally what they were. See the next section.
4. **Not imply endorsement** by 480 Design of eno.vn, and
5. **Not add restrictions** — we may not apply legal terms or technical measures that stop anyone
   else doing what the licence permits with the original set.

There is no share-alike obligation: eno.vn's own code and design work around these glyphs stay
under whatever terms it chooses.

Points 1–3 may be satisfied "in any reasonable manner based on the medium, means, and context"
(§3(a)(2)), which expressly includes "providing a URI or hyperlink to a resource that includes the
required information". This document is that resource, and it is served alongside the artwork at
`/icons/NOTICE.md`.

## Changes we made

The files here are **not** the upstream glyphs verbatim. `scripts/gen-category-icons.mjs` derives
each one from the Solar `line-duotone` style and:

- **strips every `opacity` / `fill-opacity` / `stroke-opacity` attribute**, which is what makes the
  Line Duotone artwork monotone — the second tone in that style is encoded purely as opacity;
- emits `stroke="currentColor"` so the glyph takes the colour of the tile that renders it, rather
  than any colour Solar or we chose;
- for the `selected/` variant, draws the same paths **twice** in one 24×24 box — an unpainted body
  layer (`class="cat-art-body"`, for a stylesheet to tint) beneath the untouched ink line
  (`class="cat-art-ink"`);
- **omits one or two paths from that body layer** on two glyphs (`vehicles`, `community-events`),
  where filling an open stroke would close it into a shape the original does not draw;
- renames each file after the eno category slug it serves, so the Solar name survives only in the
  generator's mapping table.

The generator's table records the upstream name behind every slug, which is the honest record of
what was taken.

## Where this credit is maintained

This document is the credit for the Solar artwork, and it travels with it: it sits in the same
directory as the files it covers, it is served at the same origin, and the generator that produces
those files will not run without it. If eno.vn later publishes a combined licences or credits page,
this entry belongs there too.

The credit is deliberately **not** rendered beside an individual icon in the interface. A line of
attribution under a category tile tells a shopper nothing, and placing a creator's name inside a
commercial product's chrome risks implying the endorsement that point 4 above rules out.
