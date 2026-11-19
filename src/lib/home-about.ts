/**
 * THE HOME PAGE'S "ABOUT eno.vn" BLOCK: five questions answered at length, under the FAQ (owner 2026-11-19, from the AEO checker:
 * "Answer-first opener after H2 headings", "2,000+ word count", "Expert quotes / attribution"; placed at the bottom of the home page,
 * with a founder quote the owner approves).
 *
 * ⛔ NO NEW CLAIMS. Every sentence restates copy that already stands on eno.vn: /about (what eno is, the 11 languages, automated
 * checks, trust score and partner badge, "How eno earns"), the home FAQ (src/lib/home-faq.ts: free, contact, payments, AI
 * assistants), the Operating Regulations (fees only on a closed, eno-sent deal; no fee for your own listings), the publish gate's
 * identity copy (one check before a first listing, reviewed within a working day) and /llms.txt. Change a fact there, change it here.
 * ⚠️ THE SHAPE IS THE POINT: each H2 opens with a 40-60 word direct answer (`open`), and each section runs 120-180 words in all
 * (home-about.test.ts holds both). AI answer engines lift passages, so each section must stand alone.
 * ⚠️ Every string stays under 200 characters: gen-ui-strings harvests `{ en, vi }` pairs up to that length for the nine
 * machine-translated languages. A paragraph is a list of such pieces, drawn as one <p>.
 * eno.vn only: the site the copy names (eno.forum has no home page of its own any more).
 */
export type AboutText = { en: string; vi: string }
export type AboutSection = { id: string; q: AboutText; open: AboutText[]; more: AboutText[][] }

/** The owner's words, approved by the owner (2026-11-19). Never put words in a real person's mouth they did not approve. */
export const FOUNDER_QUOTE: { text: AboutText; by: AboutText } = {
  text: {
    en: 'eno is a classified marketplace for expats and locals in Vietnam, and for the AI agents that work for them. People set the goal and the limits; their agents do the legwork.',
    vi: 'eno là sàn rao vặt cho người nước ngoài và người Việt tại Việt Nam, và cho cả các trợ lý AI làm việc cho họ. Con người đặt mục tiêu và giới hạn; trợ lý AI làm phần việc còn lại.',
  },
  by: { en: 'Shanazar Babakulyyev, Founder of eno.vn', vi: 'Shanazar Babakulyyev, nhà sáng lập eno.vn' },
}

export const HOME_ABOUT: readonly AboutSection[] = [
  {
    id: 'what-is-eno',
    q: { en: 'What is eno.vn?', vi: 'eno.vn là gì?' },
    open: [
      { en: 'eno.vn is a classifieds marketplace for people in Vietnam and the AI agents that work for them.', vi: 'eno.vn là sàn rao vặt dành cho mọi người tại Việt Nam và các trợ lý AI làm việc cho họ.' },
      {
        en: 'Expats and locals use it to rent homes and vehicles, find jobs, buy and sell used goods and find services, in 11 languages, on the web and in the iPhone and Android apps.',
        vi: 'Người nước ngoài và người Việt dùng eno để thuê nhà và xe, tìm việc, mua bán đồ cũ và tìm dịch vụ, bằng 11 ngôn ngữ, trên web và ứng dụng iPhone, Android.',
      },
    ],
    more: [
      [
        {
          en: 'People, local shops and official partner stores post here, so one search covers apartments and rooms, used phones and furniture, cars and motorbikes, teaching jobs and everyday services.',
          vi: 'Người dùng, cửa hàng địa phương và cửa hàng đối tác chính thức cùng đăng tin tại đây, nên một lần tìm là thấy căn hộ, phòng trọ, đồ cũ, xe cộ, việc dạy học và dịch vụ.',
        },
        {
          en: 'Each listing shows the price, the area and the seller, and listings and chat are translated automatically, so a buyer and a seller who speak different languages understand each other.',
          vi: 'Mỗi tin đăng ghi rõ giá, khu vực và người bán; tin đăng và tin nhắn được dịch tự động, nên người mua và người bán nói khác ngôn ngữ vẫn hiểu nhau.',
        },
      ],
    ],
  },
  {
    id: 'what-eno-costs',
    q: { en: 'What does it cost to use eno.vn?', vi: 'Dùng eno.vn tốn bao nhiêu?' },
    open: [
      { en: 'Browsing, posting and contacting sellers on eno.vn are currently free.', vi: 'Hiện tại, xem tin, đăng tin và liên hệ người bán trên eno.vn đều miễn phí.' },
      {
        en: 'There is no listing fee and no daily charge, and eno takes no commission on what you sell yourself, so a person selling a sofa or renting out a room pays nothing to list it.',
        vi: 'Không có phí đăng tin, không thu phí theo ngày, và eno không thu hoa hồng trên những gì bạn tự bán, nên người bán sofa hay cho thuê phòng không mất gì để đăng tin.',
      },
    ],
    more: [
      [
        { en: 'Signing up is free too, with an email address or a social account, and Vietnamese law requires sellers to verify their identity before publishing.', vi: 'Đăng ký cũng miễn phí, bằng email hoặc tài khoản mạng xã hội, và pháp luật Việt Nam yêu cầu người bán xác minh danh tính trước khi đăng tin.' },
        {
          en: 'eno’s income comes from businesses: service partners pay for its marketing and lead service, and only when a deal eno sent them closes.',
          vi: 'Thu nhập của eno đến từ doanh nghiệp: đối tác dịch vụ trả phí cho dịch vụ tiếp thị và tìm khách của eno, và chỉ khi giao dịch eno giới thiệu thành công.',
        },
        {
          en: 'eno may also earn a commission from some partner shops when someone buys through a link here, which does not change the price you pay. The fees are set out at eno.vn/regulations.',
          vi: 'eno cũng có thể nhận hoa hồng từ một số cửa hàng đối tác khi có người mua qua đường dẫn tại đây, và giá bạn trả không đổi. Mức phí được công bố tại eno.vn/regulations.',
        },
      ],
    ],
  },
  {
    id: 'ai-agents-on-eno',
    q: { en: 'How do AI agents use eno.vn?', vi: 'Trợ lý AI dùng eno.vn như thế nào?' },
    open: [
      { en: 'AI assistants such as Claude and Grok can connect to eno.vn and search its listings for you.', vi: 'Các trợ lý AI như Claude và Grok có thể kết nối với eno.vn và tìm tin giúp bạn.' },
      {
        en: 'Once you sign in and allow it, your assistant can also post, message sellers and negotiate; every agent message is labelled 🤖 AI, and only you can accept an offer.',
        vi: 'Sau khi bạn đăng nhập và cho phép, trợ lý còn có thể đăng tin, nhắn tin cho người bán và trả giá; mọi tin nhắn của AI đều được gắn nhãn 🤖 AI, và chỉ bạn mới chấp nhận được đề nghị.',
      },
    ],
    more: [
      [
        {
          en: 'eno is listed in Claude’s connector directory, and its MCP servers are in the official MCP Registry, so any AI tool that speaks MCP can find and use it.',
          vi: 'eno có trong danh mục kết nối của Claude, và các máy chủ MCP của eno có trong MCP Registry chính thức, nên mọi công cụ AI hỗ trợ MCP đều tìm và dùng được.',
        },
        {
          en: 'Shops can sync and manage their whole catalogue from an AI chat, and AI search engines can read eno’s llms.txt and markdown pages. Details are at eno.vn/developers.',
          vi: 'Cửa hàng có thể đồng bộ và quản lý toàn bộ sản phẩm từ cuộc trò chuyện với AI, và công cụ tìm kiếm AI đọc được llms.txt và trang markdown của eno. Chi tiết tại eno.vn/developers.',
        },
      ],
      [
        {
          en: 'eno is building toward a marketplace where agents do more of the work for their owners, listing, selling and arranging delivery, with people always in control.',
          vi: 'eno đang hướng tới một sàn mua bán nơi trợ lý AI làm nhiều việc hơn cho chủ của mình, từ đăng tin, bán hàng đến sắp xếp giao hàng, và con người luôn nắm quyền quyết định.',
        },
      ],
    ],
  },
  {
    id: 'is-eno-safe',
    q: { en: 'Is it safe to buy and sell on eno.vn?', vi: 'Mua bán trên eno.vn có an toàn không?' },
    open: [
      {
        en: 'eno.vn never holds your money: you pay the seller directly, after checking the item, and anyone asking you to pay eno or into an “eno escrow” is running a scam.',
        vi: 'eno.vn không bao giờ giữ tiền của bạn: bạn trả trực tiếp cho người bán sau khi đã kiểm tra món hàng, và ai bảo bạn chuyển tiền cho eno hay “ký quỹ eno” là lừa đảo.',
      },
      { en: 'Sellers who post from an account show a public trust score or an official partner badge.', vi: 'Người bán đăng tin từ tài khoản có điểm uy tín công khai hoặc huy hiệu đối tác chính thức.' },
    ],
    more: [
      [
        { en: 'Automated checks run on every post, and anyone can report a listing, a seller or a chat that is not what it claims to be.', vi: 'Mọi tin đăng đều qua kiểm tra tự động, và ai cũng có thể báo cáo tin đăng, người bán hoặc cuộc trò chuyện không đúng như mô tả.' },
        {
          en: 'Listings posted on eno do not show the seller’s phone number: you message the seller about the listing, and their phone or Zalo appears in the chat once they reply.',
          vi: 'Tin đăng trên eno không hiện số điện thoại của người bán: bạn nhắn tin về tin đăng, và số điện thoại hoặc Zalo của người bán sẽ hiện trong cuộc trò chuyện khi họ trả lời.',
        },
        { en: 'Meet in a public place, check the item before you pay, and never send a deposit to someone you have not met in person.', vi: 'Hãy gặp ở nơi công cộng, kiểm tra món hàng trước khi trả tiền, và đừng chuyển tiền cọc cho người bạn chưa từng gặp trực tiếp.' },
      ],
    ],
  },
  {
    id: 'who-eno-is-for',
    q: { en: 'Who is eno.vn for?', vi: 'eno.vn dành cho ai?' },
    open: [
      { en: 'eno.vn is for anyone in Vietnam who wants to rent, hire, buy or sell.', vi: 'eno.vn dành cho bất kỳ ai tại Việt Nam muốn thuê, tuyển người, mua hay bán.' },
      {
        en: 'That includes expats and visitors looking for a home, a motorbike or a job, and Vietnamese landlords, shops and sellers who want to reach them as well as local buyers.',
        vi: 'Đó là người nước ngoài và du khách cần nhà, xe máy hay việc làm, và cả chủ nhà, cửa hàng, người bán Việt Nam muốn tiếp cận họ cũng như người mua trong nước.',
      },
    ],
    more: [
      [
        {
          en: 'The site and apps work in 11 languages, from English and Vietnamese to Chinese, Korean, Japanese and Russian, so newcomers can use eno in their own language from day one.',
          vi: 'Trang web và ứng dụng có 11 ngôn ngữ, từ tiếng Anh, tiếng Việt đến tiếng Trung, Hàn, Nhật và Nga, nên người mới đến dùng được eno bằng tiếng của mình ngay từ đầu.',
        },
        {
          en: 'Teachers can create a free profile that schools browse, schools and businesses can post jobs, and students and families can find a tutor among the teacher profiles.',
          vi: 'Giáo viên có thể tạo hồ sơ miễn phí để trường học tìm, trường học và doanh nghiệp có thể đăng tin tuyển dụng, và học sinh, phụ huynh tìm được gia sư trong các hồ sơ giáo viên.',
        },
        { en: 'Businesses can become official partners, shown with a partner badge. Sellers verify their identity once (again only if the document expires), usually reviewed within a working day.', vi: 'Doanh nghiệp có thể trở thành đối tác chính thức, có huy hiệu đối tác. Người bán xác minh danh tính một lần (làm lại khi giấy tờ hết hạn), thường được duyệt trong một ngày làm việc.' },
      ],
    ],
  },
]

/** Words in an English text, as the AEO checkers count them. */
export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w)).length
