// Canned moderation messages — prefill the admin→user composer, then edit before sending.
// Vietnamese (the market); an admin can tweak per case. Static config; promote to a table
// later if the library grows.
export const MOD_MACROS: { label: string; text: string }[] = [
  {
    label: 'Off-platform deposit warning',
    text: 'Cảnh báo từ eno.vn: tuyệt đối không chuyển cọc hay thanh toán ngoài ứng dụng. Hãy giữ mọi liên hệ và giao dịch trên eno.vn để được bảo vệ.',
  },
  {
    label: 'Need more detail',
    text: 'Cảm ơn bạn đã báo cáo. Bạn có thể gửi thêm chi tiết (ảnh chụp màn hình, nội dung tin nhắn) để chúng tôi xử lý nhanh và chính xác hơn không?',
  },
  {
    label: 'Listing removed — policy',
    text: 'Tin đăng của bạn đã bị gỡ vì vi phạm chính sách eno.vn. Vui lòng chỉnh sửa cho đúng quy định rồi đăng lại.',
  },
  {
    label: 'Account warning',
    text: 'Đây là cảnh báo từ eno.vn về hoạt động trên tài khoản của bạn. Vi phạm tiếp theo có thể khiến tài khoản bị hạn chế đăng tin.',
  },
  {
    label: 'Resolved — thanks',
    text: 'Cảm ơn bạn đã báo cáo. Chúng tôi đã xem xét và xử lý. eno.vn an toàn hơn nhờ có bạn!',
  },
]
