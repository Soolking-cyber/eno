/**
 * The safety-code alphabet — 256 emoji, one per byte value (design v3 §3.2 step 5; the maths is in ./sas.ts).
 *
 * Each call shows 4 of these: the first 4 bytes of the SAS hash, each byte an index into this list, so 4 emoji carry
 * exactly 32 bits and a man-in-the-middle gets one 1-in-4.3-billion guess per completed call. Emoji rather than digits
 * because eno's typical pair is an English-speaking expat and a Vietnamese seller who may share no language: the
 * pictures are compared on video or by pointing, and the EN + VI name under each one covers voice and screen readers.
 *
 * ⚠️ THE ORDER IS PROTOCOL. Index i IS byte value i. Reordering, inserting, deleting or swapping ANY entry changes the
 * code an updated phone shows while the other phone — an old tab or a Capacitor WebView that keeps last week's JS for
 * days — still shows the old one, so an honest call reads as interception. A change here therefore needs a new SAS tag
 * in ./sas.ts AND a CALL_PROTOCOL_VERSION bump (the server refuses mixed pairs). sas.test.ts pins a hash of the
 * sequence so an edit cannot slip through as a "small cleanup".
 *
 * ⚠️ THE NAMES ARE NOT HASHED, BUT BOTH PEOPLE READ THEM ALOUD. Rename rarely and never move a name to another entry:
 * an old and a new build would then say different words for the same picture.
 *
 * Every entry was checked against Unicode's own files (emoji-test.txt 18.0 and emoji-data.txt 18.0.0, fetched
 * 2026-10-21), not from memory — the version comment on each line comes from there:
 *   · one code point, fully qualified: + U+FE0F exactly when the base defaults to text presentation. Without the
 *     selector Android and Chrome draw ☀ ✈ ✂ as monochrome text glyphs — so it is written as a visible `\uFE0F`
 *     escape, never as an invisible character someone could "clean" out of the source;
 *   · Emoji 3.0 or older (Unicode 9, 2016). The design says ≤ 4.0, and that is the same set: Emoji 4.0 added only
 *     sequences plus three single code points (♀ ♂ ⚕, gender and medical signs, excluded anyway) — and 3.0 is what
 *     Android 7.0 (the app's minSdk 24) actually ships;
 *   · no people or hands (nothing that takes a skin tone: Emoji_Modifier_Base), no flags, no ZWJ sequences, and no
 *     emotion faces — 🤖 is the one costume face, kept because it reads as an object.
 *
 * What was left out on purpose, so nobody "completes" the list with it:
 *   · religion and belief (crosses, crescents, temples, prayer beads, zodiac, ☯, the atom — Unicode files it under
 *     religion), death (skull, coffin, urn, candle), alcohol, tobacco, drugs, weapons, the pig family (pork);
 *   · political symbols: maps and globes (borders and the East Sea are a flashpoint in VN — 🌏 went at the commit
 *     gate), 🍉 and 🌻 (protest and solidarity symbols), national landmarks; 🐵 (a racist taunt); and the crescent moon
 *     (with ⭐ it makes a star and crescent — 🌙 went at the gate; the round 🌕 stays) — a random code must never read
 *     as a message to the other person;
 *   · 🦉 (an owl is a death omen in Vietnamese folk belief, and "con cú" without its tone mark is a vulgar word) and
 *     💈 (the spinning pole outside "hớt tóc" shops is a known sign for sex work in Vietnam);
 *   · anything that reads as a verdict or a status: ✅ ❌ ⚠ 🚫, 🔒 🔓 (they mimic the call's own lock indicator),
 *     speaker, battery, microphone and camera icons (they mimic the call's own controls — 🎤 and 📷 were in the first
 *     draft and went at the commit gate, 2026-10-21), emotion faces, hearts and kisses (two strangers on a call);
 *   · money and police: 💵 💳 💰 and 🚓 👮 — "công an" impersonation is Vietnam's most common phone scam, and a code
 *     full of banknotes sits badly beside "eno never asks you for money";
 *   · visually confusable twins — one per cluster: 🐶 not 🐕, 🍎 not 🍏, ☕ not 🍵, 🎸 not 🎻, 📷 not 📸/🎥, 📺 not 📻,
 *     🍕 not 🧀, 🐑 not 🐐, 🐘 not 🦏, 🐉 not 🐊/🦎, 🐙 not 🦑, 🐠 not 🐟/🐡, 🐌 not 🐚, 🐅 (full body) not 🐯 (Android
 *     paints the tiger and cat faces the same orange), 🌴 not 🏝 (the island IS a palm on sand), no colour-only
 *     variants (books, hearts, circles, medals).
 *   · names one could mishear for another, read aloud on a bad line: no name is the whole-word start or end of another
 *     ("đồng hồ" / "đồng hồ cát", "train" / "bullet train", "sun" / "sun hat"), and no short rhyme pair (ship/sheep,
 *     bear/pear, mouse/house, cake/snake, bee/key, bat/cat, star/car) — both rules are tests in sas.test.ts, which is
 *     why some English names carry a word more than the picture needs ("lamb", "brown bear", "birthday cake");
 *   · 🔑 and 🛡 (with 🔒 they read as "secured" badges on a screen about encryption — they went at the commit gate).
 *     sas.test.ts keeps a list of these pairs, so a later addition of a twin fails the build.
 *
 * Vietnamese names avoid North/South splits where a neutral word exists (bắp ngô, cái ô, xe máy); dishes whose only
 * names are regional (spoon thìa/muỗng, peanuts lạc/đậu phộng, cucumber dưa chuột/dưa leo) are simply not in the list.
 * ⚠️ No two Vietnamese names may be the same text once tone marks drop (sas.review.test.ts). A pair that differs only
 * by tone is misheard on a bad line, and a font or TTS voice without Vietnamese flattens it. That is why the crane is
 * "cẩu tháp": "cần cẩu" beside the fishing rod's "cần câu" was exactly such a pair. 🚀 is "tàu vũ trụ", never "tên lửa"
 * (which also means a missile — weapons are out), and 📣 "loa phóng thanh", never the bare "loa" a call's speaker button
 * would be called.
 */

export interface SasEmoji {
  /** The emoji as rendered: one code point, plus U+FE0F when the base defaults to text presentation. */
  readonly char: string
  /** Short English name — lowercase, 1–3 words. */
  readonly en: string
  /** Natural Vietnamese name — lowercase, 1–3 words. */
  readonly vi: string
}

const e = (char: string, en: string, vi: string): SasEmoji => Object.freeze({ char, en, vi })

/** Index = byte value. Frozen, entries included: this table is protocol, not UI copy. */
export const SAS_EMOJI: readonly SasEmoji[] = Object.freeze([
  e('🐶', 'dog', 'con chó'), //   0 · U+1F436 dog face, E0.6
  e('🐱', 'cat', 'con mèo'), //   1 · U+1F431 cat face, E0.6
  e('🐭', 'mouse', 'con chuột'), //   2 · U+1F42D mouse face, E0.6
  e('🐮', 'cow', 'con bò'), //   3 · U+1F42E cow face, E0.6
  e('🐃', 'buffalo', 'con trâu'), //   4 · U+1F403 water buffalo, E1.0
  e('🐅', 'tiger', 'con hổ'), //   5 · U+1F405 tiger, E1.0
  e('🐰', 'rabbit', 'con thỏ'), //   6 · U+1F430 rabbit face, E0.6
  e('🐉', 'dragon', 'con rồng'), //   7 · U+1F409 dragon, E1.0
  e('🐍', 'snake', 'con rắn'), //   8 · U+1F40D snake, E0.6
  e('🐎', 'horse', 'con ngựa'), //   9 · U+1F40E horse, E0.6
  e('🦄', 'unicorn', 'kỳ lân'), //  10 · U+1F984 unicorn, E1.0
  e('🐑', 'lamb', 'con cừu'), //  11 · U+1F411 ewe, E0.6
  e('🐓', 'rooster', 'gà trống'), //  12 · U+1F413 rooster, E1.0
  e('🐧', 'penguin', 'chim cánh cụt'), //  13 · U+1F427 penguin, E0.6
  e('🥋', 'martial arts uniform', 'võ phục'), //  14 · U+1F94B martial arts uniform, E3.0
  e('🦆', 'duck', 'con vịt'), //  15 · U+1F986 duck, E3.0
  e('🦅', 'eagle', 'đại bàng'), //  16 · U+1F985 eagle, E3.0
  e('🐳', 'whale', 'cá voi xanh'), //  17 · U+1F433 spouting whale, E0.6
  e('🐬', 'dolphin', 'cá heo'), //  18 · U+1F42C dolphin, E0.6
  e('🦈', 'shark', 'cá mập'), //  19 · U+1F988 shark, E3.0
  e('🐠', 'fish', 'con cá'), //  20 · U+1F420 tropical fish, E0.6
  e('🐙', 'octopus', 'bạch tuộc'), //  21 · U+1F419 octopus, E0.6
  e('🦀', 'crab', 'con cua'), //  22 · U+1F980 crab, E1.0
  e('🦐', 'shrimp', 'con tôm'), //  23 · U+1F990 shrimp, E3.0
  e('🐌', 'snail', 'ốc sên'), //  24 · U+1F40C snail, E0.6
  e('🐛', 'caterpillar', 'con sâu'), //  25 · U+1F41B bug, E0.6
  e('🐜', 'little ant', 'con kiến'), //  26 · U+1F41C ant, E0.6
  e('🐝', 'bumblebee', 'con ong'), //  27 · U+1F41D honeybee, E0.6
  e('🐞', 'ladybug', 'bọ rùa'), //  28 · U+1F41E lady beetle, E0.6
  e('🦋', 'butterfly', 'bươm bướm'), //  29 · U+1F98B butterfly, E3.0
  e('🐢', 'turtle', 'con rùa'), //  30 · U+1F422 turtle, E0.6
  e('🐸', 'frog', 'con ếch'), //  31 · U+1F438 frog, E0.6
  e('🐘', 'elephant', 'con voi'), //  32 · U+1F418 elephant, E0.6
  e('🐪', 'camel', 'lạc đà'), //  33 · U+1F42A camel, E1.0
  e('🐻', 'brown bear', 'con gấu'), //  34 · U+1F43B bear, E0.6
  e('🐼', 'panda', 'gấu trúc'), //  35 · U+1F43C panda, E0.6
  e('🦁', 'lion', 'sư tử'), //  36 · U+1F981 lion, E1.0
  e('🦌', 'deer', 'con hươu'), //  37 · U+1F98C deer, E3.0
  e('🦇', 'fruit bat', 'con dơi'), //  38 · U+1F987 bat, E3.0
  e('🐿\uFE0F', 'squirrel', 'con sóc'), //  39 · U+1F43F U+FE0F chipmunk, E0.7
  e('🐾', 'paw prints', 'dấu chân thú'), //  40 · U+1F43E paw prints, E0.6
  e('🐦', 'bird', 'con chim'), //  41 · U+1F426 bird, E0.6
  e('🕸\uFE0F', 'spider web', 'mạng nhện'), //  42 · U+1F578 U+FE0F spider web, E0.7
  e('🌵', 'cactus', 'xương rồng'), //  43 · U+1F335 cactus, E0.6
  e('🌴', 'palm tree', 'cây dừa'), //  44 · U+1F334 palm tree, E0.6
  e('🌳', 'leafy tree', 'cây xanh'), //  45 · U+1F333 deciduous tree, E1.0
  e('🌲', 'pine tree', 'cây thông'), //  46 · U+1F332 evergreen tree, E1.0
  e('🌱', 'seedling', 'mầm cây'), //  47 · U+1F331 seedling, E0.6
  e('🍀', 'clover', 'cỏ bốn lá'), //  48 · U+1F340 four leaf clover, E0.6
  e('🍁', 'maple leaf', 'lá phong'), //  49 · U+1F341 maple leaf, E0.6
  e('🍄', 'mushroom', 'cây nấm'), //  50 · U+1F344 mushroom, E0.6
  e('🌾', 'rice plant', 'bông lúa'), //  51 · U+1F33E sheaf of rice, E0.6
  e('🌕', 'full moon', 'trăng tròn'), //  52 · U+1F315 full moon, E0.6
  e('🌹', 'rose', 'hoa hồng'), //  53 · U+1F339 rose, E0.6
  e('🌸', 'cherry blossom', 'hoa anh đào'), //  54 · U+1F338 cherry blossom, E0.6
  e('🌷', 'tulip', 'hoa tulip'), //  55 · U+1F337 tulip, E0.6
  e('💐', 'bouquet', 'bó hoa'), //  56 · U+1F490 bouquet, E0.6
  e('🌰', 'chestnut', 'hạt dẻ'), //  57 · U+1F330 chestnut, E0.6
  e('☀\uFE0F', 'sun', 'mặt trời'), //  58 · U+2600 U+FE0F sun, E0.6
  e('🌌', 'milky way', 'dải ngân hà'), //  59 · U+1F30C milky way, E0.6
  e('⭐', 'shining star', 'ngôi sao'), //  60 · U+2B50 star, E0.6
  e('☁\uFE0F', 'cloud', 'đám mây'), //  61 · U+2601 U+FE0F cloud, E0.6
  e('🌈', 'rainbow', 'cầu vồng'), //  62 · U+1F308 rainbow, E0.6
  e('⚡', 'lightning', 'tia sét'), //  63 · U+26A1 high voltage, E0.6
  e('❄\uFE0F', 'snowflake', 'bông tuyết'), //  64 · U+2744 U+FE0F snowflake, E0.6
  e('⛄', 'snowman', 'người tuyết'), //  65 · U+26C4 snowman without snow, E0.6
  e('🔥', 'flame', 'ngọn lửa'), //  66 · U+1F525 fire, E0.6
  e('💧', 'droplet', 'giọt nước'), //  67 · U+1F4A7 droplet, E0.6
  e('🌊', 'wave', 'sóng biển'), //  68 · U+1F30A water wave, E0.6
  e('☄\uFE0F', 'comet', 'sao chổi'), //  69 · U+2604 U+FE0F comet, E1.0
  e('🌋', 'volcano', 'núi lửa'), //  70 · U+1F30B volcano, E0.6
  e('⛰\uFE0F', 'mountain', 'ngọn núi'), //  71 · U+26F0 U+FE0F mountain, E0.7
  e('🛤\uFE0F', 'railway track', 'đường ray'), //  72 · U+1F6E4 U+FE0F railway track, E0.7
  e('⛳', 'golf', 'đánh gôn'), //  73 · U+26F3 flag in hole, E0.6
  e('☔', 'umbrella', 'cái ô'), //  74 · U+2614 umbrella with rain drops, E0.6
  e('🌪\uFE0F', 'tornado', 'lốc xoáy'), //  75 · U+1F32A U+FE0F tornado, E0.7
  e('🌡\uFE0F', 'thermometer', 'nhiệt kế'), //  76 · U+1F321 U+FE0F thermometer, E0.7
  e('🌉', 'bridge', 'cây cầu'), //  77 · U+1F309 bridge at night, E0.6
  e('🍇', 'grapes', 'chùm nho'), //  78 · U+1F347 grapes, E0.6
  e('🍊', 'orange', 'quả cam'), //  79 · U+1F34A tangerine, E0.6
  e('🍋', 'lemon', 'quả chanh'), //  80 · U+1F34B lemon, E1.0
  e('🍌', 'banana', 'quả chuối'), //  81 · U+1F34C banana, E0.6
  e('🍍', 'pineapple', 'quả dứa'), //  82 · U+1F34D pineapple, E0.6
  e('🍎', 'red apple', 'quả táo'), //  83 · U+1F34E red apple, E0.6
  e('🍐', 'pear', 'quả lê'), //  84 · U+1F350 pear, E1.0
  e('🍒', 'cherries', 'quả cherry'), //  85 · U+1F352 cherries, E0.6
  e('🍓', 'strawberry', 'dâu tây'), //  86 · U+1F353 strawberry, E0.6
  e('🥑', 'avocado', 'quả bơ'), //  87 · U+1F951 avocado, E3.0
  e('🥕', 'carrot', 'cà rốt'), //  88 · U+1F955 carrot, E3.0
  e('🌽', 'corn cob', 'bắp ngô'), //  89 · U+1F33D ear of corn, E0.6
  e('🌶\uFE0F', 'chili', 'quả ớt'), //  90 · U+1F336 U+FE0F hot pepper, E0.7
  e('🥐', 'croissant', 'bánh sừng bò'), //  91 · U+1F950 croissant, E3.0
  e('🥖', 'baguette', 'bánh mì'), //  92 · U+1F956 baguette bread, E3.0
  e('🥞', 'pancakes', 'bánh kếp'), //  93 · U+1F95E pancakes, E3.0
  e('🍗', 'drumstick', 'đùi gà'), //  94 · U+1F357 poultry leg, E0.6
  e('🍔', 'hamburger', 'hamburger'), //  95 · U+1F354 hamburger, E0.6
  e('🍟', 'fries', 'khoai tây chiên'), //  96 · U+1F35F french fries, E0.6
  e('🍕', 'pizza', 'pizza'), //  97 · U+1F355 pizza, E0.6
  e('🥚', 'egg', 'quả trứng'), //  98 · U+1F95A egg, E3.0
  e('🍿', 'popcorn', 'bắp rang bơ'), //  99 · U+1F37F popcorn, E1.0
  e('🍲', 'hot pot', 'nồi lẩu'), // 100 · U+1F372 pot of food, E0.6
  e('🥗', 'salad', 'rau trộn'), // 101 · U+1F957 green salad, E3.0
  e('🍱', 'lunch box', 'cơm hộp'), // 102 · U+1F371 bento box, E0.6
  e('🍚', 'bowl of rice', 'cơm trắng'), // 103 · U+1F35A cooked rice, E0.6
  e('🍙', 'rice ball', 'cơm nắm'), // 104 · U+1F359 rice ball, E0.6
  e('🍜', 'noodle soup', 'phở'), // 105 · U+1F35C steaming bowl, E0.6
  e('🍝', 'spaghetti', 'mì spaghetti'), // 106 · U+1F35D spaghetti, E0.6
  e('🍠', 'sweet potato', 'khoai lang'), // 107 · U+1F360 roasted sweet potato, E0.6
  e('🍢', 'skewer', 'xiên que'), // 108 · U+1F362 oden, E0.6
  e('🍣', 'sushi', 'sushi'), // 109 · U+1F363 sushi, E0.6
  e('🍦', 'ice cream', 'kem ốc quế'), // 110 · U+1F366 soft ice cream, E0.6
  e('🍩', 'doughnut', 'bánh donut'), // 111 · U+1F369 doughnut, E0.6
  e('🍪', 'cookie', 'bánh quy'), // 112 · U+1F36A cookie, E0.6
  e('🎂', 'birthday cake', 'bánh sinh nhật'), // 113 · U+1F382 birthday cake, E0.6
  e('🍫', 'chocolate', 'sô cô la'), // 114 · U+1F36B chocolate bar, E0.6
  e('🍭', 'lollipop', 'kẹo mút'), // 115 · U+1F36D lollipop, E0.6
  e('🍬', 'candy', 'viên kẹo'), // 116 · U+1F36C candy, E0.6
  e('🍮', 'flan', 'bánh flan'), // 117 · U+1F36E custard, E0.6
  e('🍯', 'honey', 'mật ong'), // 118 · U+1F36F honey pot, E0.6
  e('🍼', 'baby bottle', 'bình sữa'), // 119 · U+1F37C baby bottle, E1.0
  e('☕', 'coffee', 'cà phê'), // 120 · U+2615 hot beverage, E0.6
  e('🏺', 'vase', 'bình gốm'), // 121 · U+1F3FA amphora, E1.0
  e('🚲', 'bicycle', 'xe đạp'), // 122 · U+1F6B2 bicycle, E0.6
  e('🛵', 'scooter', 'xe máy'), // 123 · U+1F6F5 motor scooter, E3.0
  e('🚗', 'family car', 'ô tô'), // 124 · U+1F697 automobile, E0.6
  e('🚌', 'bus', 'xe buýt'), // 125 · U+1F68C bus, E0.6
  e('🚑', 'ambulance', 'xe cứu thương'), // 126 · U+1F691 ambulance, E0.6
  e('🚒', 'fire engine', 'xe cứu hỏa'), // 127 · U+1F692 fire engine, E0.6
  e('🚜', 'tractor', 'máy cày'), // 128 · U+1F69C tractor, E1.0
  e('🚂', 'steam train', 'tàu hỏa'), // 129 · U+1F682 locomotive, E1.0
  e('🚄', 'bullet train', 'tàu cao tốc'), // 130 · U+1F684 high-speed train, E0.6
  e('🚁', 'helicopter', 'trực thăng'), // 131 · U+1F681 helicopter, E1.0
  e('✈\uFE0F', 'airplane', 'máy bay'), // 132 · U+2708 U+FE0F airplane, E0.6
  e('🚀', 'rocket', 'tàu vũ trụ'), // 133 · U+1F680 rocket, E0.6
  e('🛰\uFE0F', 'satellite', 'vệ tinh'), // 134 · U+1F6F0 U+FE0F satellite, E0.7
  e('🚢', 'ship', 'tàu thủy'), // 135 · U+1F6A2 ship, E0.6
  e('⛵', 'sailboat', 'thuyền buồm'), // 136 · U+26F5 sailboat, E0.6
  e('🛶', 'canoe', 'chiếc xuồng'), // 137 · U+1F6F6 canoe, E3.0
  e('🚤', 'speedboat', 'ca nô'), // 138 · U+1F6A4 speedboat, E0.6
  e('⚓', 'anchor', 'mỏ neo'), // 139 · U+2693 anchor, E0.6
  e('🚦', 'traffic light', 'đèn giao thông'), // 140 · U+1F6A6 vertical traffic light, E1.0
  e('⛽', 'fuel pump', 'cây xăng'), // 141 · U+26FD fuel pump, E0.6
  e('🚠', 'cable car', 'cáp treo'), // 142 · U+1F6A0 mountain cableway, E1.0
  e('🏠', 'home', 'ngôi nhà'), // 143 · U+1F3E0 house, E0.6
  e('🏢', 'office building', 'tòa nhà'), // 144 · U+1F3E2 office building, E0.6
  e('🏫', 'school', 'trường học'), // 145 · U+1F3EB school, E0.6
  e('🏭', 'factory', 'nhà máy'), // 146 · U+1F3ED factory, E0.6
  e('🏰', 'castle', 'lâu đài'), // 147 · U+1F3F0 castle, E0.6
  e('🏗\uFE0F', 'crane', 'cẩu tháp'), // 148 · U+1F3D7 U+FE0F building construction, E0.7
  e('⛺', 'tent', 'cái lều'), // 149 · U+26FA tent, E0.6
  e('🎪', 'circus', 'rạp xiếc'), // 150 · U+1F3AA circus tent, E0.6
  e('⛲', 'fountain', 'đài phun nước'), // 151 · U+26F2 fountain, E0.6
  e('🎡', 'ferris wheel', 'vòng đu quay'), // 152 · U+1F3A1 ferris wheel, E0.6
  e('🎢', 'roller coaster', 'tàu lượn'), // 153 · U+1F3A2 roller coaster, E0.6
  e('🏟\uFE0F', 'stadium', 'sân vận động'), // 154 · U+1F3DF U+FE0F stadium, E0.7
  e('💺', 'seat', 'ghế ngồi'), // 155 · U+1F4BA seat, E0.6
  e('🎆', 'fireworks', 'pháo hoa'), // 156 · U+1F386 fireworks, E0.6
  e('⌛', 'hourglass', 'đồng hồ cát'), // 157 · U+231B hourglass done, E0.6
  e('⏰', 'alarm clock', 'báo thức'), // 158 · U+23F0 alarm clock, E0.6
  e('🎁', 'gift', 'hộp quà'), // 159 · U+1F381 wrapped gift, E0.6
  e('🎀', 'ribbon', 'cái nơ'), // 160 · U+1F380 ribbon, E0.6
  e('🎉', 'party popper', 'pháo giấy'), // 161 · U+1F389 party popper, E0.6
  e('🎫', 'ticket', 'tấm vé'), // 162 · U+1F3AB ticket, E0.6
  e('🏆', 'trophy', 'chiếc cúp'), // 163 · U+1F3C6 trophy, E0.6
  e('🏅', 'medal', 'huy chương'), // 164 · U+1F3C5 sports medal, E1.0
  e('⚽', 'soccer ball', 'quả bóng đá'), // 165 · U+26BD soccer ball, E0.6
  e('🏈', 'american football', 'bóng bầu dục'), // 166 · U+1F3C8 american football, E0.6
  e('🏀', 'basketball', 'bóng rổ'), // 167 · U+1F3C0 basketball, E0.6
  e('🎾', 'tennis ball', 'bóng tennis'), // 168 · U+1F3BE tennis, E0.6
  e('⚾', 'baseball', 'bóng chày'), // 169 · U+26BE baseball, E0.6
  e('🎱', 'pool ball', 'bi-a'), // 170 · U+1F3B1 pool 8 ball, E0.6
  e('🏓', 'ping pong', 'bóng bàn'), // 171 · U+1F3D3 ping pong, E1.0
  e('🏸', 'badminton', 'cầu lông'), // 172 · U+1F3F8 badminton, E1.0
  e('🎳', 'bowling', 'bowling'), // 173 · U+1F3B3 bowling, E0.6
  e('🏒', 'ice hockey', 'khúc côn cầu'), // 174 · U+1F3D2 ice hockey, E1.0
  e('🎿', 'skis', 'ván trượt tuyết'), // 175 · U+1F3BF skis, E0.6
  e('⛸\uFE0F', 'ice skate', 'giày trượt băng'), // 176 · U+26F8 U+FE0F ice skate, E0.7
  e('🎣', 'fishing rod', 'cần câu'), // 177 · U+1F3A3 fishing pole, E0.6
  e('🥊', 'boxing glove', 'găng đấm bốc'), // 178 · U+1F94A boxing glove, E3.0
  e('🥅', 'goal', 'khung thành'), // 179 · U+1F945 goal net, E3.0
  e('🎯', 'dartboard', 'bảng phi tiêu'), // 180 · U+1F3AF bullseye, E0.6
  e('🎮', 'game controller', 'tay cầm game'), // 181 · U+1F3AE video game, E0.6
  e('🕹\uFE0F', 'joystick', 'cần điều khiển'), // 182 · U+1F579 U+FE0F joystick, E0.7
  e('🎨', 'palette', 'bảng màu'), // 183 · U+1F3A8 artist palette, E0.6
  e('🎭', 'theater masks', 'mặt nạ'), // 184 · U+1F3AD performing arts, E0.6
  e('🖼\uFE0F', 'picture', 'bức tranh'), // 185 · U+1F5BC U+FE0F framed picture, E0.7
  e('👓', 'glasses', 'kính mắt'), // 186 · U+1F453 glasses, E0.6
  e('👔', 'necktie', 'cà vạt'), // 187 · U+1F454 necktie, E0.6
  e('👕', 't-shirt', 'áo thun'), // 188 · U+1F455 t-shirt, E0.6
  e('👖', 'jeans', 'quần jean'), // 189 · U+1F456 jeans, E0.6
  e('👗', 'dress', 'chiếc váy'), // 190 · U+1F457 dress, E0.6
  e('👜', 'handbag', 'túi xách'), // 191 · U+1F45C handbag, E0.6
  e('💼', 'briefcase', 'cặp tài liệu'), // 192 · U+1F4BC briefcase, E0.6
  e('🎒', 'backpack', 'ba lô'), // 193 · U+1F392 backpack, E0.6
  e('👟', 'sneaker', 'giày thể thao'), // 194 · U+1F45F running shoe, E0.6
  e('👞', 'leather shoe', 'giày da'), // 195 · U+1F45E man’s shoe, E0.6
  e('👠', 'high heel', 'giày cao gót'), // 196 · U+1F460 high-heeled shoe, E0.6
  e('👑', 'crown', 'vương miện'), // 197 · U+1F451 crown, E0.6
  e('👒', 'straw hat', 'mũ rộng vành'), // 198 · U+1F452 woman’s hat, E0.6
  e('🎩', 'top hat', 'mũ chóp cao'), // 199 · U+1F3A9 top hat, E0.6
  e('🎓', 'graduation cap', 'mũ tốt nghiệp'), // 200 · U+1F393 graduation cap, E0.6
  e('💄', 'lipstick', 'son môi'), // 201 · U+1F484 lipstick, E0.6
  e('💎', 'diamond', 'kim cương'), // 202 · U+1F48E gem stone, E0.6
  e('🔔', 'bell', 'cái chuông'), // 203 · U+1F514 bell, E0.6
  e('📣', 'megaphone', 'loa phóng thanh'), // 204 · U+1F4E3 megaphone, E0.6
  e('🎵', 'music note', 'nốt nhạc'), // 205 · U+1F3B5 musical note, E0.6
  e('🔗', 'chain link', 'mắt xích'), // 206 · U+1F517 link, E0.6
  e('🎧', 'headphones', 'tai nghe'), // 207 · U+1F3A7 headphone, E0.6
  e('🎺', 'trumpet', 'kèn trumpet'), // 208 · U+1F3BA trumpet, E0.6
  e('🎸', 'guitar', 'đàn ghi-ta'), // 209 · U+1F3B8 guitar, E0.6
  e('🎹', 'piano', 'đàn piano'), // 210 · U+1F3B9 musical keyboard, E0.6
  e('🥁', 'drum', 'cái trống'), // 211 · U+1F941 drum, E3.0
  e('📱', 'smartphone', 'điện thoại'), // 212 · U+1F4F1 mobile phone, E0.6
  e('💻', 'laptop', 'máy tính'), // 213 · U+1F4BB laptop, E0.6
  e('🖨\uFE0F', 'printer', 'máy in'), // 214 · U+1F5A8 U+FE0F printer, E0.7
  e('🌮', 'taco', 'bánh taco'), // 215 · U+1F32E taco, E1.0
  e('📺', 'television', 'ti vi'), // 216 · U+1F4FA television, E0.6
  e('📼', 'video tape', 'băng video'), // 217 · U+1F4FC videocassette, E0.6
  e('💿', 'compact disc', 'đĩa cd'), // 218 · U+1F4BF optical disk, E0.6
  e('🎞\uFE0F', 'film strip', 'cuộn phim'), // 219 · U+1F39E U+FE0F film frames, E0.7
  e('📡', 'antenna', 'ăng-ten chảo'), // 220 · U+1F4E1 satellite antenna, E0.6
  e('🔦', 'flashlight', 'đèn pin'), // 221 · U+1F526 flashlight, E0.6
  e('💡', 'light bulb', 'bóng đèn'), // 222 · U+1F4A1 light bulb, E0.6
  e('🏮', 'lantern', 'đèn lồng'), // 223 · U+1F3EE red paper lantern, E0.6
  e('📚', 'books', 'chồng sách'), // 224 · U+1F4DA books, E0.6
  e('📰', 'newspaper', 'tờ báo'), // 225 · U+1F4F0 newspaper, E0.6
  e('🏷\uFE0F', 'tag', 'nhãn mác'), // 226 · U+1F3F7 U+FE0F label, E0.7
  e('📦', 'parcel', 'thùng hàng'), // 227 · U+1F4E6 package, E0.6
  e('📮', 'postbox', 'hòm thư'), // 228 · U+1F4EE postbox, E0.6
  e('✏\uFE0F', 'pencil', 'bút chì'), // 229 · U+270F U+FE0F pencil, E0.6
  e('📁', 'folder', 'thư mục'), // 230 · U+1F4C1 file folder, E0.6
  e('📅', 'calendar', 'tờ lịch'), // 231 · U+1F4C5 calendar, E0.6
  e('📌', 'pushpin', 'đinh ghim'), // 232 · U+1F4CC pushpin, E0.6
  e('📎', 'paperclip', 'kẹp giấy'), // 233 · U+1F4CE paperclip, E0.6
  e('📏', 'ruler', 'thước kẻ'), // 234 · U+1F4CF straight ruler, E0.6
  e('✂\uFE0F', 'scissors', 'cái kéo'), // 235 · U+2702 U+FE0F scissors, E0.6
  e('🗄\uFE0F', 'file cabinet', 'tủ hồ sơ'), // 236 · U+1F5C4 U+FE0F file cabinet, E0.7
  e('🗑\uFE0F', 'trash can', 'thùng rác'), // 237 · U+1F5D1 U+FE0F wastebasket, E0.7
  e('🗒\uFE0F', 'notepad', 'sổ tay'), // 238 · U+1F5D2 U+FE0F spiral notepad, E0.7
  e('🔨', 'hammer', 'cái búa'), // 239 · U+1F528 hammer, E0.6
  e('🔧', 'wrench', 'cờ lê'), // 240 · U+1F527 wrench, E0.6
  e('🔩', 'bolt', 'bu lông'), // 241 · U+1F529 nut and bolt, E0.6
  e('⚙\uFE0F', 'cogwheel', 'bánh răng'), // 242 · U+2699 U+FE0F gear, E1.0
  e('⚖\uFE0F', 'scales', 'cái cân'), // 243 · U+2696 U+FE0F balance scale, E1.0
  e('🛢\uFE0F', 'oil barrel', 'thùng dầu'), // 244 · U+1F6E2 U+FE0F oil drum, E0.7
  e('⚗\uFE0F', 'flask', 'bình thí nghiệm'), // 245 · U+2697 U+FE0F alembic, E1.0
  e('🔬', 'microscope', 'kính hiển vi'), // 246 · U+1F52C microscope, E1.0
  e('🔭', 'telescope', 'kính thiên văn'), // 247 · U+1F52D telescope, E1.0
  e('🚪', 'door', 'cánh cửa'), // 248 · U+1F6AA door, E0.6
  e('🛏\uFE0F', 'bed', 'cái giường'), // 249 · U+1F6CF U+FE0F bed, E0.7
  e('🚿', 'shower', 'vòi sen'), // 250 · U+1F6BF shower, E1.0
  e('🛁', 'bathtub', 'bồn tắm'), // 251 · U+1F6C1 bathtub, E1.0
  e('🛒', 'shopping cart', 'xe đẩy hàng'), // 252 · U+1F6D2 shopping cart, E3.0
  e('🔌', 'plug', 'phích cắm'), // 253 · U+1F50C electric plug, E0.6
  e('🤖', 'robot', 'người máy'), // 254 · U+1F916 robot, E1.0
  e('♻\uFE0F', 'recycling', 'tái chế'), // 255 · U+267B U+FE0F recycling symbol, E0.6
])
