import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * THAY PIN iPHONE Ở ĐÂU — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the two articles answer different questions on purpose. The
 * English page (/iphone-battery-replacement-vietnam) spends its length on what a foreign reader
 * cannot assume: what the Settings screens mean, whether a handset bought abroad can be serviced
 * here, and the two Vietnamese words to say at the counter. A Vietnamese reader knows all of that
 * and is asking something else entirely — pin zin bóc máy or pin công ty, what an IC lập trình
 * does to the health reading, whether the phone survives rain afterwards, how long a shop's own
 * bảo hành is worth. Machine-translating either page would answer the wrong questions twice.
 *
 * ⚠️ MỌI BƯỚC KIỂM TRA ĐỀU LÀM ĐƯỢC NGAY TRÊN MÁY. A guide that says "chọn cửa hàng uy tín" is
 * worth nothing to a reader and ranks for nothing; every claim here is verifiable in under a minute.
 *
 * ⛔ NO SHOP IS NAMED OR RANKED. The marketplace lists several of these retailers and earns
 * affiliate revenue from some, so a ranking here would be an advertisement with an editorial byline.
 */
const SLUG = 'thay-pin-iphone-o-dau'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang sửa chữa',
  h1: 'Thay pin iPhone ở đâu',
  intro:
    'Thay pin là việc sửa iPhone phổ biến nhất và cũng là chỗ linh kiện chênh lệch nhiều nhất. Bài này nói rõ khi nào con số phần trăm mới thực sự là lúc phải thay, ba loại pin đang bán trên thị trường khác nhau ở đâu, máy báo gì khi lắp pin không được ghép, và những bước kiểm tra để không bị tráo pin ngay tại quầy.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/iphone-battery-replacement-vietnam' },
  sections: [
    {
      id: 'khi-nao-can-thay',
      title: 'Khi nào thật sự cần thay pin',
      body: (
        <>
          <P>
            Mở <strong>Cài đặt › Pin › Tình trạng pin và sạc</strong>. Dung lượng tối đa là phần trăm
            so với chính viên pin lúc máy xuất xưởng, không phải so với máy của người khác. Apple coi
            viên pin đã hết vòng đời khi xuống dưới 80%, và đó là con số mọi quầy dịch vụ đều nhắc
            &mdash; nhưng một mình nó không phải là lệnh phải thay. Máy 82% mà vẫn đủ dùng hết ngày
            thì chưa cần đụng vào. Máy 88% mà sập nguồn lúc còn 30% thì phải thay luôn.
          </P>
          <P>Dấu hiệu quan trọng hơn con số. Gặp một trong những điều dưới đây là nên thay:</P>
          <Ul>
            <li>
              Sập nguồn đột ngột khi pin vẫn còn vài chục phần trăm &mdash; hay gặp nhất lúc mở
              camera hoặc khi ngồi trong phòng lạnh.
            </li>
            <li>
              Máy hiện thông báo đã áp dụng chế độ quản lý hiệu năng sau một lần tắt nguồn ngoài ý
              muốn. Đó là iOS tự hạ xung để máy khỏi sập lần nữa.
            </li>
            <li>Cắm sạc mà máy nóng lên rõ rệt dù không chạy ứng dụng gì nặng.</li>
            <li>
              Màn hình hoặc mặt lưng kênh lên một cạnh, ốp không còn ôm sát: pin phồng. Ngừng sạc,
              không đè, không chọc, mang đi thay càng sớm càng tốt.
            </li>
            <li>Để máy yên trong túi mà pin vẫn tụt thấy rõ.</li>
          </Ul>
          <P>
            Để biết thế nào là hao mòn bình thường: các đời iPhone cũ được Apple công bố giữ khoảng
            80% dung lượng sau chừng 500 chu kỳ sạc đầy, còn từ thế hệ iPhone 15 con số này được nâng
            lên khoảng 1.000 chu kỳ. Một chu kỳ là cộng dồn đủ 100%, không phải một lần cắm sạc, nên
            hai ngày sạc nửa vời mới tính là một chu kỳ. Từ iPhone 15 trở lên bạn xem được trực tiếp
            trong <strong>Cài đặt › Cài đặt chung › Giới thiệu</strong>: Số chu kỳ sạc, Ngày sản xuất
            và Lần sử dụng đầu tiên.
          </P>
          <P>
            Thứ làm pin chai nhanh nhất ở Việt Nam là nhiệt, và đây là phần sửa được. Apple khuyến
            nghị dùng máy trong khoảng 0&ndash;35°C; điện thoại kẹp trên giá xe máy giữa trưa nắng
            vượt xa mức đó, mà pin lithium xuống cấp nhanh nhất đúng vào lúc vừa nóng vừa đang sạc.
            Mỗi năm tụt vài phần trăm là chuyện bình thường; tụt cả chục phần trăm sau một mùa hè thì
            thường là do cái giá đỡ trên xe chứ không phải do máy.
          </P>
        </>
      ),
    },
    {
      id: 'ba-loai-pin',
      title: 'Ba loại pin đang bán, khác nhau ở đâu',
      body: (
        <>
          <P>
            <strong>Pin chính hãng thay tại trung tâm bảo hành ủy quyền (AASP).</strong> Apple chưa
            có cửa hàng riêng tại Việt Nam, nên đây là các quầy dịch vụ ủy quyền trong chuỗi lớn hoặc
            trung tâm bảo hành riêng. Pin mới được ghép đúng với máy bằng phần mềm, nên mục Tình
            trạng pin vẫn hiển thị bình thường; lần sửa được ghi vào
            Lịch sử linh kiện và dịch vụ của chính chiếc máy; keo chống nước được thay; và bảo hành
            linh kiện không phụ thuộc vào việc một cửa hàng cụ thể còn tồn tại hay không. Đổi lại,
            đây là lựa chọn đắt nhất, cần serial hoặc IMEI, và máy đời cũ có thể phải đặt linh kiện
            chờ vài ngày.
          </P>
          <P>
            <strong>Pin zin bóc máy.</strong> Cell thật của Apple, tháo ra từ một chiếc máy khác. Chất
            lượng cell nhỉnh hơn hàng chợ, nhưng đó là pin đã qua sử dụng và gần như không ai biết nó
            đã chạy bao nhiêu chu kỳ. Quan trọng hơn: vì không được ghép với máy của bạn nên máy vẫn
            báo &ldquo;Bộ phận không xác định&rdquo; đúng như pin ngoài.
          </P>
          <P>
            <strong>Pin công ty, hay được gọi là &ldquo;pin dung lượng cao&rdquo;.</strong> Cell do
            bên thứ ba sản xuất. Con số dung lượng in trên vỏ thường cao hơn pin gốc, nhưng đó là
            thông số nhà sản xuất tự công bố, và nhét thêm dung lượng vào đúng một khoang máy đó
            thường phải đánh đổi ở tuổi thọ hoặc độ an toàn. Đây là loại phổ
            biến nhất ở các tiệm &ldquo;thay pin lấy ngay&rdquo;.
          </P>
          <P>
            Hỏi thẳng ba câu trước khi đồng ý, và cửa hàng làm ăn tử tế trả lời được cả ba: lắp loại
            pin nào, bảo hành bao lâu và ghi vào phiếu hay không, có thay keo chống nước không. Máy
            còn bảo hành Apple thì đừng cân nhắc gì thêm &mdash; thay ngoài là tự bỏ phần bảo hành đã
            trả tiền.
          </P>
        </>
      ),
    },
    {
      id: 'may-bao-gi-khi-thay-pin-ngoai',
      title: 'Thay pin ngoài thì máy báo gì',
      body: (
        <>
          <P>
            Từ iOS 15 và 16 trở đi, viên pin không được ghép với máy sẽ làm hiện &ldquo;Thông báo
            quan trọng về pin&rdquo;, và màn hình Tình trạng pin ngừng hiển thị Dung lượng tối đa:
            chỗ đáng lẽ là phần trăm sẽ ghi <strong>Bộ phận không xác định</strong>. Từ iPhone 15 trở
            lên còn một nơi nữa để xem &mdash; <strong>Cài đặt › Cài đặt chung › Giới thiệu</strong>{' '}
            có mục Lịch sử linh kiện và dịch vụ, ghi rõ pin là <em>Bộ phận chính hãng của Apple</em>{' '}
            hay <em>Bộ phận không xác định</em>.
          </P>
          <P>Hai điều hay bị hiểu sai ở đây:</P>
          <Ul>
            <li>
              Máy không bị khóa, không bị bóp hiệu năng, không bị gì cả. Cái mất là chính chỉ số tình
              trạng pin &mdash; mất vĩnh viễn với viên pin đó, nên lần sau bạn không còn căn cứ nào
              để biết pin chai tới đâu.
            </li>
            <li>
              Pin zin bóc máy cũng báo y hệt. Vấn đề nằm ở việc ghép pin với máy chứ không phải cell
              thật hay cell nhái. Apple gần đây có mở dần việc hiệu chỉnh linh kiện chính hãng đã qua
              sử dụng trên các đời mới, nhưng đó là một bước làm bằng phần mềm, và thay ở tiệm ngoài
              thường không có bước đó.
            </li>
          </Ul>
          <P>
            Còn một thứ ít ai nhắc: máy đã mở ra thì chuẩn kháng nước lúc xuất xưởng coi như không
            còn, trừ khi gioăng và keo được thay đúng loại &mdash; mà kể cả vậy, Apple vẫn khuyến cáo
            không nên coi một chiếc máy đã sửa là còn chống nước.
          </P>
        </>
      ),
    },
    {
      id: 'tranh-bi-trao-pin',
      title: 'Tránh bị tráo pin: kiểm tra trước và sau khi thay',
      body: (
        <>
          <P>
            Có hai chuyện khác nhau hay bị gộp chung thành &ldquo;lừa đảo thay pin&rdquo;, và dấu vết
            để lại cũng khác nhau. Một là tráo thẳng: báo giá loại pin này, lắp vào loại khác &mdash;
            hoặc tháo luôn viên pin gốc còn tốt của bạn ra để bán lại. Hai là pin đã lập trình IC:
            cell hàng chợ gắn bo mạch báo dung lượng tùy ý. Máy khi đó hiện 100% sạch sẽ, không có
            dòng cảnh báo nào, cũng không báo &ldquo;Bộ phận không xác định&rdquo;.
          </P>
          <P>
            Dấu hiệu của pin lập trình IC nằm ở cách nó cư xử theo thời gian: con số đứng nguyên
            đúng 100% suốt nhiều tháng không nhúc nhích (pin thật thường
            tụt một hai phần trăm ngay trong vài tháng đầu), số chu kỳ sạc không tăng, và thời gian
            dùng thực tế không khớp với con số đẹp trên màn hình.
          </P>
          <P>
            Những bước dưới đây không tốn gì, và cửa hàng nào từ chối một trong số đó thì đấy cũng
            đã là câu trả lời:
          </P>
          <Ul>
            <li>
              Chụp màn hình Tình trạng pin và trang Giới thiệu (có serial, IMEI) trước khi giao máy.
            </li>
            <li>
              Yêu cầu thay ngay tại quầy, trong tầm mắt. Tiệm nào bắt buộc phải mang máy đi nơi khác
              là một lựa chọn khác hẳn, và đáng được tin ở mức khác.
            </li>
            <li>Xin lại viên pin cũ. Đây là yêu cầu bình thường và nó xóa luôn động cơ tráo hàng.</li>
            <li>
              Máy từ iPhone 15 trở lên: xem lại Số chu kỳ sạc và Ngày sản xuất sau khi thay. Pin mới
              thật phải ở mức vài chu kỳ và ngày sản xuất phải gần đây.
            </li>
            <li>
              Trước khi rời tiệm, thử lại Face ID, camera trước, cảm biến tiệm cận (áp máy vào tai khi
              gọi thì màn hình phải tắt) và đèn flash. Cáp của mấy bộ phận này chạy ngay trên khoang
              pin và là thứ hay bị vạ lây nhất.
            </li>
            <li>Yêu cầu ghi thời hạn bảo hành pin kèm IMEI lên phiếu, không nhận lời hứa miệng.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'giu-pin-lau-chai',
      title: 'Giữ cho viên pin mới lâu chai',
      body: (
        <>
          <P>
            Thay xong thì việc còn lại là đừng lặp lại thói quen đã giết viên pin cũ &mdash; phần
            lớn nằm ở nhiệt độ chứ không ở số lần cắm sạc.
          </P>
          <Ul>
            <li>
              Bật <strong>Sạc tối ưu</strong>. Từ iPhone 15 có thêm tùy chọn giới hạn sạc ở mức 80%,
              hợp với người tối nào cũng cắm sạc qua đêm.
            </li>
            <li>
              Đừng vừa sạc vừa chơi game nặng hay quay video dài. Nhiệt cộng dồn trong lúc sạc là thứ
              bào pin nhanh nhất.
            </li>
            <li>
              Máy nóng khi sạc thì tháo ốp dày ra; và đừng để máy trong cốp xe hay trên taplo ô tô
              giữa trưa.
            </li>
            <li>
              Sạc nhanh bản thân nó không phải vấn đề; củ sạc trôi nổi thì có, vì rủi ro nằm ở điện
              áp không ổn định.
            </li>
          </Ul>
          <P>
            Cuối cùng, khi máy vừa chai pin vừa mờ màn hình vừa rơ camera thì tiền thay pin không
            còn là khoản hiển nhiên nên chi. Hãy đặt báo giá
            cạnh giá bán lại của chính chiếc máy đó và giá máy đời mới hôm nay trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>. Nếu tính mua máy cũ
            thay vì sửa, các bước kiểm tra đầy đủ nằm trong{' '}
            <HereLink href="/kinh-nghiem-mua-iphone-cu">bài kinh nghiệm mua iPhone cũ</HereLink>{' '}
            &mdash; và Lịch sử linh kiện và dịch vụ là màn hình đầu tiên nên mở.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Pin iPhone còn bao nhiêu phần trăm thì nên thay?',
      a: 'Apple coi pin đã hết vòng đời khi Dung lượng tối đa dưới 80%, và đó là mốc thông thường. Nhưng triệu chứng quan trọng hơn con số theo cả hai chiều: máy sập nguồn khi còn pin, nóng bất thường lúc sạc, hoặc hiện thông báo đã bật quản lý hiệu năng thì thay ở bất kỳ mức nào; còn máy 82% mà vẫn đủ dùng hết ngày thì chưa cần thay.',
    },
    {
      q: 'Thay pin iPhone chính hãng và thay ngoài khác nhau thế nào?',
      a: 'Thay tại trung tâm ủy quyền thì pin được ghép với máy nên vẫn xem được Tình trạng pin, lần sửa được ghi vào Lịch sử linh kiện và dịch vụ, keo chống nước được thay, và bảo hành không phụ thuộc vào một cửa hàng. Thay ngoài nhanh hơn và rẻ hơn nhiều, nhưng mất chỉ số tình trạng pin và bảo hành chỉ có giá trị tại chính tiệm đó.',
    },
    {
      q: 'Thay pin xong máy báo "Bộ phận không xác định" có sao không?',
      a: 'Máy vẫn chạy, vẫn sạc, không bị khóa hay bóp hiệu năng. Cái mất là mục Dung lượng tối đa — mất vĩnh viễn với viên pin đó, nên lần sau bạn không còn căn cứ để biết pin chai tới đâu. Pin zin bóc máy cũng báo như vậy, vì vấn đề nằm ở việc pin chưa được ghép với máy chứ không phải cell thật hay giả.',
    },
    {
      q: 'Thay pin iPhone có mất chống nước không?',
      a: 'Gần như chắc chắn là có, trừ khi gioăng và keo chống nước được thay đúng loại trong lúc lắp lại. Kể cả thay rồi thì Apple vẫn khuyến cáo không nên coi một chiếc máy đã mở ra là còn chống nước như lúc mới. Hỏi rõ cửa hàng có thay keo hay không trước khi chốt giá — đây là chỗ hai báo giá nghe giống nhau lại khác nhau.',
    },
    {
      q: 'Pin báo 100% mãi không tụt có phải pin lập trình IC không?',
      a: 'Rất đáng nghi. Pin thật thường tụt một hai phần trăm ngay trong vài tháng đầu, còn bo mạch đã lập trình có thể báo cố định 100% và số chu kỳ sạc không tăng. Đối chiếu với thời gian dùng thực tế: nếu máy hết pin nhanh mà con số vẫn đẹp thì con số đó không phản ánh viên pin bên trong.',
    },
    {
      q: 'Thay pin iPhone mất bao lâu?',
      a: 'Tiệm ngoài thường làm trong khoảng ba mươi phút đến một tiếng và trả máy ngay. Trung tâm bảo hành ủy quyền có thể xong trong ngày với máy đời mới, nhưng máy cũ có khi phải đặt linh kiện và giữ máy vài ngày — nên hỏi trước khi để máy lại.',
    },
    {
      q: 'Thay pin ngoài rồi thì Apple còn bảo hành không?',
      a: 'Máy còn hạn bảo hành mà thay pin ngoài thì mất quyền lợi với những hư hỏng liên quan tới linh kiện không chính hãng đó, và trung tâm ủy quyền có thể từ chối sửa nếu linh kiện lắp thêm gây cản trở. Máy đã hết hạn bảo hành thì không còn gì để mất theo nghĩa đó, và lựa chọn quay về thuần túy là chất lượng pin với giá tiền.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Thay pin iPhone ở đâu — chính hãng, pin zin hay pin ngoài | ${SITE_NAME}`,
  description:
    'Khi nào pin iPhone thật sự cần thay, ba loại pin trên thị trường khác nhau ra sao, vì sao máy báo Bộ phận không xác định, và các bước kiểm tra tại quầy để không bị tráo pin.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function ThayPinIPhoneODauPage() {
  return <SeoArticle content={CONTENT} />
}
