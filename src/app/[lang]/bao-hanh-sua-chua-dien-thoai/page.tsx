import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * BẢO HÀNH VÀ SỬA CHỮA ĐIỆN THOẠI — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the two articles deliberately diverge. The English page
 * (/phone-warranty-repair-vietnam) spends its length on what a foreigner cannot assume: that a
 * warranty bought abroad does not follow them here, that Apple has no store to walk into, how to
 * hand a locked phone to a shop they cannot easily talk to. A Vietnamese reader knows all of that.
 * What they are actually deciding is ép kính or thay màn, màn zin bóc máy or màn lô, pin zin or
 * "pin dung lượng cao" — and which line on the phiếu bảo hành is the one that will be used to
 * refuse the claim. That vocabulary has no English page to be translated from.
 *
 * ⛔ KHÔNG CÓ GIÁ TRONG BÀI. Giá sửa chữa thay đổi nhanh hơn bài viết; một con số cũ còn tệ hơn
 * không có số nào. Thời gian sửa được ghi dưới dạng khoảng ước lượng. Giá máy mới xem tại
 * /iphone-18-vietnam, đọc trực tiếp từ tin rao.
 *
 * ⚠️ KHÔNG XẾP HẠNG VÀ KHÔNG GỌI TÊN CỬA HÀNG NÀO LÀ "UY TÍN NHẤT". Sàn có liên kết doanh thu với
 * một số nhà bán lẻ, nên một bảng xếp hạng ở đây là quảng cáo đội lốt bài viết.
 */
const SLUG = 'bao-hanh-sua-chua-dien-thoai'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang sử dụng',
  h1: 'Bảo hành và sửa chữa điện thoại',
  intro:
    'Ba bên khác nhau có thể đứng ra bảo hành chiếc máy bạn đang cầm, và chỉ một trong ba là hãng. Bài này phân biệt ba loại bảo hành đó, giải thích từ vựng linh kiện mà mọi báo giá đều dùng — ép kính, màn zin bóc máy, màn lô, pin zin — những trường hợp bị từ chối bảo hành, và sáu thứ phải kiểm tra trước khi rời cửa hàng.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/phone-warranty-repair-vietnam' },
  sections: [
    {
      id: 'ba-loai-bao-hanh',
      title: 'Ba loại bảo hành và bạn đang cầm loại nào',
      body: (
        <>
          <P>
            <strong>Bảo hành chính hãng</strong> áp dụng cho máy phân phối chính thức tại Việt Nam,
            thường 12 tháng với điện thoại. Nó gắn với IMEI chứ không gắn với tờ giấy, nên mọi trung
            tâm bảo hành ủy quyền trên toàn quốc đều tra được và đều nhận máy. Apple không có Apple
            Store tại Việt Nam, nên mọi ca bảo hành Apple đều đi qua trung tâm ủy quyền; Samsung,
            Xiaomi, OPPO đều có trung tâm riêng ở các thành phố lớn.
          </P>
          <P>
            <strong>Bảo hành cửa hàng</strong> là thứ đi kèm máy xách tay hoặc máy cũ: thường
            6&ndash;12 tháng với máy mới nhập, 1&ndash;6 tháng với máy đã qua sử dụng, và chỉ có giá
            trị tại chính nơi bán. Đây là cam kết của một doanh nghiệp, không phải của hãng. Hãy đọc
            phần loại trừ trước phần quyền lợi &mdash; danh sách những gì <em>không</em> được bảo
            hành mới là nội dung thật của tờ phiếu.
          </P>
          <P>
            <strong>Gói bảo hành mở rộng</strong> (rơi vỡ, vào nước) là một sản phẩm bán kèm, tồn tại
            đúng vì hai loại trên loại trừ những rủi ro đó. Nếu mua, hỏi ba điều và yêu cầu ghi vào
            hợp đồng: mức chi trả tối đa, số lần được dùng trong một năm, và có phải đóng thêm một
            phần chi phí mỗi lần sửa không.
          </P>
          <P>
            Vài cụm từ trên phiếu cần hiểu đúng. <strong>&ldquo;1 đổi 1 trong 30 ngày&rdquo;</strong>{' '}
            là cam kết của người bán chứ không phải của hãng &mdash; hỏi rõ đổi máy mới nguyên seal
            hay đổi máy tương đương, rồi bắt ghi câu trả lời vào phiếu.{' '}
            <strong>&ldquo;Bảo hành trọn đời&rdquo;</strong> trong đa số trường hợp chỉ là hỗ trợ
            phần mềm và vệ sinh máy, không bao gồm linh kiện. Sự khác biệt giữa máy chính hãng và
            máy xách tay nằm ở{' '}
            <HereLink href="/iphone-chinh-hang-va-xach-tay">bài chính hãng và xách tay</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'tu-vung-linh-kien',
      title: 'Ép kính, màn zin, màn lô — từ vựng quyết định báo giá',
      body: (
        <>
          <P>
            Hai cửa hàng cùng báo &ldquo;thay màn&rdquo; có thể đang bán ba món hàng hoàn toàn khác
            nhau. Đây là các mức, từ rẻ đến đắt:
          </P>
          <Ul>
            <li>
              <strong>Ép kính</strong> &mdash; chỉ thay lớp kính ngoài, giữ nguyên tấm nền hiển thị.
              Hợp lý khi kính nứt nhưng màn vẫn sáng đều và cảm ứng còn tốt. Rủi ro nằm ở tay nghề:
              máy phải qua công đoạn tách và ép, làm không chuẩn thì vài tháng sau có bụi dưới kính,
              hở viền hoặc liệt cảm ứng một vùng.
            </li>
            <li>
              <strong>Màn lô</strong> (màn thay thế của hãng thứ ba) &mdash; rẻ nhất trong nhóm thay
              nguyên cụm. Khác biệt nhìn thấy được: độ sáng ngoài trời thấp hơn, ám màu hoặc ngả
              xanh ở mức sáng thấp, và trên iPhone thì mất True Tone.
            </li>
            <li>
              <strong>Màn zin bóc máy</strong> (zin tháo máy) &mdash; cụm màn nguyên bản gỡ từ một
              máy khác. Chất lượng hiển thị gần nhất với màn mới, nhưng nguồn gốc không kiểm chứng
              được và tuổi thọ còn lại là một ẩn số.
            </li>
            <li>
              <strong>Linh kiện chính hãng qua trung tâm ủy quyền</strong> &mdash; đắt nhất, và là
              lựa chọn duy nhất giữ nguyên bảo hành của hãng.
            </li>
          </Ul>
          <P>
            Với pin cũng vậy. <strong>Pin zin</strong> đúng dung lượng thiết kế là chuẩn tham chiếu;
            loại quảng cáo <em>dung lượng cao</em> hiếm khi thật, và một viên pin sạc rất nhanh đầy
            rồi tụt cũng rất nhanh thường là cell nhỏ nằm trong vỏ to. Trên iPhone, thay pin không
            chính hãng thì máy ẩn luôn phần trăm dung lượng pin &mdash; mất đúng cái chỉ số dùng để
            đánh giá viên pin mới.
          </P>
          <P>
            Vì vậy khi hỏi giá, đừng hỏi &ldquo;thay màn bao nhiêu&rdquo;. Hỏi loại linh kiện cụ thể,
            bảo hành linh kiện bao lâu, và yêu cầu ghi cả hai vào phiếu tiếp nhận. Một tiệm làm ăn
            đàng hoàng sẽ chủ động báo có mấy mức để chọn.
          </P>
        </>
      ),
    },
    {
      id: 'tu-choi-bao-hanh',
      title: 'Những trường hợp bị từ chối bảo hành',
      body: (
        <>
          <P>
            Bảo hành chấm dứt khi hãng chứng minh được máy đã bị mở hoặc can thiệp bên ngoài hệ
            thống ủy quyền, và bằng chứng thường là vật lý, vĩnh viễn:
          </P>
          <Ul>
            <li>
              <strong>Tem bảo hành rách, mất, hoặc ốc bị toét</strong> &mdash; dấu hiệu máy đã được
              mở.
            </li>
            <li>
              <strong>Đã thay linh kiện bên ngoài.</strong> iPhone đời mới ghi thẳng việc này vào{' '}
              <strong>Cài đặt › Cài đặt chung › Giới thiệu › Lịch sử linh kiện và dịch vụ</strong>,
              và mục đó không xóa được.
            </li>
            <li>
              <strong>Vào nước.</strong> Chấm báo nước trong khay SIM chuyển sang đỏ và không hồi
              lại; mọi bảo hành tiêu chuẩn của hãng đều loại trừ hư hỏng do chất lỏng.
            </li>
            <li>
              <strong>Rơi, cong vênh, nứt kính, móp máy</strong> &mdash; lỗi người dùng. Máy đã cong
              khung thì trung tâm ủy quyền có quyền từ chối cả những ca sau đó.
            </li>
            <li>
              <strong>Jailbreak, root, cài firmware không chính thức</strong>, hoặc IMEI mờ, không
              đọc được.
            </li>
          </Ul>
          <P>
            Một hệ quả ít người tính tới: chỉ cần một lần thay pin ở ngoài là phần bảo hành còn lại
            của <em>toàn bộ</em> máy có thể mất, chứ không riêng viên pin. Nên nếu máy còn bảo hành
            và lỗi thuộc diện được bảo hành, đừng ghé tiệm ngoài trước cho nhanh &mdash; tiết kiệm
            một buổi chiều để mất phần bảo hành còn lại là một cái giá rất đắt.
          </P>
        </>
      ),
    },
    {
      id: 'sua-o-dau-bao-lau',
      title: 'Sửa ở đâu và mất bao lâu',
      body: (
        <>
          <P>
            <strong>Trung tâm bảo hành ủy quyền</strong> dùng linh kiện chính hãng và giữ nguyên bảo
            hành &mdash; đó là toàn bộ lý do tồn tại của nó. Họ làm việc theo kiểu thay nguyên cụm
            chứ không sửa vi mạch, nên rất nhanh với màn, pin, camera, chân sạc, và gần như không
            nhận các ca main. Thời gian ước lượng: có sẵn linh kiện thì trong ngày đến 2&ndash;3
            ngày; phải đặt linh kiện hoặc gửi đi thì thường từ một tuần trở lên. Câu cần hỏi ngay lúc
            tiếp nhận là <em>&ldquo;sửa tại đây hay gửi đi?&rdquo;</em> &mdash; câu trả lời đó quyết
            định bạn xa máy bao lâu.
          </P>
          <P>
            <strong>Quầy bảo hành của chuỗi bán lẻ</strong> tiện khi bạn mua máy tại đó: họ đứng ra
            làm trung gian với hãng, bạn không phải tự đi. Đổi lại, mỗi lần chuyển giao cộng thêm
            một đến hai ngày, và con số đó cộng dồn khi phải chờ linh kiện.
          </P>
          <P>
            <strong>Tiệm sửa chữa độc lập</strong> làm được đúng những thứ hệ thống ủy quyền không
            làm: sửa main, hàn lại chân IC, thay IC nguồn và IC sạc, cứu máy vào nước, cứu dữ liệu
            trên máy không lên nguồn, xử lý mất sóng sau khi rơi. Nhanh nhất, rẻ nhất, thay màn hay
            pin thường lấy ngay trong ngày. Đổi lại, chất lượng linh kiện chênh nhau rất nhiều giữa
            các tiệm và máy mất bảo hành hãng.
          </P>
          <P>Ghép đúng lỗi với đúng nơi thay vì đi hỏi khắp nơi:</P>
          <Ul>
            <li>Máy chính hãng còn bảo hành, lỗi thuộc diện được bảo hành &mdash; trung tâm ủy quyền, và không ghé đâu trước.</li>
            <li>Nứt kính, chai pin trên máy đã hết bảo hành &mdash; nơi nào cũng làm được; khác nhau ở loại linh kiện và tờ phiếu.</li>
            <li>Vào nước, mất nguồn, mất sóng sau khi rơi, treo táo &mdash; thợ main ở tiệm độc lập, vì trung tâm ủy quyền sẽ báo thay nguyên bo.</li>
            <li>Máy định bán lại trong thời gian tới &mdash; linh kiện zin và phiếu bảo hành linh kiện giữ lại đúng phần giá mà một tấm màn lô lấy đi.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'giao-may-nhan-may',
      title: 'Giao máy và nhận máy: sáu thứ phải kiểm tra',
      body: (
        <>
          <P>
            Trước khi giao: sao lưu dữ liệu, chụp ảnh tình trạng máy ở nhiều góc, và yêu cầu phiếu
            tiếp nhận có IMEI, mô tả lỗi và giá đã thống nhất. Tắt <strong>Tìm</strong> (Find My)
            trước &mdash; trung tâm ủy quyền không nhận máy còn khóa kích hoạt, và tiệm ngoài không
            thể kiểm tra một chiếc máy không qua được màn hình khóa. Đưa mật mã mở máy để thợ kiểm
            tra sau khi sửa là chuyện thường gặp &mdash; nhưng ⚠️ mã mở khóa máy không chỉ mở màn hình: nó mở
            luôn mật khẩu đã lưu, email, tin nhắn và mọi ứng dụng coi chiếc máy là lớp xác thực thứ
            hai. Với sửa chữa lớn, an toàn nhất là sao lưu, xóa máy rồi mới mang đi, phục hồi lại khi
            nhận về. Mật khẩu iCloud hay tài khoản Google thì tuyệt đối không đưa.
          </P>
          <P>Khi nhận máy về, kiểm tra ngay tại quầy, trước khi trả nốt tiền:</P>
          <Ul>
            <li><strong>IMEI</strong> trên máy khớp với IMEI ghi trên phiếu tiếp nhận.</li>
            <li>
              <strong>Cài đặt › Cài đặt chung › Giới thiệu › Lịch sử linh kiện và dịch vụ.</strong>{' '}
              Linh kiện chính hãng đã ghép mã sẽ hiện đúng tên; hiện{' '}
              <em>&ldquo;Bộ phận không xác định&rdquo;</em> nghĩa là linh kiện không chính hãng hoặc
              chưa được ghép mã với máy này.
            </li>
            <li>
              <strong>True Tone</strong> còn bật được sau khi thay màn. Mất True Tone là dấu hiệu
              mạnh cho thấy tấm nền không phải hàng nguyên bản.
            </li>
            <li>
              <strong>Face ID, cảm biến tiệm cận và cảm ứng sát bốn cạnh.</strong> Áp tai khi gọi mà
              màn không tắt là cảm biến tiệm cận chưa được lắp lại đúng.
            </li>
            <li>
              <strong>Dung lượng pin</strong> hiện ra một con số phần trăm, không phải dòng cảnh báo
              linh kiện.
            </li>
            <li>
              <strong>Phiếu bảo hành linh kiện mới</strong>, ghi rõ loại linh kiện đã thay và thời
              hạn bảo hành của chính linh kiện đó.
            </li>
          </Ul>
          <P>
            Yêu cầu nhận lại linh kiện cũ. Đây là đòi hỏi bình thường và một tiệm đàng hoàng không
            ngại.
          </P>
          <P>
            Cuối cùng, giữ phiếu. Quy định về bảo vệ quyền lợi người tiêu dùng buộc bên bán phải thực
            hiện đúng cam kết ghi trên phiếu bảo hành, và phải đổi máy hoặc hoàn tiền nếu đã sửa
            nhiều lần mà không khắc phục được lỗi &mdash; nhưng tất cả chỉ dùng được khi bạn còn giữ
            tờ phiếu và còn giữ tin nhắn báo giá. Nếu chi phí sửa đã tiệm cận giá bán lại của máy,
            hãy cân nhắc phương án khác trước khi quyết: xem{' '}
            <HereLink href="/kinh-nghiem-mua-iphone-cu">kinh nghiệm mua iPhone cũ</HereLink> để biết
            máy cùng đời đang ở tầm nào, và{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink> cho mặt bằng máy mới.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Thay màn hình ở ngoài có mất bảo hành không?',
      a: 'Có, và mất bảo hành của cả máy chứ không riêng màn hình. Mở máy ngoài hệ thống ủy quyền và lắp màn không chính hãng là đủ căn cứ để hãng từ chối. Trên iPhone đời mới, việc này còn được máy tự ghi lại trong Cài đặt › Cài đặt chung › Giới thiệu › Lịch sử linh kiện và dịch vụ và không xóa được.',
    },
    {
      q: 'Ép kính và thay màn khác nhau thế nào?',
      a: 'Ép kính chỉ thay lớp kính ngoài và giữ lại tấm nền hiển thị, nên rẻ hơn nhiều, hợp khi kính nứt mà màn vẫn sáng đều và cảm ứng còn tốt. Thay màn là thay nguyên cụm. Rủi ro của ép kính nằm ở tay nghề: làm không chuẩn thì sau vài tháng có bụi dưới kính, hở viền hoặc liệt cảm ứng một vùng.',
    },
    {
      q: 'Màn zin, màn zin bóc máy và màn lô khác nhau ra sao?',
      a: 'Màn zin là linh kiện chính hãng, thường chỉ có qua trung tâm ủy quyền và là loại duy nhất giữ được bảo hành. Màn zin bóc máy là cụm nguyên bản gỡ từ máy khác — hiển thị gần như màn mới nhưng không biết đã dùng bao lâu. Màn lô là hàng của bên thứ ba, rẻ nhất, thường kém sáng ngoài trời, dễ ám màu và làm mất True Tone.',
    },
    {
      q: 'Máy xách tay có được bảo hành chính hãng tại Việt Nam không?',
      a: 'Thông thường là không. Bảo hành của Apple gắn với thị trường nơi máy được phân phối, và phần lớn hãng Android cũng vậy. Máy xách tay dựa vào bảo hành của cửa hàng bán ra, thường 6–12 tháng và chỉ có giá trị tại đúng cửa hàng đó, nên hãy giữ phiếu và cân nhắc khoảng cách địa lý trước khi mua.',
    },
    {
      q: 'Gửi bảo hành chính hãng mất bao lâu?',
      a: 'Ước lượng chung: có sẵn linh kiện và sửa tại chỗ thì trong ngày đến 2–3 ngày; phải đặt linh kiện hoặc gửi đi thì thường từ một tuần trở lên, lâu hơn với máy đời cũ. Hãy hỏi ngay lúc tiếp nhận là sửa tại chỗ hay gửi đi, và yêu cầu ghi thời hạn dự kiến vào phiếu.',
    },
    {
      q: 'Làm sao biết cửa hàng có thay đúng linh kiện zin không?',
      a: 'Mở Cài đặt › Cài đặt chung › Giới thiệu › Lịch sử linh kiện và dịch vụ — linh kiện chính hãng đã ghép mã sẽ hiện đúng tên, còn dòng "Bộ phận không xác định" nghĩa là không phải. Kiểm tra thêm True Tone còn bật được, dung lượng pin hiện số phần trăm, Face ID hoạt động, và yêu cầu nhận lại linh kiện cũ.',
    },
    {
      q: 'Tem bảo hành bị rách thì còn được bảo hành không?',
      a: 'Với bảo hành hãng thì thường là không, vì tem rách được coi là dấu hiệu máy đã bị mở. Một số cửa hàng vẫn nhận bảo hành theo cam kết riêng của họ nếu lỗi rõ ràng không liên quan đến việc can thiệp, nhưng đó là thiện chí của cửa hàng chứ không phải quyền lợi mặc định — hỏi trước và xin xác nhận bằng tin nhắn.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Bảo hành và sửa chữa điện thoại — ai bảo hành cái gì | ${SITE_NAME}`,
  description:
    'Phân biệt bảo hành chính hãng, bảo hành cửa hàng và gói mở rộng; ép kính, màn zin bóc máy hay màn lô; các trường hợp bị từ chối bảo hành; thời gian sửa ước lượng và sáu thứ phải kiểm tra khi nhận máy.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function BaoHanhSuaChuaDienThoaiPage() {
  return <SeoArticle content={CONTENT} />
}
