# eno's guide — the voice concierge's face

`eno-guide-v1.bin` (a binary glTF) and `eno-guide-face-v1.webp` are drawn by the concierge window
(src/components/concierge/talking-guide.ts, src/lib/concierge/guide-assets.ts).

## The avatar — CC0 1.0

Made from TalkingHead's example avatar `avatars/mpfb.glb`
(https://github.com/met4citizen/TalkingHead, commit 6318ff8c798e4a661fcd70c9373c4ab789c822bb), which its README states was
created with Blender and MPFB (MakeHuman) and is licensed **CC0**. Every part is a MakeHuman system asset or a CC0 MakeHuman
community asset (body, eyes, teeth, tongue, ponytail hair, the casual suit and its textures, skin, Mindfront eyebrows and
eyelashes): https://static.makehumancommunity.org/assets/assetpacks.html. No attribution is required; it is given anyway.

### Changes made by eno (2026-10-28)
- The shirt is recoloured to eno's blue, its stripes and the MakeHuman chest logo are removed, and eno's "e" mark is painted
  on the left chest.
- A `viseme_sil` blend shape (empty) is added; textures are 1024 px WebP (teeth and tongue 512 px); geometry is Meshopt
  compressed; morph normals are dropped.
- The tools that made these changes and the part-by-part licence check are kept in eno's build notes.

## The code that draws it — MIT

- **TalkingHead** 1.8.2 — Copyright (c) 2023-2024 Mika Suominen — https://github.com/met4citizen/TalkingHead
- **HeadAudio** 1.0.0 (`/headaudio/headworklet-1.0.0.js` and `/headaudio/model-en-mixed-1.0.0.bin` are its files) —
  Copyright (c) 2025 Mika Suominen — https://github.com/met4citizen/HeadAudio
- **three.js** 0.186.1 — Copyright © 2010-2026 three.js authors — https://github.com/mrdoob/three.js

Each is distributed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
> files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
> modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
> Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
> WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
> ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
