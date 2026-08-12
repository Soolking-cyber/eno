# Icon attribution

The SVGs under `public/icons/` are GENERATED — do not hand-edit them, run `npm run icons`.

## Credit

**[Solar Icons](https://solar-icons.vercel.app/)** by **480 Design**, licensed
**CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
Obtained through the `@solar-icons/static` package (version 2.0.0), whose packaging
code is MIT. The icon artwork itself is CC BY 4.0 and that is the licence these files carry.

## Changes made

These files are **modified** copies of the originals. `scripts/gen-icons.mjs` renames each
glyph to an app-facing name, removes Solar's own `class="solar solar-<name>-<style>"` and the
inert root `stroke-width`, and collapses whitespace between elements. No geometry and no colour
is altered — every path keeps its original `d` and its `fill="currentColor"`.

## What is used

Two of Solar's six styles, carrying the app's idle/active grammar:

| directory | Solar style | used for |
|---|---|---|
| `rest/` | Outline | a category tile at rest |
| `selected/` | Bold | a category tile selected |
| `ui/rest/` | Outline | a UI control at rest |
| `ui/selected/` | Bold | a UI control active |

Every file paints with `currentColor` and carries no baked colour, so the ink follows the
element's own colour in both themes. `scripts/gen-icons.mjs` holds the name mapping and the
reasoning behind each choice.

<!-- provenance:begin -->
    source   @solar-icons/static@2.0.0
    styles   outline, bold
    glyphs   17 category tiles + 40 UI glyphs
    sha256   0ede5a92075bf04bd2801984d52369acfb1de6a69aa08c47ded99de5529228a5
<!-- provenance:end -->
