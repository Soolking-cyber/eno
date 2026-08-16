# Animated emoji artwork

The 47 animations in this directory are **Google's Noto animated emoji**, released under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Provenance was verified rather than assumed: the source files name themselves by Unicode
codepoint in Noto's own convention — `emoji_u2764` (❤️), `emoji_u1F525` (🔥), `emoji_u1F601` (😁) —
which is how <https://googlefonts.github.io/noto-emoji-animation/> exports them. They reached this
repo repackaged as dotLottie archives (`"author":"LottieFiles"` in the archive manifest, LottieFiles
being the redistributor, not the author).

CC BY 4.0 permits commercial use and redistribution, including modified copies, and requires
attribution. This file is that attribution.

## What was modified

`scripts/import-emoji-pack.mjs` unzips each dotLottie archive and re-emits the animation JSON with
authoring metadata removed (`nm`, `mn`, `cl`, `ln`, `ix`, `cix`, `np`). No geometry, colour or
timing is altered — verified by rendering all 47 at four points in their timelines, at 24px and
96px, and diffing every number the renderer emitted: 47/47 byte-identical.

⚠️ Stripping `nm` also removes the embedded `emoji_u…` name, which is why the provenance evidence is
recorded here instead of living only inside the files.
