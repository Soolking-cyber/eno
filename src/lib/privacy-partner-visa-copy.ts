/**
 * eno.vn's /privacy section for the PARTNER e-Visa flow (owner, 2026-10-06: "have evisa application flow in the app via
 * eno.vn so when customers send to vietkite via message they can quick check and send needed documents only passport
 * photo and 3x4 portrait image"). eno.forum's own text is privacy-services-copy.ts and does not apply here: it describes
 * eno.forum as VietKite's processor and a full application form, neither of which is true of eno.vn.
 *
 * ⛔ DRAFT FOR OWNER + COUNSEL APPROVAL — every sentence below is legal text. Change both languages together.
 * ⚠️ ALIASED like privacy-services-copy.ts: next.config.ts swaps in the empty stub on a marketplace build WITHOUT
 * MARKETPLACE_HOSTS_SERVICES, so the words ship only where the flow does; the page renders it only when !IS_SERVICES.
 * Each claim was read out of the code on 2026-10-06 — the file is named beside it. Change the code → change this.
 */
export type PartnerVisaPrivacyText = { en: string; vi: string }
export type PartnerVisaPrivacySection = [string, PartnerVisaPrivacyText, PartnerVisaPrivacyText[]]

export const PRIVACY_PARTNER_VISA_SECTIONS: PartnerVisaPrivacySection[] = [
  [
    // Same anchor as eno.forum's section, so one link (/privacy#visa-applications) works on both sites.
    'visa-applications',
    { en: 'e-Visa photos you send to a seller', vi: 'Ảnh hồ sơ e-Visa bạn gửi cho người bán' },
    [
      {
        // visa-cards.tsx step 1 (passport + portrait) · extract/route.svc.ts (fields read from the passport) · dm-flow.ts (the product chosen)
        en: 'Some sellers on eno.vn offer help with a Vietnam e-Visa. If you use one, you send that seller two photos in the chat: the data page of your passport and a portrait photo. We store both images and the e-Visa service you chose, and — when the automatic check runs — the details printed on the passport page that the check reads from the image: name, date and place of birth, sex, nationality, passport number and its issue and expiry dates.',
        vi: 'Một số người bán trên eno.vn cung cấp dịch vụ hỗ trợ xin e-Visa Việt Nam. Nếu bạn sử dụng, bạn gửi cho người bán đó hai ảnh trong cuộc trò chuyện: trang thông tin hộ chiếu và ảnh chân dung. Chúng tôi lưu cả hai ảnh và dịch vụ e-Visa bạn đã chọn, và — khi bước kiểm tra tự động được thực hiện — các thông tin in trên trang hộ chiếu mà bước kiểm tra đọc được từ ảnh: họ tên, ngày và nơi sinh, giới tính, quốc tịch, số hộ chiếu cùng ngày cấp và ngày hết hạn.',
      },
      {
        // extract/route.svc.ts (Gemini, global endpoint) · ai-consent.ts family `document_check` · image-normalization.ts
        en: 'Before the photos reach the seller they are checked against the e-Visa photo rules: by our own checks (file type, size, readability) and by Google’s Gemini AI model (Google’s global endpoint, outside Vietnam), which receives both images and reads the passport page. In the eno apps you are asked first; if you say no, the photos are sent to the seller unchecked and the seller checks them by hand. A check can ask you for a clearer photo; it never decides a visa application.',
        vi: 'Trước khi đến người bán, ảnh được kiểm tra theo yêu cầu ảnh e-Visa: bằng các bước kiểm tra của chúng tôi (định dạng, kích thước, độ rõ) và bằng mô hình AI Gemini của Google (điểm truy cập toàn cầu của Google, ngoài Việt Nam), mô hình này nhận cả hai ảnh và đọc trang hộ chiếu. Trong ứng dụng eno, bạn sẽ được hỏi trước; nếu bạn không đồng ý, ảnh được gửi cho người bán mà chưa kiểm tra và người bán sẽ tự kiểm tra. Bước kiểm tra có thể đề nghị bạn gửi ảnh rõ hơn; bước này không bao giờ quyết định kết quả hồ sơ thị thực.',
      },
      {
        // submit/route.svc.ts (the send) · desk-operator.ts (the seller's scope: only its own cases) · bundle route
        en: 'When you press Send, the seller named on the listing can open the two images and the passport details, to prepare and file your application with the Vietnamese authorities and to agree its fee with you in the chat. The seller handles your application under its own responsibility and its own obligations under Vietnamese law. eno.vn is the marketplace: it is not a government agency and does not decide visa applications. The official e-Visa portal is https://evisa.gov.vn.',
        vi: 'Khi bạn nhấn Gửi, người bán có tên trên tin đăng có thể mở hai ảnh và thông tin hộ chiếu để chuẩn bị, nộp hồ sơ của bạn cho cơ quan chức năng Việt Nam và thỏa thuận phí với bạn trong cuộc trò chuyện. Người bán xử lý hồ sơ của bạn theo trách nhiệm và nghĩa vụ pháp lý của chính mình theo pháp luật Việt Nam. eno.vn là sàn giao dịch: không phải cơ quan nhà nước và không quyết định kết quả hồ sơ thị thực. Cổng thông tin e-Visa chính thức là https://evisa.gov.vn.',
      },
      {
        // crypto.ts (AES-256-GCM) · storage.ts (private bucket) · visa-admin.ts (retention on the final outcome) · account-erasure.ts
        en: 'The details are stored encrypted and the images in private storage that cannot be reached from the internet. When the seller closes your case — issued, refused or cancelled — a retention window starts, and at its end the images and details are deleted automatically. You can delete an unsent application, or your account, at any time, and the files go with it. Copies the seller keeps after you send them are governed by the seller’s own obligations.',
        vi: 'Thông tin được lưu dưới dạng mã hóa và ảnh được lưu trong kho lưu trữ riêng không truy cập được từ internet. Khi người bán đóng hồ sơ — được cấp, bị từ chối hoặc bị hủy — thời hạn lưu trữ bắt đầu, và khi hết thời hạn, ảnh và thông tin được xóa tự động. Bạn có thể xóa hồ sơ chưa gửi, hoặc xóa tài khoản, bất cứ lúc nào, và các tệp sẽ bị xóa theo. Bản sao người bán lưu giữ sau khi bạn gửi chịu sự điều chỉnh của nghĩa vụ của chính người bán.',
      },
      {
        // start/route.svc.ts (Meta CAPI InitiateCheckout) · meta-capi.ts (consent v2 `d`; never inside the apps — consent-value.ts)
        en: 'Only if you switch on Advertising on the website: when you start an e-Visa application, Meta is told that one was started, with your account identifier scrambled (hashed), your IP address and browser details — never the photos or the passport details. Inside the eno apps this never happens.',
        vi: 'Chỉ khi bạn bật Quảng cáo trên website: khi bạn bắt đầu một hồ sơ e-Visa, Meta được thông báo rằng một hồ sơ đã được bắt đầu, kèm mã tài khoản đã được xáo trộn (băm), địa chỉ IP và thông tin trình duyệt — không bao giờ kèm ảnh hay thông tin hộ chiếu. Trong ứng dụng eno, việc này không bao giờ xảy ra.',
      },
    ],
  ],
]

/** Appended to "Who else receives your data". */
export const PRIVACY_PARTNER_VISA_RECIPIENTS: PartnerVisaPrivacyText[] = [
  {
    en: 'The seller of an e-Visa service you choose receives the passport photo (with the details printed on it) and the portrait when you press Send (see “e-Visa photos you send to a seller”), and Google (Gemini) receives both images for the automatic check — unless you decline that check in the eno apps.',
    vi: 'Người bán dịch vụ e-Visa bạn chọn nhận ảnh hộ chiếu (cùng các thông tin in trên đó) và ảnh chân dung khi bạn nhấn Gửi (xem mục “Ảnh hồ sơ e-Visa bạn gửi cho người bán”), và Google (Gemini) nhận cả hai ảnh cho bước kiểm tra tự động — trừ khi bạn từ chối bước kiểm tra này trong ứng dụng eno.',
  },
]
