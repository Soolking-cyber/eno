/** Every scope an agent can be granted, in words. The page lists the GRANTED set (DEFAULT_SIGN_IN_SCOPES); a scope added
 *  there without words here fails agent-auth.test.ts (commit gate, opus: never under-disclose a write-capable grant). */
export const SCOPE_TEXT: Record<string, { en: string; vi: string }> = {
  'listings:read': { en: 'See your shop and its listings', vi: 'Xem cửa hàng và các tin đăng của bạn' },
  'listings:write': { en: 'Post, edit, mark sold and remove your listings, and edit your shop profile', vi: 'Đăng, sửa, đánh dấu đã bán và gỡ tin đăng, và sửa hồ sơ cửa hàng của bạn' },
  'analytics:read': { en: 'See the views and leads on your listings', vi: 'Xem lượt xem và lượt liên hệ trên tin đăng của bạn' },
  'messages:read': { en: 'Read your conversations: your inbox, and the messages and offers in each chat', vi: 'Đọc các cuộc trò chuyện của bạn: hộp thư, tin nhắn và trả giá trong từng cuộc trò chuyện' },
  'messages:write': { en: 'Send messages for you, and make, counter and decline offers. An offer it makes binds you if accepted. Its messages are marked as AI; accepting an offer stays with you', vi: 'Nhắn tin thay bạn, trả giá, trả giá lại và từ chối giá. Mức giá nó đưa ra ràng buộc bạn nếu bên kia đồng ý. Tin nhắn của nó được ghi là AI; việc đồng ý một mức giá vẫn do bạn quyết định' },
}
