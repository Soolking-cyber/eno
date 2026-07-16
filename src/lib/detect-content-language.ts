// Conservative script detection for user-authored forum content. Plain Latin text
// remains unclassified so English copy is never sent for unnecessary translation.
export function detectContentLanguage(text: string | null | undefined): string | null {
  if (!text) return null
  if (/[가-힣]/.test(text)) return 'ko'
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[一-鿿]/.test(text)) return 'zh-Hans'
  if (/[Ѐ-ӿ]/.test(text)) return 'ru'
  if (/[ក-៿]/.test(text)) return 'km'
  if (/[฀-๿]/.test(text)) return 'th'
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  if (/[ăĂđĐơƠưƯạẠặẶậẬẹẸệỆịỊọỌộỘợỢụỤựỰ]/.test(text)) return 'vi'
  return null
}
