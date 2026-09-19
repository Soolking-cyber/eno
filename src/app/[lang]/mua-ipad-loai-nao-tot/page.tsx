import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * MUA iPAD LOẠI NÀO TỐT — the Vietnamese half of the pair; the English half is
 * /ipad-buying-guide-vietnam.
 *
 * ⛔ WRITTEN FROM SCRATCH, NOT TRANSLATED, AND DELIBERATELY A DIFFERENT ARTICLE. The English page is
 * read by someone deciding between buying here and bringing one in, so it spends its length on the
 * VN/A-versus-import split, on what a passport is enough for, and on the VAT refund. A Vietnamese
 * reader already knows all of that. This page goes where a local buyer actually goes: which line fits
 * a student versus someone who draws, what "likenew", "máy trưng bày" and "máy dựng" are really
 * selling, the at-the-counter inspection list, whether a third-party stylus is good enough, and how
 * many years of iPadOS are left in an older unit. Machine-translating either page would answer the
 * wrong questions in both languages.
 *
 * ⚠️ KHÔNG CÓ GIÁ TRONG BÀI. Giá Apple tại Việt Nam thay đổi theo đợt khuyến mãi; một con số gõ ở đây
 * sai trong một quý và sai mãi. Chỗ nào cần số thì trỏ sang trang giá đọc trực tiếp từ tin rao.
 *
 * ⚠️ KHÔNG XẾP HẠNG CỬA HÀNG. Sàn có liên kết tiếp thị với một số nhà bán lẻ, nên một bảng xếp hạng ở
 * đây là quảng cáo đội lốt bài viết.
 */
const SLUG = 'mua-ipad-loai-nao-tot'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Mua iPad loại nào tốt',
  intro:
    'iPad khó chọn không phải vì nhiều dòng, mà vì tên gọi không cho biết máy hợp với việc gì. Bài này đi qua bốn dòng đang bán — bản thường, Air, mini và Pro — theo đúng cách người Việt dùng máy: học, vẽ, xem phim, ghi chú, làm việc nhẹ. Kèm theo là ba quyết định tốn tiền nhất mà ai cũng phải chốt: bản Wi-Fi hay bản 4G, dung lượng bao nhiêu, và bút với bàn phím có cần mua ngay không.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/ipad-buying-guide-vietnam' },
  sections: [
    {
      id: 'chon-theo-nhu-cau',
      title: 'Bốn dòng iPad và mỗi dòng hợp với ai',
      body: (
        <>
          <P>
            <strong>iPad bản thường</strong> là cách rẻ nhất để có màn hình lớn của Apple. Xem phim,
            học online, làm bài, đọc tài liệu &mdash; ở những việc này nó không thua các dòng trên.
            Hai điểm trừ khá cụ thể: các đời gần đây mặt kính chưa dán liền vào tấm nền nên viết bằng
            bút hơi &ldquo;hẫng&rdquo;, và máy không dùng được cây bút đời cao nhất. Mua cho trẻ học
            hoặc để nhà dùng chung thì dừng ở đây và dồn tiền vào dung lượng.
          </P>
          <P>
            <strong>iPad Air</strong> là câu trả lời mặc định cho người lớn mua một máy dùng lâu: chip
            dòng M, màn dán liền, dùng được cây bút có lực nhấn, lắp được bàn phím kèm trackpad của
            Apple. Air có hai cỡ, và chọn cỡ quan trọng hơn chọn chip &mdash; bản nhỏ là máy cầm trên
            tay, bản lớn là máy đặt xuống bàn thay laptop nhẹ. Rất ít người đổi Air vì yếu; người ta
            đổi vì màn nhỏ quá hoặc hết dung lượng.
          </P>
          <P>
            <strong>iPad mini</strong> hay bị gạt đi rồi lặng lẽ thành máy được cầm nhiều nhất trong
            nhà: đọc truyện, đọc tài liệu, ghi chú nhanh, xem bản đồ một tay, bỏ vừa túi đeo chéo. Máy
            dùng được cây bút đời mới. Ngược lại, mini không hợp để gõ nhiều, chia đôi màn hình, hay
            cho ai muốn một chiếc laptop nhỏ.
          </P>
          <P>
            <strong>iPad Pro</strong> mua về màn hình đẹp hơn hẳn, chip mạnh nhất, loa tốt nhất, thân
            máy mỏng nhất. Vài thế hệ gần đây, hai mức dung lượng cao nhất còn được cấu hình nhiều RAM
            hơn &mdash; dựng video thì nên hỏi kỹ đúng chiếc máy đang cầm. Nói thẳng thì Pro xứng đáng
            với người dựng phim, làm màu, hoặc coi iPad là máy chính; còn lại, Pro là một chiếc Air có
            màn đẹp hơn.
          </P>
          <Ul>
            <li>Học sinh, sinh viên: bản thường hoặc Air bản nhỏ, ưu tiên dung lượng hơn dòng máy.</li>
            <li>Vẽ, thiết kế, ghi chép viết tay: Air trở lên, vì cần bút có lực nhấn và màn dán liền.</li>
            <li>Xem phim, giải trí, máy dùng chung trong nhà: bản thường, dung lượng cao hơn.</li>
            <li>Đọc và mang theo cả ngày, hoặc làm máy phụ bên cạnh laptop: mini.</li>
            <li>Dựng video, làm màu, thay hẳn máy tính: Pro bản lớn, cộng bàn phím.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'wifi-hay-4g',
      title: 'Bản Wi-Fi hay bản 4G: trả thêm để được gì',
      body: (
        <>
          <P>
            Việt Nam gần như là nơi ít cần bản 4G nhất, và đó là lời khen cho hạ tầng. Quán cà phê, văn
            phòng, phòng trọ đều có Wi-Fi; gói data trên điện thoại rẻ và bật điểm phát sóng chỉ mất
            vài giây. Bản 4G đắt hơn ngay từ lúc mua, cho một chiếc máy bạn giữ bốn, năm năm.
          </P>
          <P>
            Ba trường hợp bản 4G vẫn đáng tiền. Thứ nhất là tần suất: mở máy chục lần một ngày ở chục
            chỗ thì bật hotspot thành phiền, kết cục là chiếc iPad nằm ở nhà. Thứ hai là máy cho người
            khác dùng &mdash; con nhỏ, bố mẹ &mdash; không có gói data riêng. Thứ ba là lý do kỹ
            thuật:{' '}
            <strong>chỉ bản 4G/5G mới có chip định vị GPS</strong>. Bản Wi-Fi định vị dựa vào sóng
            Wi-Fi xung quanh, nội thành thì tạm, ra quốc lộ hoặc lên vùng núi coi như không có. Ai dùng
            iPad để dẫn đường hay khảo sát hiện trường thì riêng điểm này đã đủ để chốt.
          </P>
          <P>
            Nếu mua bản 4G, máy đời gần đây đều hỗ trợ eSIM và các nhà mạng lớn đều cấp eSIM, nên không
            phải rút SIM vật lý ở điện thoại. Bài{' '}
            <HereLink href="/esim-viettel-vinaphone-mobifone">hướng dẫn eSIM</HereLink> nói rõ nhà mạng
            nào hỗ trợ đến đâu.
          </P>
          <P>
            Một lưu ý: phát hotspot rất tốn pin điện thoại. Nếu câu trả lời của bạn là &ldquo;cứ phát
            Wi-Fi từ điện thoại&rdquo;, hãy tính thêm một cục sạc dự phòng thay vì khoản chênh của bản
            4G.
          </P>
        </>
      ),
    },
    {
      id: 'dung-luong',
      title: 'Dung lượng: chọn xong là không sửa được',
      body: (
        <>
          <P>
            iPad không có khe thẻ nhớ và không nâng cấp được bộ nhớ. Ổ cứng rời cắm cổng USB-C chỉ chứa
            file, ảnh và video; ứng dụng, hệ điều hành và mọi thứ cần dùng khi không có mạng đều nằm
            trong bộ nhớ máy. Đây là quyết định duy nhất trong bài mà chọn sai thì phải đổi máy.
          </P>
          <P>
            Mức thấp nhất đủ dùng nếu bạn chủ yếu xem phim trực tuyến, lướt web, đọc tài liệu và ghi
            chú. Nó hết nhanh hơn bạn tưởng nếu:
          </P>
          <Ul>
            <li>Tải phim hoặc khóa học về xem khi không có mạng, nhất là lúc đi đường dài.</li>
            <li>Vẽ nghiêm túc: file nhiều lớp ở độ phân giải in nặng hàng trăm MB, và ứng dụng giữ lại toàn bộ.</li>
            <li>Dựng video: file gốc, dự án và bản xuất chiếm chỗ ba lần.</li>
            <li>Cài game lớn &mdash; nhiều game nặng vài GB, bản cập nhật còn nặng thêm.</li>
            <li>Lưu nhạc, podcast hoặc bản đồ offline cho cả nước.</li>
          </Ul>
          <P>
            Hai lý do nên lên một mức dung lượng dù chưa thấy cần. Hệ điều hành chiếm một phần trong
            con số ghi trên hộp, nên bản thấp nhất thực tế nhỏ hơn vẻ ngoài. Và dung lượng giữ giá khi
            bán lại, còn bàn phím với bao da thì không. Phân vân giữa lên dung lượng và lên dòng máy
            thì chọn dung lượng.
          </P>
        </>
      ),
    },
    {
      id: 'but-va-ban-phim',
      title: 'Bút và bàn phím: khoản tiền hay bị bỏ quên',
      body: (
        <>
          <P>
            Bàn phím có trackpad của Apple chiếm một phần rất lớn so với giá chính chiếc máy, và cây
            bút đời mới cũng không phải khoản nhỏ. Cộng đủ trước khi chốt dòng: iPad bản thường cộng
            bút, cộng bàn phím, cộng dung lượng cao hơn có thể chạm tới một chiếc Air &mdash; mà Air
            là máy tốt hơn.
          </P>
          <P>
            Về bàn phím có ba lựa chọn thật sự. Bàn phím trackpad của Apple tốt nhất, cũng nặng và đắt
            nhất: nó biến iPad thành một chiếc laptop nhỏ, kể cả về cân nặng. Bao da bàn phím bên thứ
            ba bán khắp nơi, giá chỉ bằng một phần; loại tốt dùng ổn, loại rẻ thì phím nhão, bản lề rơ
            sau vài tháng và phần lớn không có trackpad. Lựa chọn thứ ba là thứ nhiều người thấy hợp
            nhất: bàn phím Bluetooth rời cộng giá đỡ gấp &mdash; nhẹ hơn, rẻ hơn, hôm nào chỉ muốn cầm
            máy tính bảng thì để ở nhà.
          </P>
          <P>
            Mua loại nào cũng phải hỏi đúng <em>đời máy</em>, không chỉ hỏi kích thước màn. Bao da bàn
            phím cắt theo từng đời vì cụm camera và vị trí cổng thay đổi giữa các năm, nên dòng chữ
            &ldquo;vừa iPad 11 inch&rdquo; trên tin rao không phải là thông số kỹ thuật.
          </P>
          <P>
            Về bút, ba đời đang lưu hành cùng lúc và không thay cho nhau được. Cây bút đời cao nhất có
            lực nhấn, độ nghiêng, rê trước mặt kính và thao tác bóp &mdash; đây là cây dành cho người
            vẽ, và iPad bản thường không dùng được nó. Cây bút cổng USB-C rẻ hơn, hít nam châm vào cạnh
            máy để sạc, nhưng <strong>không có cảm biến lực nhấn</strong>: viết chữ thì không sao, vẽ
            thì hỏng chuyện. Bút đời cũ chỉ ghép được với máy đời cũ. Bút bên thứ ba ghi chú rất ổn,
            nhưng không mô phỏng được lực nhấn.
          </P>
          <P>
            Nguyên tắc chung: mua máy trước, dùng hai tuần, rồi mới mua phụ kiện mình đã biết chắc là
            cần. Bài{' '}
            <HereLink href="/phu-kien-dien-thoai-nen-mua">phụ kiện nên mua</HereLink> nói rõ hơn.
          </P>
        </>
      ),
    },
    {
      id: 'may-cu-va-xach-tay',
      title: 'Máy mới, máy cũ hay máy xách tay',
      body: (
        <>
          <P>
            iPad là món mua cũ hợp lý hơn điện thoại: pin lớn, số lần sạc ít, chip dùng tốt nhiều năm.
            Đổi lại, nên hiểu ba từ trước khi đọc tin rao. &ldquo;Likenew&rdquo; hay
            &ldquo;99%&rdquo; là máy đã qua sử dụng còn đẹp, không phải máy mới. &ldquo;Máy trưng
            bày&rdquo; vẫn là máy mới nhưng thường đã kích hoạt, nên bảo hành còn lại ngắn hơn và giá
            phải thấp hơn tương xứng. &ldquo;Máy dựng&rdquo; là máy đã mở ra thay linh kiện &mdash;
            thứ cần tránh, và là lý do có danh sách bên dưới.
          </P>
          <Ul>
            <li>
              <strong>Cài đặt › Cài đặt chung › Giới thiệu</strong>: đọc Số hiệu kiểu máy. Đuôi{' '}
              <code>VN/A</code> là hàng Apple Việt Nam phân phối; <code>LL/A</code> là Mỹ,{' '}
              <code>ZA/A</code> Singapore, <code>J/A</code> Nhật. Cửa hàng không sửa được chuỗi này.
            </li>
            <li>
              Tra số sê-ri trên trang bảo hành của Apple để biết máy đã kích hoạt từ bao giờ &mdash;
              ngày kích hoạt nói thật hơn lời người bán.
            </li>
            <li>
              Bắt buộc: máy phải <strong>đăng xuất iCloud hoàn toàn</strong> trước khi chuyển tiền. Còn
              tài khoản người khác thì chiếc máy đó vô dụng.
            </li>
            <li>
              Nhìn nghiêng dọc bốn cạnh kính dưới ánh sáng xem có kênh lên hay hở viền không. Kính
              vênh là dấu hiệu pin phồng &mdash; lỗi đặc trưng của iPad cũ. ⛔ Chỉ nhìn, đừng ấn: pin
              đã phồng là pin đã hỏng, ấn vào là cách làm nó xì. Thấy kênh thì bỏ máy đó.
            </li>
            <li>
              Kéo một nét liên tục khắp mặt kính để thử cảm ứng, thử loa, cắm sạc xem máy có nhận
              không.
            </li>
          </Ul>
          <P>
            Với máy xách tay, phần cứng bản Wi-Fi giống nhau ở mọi thị trường, nên khác biệt nằm ở chỗ
            ai bảo hành. Hàng VN/A được nhận ở mọi trung tâm ủy quyền trong nước; máy xách tay do cửa
            hàng tự bảo hành, thường vài tháng và chỉ có giá trị tại đó. Gói bảo hành mở rộng của Apple
            có mua thêm được hay không còn tùy nơi bán và tùy máy, nên hỏi trước khi trả tiền. Bài{' '}
            <HereLink href="/iphone-chinh-hang-va-xach-tay">chính hãng và xách tay</HereLink> phân tích
            đầy đủ đánh đổi này.
          </P>
          <P>
            Cuối cùng, với máy đời cũ hãy hỏi máy ra mắt năm nào chứ không chỉ hỏi máy còn đẹp không:
            Apple hỗ trợ iPadOS nhiều năm nhưng không vô hạn, nên máy quá cũ sẽ bị các ứng dụng bỏ rơi
            trước khi pin kịp hỏng. Mặt bằng giá đồ Apple hôm nay xem ở{' '}
            <HereLink href="/iphone-18-vietnam">trang giá</HereLink>, đọc trực tiếp từ tin rao.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'iPad nào phù hợp cho học sinh sinh viên?',
      a: 'Bản thường hoặc Air bản nhỏ là hợp lý nhất, và nên dồn tiền vào dung lượng thay vì lên dòng máy. Nếu chủ yếu học online, đọc tài liệu và làm bài thì bản thường là đủ; nếu ghi chép viết tay cả ngày hoặc có học vẽ thì nên lên Air, vì Air có màn dán liền và dùng được cây bút có lực nhấn.',
    },
    {
      q: 'iPad bản Wi-Fi hay bản 4G tốt hơn?',
      a: 'Với đa số người dùng ở Việt Nam thì bản Wi-Fi là đủ: Wi-Fi có ở khắp nơi và phát hotspot từ điện thoại chỉ mất vài giây. Chỉ nên mua bản 4G nếu bạn mở máy liên tục ở nhiều nơi trong ngày, máy để cho người không có gói data riêng dùng, hoặc bạn cần GPS thật — chỉ bản 4G/5G mới có chip định vị GPS.',
    },
    {
      q: 'iPad 128GB có đủ dùng không?',
      a: 'Đủ nếu bạn xem phim trực tuyến, lướt web, đọc tài liệu và ghi chú. Không đủ nếu bạn tải phim về xem offline, vẽ file nhiều lớp ở độ phân giải in, dựng video hoặc cài nhiều game nặng. Hệ điều hành cũng chiếm một phần trong con số ghi trên hộp, nên chỗ dùng được ít hơn con số quảng cáo.',
    },
    {
      q: 'Có nên mua iPad cũ không?',
      a: 'Có, iPad giữ giá trị sử dụng tốt hơn điện thoại vì pin lớn và ít chu kỳ sạc. Điều kiện là kiểm tra đủ: đăng xuất iCloud hoàn toàn, tra số sê-ri trên trang bảo hành của Apple, thử cảm ứng toàn màn hình và ấn dọc cạnh kính xem có kênh do pin phồng không. Ngoài ra hỏi rõ máy ra mắt năm nào, vì số năm được cập nhật iPadOS là hữu hạn.',
    },
    {
      q: 'iPad nào vẽ được bằng Apple Pencil?',
      a: 'Vẽ nghiêm túc cần lực nhấn và màn dán liền, nghĩa là Air hoặc Pro cộng cây bút đời cao nhất. iPad bản thường không dùng được cây bút đó, còn cây bút cổng USB-C tuy rẻ nhưng không có cảm biến lực nhấn nên chỉ hợp ghi chú. Bút của bên thứ ba viết chữ tốt nhưng không thay được lực nhấn khi vẽ.',
    },
    {
      q: 'iPad có thay được laptop không?',
      a: 'Thay được cho việc viết lách, email, tra cứu, trình chiếu, ghi chú và chỉnh ảnh, với điều kiện có bàn phím. Không thay được nếu bạn cần phần mềm chỉ có trên máy tính, nhiều màn hình ngoài, môi trường lập trình cục bộ hoặc quản lý file phức tạp. Nếu định thay laptop thì mua bản màn lớn, vì bản nhỏ là máy tính bảng có gắn bàn phím chứ không phải laptop.',
    },
    {
      q: 'Mua iPad xách tay có dùng được ở Việt Nam không?',
      a: 'Dùng được bình thường, phần cứng bản Wi-Fi giống nhau ở mọi thị trường. Khác biệt nằm ở bảo hành: hàng VN/A được nhận ở mọi trung tâm ủy quyền trong nước, còn máy xách tay do cửa hàng tự bảo hành, thường vài tháng và chỉ tại nơi bán. Với máy 4G đời cũ thì nên hỏi thêm về băng tần mạng trước khi mua.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Mua iPad loại nào tốt — Air, Pro, mini hay bản thường | ${SITE_NAME}`,
  description:
    'Bốn dòng iPad hợp với ai, bản Wi-Fi hay 4G, chọn dung lượng bao nhiêu cho đủ, bút và bàn phím tốn thêm những gì, và cách kiểm tra iPad cũ hoặc máy xách tay trước khi trả tiền.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function MuaIPadLoaiNaoTotPage() {
  return <SeoArticle content={CONTENT} />
}
