/**
 * THE HOME PAGE'S QUESTIONS: seven questions answered at length, in ONE accordion with the FAQ merged in (owner 2026-11-19: the FAQ
 * and the About block 'looks weird' — show less, keep the scores). Originally five questions under the FAQ (owner 2026-11-19, from the AEO checker:
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
import { POSTING_IS_FREE } from '@/lib/site-identity'

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

const ALL_SECTIONS: readonly AboutSection[] = [
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
    id: 'is-eno-free',
    q: { en: 'Is eno.vn free to use?', vi: 'Dùng eno.vn có mất phí không?' },
    open: [
      { en: 'Browsing, posting and contacting sellers on eno.vn are currently free.', vi: 'Hiện tại, xem tin, đăng tin và liên hệ người bán trên eno.vn đều miễn phí.' },
      {
        en: 'There is no listing fee and no daily charge, and eno takes no commission on what you sell yourself, so a person selling a sofa or renting out a room pays nothing to list it.',
        vi: 'Không có phí đăng tin, không thu phí theo ngày, và eno không thu hoa hồng trên những gì bạn tự bán, nên người bán sofa hay cho thuê phòng không mất gì để đăng tin.',
      },
    ],
    more: [
      [
        { en: 'Signing up is free too, with an email address or a social account. Before you publish, Vietnamese law asks you to verify your identity once.', vi: 'Đăng ký cũng miễn phí, bằng email hoặc tài khoản mạng xã hội. Trước khi đăng tin, pháp luật Việt Nam yêu cầu bạn xác minh danh tính một lần.' },
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
    id: 'post-a-listing',
    q: { en: 'How do I post a listing?', vi: 'Làm sao để đăng tin?' },
    open: [
      { en: 'Go to eno.vn/post, or tap Post in the bottom bar, add at least three photos, a description, a category, a price and an area, then tap Publish.', vi: 'Vào eno.vn/post hoặc bấm Đăng tin ở thanh dưới cùng, thêm ít nhất ba ảnh, mô tả, danh mục, giá và khu vực, rồi bấm Đăng.' },
      { en: 'You can fill in the whole form first and sign in when you publish; once your identity is verified, a listing that passes the checks goes live immediately.', vi: 'Bạn có thể điền hết biểu mẫu trước rồi đăng nhập khi đăng; khi danh tính đã được xác minh, tin đăng vượt qua bước kiểm tra sẽ hiển thị ngay.' },
    ],
    more: [
      [
        { en: 'Take the photos from three different angles, in good light, of the real item: the same picture uploaded twice counts once, and you can add up to six, plus one video of up to 60 seconds.', vi: 'Chụp ảnh từ ba góc khác nhau, đủ sáng, đúng món hàng thật: cùng một ảnh tải lên hai lần chỉ tính một, bạn thêm được tối đa sáu ảnh và một video dài tối đa 60 giây.' },
        { en: 'Write a description of at least 20 characters, with the age, the condition, what is included and why you are selling, and fill in what the category asks for, such as condition or model.', vi: 'Viết mô tả ít nhất 20 ký tự, gồm tuổi, tình trạng, những gì đi kèm và lý do bán, và điền những mục danh mục yêu cầu, như tình trạng hay mẫu mã.' },
        { en: 'Leave offers on if you are open to negotiating. Before your first listing goes live you verify your identity, and a listing in a licence-checked category waits for an admin.', vi: 'Bật nhận đề nghị nếu bạn sẵn sàng thương lượng. Trước khi tin đầu tiên được đăng, bạn xác minh danh tính, và tin trong danh mục cần kiểm tra giấy phép sẽ chờ quản trị viên duyệt.' },
      ],
    ],
  },
  {
    id: 'contact-a-seller',
    q: { en: 'How do I contact a seller?', vi: 'Làm sao để liên hệ người bán?' },
    open: [
      { en: 'Open the listing and tap the message button: that starts a chat with the seller about that item, and you need to be signed in to send it.', vi: 'Mở tin đăng và bấm nút nhắn tin: thao tác này mở cuộc trò chuyện với người bán về món đó, và bạn cần đăng nhập để gửi tin.' },
      { en: 'You can ask a question or send an offer as your first message, and the seller replies in the same chat.', vi: 'Bạn có thể hỏi hoặc gửi đề nghị giá ngay trong tin nhắn đầu tiên, và người bán trả lời trong cùng cuộc trò chuyện.' },
    ],
    more: [
      [
        { en: 'Each chat is one buyer and one seller, about one listing, and only the two of you take part in it. Ask what you need to know: is it still available, can you see it today, is the price fixed.', vi: 'Mỗi cuộc trò chuyện chỉ có một người mua và một người bán, về một tin đăng. Hãy hỏi điều bạn cần biết: món hàng còn không, xem được hôm nay không, giá có cố định không.' },
        { en: 'The seller’s phone or Zalo is not shown on the listing page. It appears inside your conversation once the seller has replied at least once.', vi: 'Số điện thoại hoặc Zalo của người bán không hiện trên trang tin đăng. Thông tin này hiện trong cuộc trò chuyện khi người bán đã trả lời bạn ít nhất một lần.' },
        { en: 'This keeps sellers from being spammed and keeps your own number private too.', vi: 'Cách này giúp người bán không bị làm phiền và giữ kín số điện thoại của bạn.' },
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
          en: 'If a seller pushes you to move to another app before replying on eno, be careful: a deposit sent outside the chat leaves no record anyone can check later.',
          vi: 'Nếu người bán ép bạn chuyển sang ứng dụng khác trước khi trả lời trên eno, hãy cẩn thận: tiền cọc chuyển ngoài cuộc trò chuyện không để lại dấu vết nào để kiểm tra sau này.',
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
        { en: 'Businesses can become official partners, shown with a partner badge. When you post, your identity check is done once (again only if the document expires), usually reviewed within a working day.', vi: 'Doanh nghiệp có thể trở thành đối tác chính thức, có huy hiệu đối tác. Khi đăng tin, bạn chỉ xác minh danh tính một lần (làm lại khi giấy tờ hết hạn), thường được duyệt trong một ngày làm việc.' },
      ],
    ],
  },
  // ── 2026-11-22: seven more (owner: the home page's content-no-js ratio, "Cards + more FAQ text"). Same rules: every sentence
  // restates live copy — /renting-an-apartment-vietnam-foreigner, /housing-vietnam-expats, /c/rentals, /hcmc-rent-index,
  // /buying-a-used-iphone-vietnam, the vehicle hubs, /jobs-vietnam-expats, /teach-in-vietnam, /schools, /partners,
  // /moving-sales-vietnam and /selling-up-before-you-leave-vietnam. No figures that move (rents, counts, prices). ⚠️ vehicle-rental
  // restates vehicle-hub-copy.ts as it stands (shops and owners post, chat in the app): change both if outbound booking links return.
  // Sources: /renting-an-apartment-vietnam-foreigner (FAQ "Can a foreigner sign…", leases, deposit, handover),
  // /housing-vietnam-expats (what you'll find, popular areas, before you pay, FAQ), /c/rentals (check up to 5 rentals).
  {
    id: 'rent-apartment-foreigner',
    q: { en: 'How do I rent an apartment in Ho Chi Minh City as a foreigner?', vi: 'Người nước ngoài thuê căn hộ ở TP.HCM như thế nào?' },
    open: [
      {
        en: 'A foreigner can sign a residential lease in Vietnam: renting a home is an ordinary contract between you and the owner.',
        vi: 'Người nước ngoài có thể ký hợp đồng thuê nhà ở Việt Nam: thuê nhà là một hợp đồng thông thường giữa bạn và chủ nhà.',
      },
      {
        en: 'On eno.vn you browse apartments, houses, rooms and serviced flats in Ho Chi Minh City by district, and the eno team checks availability on up to five you pick, free.',
        vi: 'Trên eno.vn, bạn xem căn hộ, nhà nguyên căn, phòng và căn hộ dịch vụ tại TP.HCM theo từng quận, và đội ngũ eno kiểm tra phòng trống cho tối đa năm tin bạn chọn, miễn phí.',
      },
    ],
    more: [
      [
        {
          en: 'Each listing shows the asking price, the district and photos. A linked listing’s button opens the original posting; one posted directly on eno.vn has a Message button for in-app chat.',
          vi: 'Mỗi tin ghi giá chào thuê, quận và kèm ảnh. Nút trên tin liên kết mở bài đăng gốc; tin đăng trực tiếp trên eno.vn có nút Nhắn tin để trò chuyện ngay trong ứng dụng.',
        },
      ],
      [
        {
          en: 'A standard lease runs twelve months. Check that the person signing owns the property: ask for the ownership certificate and an ID whose name matches the contract.',
          vi: 'Hợp đồng thuê thông thường kéo dài mười hai tháng. Hãy chắc rằng người ký là chủ nhà: xin xem giấy chứng nhận quyền sở hữu và giấy tờ tùy thân có tên khớp với hợp đồng.',
        },
        {
          en: 'Fix the rent in đồng for the whole term and attach an inventory. One month of rent is the usual deposit, held by the landlord directly, with no escrow.',
          vi: 'Chốt giá thuê bằng đồng cho cả thời hạn và kèm danh sách đồ đạc. Tiền cọc thường là một tháng tiền nhà, do chủ nhà giữ trực tiếp, không qua ký quỹ.',
        },
        {
          en: 'View the flat in person before any money moves. In Ho Chi Minh City the landlord customarily pays the agent, so a fee asked of you just to view a flat is worth questioning.',
          vi: 'Hãy đến xem nhà tận nơi trước khi chuyển bất kỳ khoản tiền nào. Ở TP.HCM, chủ nhà thường là bên trả phí môi giới, nên khoản phí đòi bạn chỉ để xem nhà là điều nên hỏi lại.',
        },
        {
          en: 'At handover, photograph the meters, appliances and any damage.',
          vi: 'Khi nhận nhà, hãy chụp ảnh đồng hồ điện nước, các thiết bị và mọi chỗ hư hỏng.',
        },
      ],
    ],
  },
  // Sources: /hcmc-rent-index (lede, "Median rent by district" note, "How the index is calculated", FAQ, "Cite this data").
  {
    id: 'rent-prices',
    q: { en: 'How can I check what rent costs in Ho Chi Minh City?', vi: 'Làm sao biết giá thuê nhà ở TP.HCM?' },
    open: [
      {
        en: 'eno.vn publishes the Ho Chi Minh City Rent Index at eno.vn/hcmc-rent-index: the median monthly asking rent for apartments, houses and rooms, district by district.',
        vi: 'eno.vn công bố Chỉ số giá thuê nhà TP. Hồ Chí Minh tại eno.vn/hcmc-rent-index: giá chào thuê trung vị mỗi tháng của căn hộ, nhà nguyên căn và phòng trọ, theo từng quận.',
      },
      {
        en: 'It is recalculated every day from every published rental listing on eno.vn in the city, apartments are also split into studios and by bedrooms, and you may cite the figures, crediting eno.vn.',
        vi: 'Chỉ số được tính lại mỗi ngày từ mọi tin cho thuê đang đăng trên eno.vn tại thành phố, căn hộ còn được chia theo studio và số phòng ngủ, và bạn có thể trích dẫn số liệu, ghi nguồn eno.vn.',
      },
    ],
    more: [
      [
        {
          en: 'Each cell shows the median, the middle half of asking rents and how many listings it is computed from; a dash means too few listings to publish a figure.',
          vi: 'Mỗi ô cho biết giá trung vị, khoảng giữa của giá chào và số tin dùng để tính; dấu gạch nghĩa là số tin chưa đạt ngưỡng công bố.',
        },
        {
          en: 'The median is the middle asking rent, and the middle half runs from the 25th to the 75th percentile.',
          vi: 'Trung vị là mức giá chào nằm ở giữa; khoảng giữa trải từ phân vị thứ 25 đến phân vị thứ 75.',
        },
      ],
      [
        {
          en: 'These are asking prices, not signed leases: signed rents are often lower after negotiation, so use the index to compare districts, not as a quote.',
          vi: 'Đây là giá chào thuê, không phải giá trong hợp đồng đã ký: giá ký thường thấp hơn sau thương lượng, nên hãy dùng chỉ số để so sánh các quận, đừng xem là báo giá.',
        },
        {
          en: 'Offices, vehicle hire and nightly stays are left out, and a home posted by two sellers counts once when their photos match.',
          vi: 'Văn phòng, thuê xe và lưu trú theo đêm không được tính, và một căn do hai người đăng chỉ tính một lần khi ảnh trùng nhau.',
        },
      ],
      [
        {
          en: 'Listings still labelled District 2 or 9 also count in Thu Duc City. The full table is a CSV download; please credit eno.vn when you quote it.',
          vi: 'Tin vẫn ghi Quận 2 hoặc Quận 9 đồng thời được tính trong TP Thủ Đức. Toàn bộ bảng có thể tải về dạng CSV; khi trích dẫn, vui lòng ghi nguồn eno.vn.',
        },
      ],
    ],
  },
  // Sources: /buying-a-used-iphone-vietnam (intro, "Before you go", the ten checks, shop vs private, paying, FAQ);
  // Vietnamese terms from its twin /kinh-nghiem-mua-iphone-cu.
  {
    id: 'used-iphone',
    q: { en: 'How do I buy a used iPhone safely in Vietnam?', vi: 'Mua iPhone cũ ở Việt Nam thế nào cho an toàn?' },
    open: [
      {
        en: 'Inspect the phone in your hand before you pay: an activation-locked handset, a swapped screen and a tired battery sold as new can each be detected in about ten minutes.',
        vi: 'Hãy kiểm tra máy tận tay trước khi trả tiền: máy dính iCloud, màn hình đã thay hay pin chai bán như mới đều phát hiện được trong khoảng mười phút.',
      },
      {
        en: 'Check first that iCloud is signed out and Find My is off, and walk away if the seller stalls.',
        vi: 'Việc đầu tiên là xác nhận iCloud đã đăng xuất và Tìm (Find My) đã tắt; nếu người bán trì hoãn, hãy dừng lại.',
      },
    ],
    more: [
      [
        {
          en: 'Meet somewhere public, well lit and with Wi-Fi. Match the IMEI in Settings against the box and Apple’s coverage-check page, and read Battery Health: below 85% means a replacement is due.',
          vi: 'Hẹn ở nơi công cộng, sáng sủa và có Wi-Fi. Đối chiếu IMEI trong Cài đặt với vỏ hộp và trang kiểm tra bảo hành của Apple, rồi xem Tình trạng pin: dưới 85% là sắp phải thay.',
        },
        {
          en: 'Enrol a face in Face ID, look for a Parts and Service History entry under Settings › General › About, and test every camera, port and microphone.',
          vi: 'Đăng ký thử Face ID, xem mục Lịch sử linh kiện và dịch vụ trong Cài đặt › Cài đặt chung › Giới thiệu, và thử mọi camera, cổng sạc và micro.',
        },
        {
          en: 'Then call with your own SIM and restart the phone in front of the seller.',
          vi: 'Sau đó lắp SIM của bạn gọi thử, và khởi động lại máy trước mặt người bán.',
        },
      ],
      [
        {
          en: 'A listing’s “99%” is the seller’s own cosmetic grade. A shop costs more but gives a short warranty and an address; a private sale is final.',
          vi: '“99%” trong tin đăng là mức ngoại hình do người bán tự chấm. Cửa hàng bán đắt hơn nhưng có bảo hành ngắn và địa chỉ; mua của cá nhân là mua đứt.',
        },
        {
          en: 'Pay only after the inspection, in a way that leaves a record, and never pay a deposit before seeing the handset. The full checklist is at eno.vn/buying-a-used-iphone-vietnam.',
          vi: 'Chỉ trả tiền sau khi kiểm tra, bằng cách để lại dấu vết như chuyển khoản, và không đặt cọc trước khi xem máy. Danh sách kiểm tra đầy đủ có tại eno.vn/kinh-nghiem-mua-iphone-cu.',
        },
      ],
    ],
  },
  // Sources: /motorbike-rental-ho-chi-minh-city and /car-rental-ho-chi-minh-city (ledes, price notes, "Open a … to see its details",
  // licence lines, "posted on eno.vn by rental shops and owners"); Vietnamese twins /thue-xe-may-tphcm and /thue-xe-tu-lai-tphcm.
  {
    id: 'vehicle-rental',
    q: { en: 'Can I rent a motorbike or car on eno.vn?', vi: 'Có thể thuê xe máy hoặc ô tô trên eno.vn không?' },
    open: [
      {
        en: 'Yes. eno.vn lists motorbikes and scooters for rent in Ho Chi Minh City, automatic and manual, by the day or the month, at eno.vn/motorbike-rental-ho-chi-minh-city.',
        vi: 'Có. eno.vn có xe máy cho thuê tại TP.HCM, cả xe ga lẫn xe số, thuê theo ngày hoặc theo tháng, tại eno.vn/thue-xe-may-tphcm.',
      },
      {
        en: 'Self-drive cars are gathered on one page at eno.vn/car-rental-ho-chi-minh-city, with what a day costs by car size. Rental shops and owners post them.',
        vi: 'Ô tô tự lái được gom về một trang tại eno.vn/thue-xe-tu-lai-tphcm, kèm giá thuê một ngày theo loại xe. Các tin do cửa hàng cho thuê và chủ xe đăng.',
      },
    ],
    more: [
      [
        {
          en: 'Open a vehicle to see its details, then message the shop or owner in the app to agree the price, deposit and paperwork.',
          vi: 'Bấm vào một xe để xem chi tiết, rồi nhắn tin với cửa hàng hoặc chủ xe trong ứng dụng để thỏa thuận giá, tiền cọc và giấy tờ.',
        },
        {
          en: 'The deposit, the documents a shop keeps and any delivery fee are set by each shop; for a car, ask in chat about the mileage limit and insurance before you book.',
          vi: 'Tiền cọc, giấy tờ cần để lại và phí giao xe do từng cửa hàng quy định; với ô tô, hãy hỏi qua tin nhắn về giới hạn số km và bảo hiểm trước khi đặt.',
        },
      ],
      [
        {
          en: 'A month price is not a day price times thirty: it is the separate long-term rate the shop lists.',
          vi: 'Giá theo tháng không phải giá ngày nhân ba mươi: đó là giá riêng mà cửa hàng niêm yết cho thuê dài hạn.',
        },
        {
          en: 'Cars are grouped by size, 4–5 seats or 7 seats, and each shows where it is parked; many can be delivered for a fee.',
          vi: 'Ô tô được chia theo loại 4–5 chỗ hoặc 7 chỗ, mỗi xe ghi nơi đang để; nhiều xe có giao tận nơi (có phí).',
        },
      ],
      [
        {
          en: 'Which licence is accepted depends on your nationality, the licence you hold and, for a motorbike, the size of the bike. Ask the shop before you rent.',
          vi: 'Giấy phép lái xe nào được chấp nhận còn tùy quốc tịch và loại giấy phép bạn có, với xe máy thì tùy cả dung tích xe. Hãy hỏi rõ cửa hàng trước khi thuê.',
        },
      ],
    ],
  },
  // Sources: /jobs-vietnam-expats (lede, how listings work, Apply, not verified, FAQ), /teach-in-vietnam (H1, teacher-profile line),
  // /schools (lede, vote and review rules).
  {
    id: 'teaching-jobs',
    q: { en: 'How do I find an English teaching job in Vietnam on eno.vn?', vi: 'Tìm việc dạy tiếng Anh ở Việt Nam trên eno.vn như thế nào?' },
    open: [
      {
        en: 'Go to the jobs page on eno.vn: it lists jobs teaching English in Vietnam, and other subjects taught in English, with the pay where the posting states it.',
        vi: 'Vào trang việc làm trên eno.vn: trang này liệt kê việc dạy tiếng Anh tại Việt Nam, và các môn khác dạy bằng tiếng Anh, kèm mức lương nếu tin có ghi.',
      },
      {
        en: 'A linked job’s Apply button opens the original posting, where you apply to the employer; a job posted directly on eno.vn has a chat button instead.',
        vi: 'Với việc liên kết, nút Ứng tuyển mở tin gốc để bạn nộp đơn cho nhà tuyển dụng; việc đăng trực tiếp trên eno.vn thì có nút nhắn tin.',
      },
    ],
    more: [
      [
        {
          en: 'Linked jobs come from job boards and schools’ careers pages, each with an apply-by date: the posting’s own deadline or 14 days after it was posted, whichever comes first.',
          vi: 'Việc liên kết lấy từ các trang tuyển dụng và trang tuyển dụng của trường, mỗi tin có hạn nộp: hạn của chính tin gốc hoặc 14 ngày sau khi đăng, tùy mốc nào đến trước.',
        },
        {
          en: 'eno.vn does not handle applications or see your CV, and it never charges a fee.',
          vi: 'eno.vn không xử lý hồ sơ ứng tuyển, không xem CV của bạn và không bao giờ thu phí.',
        },
      ],
      [
        {
          en: 'Or create a teacher profile: schools and others looking for a teacher can message you, and your phone, email and CV stay private until you share them.',
          vi: 'Hoặc tạo hồ sơ giáo viên: các trường và người đang tìm giáo viên có thể nhắn tin cho bạn, còn số điện thoại, email và CV được giữ kín cho đến khi bạn chia sẻ.',
        },
        {
          en: 'At eno.vn/schools, teachers who worked or interviewed at a Ho Chi Minh City school vote on it and review its pay, hours and contracts; a moderator reads every review first.',
          vi: 'Tại eno.vn/schools, giáo viên từng làm hoặc phỏng vấn ở một trường tại TP. Hồ Chí Minh bình chọn và đánh giá lương, giờ dạy, hợp đồng; mọi đánh giá đều được kiểm duyệt trước.',
        },
      ],
      [
        {
          en: 'eno.vn has not verified these employers. A real employer never asks for a fee, a deposit or payment for training before you start.',
          vi: 'eno.vn chưa xác minh các nhà tuyển dụng này. Nhà tuyển dụng thật không bao giờ đòi phí, tiền cọc hay tiền đào tạo trước khi bạn bắt đầu làm.',
        },
      ],
    ],
  },
  // Sources: /partners (every paragraph), /about (lede: "for an official partner, a partner badge").
  {
    id: 'official-partners',
    q: { en: 'What does “Official partner” mean on eno.vn?', vi: 'Huy hiệu “Đối tác chính thức” trên eno.vn có nghĩa là gì?' },
    open: [
      {
        en: 'The Official partner badge, a shield, marks a company that has signed a cooperation agreement with eno. It appears on a storefront, a listing or a chat header.',
        vi: 'Huy hiệu Đối tác chính thức, hình chiếc khiên, dành cho công ty đã ký thoả thuận hợp tác với eno. Huy hiệu hiện trên gian hàng, tin đăng hoặc đầu đoạn chat.',
      },
      {
        en: 'Any business can sell on eno, but only a company with a signed agreement carries the badge, and no seller can give it to itself.',
        vi: 'Doanh nghiệp nào cũng có thể bán hàng trên eno, nhưng chỉ công ty đã ký thoả thuận mới mang huy hiệu này, và không người bán nào tự gán được cho mình.',
      },
    ],
    more: [
      [
        {
          en: 'Before signing, eno asks for the company’s business registration, the licences its line of business needs in Vietnam, a named contact, and what the service includes and costs.',
          vi: 'Trước khi ký, eno yêu cầu giấy đăng ký doanh nghiệp, các giấy phép ngành nghề cần có để hoạt động tại Việt Nam, một đầu mối liên hệ có tên tuổi, và dịch vụ gồm những gì, giá bao nhiêu.',
        },
      ],
      [
        {
          en: 'The badge lasts only as long as the agreement, and eno can withdraw it at any time. Partners answer in eno’s own chat: a partner storefront has no phone number to reveal.',
          vi: 'Huy hiệu chỉ tồn tại khi thoả thuận còn hiệu lực, và eno có thể thu hồi bất cứ lúc nào. Đối tác trả lời ngay trong khung chat của eno: gian hàng đối tác không có số điện thoại để hiển thị.',
        },
        {
          en: 'The badge is not a trust score, an independent rating or a guarantee: it records a business relationship, which may include a commission paid to eno.',
          vi: 'Huy hiệu không phải điểm uy tín, không phải đánh giá độc lập và cũng không phải sự bảo đảm: nó ghi nhận một quan hệ kinh doanh, có thể kèm khoản hoa hồng trả cho eno.',
        },
      ],
      [
        {
          en: 'eno is the marketplace, not the provider: the contract is between the buyer and the partner.',
          vi: 'eno là sàn giao dịch, không phải bên cung cấp: hợp đồng là giữa người mua với đối tác.',
        },
        {
          en: 'If something goes wrong with a partner, open a dispute in the chat. The details are at eno.vn/partners.',
          vi: 'Nếu có vấn đề với một đối tác, hãy mở tranh chấp ngay trong khung chat. Chi tiết tại eno.vn/partners.',
        },
      ],
    ],
  },
  // Sources: /moving-sales-vietnam ("If you are the one clearing a flat…"), /selling-up-before-you-leave-vietnam
  // (timeline, pricing, listing, handover, FAQ). "Posting is free" left out on purpose: it is POSTING_IS_FREE-gated copy.
  {
    id: 'moving-sale',
    q: { en: 'How do I sell my things before leaving Vietnam?', vi: 'Làm sao bán đồ trước khi rời Việt Nam?' },
    open: [
      {
        en: 'Post each piece as its own listing on eno.vn, and start six weeks before you leave with the big, slow pieces.',
        vi: 'Đăng mỗi món thành một tin riêng trên eno.vn, và bắt đầu từ sáu tuần trước ngày đi với những món lớn, lâu bán.',
      },
      {
        en: 'Wardrobes, sofas, beds, desks, the fridge and the washing machine take the longest. Buyers can message you in the app to ask for measurements and agree a pickup date.',
        vi: 'Tủ quần áo, sofa, giường, bàn làm việc, tủ lạnh và máy giặt là những món lâu bán nhất. Người mua có thể nhắn tin cho bạn trong ứng dụng để hỏi kích thước và hẹn ngày đến lấy.',
      },
    ],
    more: [
      [
        {
          en: 'Price against what similar pieces are listed at today, not what you paid. Three weeks out, list the small things in bundles.',
          vi: 'Định giá theo những món tương tự đang rao hôm nay, không theo giá bạn đã mua. Ba tuần trước ngày đi, đăng đồ nhỏ theo từng lô.',
        },
        {
          en: 'A week out, re-price what has not moved rather than re-posting it. If a piece has to go by a fixed date, say so in the listing.',
          vi: 'Một tuần trước, định giá lại những món chưa bán được thay vì đăng lại. Nếu món nào phải bán trước một ngày nhất định, hãy ghi rõ trong tin.',
        },
      ],
      [
        {
          en: 'Photograph in daylight, give the measurements, say what is wrong with it, and name the district, the floor and whether there is a lift.',
          vi: 'Chụp ảnh dưới ánh sáng ban ngày, ghi kích thước, nói rõ món đồ có lỗi gì, và ghi quận, tầng và có thang máy hay không.',
        },
        {
          en: 'Agree the price, the time and who carries it in the chat before anyone travels, and take payment in person when the item leaves.',
          vi: 'Thống nhất giá, giờ hẹn và ai khiêng đồ ngay trong cuộc trò chuyện trước khi có ai phải đi lại, và nhận tiền trực tiếp khi món đồ được mang đi.',
        },
      ],
      [
        {
          en: 'To keep your deposit, book the lift if the building requires it, leave what the lease says stays, and photograph the empty flat as you did at handover.',
          vi: 'Để giữ tiền cọc, hãy đặt lịch thang máy nếu tòa nhà yêu cầu, để lại những gì hợp đồng ghi là thuộc căn hộ, và chụp ảnh căn hộ trống giống như lúc nhận nhà.',
        },
      ],
    ],
  },
  // ── 2026-11-22, three more on the same rules, from /trust, /safety and the help articles (trust badges, reporting, languages).
  // Sources: /help/help-trust-badges-explained (labels, what moves the score, caps, "A label is not a guarantee"),
  // /trust (lede, "What the colors mean" incl. the partner-badge line, "Reviews that can't be gamed", "Fair by design").
  {
    id: 'trust-badges',
    q: { en: 'What do the badges and trust score on eno.vn mean?', vi: 'Huy hiệu và điểm uy tín trên eno.vn có ý nghĩa gì?' },
    open: [
      {
        en: 'Every seller on eno.vn has one trust score, a number shown in colour and recomputed every day from what the account does; it cannot be bought.',
        vi: 'Mỗi người bán trên eno.vn có một điểm uy tín duy nhất, hiển thị theo màu, được tính lại mỗi ngày từ hoạt động thực tế của tài khoản; điểm này không thể mua được.',
      },
      {
        en: 'New accounts start at 60, labelled Building. Trusted, in blue, takes 85 or more, at least 3 completed deals, a clean last 90 days, and account age or reviews from different buyers.',
        vi: 'Tài khoản mới đều bắt đầu ở mức 60, nhãn Đang tích lũy. Đáng tin cậy, màu xanh, cần từ 85 điểm, ít nhất 3 giao dịch, 90 ngày không vi phạm, và đủ tuổi tài khoản hoặc đánh giá từ nhiều người mua.',
      },
    ],
    more: [
      [
        {
          en: 'Building, in slate, is a normal account, not a warning. Caution, in red, means a score under 60 or an open scam hold.',
          vi: 'Đang tích lũy, màu xám, là tài khoản bình thường, không phải cảnh báo. Cần thận trọng, màu đỏ, nghĩa là dưới 60 điểm hoặc đang bị treo vì nghi lừa đảo.',
        },
      ],
      [
        {
          en: 'The score rises with a verified phone or identity, account age, reviews from buyers who actually transacted, and completed deals.',
          vi: 'Điểm tăng nhờ số điện thoại hoặc danh tính đã xác minh, tuổi tài khoản, đánh giá của người mua đã thực sự giao dịch, và các giao dịch hoàn tất.',
        },
        {
          en: 'Reports against a seller count only after an admin confirms them, and a confirmed scam does not fade with time.',
          vi: 'Báo cáo về người bán chỉ được tính sau khi quản trị viên xác nhận, và một vụ lừa đảo đã xác nhận không mờ đi theo thời gian.',
        },
      ],
      [
        {
          en: 'On an official partner’s listings, the partner badge takes the place of the score: it records a signed agreement with eno, not a track record.',
          vi: 'Trên tin đăng của đối tác chính thức, huy hiệu đối tác thay cho điểm uy tín: huy hiệu ghi nhận thoả thuận đã ký với eno, không phải thành tích giao dịch.',
        },
        {
          en: 'A label is not a guarantee: it describes past behaviour, not your deal. Still meet in person, inspect the item, and pay only when you are holding it.',
          vi: 'Nhãn uy tín không phải là bảo đảm: nó nói về quá khứ, không nói về giao dịch của bạn. Vẫn nên gặp trực tiếp, kiểm tra hàng, và chỉ trả tiền khi đã cầm hàng trong tay.',
        },
      ],
    ],
  },
  // Sources: /help/help-how-reporting-works (what you can report, how to send one, what happens next, false reports),
  // /safety ("Reports and evidence", "Our team decides", "We don't handle your money", "If something goes wrong", red flags),
  // /help/help-why-a-listing-gets-blocked (automatic blocks and hides).
  {
    id: 'report-a-problem',
    q: { en: 'How do I report a scam or a suspicious listing on eno.vn?', vi: 'Làm sao báo cáo lừa đảo hoặc tin đăng đáng ngờ trên eno.vn?' },
    open: [
      {
        en: 'Tap Report on the listing, the seller’s profile or the conversation, pick a reason and write what happened, with dates and amounts. You need to be signed in.',
        vi: 'Bấm Báo cáo trên tin đăng, trang người bán hoặc cuộc trò chuyện, chọn lý do và viết rõ chuyện gì đã xảy ra, kèm ngày và số tiền. Bạn cần đăng nhập để gửi.',
      },
      {
        en: 'Every report opens a private case under eno.vn/disputes between you, the seller and eno’s team, where both sides can add their evidence.',
        vi: 'Mỗi báo cáo mở một hồ sơ riêng tại eno.vn/disputes giữa bạn, người bán và đội ngũ eno, nơi cả hai bên đều có thể bổ sung bằng chứng.',
      },
    ],
    more: [
      [
        {
          en: 'Reasons include scam, counterfeit goods, already sold, wrong info, duplicate, and offensive or harassment. You can add screenshots and receipts before the case deadline.',
          vi: 'Lý do gồm lừa đảo, hàng giả, đã bán, sai thông tin, tin trùng, xúc phạm hoặc quấy rối. Bạn có thể thêm ảnh chụp màn hình và biên lai trước hạn chót của hồ sơ.',
        },
        {
          en: 'Decisions are made by a person on eno’s team, not automatically. If a report is upheld, eno can take the listing down, lower the seller’s trust score, and restrict or suspend the account.',
          vi: 'Quyết định do một người trong đội ngũ eno đưa ra, không phải tự động. Nếu báo cáo được chấp nhận, eno có thể gỡ tin, hạ điểm uy tín, hạn chế hoặc khóa tài khoản người bán.',
        },
      ],
      [
        {
          en: 'A request to pay a deposit, a shipping fee or a verification fee before you have seen the item is a red flag. eno holds no money, so it cannot refund you or reverse a payment.',
          vi: 'Yêu cầu trả trước tiền cọc, phí vận chuyển hay phí xác minh khi bạn chưa xem hàng là dấu hiệu lừa đảo. eno không giữ tiền, nên không thể hoàn tiền hay hủy giao dịch cho bạn.',
        },
        {
          en: 'If money was lost, keep the chat and transfer records, contact your bank immediately and report the fraud to the local police (công an phường), then email support@eno.vn.',
          vi: 'Nếu đã mất tiền, hãy giữ lại tin nhắn và chứng từ chuyển khoản, liên hệ ngân hàng ngay và trình báo công an phường gần nhất, rồi gửi email tới support@eno.vn.',
        },
      ],
    ],
  },
  // Sources: /help/help-languages-and-how-to-switch (every paragraph), /about ("Languages" row; "the site reads in your own
  // language: listings, chat and the interface are translated as you go"; prices in đồng),
  // /help/help-description-that-answers-questions ("auto-translated into 11 languages, so simple sentences travel much better").
  {
    id: 'languages',
    q: { en: 'Can I use eno.vn in my own language?', vi: 'Có thể dùng eno.vn bằng ngôn ngữ của mình không?' },
    open: [
      {
        en: 'Yes. eno.vn is available in 11 languages: English, Vietnamese, Chinese, Korean, Japanese, Russian, Khmer, Malay, Thai, French and Hindi.',
        vi: 'Có. eno.vn có 11 ngôn ngữ: tiếng Anh, tiếng Việt, tiếng Trung, tiếng Hàn, tiếng Nhật, tiếng Nga, tiếng Khmer, tiếng Mã Lai, tiếng Thái, tiếng Pháp và tiếng Hindi.',
      },
      {
        en: 'The interface, listings and chat are translated as you go, so a post written in Vietnamese is readable in your language and a seller can read your message in theirs.',
        vi: 'Giao diện, tin đăng và tin nhắn được dịch ngay khi bạn dùng, nên tin viết bằng tiếng Việt vẫn đọc được bằng ngôn ngữ của bạn, và người bán đọc được tin nhắn của bạn bằng tiếng của họ.',
      },
    ],
    more: [
      [
        {
          en: 'The first time you visit, eno uses your device language; if it is not on the list, you get English.',
          vi: 'Lần đầu bạn vào, eno dùng ngôn ngữ của thiết bị; nếu ngôn ngữ đó không có trong danh sách, bạn sẽ thấy tiếng Anh.',
        },
        {
          en: 'To change it, tap the account icon at the top right of the header and pick a language in the panel, next to Display currency and Dark mode; the page updates immediately.',
          vi: 'Để đổi, bấm biểu tượng tài khoản ở góc trên bên phải rồi chọn ngôn ngữ trong bảng mở ra, cạnh Tiền tệ hiển thị và Chế độ tối; trang đổi ngay lập tức.',
        },
      ],
      [
        {
          en: 'Your choice is saved on the device; if you are signed in, it is also kept on your profile, so eno’s emails and notifications come in the same language.',
          vi: 'Lựa chọn được lưu trên thiết bị; nếu đã đăng nhập, eno cũng lưu vào hồ sơ để email và thông báo gửi cho bạn đúng ngôn ngữ đó.',
        },
        {
          en: 'Machine translation is not perfect, so ask the seller in the chat when a detail matters. Prices are set in Vietnamese đồng, whatever language you read in.',
          vi: 'Bản dịch máy không phải lúc nào cũng chuẩn, chi tiết nào quan trọng thì cứ hỏi lại người bán trong khung chat. Giá luôn được niêm yết bằng đồng Việt Nam, dù bạn đọc bằng ngôn ngữ nào.',
        },
        {
          en: 'If you are selling, write short, simple sentences: they travel much better through translation than long ones.',
          vi: 'Nếu bạn bán hàng, hãy viết câu ngắn và đơn giản: qua bản dịch, câu ngắn dễ hiểu hơn nhiều so với câu dài.',
        },
      ],
    ],
  },
]

/**
 * ⛔ "Is eno.vn free to use?" is drawn only while POSTING_IS_FREE (src/lib/site-identity.ts), as the FAQ's free answer always was:
 * if the owner turns paid posting on, the page and its FAQPage markup stop saying "currently free" in the same build.
 */
export const HOME_ABOUT: readonly AboutSection[] = ALL_SECTIONS.filter((s) => s.id !== 'is-eno-free' || POSTING_IS_FREE)

/** Words in an English text, as the AEO checkers count them. */
export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w)).length
