import { describe, expect, it } from 'vitest'
import { fold } from './fold'
import { SEVERE_ACCENTED, SEVERE_ENTRIES, findSevereAbuse, normalizeApostrophes } from './severe-abuse-words'

// ── src/lib/severe-abuse-words.ts — the SEVERE-only vocabulary of the UGC filter (ugc-safety, R5) ─────
// Both directions are pinned, because both are expensive: a miss lets a slur or a threat through in an
// app Apple reviews for exactly that (Guideline 1.2); a false positive REFUSES an honest person's
// message, review or comment in a marketplace where people haggle in two languages all day.

const hit = (t: string) => findSevereAbuse(t)?.category ?? null

describe('catches each severe category — English, Vietnamese with AND without diacritics', () => {
  it('slurs and hate speech', () => {
    for (const t of ['you are a nigger', 'NIGGERS out', 'fucking gook', 'go home wetback', 'heil hitler', 'Kill all Jews', 'đồ tàu khựa', 'do tau khua', 'thằng pê đê', 'thang pe de']) {
      expect(hit(t), t).toBe('slur')
    }
  })

  it('sexual content involving minors', () => {
    for (const t of ['selling child porn', 'jailbait pics', 'clip ấu dâm', 'phim khiêu dâm trẻ em', 'phim khieu dam tre em', 'có sex trẻ em không', 'co sex tre em khong']) {
      expect(hit(t), t).toBe('minors')
    }
  })

  it('sexual solicitation', () => {
    for (const t of ['500k for a happy ending massage', 'send nudes', 'need a call girl tonight', 'tìm gái qua đêm', 'tìm gái gọi cao cấp', 'chat sex với em']) {
      expect(hit(t), t).toBe('solicitation')
    }
  })

  it('⛔ a possessive or a contraction hides nothing — not a slur (gate round 7), not a threat (round 9)', () => {
    for (const t of ["you nigger's", "that kike's shop", 'kike’s', "gook'll"]) {
      expect(hit(t), t).not.toBeNull()
    }
    expect(hit("you nigger's")).toBe('slur')
    expect(hit("selling child porn's")).toBe('minors')
    expect(hit("I'm going to kill your wife's family")).toBe('threat')
    expect(hit("I will kill you's")).toBe('threat')
  })

  it('a mixed message is counted under the category that comes FIRST (gate round 8)', () => {
    expect(hit('I will kill you, you gook')).toBe('threat')
    expect(hit('you gook, I will kill you')).toBe('slur')
  })

  it('a quoted threat is still a threat — a closing quote is not a possessive', () => {
    expect(hit("He wrote 'I will kill you' last night")).toBe('threat')
    expect(hit('He wrote ‘I will kill you’.')).toBe('threat')
  })

  it('a burn-the-house or break-your-legs threat needs a speaker who means it (gate round 10)', () => {
    expect(hit('I will burn your house down')).toBe('threat')
    expect(hit('im gonna fucking break your legs')).toBe('threat')
    expect(hit("I'll burn down your house")).toBe('threat')
  })

  it('the one insertion people make — an intensifier — and the near forms (gate round 2)', () => {
    expect(hit('I will fucking kill you')).toBe('threat')
    expect(hit('im gonna fuckin stab u')).toBe('threat')
    expect(hit("I'll come kill you")).toBe('threat')
    expect(hit('send me your nudes')).toBe('solicitation')
  })

  it('extra spaces, tabs and line breaks between the words do not get around it (fold collapses them)', () => {
    expect(hit('I will  kill you')).toBe('threat')
    expect(hit('I will\nkill\tyou')).toBe('threat')
    expect(hit('send\t nudes')).toBe('solicitation')
    expect(hit('tao  giết mày')).toBe('threat')
  })

  it('explicit threats of violence, any apostrophe', () => {
    for (const t of ['I will kill you', 'i’ll kill you', "I'm going to stab your family", 'im gonna rape u', 'go kill yourself', 'tao giết mày', 'đâm chết mày', 'dam chet may', 'mày chết với tao', 'xử đẹp mày', 'giet chet may']) {
      expect(hit(t), t).toBe('threat')
    }
  })

  it('the stated price of an accented-only term: typed WITHOUT accents it passes (Report is the backstop)', () => {
    for (const t of ['tao giet may', 'may chet voi tao', 'tao dot nha may', 'be de', 'clip au dam']) expect(findSevereAbuse(t), t).toBeNull()
  })
})

describe('does NOT refuse honest text — the Scunthorpe traps, both languages', () => {
  it('English words that merely CONTAIN a listed one', () => {
    for (const t of [
      'Scunthorpe United scarf', 'Niger Delta tour', 'Nigeria shipping', 'a niggardly offer', 'grape juice for you', 'I will grape you some',
      'I will skill you up', 'therapist in D1', 'Googled it', 'gooky glue', 'kikeriki toy', 'Maine Coon kitten', 'spick and span condition',
      'auto tranny rebuild', 'white power bank 20000mAh', 'Ford Escort service history',
    ]) {
      expect(findSevereAbuse(t), t).toBeNull()
    }
  })

  it('everyday English that shares words with a threat', () => {
    for (const t of [
      "I'll shoot you a message tonight", 'I will shoot you the photos', 'this price will kill you', "don't kill yourself over it",
      "I'll beat you to it", 'I will beat your price', 'sorry if I hurt you', 'will it hurt your phone?', 'this will hurt your budget',
      'no prostitution allowed in the apartment', 'escort you to the station', 'the old rice kills you slowly lol',
      // a threat phrase with no speaker who means it (gate round 10)
      'a cheap charger can burn your house down', "no rush, don't break your neck", 'skiing will break your legs lol',
    ]) {
      expect(findSevereAbuse(t), t).toBeNull()
    }
  })

  it('Vietnamese that shares letters with a listed term once the accents are gone', () => {
    for (const t of [
      // "bê đê" (accented-only) vs "bé dễ (dàng / thương)" — 82 live listings say this
      'giúp bé dễ dàng mang theo', 'giup be de dang mang theo', 'bé dễ thương lắm', 'be de thuong',
      // "khựa" (accented-only) vs "khua", "khách khứa"
      'khua tay múa chân', 'khach khua dong vui', 'khách khứa đông vui',
      // "hiếp mày" (accented-only) vs "hiệp mấy"
      'hiệp mấy rồi?', 'hiep may roi', 'Tôi hỏi hiep may',
      // "máy sẽ chết" (the machine will die) — "mày sẽ chết" is not listed at all (round 11: "mày sẽ chết cười")
      'máy sẽ chết nếu rơi nước', 'may se chet neu roi nuoc',
      // "ấu dâm", "mua dâm trẻ em", "gái bao" (accented-only, gate round 3)
      'phong cach chau au dam chat co dien', 'mua dam tre em size 5', 'hang rao gai bao quanh nha',
      // everyday WITH their accents — so the bare terms are gone (gate round 10)
      'Bé gái bao nhiêu tháng ạ?', 'con gái bao nhiêu tuổi?', 'bạn gái gọi cho em', 'con gái gọi mẹ', 'cô gái gọi điện hỏi giá',
      // "giết mày", "đốt nhà mày", "tao đâm mày", "mày chết với tao" (accented-only, gate round 2)
      'giet may con boss', 'giết mấy con boss', 'hang dot nha may moi ve', 'hàng đợt nhà máy mới về',
      'tao dam may tren anh', 'tạo đám mây trên ảnh', 'may chet voi tao roi', 'máy chết với tao rồi',
      // phrases deliberately NOT listed
      'bán máy giặt cũ', 'ban may giat cu', 'mới đến Sài Gòn', 'moi den sai gon', 'xua tan mọi đen đủi', 'đi khách sạn gần đây', 'di khach san gan day',
      'đám mây đẹp quá', 'dam may dep qua', 'con gái vị thành niên của tôi', 'múa trình diễn', 'mua trinh dien', 'bản trình chiếu', 'ban trinh chieu',
      'không chứa chấp mại dâm, ma túy', 'nghiêm cấm mua bán dâm', 'giết thời gian', 'giet thoi gian', 'đám trẻ em hàng xóm', 'dam tre em hang xom',
      'Tôi moi den', 'bon moi', 'bốn mối',
      // everyday WITH their accents, so not listed at all (gate round 11)
      'Bọn mọi người ơi, còn hàng không?', 'Xem cái này mày sẽ chết cười', 'bé gái qua đêm sốt cao', 'có gái gọi tìm anh kìa',
      "if I'm honest I'll hurt you", "I'm going to hurt your wife's feelings",
    ]) {
      expect(findSevereAbuse(t), t).toBeNull()
    }
  })

  it('accented-only terms still refuse when typed WITH their own accents', () => {
    expect(hit('đồ bê đê')).toBe('slur')
    expect(hit('bọn khựa')).toBe('slur')
    expect(hit('tao hiếp mày')).toBe('threat')
    expect(hit('tao giết mày')).toBe('threat')
    expect(hit('tao đâm mày đấy')).toBe('threat')
    expect(hit('tao đốt nhà mày')).toBe('threat')
    expect(hit('mày chết với tao')).toBe('threat')
    expect(hit('những vụ ấu dâm')).toBe('minors')
    expect(hit('mua dâm trẻ em')).toBe('minors')
    // A longer term failing its accent check cannot hide a shorter one inside it ("tấu khựa" ≠ "tàu khựa").
    expect(hit('tấu khựa')).toBe('slur')
  })
})

describe('the list itself stays consistent', () => {
  it('no two entries fold to the same key (a duplicate would hide one category)', () => {
    const keys = SEVERE_ENTRIES.map((e) => fold(normalizeApostrophes(e.term)))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every accented spelling folds to its key and is caught when typed exactly as written', () => {
    for (const [key, spellings] of Object.entries(SEVERE_ACCENTED)) {
      for (const sp of spellings) {
        expect(fold(sp), sp).toBe(key)
        expect(findSevereAbuse(sp)?.term, sp).toBe(key)
      }
    }
  })

  it('every English entry is caught as written, in any case', () => {
    for (const e of SEVERE_ENTRIES.filter((x) => !(x.term in SEVERE_ACCENTED) && !/[^\x00-\x7f]/.test(x.term))) {
      expect(findSevereAbuse(e.term.toUpperCase())?.category, e.term).toBe(e.category)
    }
  })

  it('no entry is a word-prefix of another (the overlapping scan reads one term per start position)', () => {
    const keys = SEVERE_ENTRIES.map((e) => fold(normalizeApostrophes(e.term)))
    const clashes = keys.flatMap((a) => keys.filter((b) => b !== a && b.startsWith(`${a} `)).map((b) => `${a} ⊂ ${b}`))
    expect(clashes).toEqual([])
  })

  it('an accented-only entry carries an accent (otherwise it could never match)', () => {
    for (const e of SEVERE_ENTRIES.filter((x) => x.accentedOnly)) {
      expect(/[̀-ͯ]/.test(e.term.normalize('NFD')) || /đ/.test(e.term), e.term).toBe(true)
    }
  })

  it('never stores what it matched beyond the folded term (no user text in the result)', () => {
    const r = findSevereAbuse('Hey I will KILL YOU tomorrow, address 12 Nguyễn Huệ')
    expect(r).toEqual({ term: 'i will kill you', category: 'threat' })
  })
})
