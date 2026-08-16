/**
 * THE CHAT REACTION CATALOGUE — the closed set of emoji anyone may attach to a message.
 *
 * ⛔ THIS IS AN ALLOW-LIST, AND EVERY WRITE PATH MUST CHECK IT. `MessageReaction.emoji` is
 * user-supplied text on a shared table that both participants render, so an unchecked column is a
 * place to store arbitrary strings — a ZWJ bomb that breaks the thread's layout, or simply text
 * that is not an emoji at all — in a surface the other person cannot refuse. `isReactionEmoji()`
 * is the only gate; call it on the server, not merely in the picker.
 *
 * ⚠️ THE KEY IS THE UNICODE SEQUENCE, NOT A NAME. The database stores "❤️", so a reaction keeps
 * working if the artwork is renamed, retimed or dropped entirely: the animation is a presentation
 * layer over a character that already stands on its own. It also means the global tally is a plain
 * GROUP BY with nothing to join, and that a client with no Lottie support still renders every
 * reaction correctly through the system emoji font.
 *
 * ⚠️ `lottie` IS A SLUG, NOT A PATH. The files ship as /emoji/<slug>.json; building the URL in
 * one place (see reactionAnimationUrl) keeps the fetch, the preload hint and the cache key from
 * drifting apart.
 *
 * ⛔ THE ARTWORK IS PLAIN LOTTIE JSON, NOT THE .lottie ARCHIVE THE PACK SHIPS, and that choice was
 * measured rather than assumed. A .lottie is a ZIP, so playing one in a browser costs either a WASM
 * dotLottie runtime (~150KB of wasm before the first emoji appears) or a JS unzip on the critical
 * path. scripts/import-emoji-pack.mjs unzips once, offline, and commits the animation JSON instead.
 * The raw directory is 2.6MB, which sounds worse and is not: it compresses to 249KB brotli, and a
 * real session only ever fetches the handful of emoji it actually shows — the whole default bar is
 * 36KB gzipped, and ❤️ by itself is 1KB. Uncompressed bytes at rest are not the number that matters;
 * transferred bytes are.
 */

export type ReactionEmoji = {
  /** The stored value. Everything keys off this. */
  emoji: string
  /** Basename of the dotLottie file in public/emoji, without extension. */
  lottie: string
  /** Accessible name, English. */
  label: string
  /** Accessible name, Vietnamese. */
  labelVi: string
}

/**
 * All 47 animations in the pack, in picker order — reactions people actually reach for first,
 * then faces, then hands, then the long tail. Order here IS the order of the "all emoji" grid.
 */
export const REACTIONS: ReactionEmoji[] = [
  // ── The common six, first because the picker opens on them ──
  { emoji: '❤️', lottie: 'heart', label: 'Love', labelVi: 'Yêu thích' },
  { emoji: '👍', lottie: 'thumbs-up', label: 'Like', labelVi: 'Thích' },
  { emoji: '😂', lottie: 'joyful', label: 'Haha', labelVi: 'Haha' },
  { emoji: '🤯', lottie: 'mind-blown', label: 'Wow', labelVi: 'Wow' },
  { emoji: '😭', lottie: 'crying-loudly', label: 'Sad', labelVi: 'Buồn' },
  { emoji: '😠', lottie: 'angry', label: 'Angry', labelVi: 'Tức giận' },
  // ── Faces ──
  { emoji: '😍', lottie: 'heart-eyes', label: 'Heart eyes', labelVi: 'Mắt trái tim' },
  { emoji: '🥰', lottie: 'heart-face', label: 'Adoring', labelVi: 'Đáng yêu' },
  { emoji: '🤣', lottie: 'rofl', label: 'Rolling on the floor', labelVi: 'Cười lăn lộn' },
  { emoji: '🥳', lottie: 'party', label: 'Party', labelVi: 'Tiệc tùng' },
  { emoji: '🤩', lottie: 'starstruck', label: 'Starstruck', labelVi: 'Ngưỡng mộ' },
  { emoji: '🥺', lottie: 'please', label: 'Pleading', labelVi: 'Năn nỉ' },
  { emoji: '🥹', lottie: 'holding-back-tears', label: 'Holding back tears', labelVi: 'Cố nín khóc' },
  { emoji: '😅', lottie: 'grin-sweat', label: 'Nervous laugh', labelVi: 'Cười gượng' },
  { emoji: '😊', lottie: 'smile', label: 'Smile', labelVi: 'Mỉm cười' },
  { emoji: '😃', lottie: 'big-smile', label: 'Big smile', labelVi: 'Cười tươi' },
  { emoji: '😁', lottie: 'grin', label: 'Grin', labelVi: 'Nhe răng cười' },
  { emoji: '😀', lottie: 'grinning', label: 'Grinning', labelVi: 'Cười' },
  { emoji: '😉', lottie: 'wink', label: 'Wink', labelVi: 'Nháy mắt' },
  { emoji: '😋', lottie: 'yummy', label: 'Yummy', labelVi: 'Ngon' },
  { emoji: '😛', lottie: 'tongue', label: 'Tongue out', labelVi: 'Lè lưỡi' },
  { emoji: '😝', lottie: 'squinting-tongue', label: 'Squinting tongue', labelVi: 'Nhắm mắt lè lưỡi' },
  { emoji: '🤪', lottie: 'zany-tongue', label: 'Zany', labelVi: 'Điên rồ' },
  { emoji: '😘', lottie: 'kiss-heart', label: 'Blowing a kiss', labelVi: 'Hôn gió' },
  { emoji: '😗', lottie: 'kissy-face', label: 'Kiss', labelVi: 'Hôn' },
  { emoji: '😇', lottie: 'halo', label: 'Innocent', labelVi: 'Thiên thần' },
  { emoji: '😬', lottie: 'grimacing', label: 'Grimacing', labelVi: 'Nhăn mặt' },
  { emoji: '😟', lottie: 'concerned', label: 'Concerned', labelVi: 'Lo lắng' },
  { emoji: '😔', lottie: 'pensive', label: 'Pensive', labelVi: 'Trầm ngâm' },
  { emoji: '😤', lottie: 'triumph', label: 'Triumph', labelVi: 'Hừ' },
  { emoji: '🫠', lottie: 'melting', label: 'Melting', labelVi: 'Tan chảy' },
  { emoji: '🙈', lottie: 'see-no-evil', label: 'See no evil', labelVi: 'Không nhìn' },
  { emoji: '🙉', lottie: 'hear-no-evil', label: 'Hear no evil', labelVi: 'Không nghe' },
  { emoji: '🙊', lottie: 'say-no-evil', label: 'Speak no evil', labelVi: 'Không nói' },
  // ── Hands and gestures ──
  { emoji: '👏', lottie: 'clap', label: 'Clap', labelVi: 'Vỗ tay' },
  { emoji: '🙌', lottie: 'raise-hands', label: 'Raising hands', labelVi: 'Giơ tay' },
  { emoji: '👋', lottie: 'wave', label: 'Wave', labelVi: 'Vẫy tay' },
  { emoji: '💪', lottie: 'muscle', label: 'Strong', labelVi: 'Mạnh mẽ' },
  { emoji: '✌️', lottie: 'victory', label: 'Victory', labelVi: 'Chiến thắng' },
  { emoji: '🤞', lottie: 'crossed-fingers', label: 'Fingers crossed', labelVi: 'Chúc may mắn' },
  { emoji: '☝️', lottie: 'index-finger', label: 'Point up', labelVi: 'Chỉ lên' },
  // ── Objects and creatures ──
  { emoji: '🔥', lottie: 'fire', label: 'Fire', labelVi: 'Cháy' },
  { emoji: '💯', lottie: '100-emoji', label: 'Hundred', labelVi: 'Tuyệt đối' },
  { emoji: '👀', lottie: 'eyes', label: 'Eyes', labelVi: 'Đang xem' },
  { emoji: '☀️', lottie: 'sun-emoji', label: 'Sun', labelVi: 'Nắng' },
  { emoji: '🐙', lottie: 'octopus', label: 'Octopus', labelVi: 'Bạch tuộc' },
  { emoji: '🐢', lottie: 'turtle', label: 'Turtle', labelVi: 'Rùa' },
]

/** O(1) lookup by stored value. */
const BY_EMOJI = new Map(REACTIONS.map((r) => [r.emoji, r]))

/**
 * ⛔ THE SERVER-SIDE GATE. Anything not in the catalogue is rejected on write; see the header for
 * why an open column is not acceptable here.
 */
export function isReactionEmoji(value: unknown): value is string {
  return typeof value === 'string' && BY_EMOJI.has(value)
}

export function reactionFor(emoji: string): ReactionEmoji | undefined {
  return BY_EMOJI.get(emoji)
}

/**
 * The one reaction shown without any interaction at all — owner: "by default only heart".
 * A single tap on it is the whole interaction for most people, so it must never require a hover.
 */
export const PRIMARY_REACTION = '❤️'

/**
 * ⚠️ THE FALLBACK BAR, USED UNTIL THE GLOBAL TALLY HAS ANYTHING TO SAY. The owner chose a top five
 * measured from real site-wide usage, which on day one is an empty table — ranking nothing produces
 * an empty bar, so the feature would ship broken and stay broken until it was already popular.
 * These five are the industry-standard set (the same six Zalo/Messenger show, minus one to fit),
 * every one of them backed by an animation in the pack. `topReactions()` prefers real counts the
 * moment there are any.
 *
 * ⚠️ EVERY ENTRY MUST EXIST IN `REACTIONS` — asserted by the unit test, because a typo here is a
 * bar with a hole in it that no type checker can see.
 */
export const DEFAULT_TOP_REACTIONS = ['❤️', '👍', '😂', '🤯', '😭'] as const

/** How many sit in the quick bar before the "more" button. */
export const TOP_REACTION_COUNT = 5

/**
 * Merge the measured global ranking with the fallback set.
 *
 * ⚠️ IT TOPS UP RATHER THAN REPLACES, so a tally with only two rows in it still yields five
 * buttons. A partially-populated bar is the normal state for weeks after launch, not an edge case.
 * ⚠️ Unknown emoji in the tally are dropped: the tally reads a table whose contents predate any
 * given deploy, so it can legitimately contain a value later removed from the catalogue.
 */
export function topReactions(measured: readonly string[] = []): string[] {
  const out: string[] = []
  for (const emoji of measured) {
    if (out.length >= TOP_REACTION_COUNT) break
    if (BY_EMOJI.has(emoji) && !out.includes(emoji)) out.push(emoji)
  }
  for (const emoji of DEFAULT_TOP_REACTIONS) {
    if (out.length >= TOP_REACTION_COUNT) break
    if (!out.includes(emoji)) out.push(emoji)
  }
  return out
}

/**
 * Where the animation lives. One definition so the fetch, the <link rel=preload> and the cache key
 * cannot drift.
 *
 * ⚠️ Returns null for an emoji with no artwork rather than a 404-bound URL — the caller renders the
 * Unicode glyph instead, which is the correct degraded state and needs no network at all.
 */
export function reactionAnimationUrl(emoji: string): string | null {
  const entry = BY_EMOJI.get(emoji)
  return entry ? `/emoji/${entry.lottie}.json` : null
}
