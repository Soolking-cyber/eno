/**
 * LUCIDE -> SOLAR v2, one row per icon the app actually imports.
 *
 * Owner, 2026-08-12: *"the task was replace all ui icons with solar v2 equivalent"* and, for the
 * gaps, *"if dont have icon pick the closest looking one"*.
 *
 * ⚠️ THE LEFT SIDE IS A LUCIDE COMPONENT NAME AND IT IS THE APP'S VOCABULARY. Call sites keep
 * writing <Search/>, <Trash2/>, <Loader2/>; only the import path changes, from 'lucide-react' to
 * '@/components/ui/icons'. That is what makes a 155-file swap reviewable: the diff is one line
 * per file, and every judgement call about WHICH glyph lives here, in one table.
 *
 * ⚠️ ROWS WHERE SOLAR HAS NO EQUIVALENT ARE THE ONES TO ARGUE WITH — they are marked below.
 * Solar is 1,246 icons against lucide's ~1,600, and the gaps are real: no car, no cookie, no dog,
 * no bird, no hammer, no tent, no fingerprint, no spinner. Each of those resolves to the nearest
 * mark that still reads correctly at 16-24px rather than to nothing.
 *
 * Regenerate the shim after editing: `npm run icons`.
 */
export const LUCIDE_TO_SOLAR = {
  AlertCircle: 'danger-circle',
  AlertTriangle: 'danger-triangle',
  Archive: 'archive-minimalistic',
  Armchair: 'armchair',
  ArrowBigUp: 'arrow-up',
  ArrowDown: 'arrow-down',
  ArrowLeft: 'arrow-left',
  ArrowLeftRight: 'transfer-horizontal',
  ArrowRight: 'arrow-right',
  ArrowUp: 'arrow-up',
  ArrowUpDown: 'sort-vertical',
  ArrowUpRight: 'arrow-right-up',
  AtSign: 'mention-circle',
  Award: 'medal-star',
  Baby: 'balloon',
  BadgeCheck: 'verified-check',
  Ban: 'forbidden-circle',
  Banknote: 'banknote-2',
  BedDouble: 'bed',
  BedSingle: 'bed',
  Bell: 'bell',
  BellOff: 'bell-off',
  BellRing: 'bell-ring',
  BicepsFlexed: 'dumbbell',
  Bike: 'bicycling',
  Bird: 'paw',
  Bone: 'bone',
  Bookmark: 'bookmark',
  BookmarkCheck: 'bookmark-circle',
  BookOpen: 'book-2',
  Bot: 'chat-round-line',
  Boxes: 'widget',
  Briefcase: 'case',
  BrushCleaning: 'broom',
  Building: 'buildings',
  Building2: 'buildings-2',
  BusFront: 'bus',
  Cable: 'usb',
  CalendarCheck: 'calendar-mark',
  CalendarDays: 'calendar',
  Camera: 'camera',
  Car: 'wheel-angle',
  CarFront: 'wheel-angle',
  Cat: 'cat',
  Check: 'check-circle',
  CheckCircle2: 'check-circle',
  ChevronDown: 'alt-arrow-down',
  ChevronLeft: 'alt-arrow-left',
  ChevronRight: 'alt-arrow-right',
  ChevronsUpDown: 'sort-vertical',
  ChevronUp: 'alt-arrow-up',
  CircleEllipsis: 'menu-dots-circle',
  CircleHelp: 'question-circle',
  ClipboardCheck: 'clipboard-check',
  ClipboardList: 'clipboard-list',
  Clock: 'clock-circle',
  Code: 'code',
  Coffee: 'cup-hot',
  Cog: 'settings',
  Coins: 'money-bag',
  Compass: 'compass',
  ConciergeBell: 'bell',
  Cookie: 'donut',
  CookingPot: 'chef-hat',
  Copy: 'copy',
  Copyright: 'copyright',
  CreditCard: 'card',
  Crop: 'crop',
  Dices: 'gamepad',
  Dog: 'paw',
  Download: 'download',
  Dumbbell: 'dumbbell',
  Ellipsis: 'menu-dots',
  ExternalLink: 'square-top-down',
  Eye: 'eye',
  EyeOff: 'eye-closed',
  FileCheck2: 'file-check',
  FileImage: 'gallery',
  FileText: 'document-text',
  Film: 'clapperboard-play',
  Filter: 'filter',
  Fingerprint: 'user-id',
  Flag: 'flag',
  Flower2: 'leaf',
  FolderOpen: 'folder-open',
  Footprints: 'walking',
  Gamepad2: 'gamepad',
  Gavel: 'scale',
  Gift: 'gift',
  Globe: 'global',
  GraduationCap: 'square-academic-cap',
  Guitar: 'music-note',
  Hammer: 'settings',
  HandHeart: 'hand-heart',
  Handshake: 'hand-shake',
  HardHat: 'case',
  Headphones: 'headphones-round',
  Headset: 'headphones-round',
  Heart: 'heart',
  HeartHandshake: 'hand-heart',
  HelpCircle: 'question-circle',
  // ⚠️ THE ONE ROW WHOSE LEFT SIDE IS NOT LUCIDE VOCABULARY, and the exception is deliberate.
  // This is the floating support control's mark, and it has moved twice in a day at the owner's
  // direction: question-circle -> question-square -> `dialog-2` (2026-08-26, *"use duotone front
  // one our gray back one our blue but 50% opacity"*). Lucide's name for two stacked speech
  // bubbles is MessagesSquare, which this file already spends on Solar's `chat-square-2` — so
  // reusing it would put two different drawings behind one name, which is worse than departing
  // from the convention once, in the open, for a mark that exists to mean "talk to support".
  // ⚠️ IT IS ALSO THE ONLY MEMBER OF `DUOTONE` in gen-icons.mjs: its resting weight comes from
  // Solar's bold-duotone, not outline. Renaming the SOLAR side here without updating that set
  // silently drops the duotone and the glyph goes back to a plain outline.
  SupportDialog: 'dialog-2',
  History: 'history',
  Home: 'home',
  Hotel: 'buildings-2',
  House: 'home',
  IdCard: 'card-2',
  ImageOff: 'gallery-remove',
  ImagePlus: 'gallery-add',
  Images: 'gallery',
  Inbox: 'inbox',
  Info: 'info-circle',
  Keyboard: 'keyboard',
  KeyRound: 'key',
  Lamp: 'lightbulb',
  LampDesk: 'lightbulb',
  Landmark: 'buildings',
  LandPlot: 'map',
  Languages: 'translation',
  Laptop: 'laptop',
  LayoutGrid: 'widget',
  Link2: 'link',
  ListChecks: 'checklist',
  Loader2: 'refresh',
  LocateFixed: 'gps',
  Lock: 'lock',
  LockKeyhole: 'lock',
  LogIn: 'login-2',
  LogOut: 'logout-2',
  Mail: 'letter',
  Map: 'map',
  MapPin: 'map-point',
  MapPinned: 'map-point-favorite',
  MapPinOff: 'map-point-remove',
  Mars: 'men',
  Megaphone: 'speaker',
  MessageCircle: 'chat-round',
  MessageSquare: 'chat-square',
  MessageSquareText: 'chat-square',
  MessageSquareWarning: 'chat-square-code',
  MessagesSquare: 'chat-square-2',
  Milk: 'bottle',
  Minus: 'minus-circle',
  Monitor: 'monitor',
  Moon: 'moon',
  MoreHorizontal: 'menu-dots',
  Navigation: 'map-arrow-up',
  OctagonAlert: 'danger-circle',
  PackageCheck: 'box',
  PackageOpen: 'box',
  PackageSearch: 'box',
  Palette: 'palette',
  PartyPopper: 'confetti',
  Pause: 'pause',
  PawPrint: 'paw',
  Pencil: 'pen',
  PencilLine: 'pen-new-square',
  Phone: 'phone',
  Plane: 'plane',
  PlaneTakeoff: 'plane',
  Play: 'play',
  Plug: 'plug-circle',
  Plus: 'add-circle',
  Presentation: 'presentation-graph',
  Receipt: 'bill-list',
  RefreshCw: 'refresh',
  Rocket: 'rocket',
  RotateCcw: 'refresh',
  RotateCw: 'refresh',
  Route: 'routing',
  Rows3: 'hamburger-menu',
  Salad: 'chef-hat',
  Scale: 'scale',
  ScanLine: 'scanner',
  Search: 'magnifier',
  SearchCheck: 'magnifier',
  SearchX: 'magnifier',
  Send: 'plane',
  Shapes: 'widget',
  Share2: 'share',
  ShieldAlert: 'shield-warning',
  ShieldCheck: 'shield-check',
  ShieldQuestion: 'shield-warning',
  Shirt: 't-shirt',
  ShoppingBag: 'bag-4',
  ShoppingBasket: 'basketball',
  SlidersHorizontal: 'tuning-2',
  Smartphone: 'smartphone',
  Sofa: 'sofa',
  Sparkles: 'stars-minimalistic',
  Sprout: 'leaf',
  SquareArrowOutUpRight: 'square-top-down',
  SquarePlay: 'play-circle',
  Stamp: 'verified-check',
  Star: 'star',
  Stethoscope: 'stethoscope',
  StickyNote: 'notes',
  Store: 'shop',
  Sun: 'sun',
  Table: 'bedside-table',
  TabletSmartphone: 'tablet',
  Tag: 'tag',
  Tags: 'tag-horizontal',
  Tent: 'home',
  Ticket: 'ticket',
  TicketPercent: 'ticket-sale',
  ToyBrick: 'widget',
  Trash2: 'trash-bin-trash',
  TrendingDown: 'chart-2',
  TrendingUp: 'chart-2',
  TriangleAlert: 'danger-triangle',
  Truck: 'tram',
  TvMinimal: 'tv',
  Undo2: 'undo-left',
  Upload: 'upload',
  User: 'user',
  UserPlus: 'user-plus-rounded',
  UserRound: 'user-circle',
  UserRoundCog: 'user-id',
  Users: 'users-group-rounded',
  UsersRound: 'users-group-two-rounded',
  UtensilsCrossed: 'chef-hat',
  Venus: 'women',
  Video: 'videocamera',
  Volleyball: 'basketball',
  Volume2: 'volume-loud',
  VolumeX: 'volume-cross',
  Wallet: 'wallet',
  WashingMachine: 'washing-machine',
  Watch: 'watch-round',
  // Added 2026-08-25 for the electronics subcategories the CellphoneS import needed
  // (networking, printers, keyboards & mice). Solar v2 names, same pack as everything else.
  Wifi: 'home-wi-fi',
  Printer: 'printer',
  Keyboard: 'keyboard',
  Webhook: 'code',
  WifiOff: 'wi-fi-router-minimalistic',
  Wrench: 'settings',
  X: 'close-circle',
  XCircle: 'close-circle',
  Zap: 'bolt',

  // ⚠️ THE shadcn PRIMITIVES USE lucide's `*Icon` ALIASES, and they import with DOUBLE quotes —
  // which is why the first codemod pass missed nine files under src/components/ui/. Same glyphs,
  // second spelling. Solar has no BARE checkmark (only check-circle / check-square / check-read),
  // so a dropdown tick is the circled one.
  CheckIcon: 'check-circle',
  ChevronDownIcon: 'alt-arrow-down',
  ChevronLeftIcon: 'alt-arrow-left',
  ChevronRightIcon: 'alt-arrow-right',
  ChevronUpIcon: 'alt-arrow-up',
  MinusIcon: 'minus-circle',
  MoreHorizontalIcon: 'menu-dots',
  XIcon: 'close-circle',
}

/**
 * BARE MARKS — the rows above that must NOT be drawn enclosed, and the geometry they borrow.
 *
 * ⚠️ SOLAR HAS NO STANDALONE TICK AND NO STANDALONE DASH. Every mark in the set is enclosed in a
 * circle or a square, exactly as `close` is (see the map note: "Solar has no bare X — every close
 * mark is enclosed"). That is fine for a status glyph and WRONG for a mark that is already inside
 * a box of its own: `Check` was `check-circle`, so a 16px checkbox painted a 12px white RING that
 * exactly filled its own content area, with a cramped tick inside it. The owner's words for it
 * were "it fills up all box instead having graceful tick".
 *
 * So each row here names a source glyph and ONE shape index within its OUTLINE weight — the tick
 * out of `check-read`, the bar out of `minus-circle` — and the generator emits that shape alone.
 *
 * ⚠️ `dx` IS MEASURED WITH getBBox() IN A REAL BROWSER, NOT COMPUTED. The tick shares its source
 * box with a second tick, so it sits left of centre and has to be nudged back. A first draft had
 * the generator derive this by scanning path coordinates; it was dropped because that is not a
 * bbox — a cubic's control points overstate its extent, and the scan additionally mis-parsed the
 * bar's `H` command and put its centre at 12.375 instead of 12.0. Measured, in the 24-unit box:
 *     check-read#0   x 3.25 w 12.50  centre  9.50  -> dx +2.5
 *     minus-circle#0 x 8.25 w  7.50  centre 12.00  -> dx  0
 *
 * ⚠️ `sha` PINS THE GEOMETRY THOSE NUMBERS WERE MEASURED AGAINST — sha256 of the raw source
 * shape TAG (not just its `d`), first 16 hex. A Solar bump that redraws either glyph invalidates
 * `dx` silently, and a mark 2.5 units off centre in a 16px box is visible. The build fails
 * instead; the fix is to re-measure with getBBox and update `dx` AND `sha` together, never `sha`
 * alone. The whole tag rather than `d` because a redraw can change how a mark FILLS — the element
 * type, `fill-rule`, `clip-rule` — while leaving its outline path identical.
 *
 * ⚠️ ONE DRAWING SERVES BOTH WEIGHTS. Solar ships no heavier bare tick — bold `check-read` is a
 * filled rounded SQUARE with the ticks as negative space, and bold `minus-circle` is a solid disc,
 * so neither can be the pressed layer. That is not a workaround: the generator's own identical-pair
 * guard documents that ~55 Solar glyphs are drawn IDENTICALLY in Outline and Bold precisely
 * because they are line-only marks with no interior to fill. A bare tick is that kind of mark.
 *
 * ⚠️ THE COST, STATED: two identical layers cross-fade, and two opaque copies at 0.5 composite to
 * 0.75, so the mark dips ~25% at the midpoint of the ~130ms swap. Both reviewers raised it. It is
 * NOT introduced here — six shim icons already ship identical weights for the same reason
 * (`Code`, `History`, `Link2`, `ListChecks`, `Undo2`, `Webhook`), measured on the generated file.
 * Emitting the mark once, unclassed, would remove the dip AND the pressed recolour — but it would
 * also make these four the only glyphs in the shim with no weight layers, and would silently drop
 * the accent tint that a selected dropdown row's tick is supposed to get. Not worth it for 65ms.
 */
export const BARE_MARKS = {
  Check: { from: 'check-read', shape: 0, shapes: 2, dx: 2.5, bold: 1.25, sha: 'c4c2f8ec1e702a15',
    why: 'The app\'s bare tick — checkbox, dropdown selected-marks, "copied" confirmations, wizard steps.' },
  CheckIcon: { from: 'check-read', shape: 0, shapes: 2, dx: 2.5, bold: 1.25, sha: 'c4c2f8ec1e702a15',
    why: 'lucide\'s CheckIcon is the same bare tick as Check; it marks the selected row in select/combobox/dropdown-menu.' },
  Minus: { from: 'minus-circle', shape: 0, shapes: 2, dx: 0, bold: 1.25, sha: '09fec1411a24c650',
    why: 'The checkbox INDETERMINATE dash. Already centred in its source box, hence dx 0.' },
  MinusIcon: { from: 'minus-circle', shape: 0, shapes: 2, dx: 0, sha: '09fec1411a24c650',
    // ⚠️ NO `bold` HERE, UNLIKE `Minus`. The 1.25 weight was measured on a TICK at 12px inside a
    // saturated 16px box, where a hairline disappears. This dash is the separator between OTP
    // groups: it sits on the page surface at normal size, where the same stroke makes it 83%
    // thicker than the glyphs around it for no reason anyone asked for. Same source shape,
    // different job, different weight.
    why: 'The separator between OTP groups (ui/input-otp) — a dash, never a circled minus.' },
}

/**
 * ⚠️ `CheckCircle2` IS DELIBERATELY NOT A BARE MARK. It means an ENCLOSED tick in lucide and every
 * call site uses it that way — a success state, a resolved report, a completed case — so it keeps
 * the whole `check-circle` glyph. Do not "fix" it to match Check.
 */

/**
 * ⚠️ THE SUBSTITUTIONS, CALLED OUT SO THEY GET REVIEWED RATHER THAN DISCOVERED.
 * Solar has no equivalent for these; each is the closest mark that survives at tile size.
 */
export const SUBSTITUTIONS = {
  Loader2: 'Solar has no spinner at all. `refresh` is a circular arrow, which is what every call site already spins with `animate-spin`.',
  Sparkles: '`stars-minimalistic` — the AI concierge mark. Solar has no multi-spark glyph; `magic-wand-3` reads as a wand, not as AI.',
  Car: '`wheel-angle` (a steering wheel). SOLAR HAS NO CAR — measured across all 1,246. `bus` was the alternative and names the wrong vehicle.',
  CarFront: 'Same as Car.',
  Dog: '`paw`. No dog, cat or bird in the set; all three pet subcategories collapse to the one paw.',
  Bird: 'Same as Dog — `paw`.',
  Cookie: '`donut`. No cookie; the consent banner needs something edible and round.',
  Hammer: '`settings` (a cog) — the same stand-in the services tile uses, and for the same reason: Solar has no wrench, spanner or hammer.',
  HardHat: '`case` — a briefcase. No helmet or hard hat.',
  Tent: '`home`. No tent.',
  Fingerprint: '`user-id`. No fingerprint.',
  Stamp: '`verified-check`. No stamp; the mark is used for visa approval, which is what a check conveys.',
  Salad: '`chef-hat`, same as the food category. No salad, bowl or plate of greens.',
  CookingPot: 'Same as Salad — `chef-hat`.',
  Dices: '`gamepad`. No dice.',
  Table: '`bedside-table` — the only table in the set.',
  Watch: '`watch-round`.',
  Rows3: '`hamburger-menu` — three stacked lines, which is exactly what the list-view toggle means.',
}
