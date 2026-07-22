// Strip the markdown emphasis a model reaches for by habit.
//
// WHY. "AI Polish" writes into the post wizard's TEXTAREA, which is plain text — so a
// model that returns "**Like new** condition" hands the seller literal asterisks to look
// at and edit. (The PDP's formatter does render **bold**, so this was invisible until
// someone watched the composer: the copy looked fine published and looked broken while
// being written.) Owner, 2026-07-22: "make sure it writes professionally, no asterixes".
//
// Bullets are DELIBERATELY kept — "- " lines are what the prompt asks for and what
// listing-content.tsx turns into a real <ul>. Only the emphasis markers go, and a "* "
// bullet is normalised to "- " rather than mangled.
//
// A prompt rule alone would not do: models drift, and this runs on every polish.

/**
 * Remove markdown emphasis/heading/code markers, leaving the words.
 *
 * ⚠️ Single-asterisk emphasis is matched CONSERVATIVELY — it must be preceded by a space
 * or line start and followed by whitespace/punctuation/end. Listing text is full of
 * dimensions like "10*20*30cm", and a naive "match any pair of asterisks" rule turns
 * that into "102030".
 */
export function stripMarkdown(input: string): string {
  let s = input.replace(/\r\n?/g, '\n')

  // Bullets first, before any asterisk rule can eat the marker.
  s = s.replace(/^[ \t]*\*[ \t]+/gm, '- ')
  // "•" and "–" also show up from models; normalise to the one bullet the renderer knows.
  s = s.replace(/^[ \t]*[•‣▪–][ \t]+/gm, '- ')

  // Headings: keep the words, drop the hashes (a listing has no sections).
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')

  // Bold / bold-italic. Safe unconditionally: no real listing writes ** for anything else.
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1')
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  s = s.replace(/__([^_\n]+)__/g, '$1')

  // Single-asterisk italics, only when clearly wrapping words (see the warning above).
  s = s.replace(/(^|\s)\*([^*\n]{1,120}?)\*(?=[\s.,!?;:)]|$)/gm, '$1$2')

  // Inline code / fences — a marketplace description has no code in it.
  s = s.replace(/```[a-z]*\n?/gi, '').replace(/`([^`\n]+)`/g, '$1')

  // Markdown links: keep the label, drop the URL syntax. (The publish guard blocks URLs
  // in listings anyway, so a bare link here would only trip that check later.)
  s = s.replace(/\[([^\]\n]+)\]\((?:[^)\n]*)\)/g, '$1')

  // Tidy: trailing spaces, and 3+ blank lines collapsed to a paragraph break.
  s = s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')

  return s.trim()
}
