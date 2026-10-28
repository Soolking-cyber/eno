/**
 * ⛔ TRUST CLAIMS, IN EVERY LANGUAGE THE GUIDE SPEAKS (commit review rounds 1–4, codex: "这个卖家已经核实，绝对安全" passed;
 * a test corpus even counted "…от проверенных продавцов" as ordinary). eno.vn verifies no seller, listing or price (the
 * brief: "Never promise that a listing, person or price is genuine, safe, verified or still available"; copy-rules.ts
 * RETIRED_TRUST_CLAIMS are eno's own old EN/VI marketing lines). These are the claim itself: a verification or safety word
 * ON a seller, landlord, teacher, listing or business — either order — or eno as the one who checked or guarantees.
 * ⚠️ NARROW ON PURPOSE, hand-written (not the generated lists): never a qualification ("certified teacher", "chứng chỉ"),
 * never eno's own features named as they are ("trust score", "điểm uy tín", the "Trusted" tier read from a card, "No
 * broker", "chính chủ"), never the person's own checking ("check the item before you pay"). Run on norm()ed text.
 */
const EN_WHO = '(?:sellers?|listings?|landlords?|hosts?|providers?|agents?|agencies|teachers?|tutors?|owners?|vendors?|shops?|stores?|businesses|companies|schools?|employers?|deals?|offers?|apartments?|rooms?|homes?|items?|products?)'
const EN_CLAIM = '(?:verified|vetted|trusted|trustworthy|guaranteed|reliable|reputable|legit|legitimate|genuine|safe|scam free|fully checked|screened)'
export const TRUST_CLAIMS: readonly RegExp[] = [
  // en
  new RegExp(`(?<![^ ])${EN_CLAIM} ${EN_WHO}(?![^ ])`, 'u'),
  new RegExp(`(?<![^ ])${EN_WHO}(?: here| on eno(?: vn)?)? (?:are|is|were|was|have been|has been|get|gets)(?: all| always| fully| 100)? ${EN_CLAIM}(?![^ ])`, 'u'),
  /(?<![^ ])(?:guaranteed|100) (?:genuine|real|safe|authentic|legit)(?![^ ])/u,
  /(?<![^ ])eno(?: vn)? (?:has |have )?(?:verified|vetted|guarantees|guaranteed|screens|screened|checks every|checked every|vouches for)(?![^ ])/u,
  // The guide (or eno) BOOKING, reserving, arranging or planning a trip itself — whoever lists it (commit review round 6,
  // codex: "I can book a tour from local sellers" passed the generated list's seller exemption). Opening or showing the
  // sellers' listings is still said.
  // ⚠️ The trip right after the verb (a, the, your, one kind word) — never "these tours by price", "your saved tours", "an
  // alert for day trips" or the sellers' own ("sellers arrange their own tours"): the verified English set keeps them said.
  /(?<![^ ])(?:i|we|eno|let me|let us|i ll|we ll|i d|we d)(?: can| could| will| would| ll| am happy to| d be happy to| d love to)?(?: also| gladly| happily)? (?:book|reserve|arrange|organi[sz]e|plan|set up)(?: you| for you)?(?: (?:a|an|the|your|some))?(?: (?:day|private|guided|boat|city|food|walking|full day|half day|weekend|short|quick|little))? (?:tours?|trips?|excursions?|holidays?|vacations?|itinerar(?:y|ies)|getaways?|cruises?)(?! (?:by|into|in order))(?![^ ])/u,
  // vi — the guide BOOKING or arranging a trip FOR the listener, subject dropped as polite Vietnamese drops it (final review,
  // opus: "Anh ơi, đặt tour Hạ Long cho anh luôn nhé?", "Bạn cần không, mình đặt tour giúp bạn luôn." passed the generated
  // list's third-party and negation exemptions; a "không" right before the verb is eno's own no — "eno.vn không lên kế
  // hoạch chuyến đi"; "bạn có thể / nên / tự …" is the listener doing it; a title and a name before "sẽ / có thể" is someone else — "Anh Tuấn sẽ tổ chức tour cho bạn") — never the
  // seller doing it ("người bán sẽ đặt tour cho bạn"), never "you
  // can book with the seller in the chat" (no "for you").
  /(?<!(?:người bán|chủ nhà|chủ tour|shop|đơn vị|nhà cung cấp|công ty|họ|bên đó|bên bán)(?: [^ ]+){0,3} )(?<!(?:không|chưa|chẳng|chả|đừng|ko) )(?<!(?:anh|chị|cô|chú|ông|bà) [^ ]+ (?:sẽ|có thể|đang|thì|hay) )(?<!(?:bạn|anh|chị|quý khách|anh chị|mọi người|cả nhà) (?:có thể|nên|hãy|cứ|cũng có thể|vẫn có thể|tự) )(?<![^ ])(?:đặt|book|giữ chỗ|giữ|chốt|sắp xếp|tổ chức|lên lịch trình|lên kế hoạch)(?: luôn| giúp| hộ)?(?: (?:cho|giúp|hộ) (?:anh|chị|bạn|em|quý khách|anh chị|cả nhà|gia đình mình|mình))? (?:tour|chuyến đi|chuyến du lịch|chuyến tham quan|chuyến dã ngoại|vé tour|lịch trình|kỳ nghỉ)(?: [^ ]+){0,3} (?:cho|giúp|hộ) (?:anh|chị|bạn|em|quý khách|anh chị|cả nhà|cô|chú|ông|bà)(?![^ ])/u,
  /(?<!(?:người bán|chủ nhà|chủ tour|shop|đơn vị|nhà cung cấp|công ty|họ|bên đó|bên bán)(?: [^ ]+){0,3} )(?<!(?:không|chưa|chẳng|chả|đừng|ko) )(?<!(?:anh|chị|cô|chú|ông|bà) [^ ]+ (?:sẽ|có thể|đang|thì|hay) )(?<!(?:bạn|anh|chị|quý khách|anh chị|mọi người|cả nhà) (?:có thể|nên|hãy|cứ|cũng có thể|vẫn có thể|tự) )(?<![^ ])(?:đặt|book|giữ chỗ|chốt|sắp xếp|tổ chức) (?:giúp|cho|hộ) (?:anh|chị|bạn|em|quý khách|anh chị|cả nhà) (?:tour|chuyến đi|chuyến du lịch|chuyến tham quan|chuyến dã ngoại|vé tour|kỳ nghỉ)(?![^ ])/u,
  /(?:người bán|chủ nhà|tin đăng|giáo viên|nhà cung cấp|đơn vị|cửa hàng|shop|trường|nhà tuyển dụng|môi giới|căn hộ|sản phẩm)(?: này| đó| ở đây| trên eno)? (?:đều |đã |đã được |được |rất |hoàn toàn |luôn )*(?:xác minh|xác thực|kiểm duyệt|uy tín|đáng tin|đáng tin cậy|an toàn|đảm bảo|bảo đảm)(?![^ ])/u,
  /(?<![^ ])eno (?:đã |đều |luôn )*(?:xác minh|kiểm duyệt|đảm bảo|bảo đảm|cam kết)(?![^ ])|(?<![^ ])(?:an toàn|thật) 100(?![^ ])|(?<![^ ])(?:đảm bảo|bảo đảm|cam kết) (?:an toàn|hàng thật|chính hãng|uy tín)(?![^ ])/u,
  // zh (Traditional is mapped to Simplified first)
  /(?:已经?|经过)?(?:认证|验证|核实|审核|靠谱|可靠|可信|信得过|有保障|安全|放心)的?(?:卖家|房东|商家|老师|中介|房源|商品|学校|雇主|店铺|店家)|(?:卖家|房东|商家|老师|房源|商品|店铺)(?:们)?(?:都|也|全部|均)?(?:已经?|经过)(?:认证|验证|核实|审核)|(?:卖家|房东|商家|房源|商品|店铺|中介)(?:们)?(?:都|也|全部|均)?(?:是)?(?:很|非常|十分|特别|绝对|完全|百分百)?(?:可靠|靠谱|可信|信得过|有保障|安全|放心|正规)的?|(?:保证|保真|百分百|绝对)(?:真实|正品|安全|可靠|靠谱)|eno(?:已经?|都)?(?:认证|验证|核实|审核|保证|担保)/u,
  // ja
  /(?:認証済み|確認済み|審査済み|検証済み|信頼できる|信頼性の高い|安心できる|安心な|保証付き|優良)の?(?:出品者|販売者|売り手|大家|オーナー|講師|先生|業者|物件|商品|学校|お店|店舗)|(?:出品者|販売者|売り手|大家|オーナー|講師|業者|物件|商品)(?:は|も|が)?(?:すべて|全て|全員|みな)?(?:認証|確認|審査|検証)済み|(?:絶対|完全に|100)(?:安全|安心|本物)|eno(?:が|は)?(?:認証|審査|検証|保証)(?:済み|し|した|して)/u,
  // ko
  /(?:인증된|검증된|확인된|믿을 수 있는|믿을 만한|신뢰할 수 있는|보장된|안전한|안심할 수 있는) ?(?:판매자|집주인|선생님|강사|업체|매물|상품|학교|가게|중개인)|(?:판매자|집주인|선생님|강사|업체|매물|상품)(?:는|은|들은|들도|도|모두)? ?(?:모두 |다 |전부 )?(?:인증|검증)(?:된|됐|되었|받은|완료)|(?:100 ?|완전히 |절대 )(?:안전|진품)|eno(?:가|는)? ?(?:인증|검증|보장)(?:한|했|합|된)/u,
  // ru
  /(?<![^ ])(?:проверенн|надёжн|надежн|достоверн|гарантированн|безопасн|благонадёжн|благонадежн)\p{L}* (?:продав|арендодател|хозя|учител|преподавател|репетитор|агент|риелтор|риэлтор|объявлени|компани|магазин|школ|работодател|предложени|квартир|товар)|(?<![^ ])(?:продав|арендодател|хозя|учител|преподавател|объявлени|компани|магазин|квартир|товар)\p{L}* (?:здесь |на eno )?(?:все |всегда |полностью )*(?:проверен|гарантирован|надёжн|надежн|безопасн)\p{L}*|(?<![^ ])eno (?:всё |все )?(?:провер|гарантир)\p{L}*/u,
  // ms
  /(?<![^ ])(?:penjual|tuan rumah|pemilik|guru|tutor|ejen|penyedia|kedai|syarikat|sekolah|majikan|iklan|senarai|rumah|bilik|barang)(?: (?:ini|di sini|di eno))? (?:yang )?(?:semuanya |semua |sudah |telah |pasti )*(?:disahkan|dipercayai|boleh dipercayai|terjamin|dijamin|selamat|tulen)(?![^ ])|(?<![^ ])(?:dijamin|terjamin|100) (?:selamat|tulen|asli)(?![^ ])|(?<![^ ])eno (?:telah |sudah )?(?:mengesahkan|menjamin|menyemak semua)(?![^ ])/u,
  // th (joined: no space between Thai words)
  /(?:ผู้ขาย|เจ้าของ|ครู|ติวเตอร์|ร้าน|ผู้ให้บริการ|โรงเรียน|นายจ้าง|ประกาศ|ห้อง|ที่พัก|สินค้า)(?:ที่|ทุกคน|ทุกราย|ทั้งหมด|ทุกที่|รายนี้|คนนี้|ร้านนี้|นี้|ทุกคนที่นี่)*(?:ได้รับการ)?(?:ยืนยันแล้ว|ยืนยันตัวตนแล้ว|ตรวจสอบแล้ว|น่าเชื่อถือ|ไว้ใจได้|เชื่อถือได้|รับประกัน|ปลอดภัย)|(?:ปลอดภัย|ของแท้)100|รับประกัน(?:ของแท้|ความปลอดภัย)|eno(?:ได้)?(?:ยืนยัน|ตรวจสอบ|รับประกัน)/u,
  // fr
  /(?<![^ ])(?:vendeurs?|vendeuses?|propriétaires?|bailleurs?|hôtes?|professeurs?|profs?|enseignants?|enseignantes?|tuteurs?|agents?|agences?|prestataires?|annonces?|boutiques?|magasins?|écoles?|employeurs?|offres?|logements?|articles?)(?: ici| sur eno(?: vn)?)? (?:sont |est |sont tous |sont toutes |tous |toutes |toujours )*(?:vérifiés?|vérifiées?|fiables?|de confiance|garantis?|garanties?|sûrs?|sûres?|sécurisés?|sécurisées?|authentiques?)(?![^ ])|(?<![^ ])(?:vérifiés?|vérifiées?|fiables|de confiance) (?:vendeurs?|propriétaires?|annonces?|professeurs?|prestataires?)(?![^ ])|(?<![^ ])(?:100|garanti|garantie) (?:sûr|sûre|sécurisé|sécurisée|authentique)(?![^ ])|(?<![^ ])eno (?:a |vérifie tous|garantit|a vérifié|certifie)(?:vérifié|garanti)?(?![^ ])/u,
  // hi
  /(?:सत्यापित|वेरिफाइड|भरोसेमंद|विश्वसनीय|भरोसे के लायक|सुरक्षित|गारंटीड|गारंटी वाले) ?(?:विक्रेता|बेचने वाले|मकान मालिक|शिक्षक|टीचर|ट्यूटर|एजेंट|दुकान|स्कूल|लिस्टिंग|विज्ञापन|नियोक्ता)|(?:विक्रेता|मकान मालिक|शिक्षक|टीचर|एजेंट|लिस्टिंग)(?: सभी| सब)? (?:सत्यापित|वेरिफाइड|भरोसेमंद|विश्वसनीय|सुरक्षित)/u,
]
