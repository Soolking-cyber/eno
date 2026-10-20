import 'server-only'
import { BIG, UNI } from './vi-restore-data'

/**
 * Put the marks back on Vietnamese typed without them, before machine translation.
 *
 * ⛔ WHY. The box model (m2m100) cannot read unaccented Vietnamese even when told the language: measured 2026-10-20,
 * 'dat coc may thang' (đặt cọc mấy tháng — "how many months' deposit") came back "The Cock may be a staircase." and
 * 'minh can tim giao vien tieng anh cho con' came back "I can give you my heart." — fluent, wrong, and accepted by
 * every quality check. With the marks restored first the same model gives usable English for most lines.
 *
 * How: a fixed chat phrase or word table first (the words people actually chat in — eno's listing text alone reads
 * 'lop' as lốp, a tyre, and 'lai' as lái, to drive), then the usual form of each pair in eno's own Vietnamese text,
 * then of each word. Measured on 40 unseen chat lines: 87% of syllables right; a wrong syllable usually still
 * leaves the line understandable. Words that already carry marks are kept as written.
 */

// Fixed two-word chat phrases. Checked before the corpus pairs, and looked for one word AHEAD so a corpus pair cannot
// swallow the first word of a phrase ('co ban cong' is có ban công, not cơ bản công).
const PHRASES: Record<string, string> = {
  'xin chao': 'xin chào', 'chao ban': 'chào bạn', 'chao anh': 'chào anh', 'chao chi': 'chào chị', 'chao em': 'chào em',
  'chao co': 'chào cô', 'chao thay': 'chào thầy', 'cam on': 'cảm ơn', 'khoe khong': 'khỏe không', 'em oi': 'em ơi',
  'anh oi': 'anh ơi', 'chi oi': 'chị ơi', 'ban oi': 'bạn ơi', 'co oi': 'cô ơi', 'thay oi': 'thầy ơi', 'may gio': 'mấy giờ',
  'may thang': 'mấy tháng', 'may tuoi': 'mấy tuổi', 'quan may': 'quận mấy', 'con phong': 'còn phòng', 'con hang': 'còn hàng',
  'con khong': 'còn không', 'phong con': 'phòng còn', 'nha minh': 'nhà mình', 'con be': 'con bé', 'roi a': 'rồi à',
  'com chua': 'cơm chưa', 'da vang': 'dạ vâng', 'ban cong': 'ban công', 'ho boi': 'hồ bơi',
  'can ho': 'căn hộ', 'cho meo': 'chó mèo', 'xem nha': 'xem nhà', 'khong a': 'không ạ', 'tinh sao': 'tính sao',
  'sao dau': 'sao đâu', 'bao nhieu': 'bao nhiêu', 'o dau': 'ở đâu', 'the nao': 'thế nào', 'hen gap': 'hẹn gặp',
  'gap lai': 'gặp lại', 'khong sao': 'không sao', 'dat coc': 'đặt cọc', 'hop dong': 'hợp đồng', 'phu huynh': 'phụ huynh',
  'giao vien': 'giáo viên', 'tieng anh': 'tiếng anh', 'tieng viet': 'tiếng việt', 'hoc phi': 'học phí',
  'dien thoai': 'điện thoại', 'so dien': 'số điện', 'an com': 'ăn cơm', 'toi thieu': 'tối thiểu', 'bao lau': 'bao lâu',
  'bat dau': 'bắt đầu', 'luc may': 'lúc mấy', 'cho hoi': 'cho hỏi', 'em hoi': 'em hỏi', 'gui em': 'gửi em',
  'goi lai': 'gọi lại', 'co the': 'có thể', 'duoc khong': 'được không', 'cho de': 'chỗ để', 'de xe': 'để xe',
  'noi lai': 'nói lại', 'tien dien': 'tiền điện', 'dien nuoc': 'điện nước', 'cho con': 'cho con', 'con toi': 'con tôi',
  'con minh': 'con mình', 'be nha': 'bé nhà', 'lop hoc': 'lớp học', 'hoc tieng': 'học tiếng', 'ngay mai': 'ngày mai',
  'hom nay': 'hôm nay', 'toi nay': 'tối nay', 'sang mai': 'sáng mai', 'chieu nay': 'chiều nay', 'luc nao': 'lúc nào',
  'bao gio': 'bao giờ', 'nhu the': 'như thế', 'vay a': 'vậy à', 'that a': 'thật à', 'dung roi': 'đúng rồi', 'ok nhe': 'ok nhé',
  'xin loi': 'xin lỗi', 'tra loi': 'trả lời', 'dung gio': 'đúng giờ', 'sach se': 'sạch sẽ', 'tot lanh': 'tốt lành',
  'nau an': 'nấu ăn', 'chu nha': 'chủ nhà', 'thang may': 'thang máy', 'may lanh': 'máy lạnh', 'may giat': 'máy giặt',
  'buoi hoc': 'buổi học', 'mot buoi': 'một buổi', 'hoc thu': 'học thử', 'nam nay': 'năm nay', 'chuyen khoan': 'chuyển khoản',
  'tai khoan': 'tài khoản', 'thu bay': 'thứ bảy', 'chu nhat': 'chủ nhật', 'cuoi tuan': 'cuối tuần', 'kinh nghiem': 'kinh nghiệm',
  'hoc sinh': 'học sinh', 'sinh vien': 'sinh viên', 'truong hoc': 'trường học', 'an ninh': 'an ninh', 'lau dai': 'lâu dài',
  'con trong': 'còn trống', 'phong trong': 'phòng trống', 'trong phong': 'trong phòng', 'thay day': 'thầy dạy', 'co day': 'cô dạy',
  'day hoc': 'dạy học', 'day tieng': 'dạy tiếng', 'o day': 'ở đây', 'gan day': 'gần đây', 'day du': 'đầy đủ', 'em thay': 'em thấy',
  'minh thay': 'mình thấy', 'toi thay': 'tôi thấy', 'thay doi': 'thay đổi', 'de thuong': 'dễ thương', 'dep lam': 'đẹp lắm',
  'tot lam': 'tốt lắm', 'thich lam': 'thích lắm', 'dep qua': 'đẹp quá', 'dat qua': 'đắt quá', 're qua': 'rẻ quá',
  // 'ban' is bán (sell) on a marketplace and bạn (you) in chat; 'dat' is đất (land), đặt (book) or đắt (dear). Only
  // the neighbouring word can tell — so these are phrases, and a lone word falls to eno's own usage.
  'can ban': 'cần bán', 'dang ban': 'đang bán', 'muon ban': 'muốn bán', 'da ban': 'đã bán', 'con ban': 'còn bán',
  'mua ban': 'mua bán', 'ban xe': 'bán xe', 'ban nha': 'bán nhà', 'ban dat': 'bán đất', 'ban gap': 'bán gấp',
  'ban roi': 'bán rồi', 'ban co': 'bạn có', 'cua ban': 'của bạn', 'ban khoe': 'bạn khỏe', 'ban o': 'bạn ở',
  'ban la': 'bạn là', 'ban can': 'bạn cần', 'giup ban': 'giúp bạn', 'voi ban': 'với bạn', 'cho ban': 'cho bạn',
  'ban nhe': 'bạn nhé', 'nhe ban': 'nhé bạn', 'ban nhieu': 'bạn nhiều', 'hoi dat': 'hơi đắt', 'dat lich': 'đặt lịch', 'dat phong': 'đặt phòng',
  'mua dat': 'mua đất', 'lo dat': 'lô đất', 'dat nen': 'đất nền',
}
// Fixed single words: the everyday chat vocabulary, where listing text would pick a different word.
const WORDS: Record<string, string> = {
  khong: 'không', duoc: 'được', nhe: 'nhé', roi: 'rồi', chua: 'chưa', minh: 'mình', toi: 'tôi', oi: 'ơi',
  vang: 'vâng', nha: 'nhà', gi: 'gì', dau: 'đâu', vay: 'vậy', muon: 'muốn', thue: 'thuê', phong: 'phòng', co: 'có', o: 'ở',
  cua: 'của', la: 'là', chi: 'chị', tien: 'tiền', gia: 'giá', nhieu: 'nhiều', lai: 'lại',
  hoc: 'học', lop: 'lớp', dien: 'điện', nuoc: 'nước', gui: 'gửi', goi: 'gọi', hoi: 'hỏi', biet: 'biết', hieu: 'hiểu',
  noi: 'nói', can: 'cần', nao: 'nào', den: 'đến', di: 'đi', ve: 'về', voi: 'với', nguoi: 'người', thich: 'thích', tot: 'tốt',
  dep: 'đẹp', de: 'để', gio: 'giờ', ngay: 'ngày', tuan: 'tuần', thang: 'tháng', nam: 'năm', sang: 'sáng',
  chieu: 'chiều', be: 'bé', nho: 'nhỏ', lon: 'lớn', moi: 'mới', cu: 'cũ', re: 'rẻ', se: 'sẽ', buoi: 'buổi',
  truong: 'trường', chuc: 'chúc', sau: 'sau', truoc: 'trước', gan: 'gần', xa: 'xa', them: 'thêm',
  cung: 'cũng', nhung: 'nhưng', vi: 'vì', neu: 'nếu', thi: 'thì', ma: 'mà', hay: 'hay', hoac: 'hoặc', rat: 'rất',
  lam: 'làm', xem: 'xem', mai: 'mai', qua: 'qua', cho: 'cho', anh: 'anh', em: 'em', thu: 'thứ',
  // money, as prices are written in chat
  ty: 'tỷ', trieu: 'triệu', nghin: 'nghìn', ngan: 'ngàn', dong: 'đồng',
  // time words — listing text reads 'luc' as lực (force)
  luc: 'lúc', trua: 'trưa',
}
// A last word that is a sentence-final particle.
const TAIL: Record<string, string> = { nhe: 'nhé', chua: 'chưa', a: 'ạ', nha: 'nha' }

const WORD_RE = /^[a-z]+$/

/** Restore the marks on one line. Capitalisation and everything that is not a plain unaccented word are kept. */
export function restoreViMarks(line: string): string {
  const parts = line.match(/\p{L}+|[^\p{L}]+/gu) ?? []
  const lower = parts.map((p) => p.toLowerCase())
  // indices of the parts that are plain unaccented words
  const idx = lower.map((p, i) => (WORD_RE.test(p) ? i : -1)).filter((i) => i >= 0)
  const out = [...parts]
  const put = (i: number, form: string) => {
    const orig = parts[i]
    out[i] = orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase() ? form[0].toUpperCase() + form.slice(1) : form
  }
  // Words separated only by spaces form a pair; punctuation between them breaks it.
  const adjacent = (a: number, b: number) => b === a + 2 && /^\s+$/.test(parts[a + 1] ?? '')
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    const t = lower[i]
    const j = idx[k + 1]
    const pairNext = j !== undefined && adjacent(i, j)
    if (pairNext) {
      const pair = `${t} ${lower[j]}`
      const phrase = PHRASES[pair]
      if (phrase) {
        const [a, b] = phrase.split(' ')
        put(i, a); put(j, b); k++
        continue
      }
      const l = idx[k + 2]
      const phraseAhead = l !== undefined && adjacent(j, l) && `${lower[j]} ${lower[l]}` in PHRASES
      const corpus = BIG[pair]
      if (corpus && !phraseAhead && !(t in WORDS)) {
        const [a, b] = corpus.split(' ')
        put(i, a); put(j, b); k++
        continue
      }
    }
    const last = k === idx.length - 1 && k > 0
    const form = (last && TAIL[t]) || WORDS[t] || UNI[t]
    if (form) put(i, form)
  }
  return out.join('')
}
