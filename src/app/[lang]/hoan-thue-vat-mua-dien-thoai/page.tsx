import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * HOÀN THUẾ VAT KHI MUA ĐIỆN THOẠI — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the divergence is forced by the law itself: the airport refund is
 * for departing FOREIGN passport holders, so the English reader at /vat-refund-phone-vietnam is
 * eligible and needs the operational article — eligibility, the invoice obtained at the till, the
 * order of the counters, the threshold, the disqualifiers. A Vietnamese reader is, in the ordinary
 * case, NOT eligible, so an article that walks them through the terminal would be answering a
 * question they cannot act on. This page therefore says that in the first section, then spends its
 * length on the two things a Vietnamese searcher actually needs: how to get the invoice right when
 * buying a handset for a relative who is about to fly out (the name and passport number must be
 * theirs, at the till, with no fixing it afterwards), and the domestic red-invoice / input-VAT
 * question they were probably really typing — what a hóa đơn GTGT is good for, and the one thing
 * people wrongly believe it does for a private buyer.
 *
 * ⚠️ HEDGED WHERE THE FACT IS HEDGY. The 85/15 split and the 2.000.000 đ floor are regulatory and
 * stated flat. The airport list, customs practice and the non-cash payment threshold for input-VAT
 * deduction have all moved, so they are described as moving rather than pinned to a number this
 * file would be wrong about next year.
 *
 * ⛔ NO SHOP AND NO BANK IS NAMED. Prices live on /iphone-18-vietnam, which reads real listings.
 */
const SLUG = 'hoan-thue-vat-mua-dien-thoai'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Hoàn thuế VAT khi mua điện thoại: ai được và ai không',
  intro:
    'Cụm từ “hoàn thuế VAT mua điện thoại” thực ra trỏ tới hai chuyện khác hẳn nhau: hoàn thuế tại sân bay cho người mang hộ chiếu nước ngoài khi xuất cảnh, và khấu trừ thuế GTGT đầu vào cho doanh nghiệp trong nước. Người Việt mang hộ chiếu Việt Nam không thuộc diện thứ nhất. Bài này nói rõ ai được hoàn, hóa đơn phải đứng tên ai nếu bạn mua hộ người thân sắp bay, và khi nào tấm hóa đơn đỏ mới thực sự có giá trị với chính bạn.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/vat-refund-phone-vietnam' },
  sections: [
    {
      id: 'ai-duoc-hoan-thue',
      title: 'Ai được hoàn thuế tại sân bay, và ai không',
      body: (
        <>
          <P>
            Chính sách hoàn thuế GTGT tại sân bay chỉ dành cho <strong>người nước ngoài và người Việt
            Nam định cư ở nước ngoài</strong>, nhập cảnh và xuất cảnh bằng hộ chiếu do nước ngoài
            cấp. Công dân Việt Nam mang hộ chiếu Việt Nam không thuộc diện này, kể cả khi đi công
            tác, đi học hay sắp chuyển ra nước ngoài sống. Thành viên tổ bay của chính chuyến bay
            xuất cảnh cũng không được hoàn.
          </P>
          <P>
            Nói thẳng điều đó ngay đầu bài là cần thiết, vì phần lớn người gõ cụm từ này đang trộn
            hai chuyện làm một. Mua điện thoại ở Việt Nam để dùng ở Việt Nam thì không có cơ chế nào
            trả lại 10% cho người tiêu dùng cá nhân &mdash; không có, dù bạn giữ đủ hóa đơn. Thứ tồn
            tại là khấu trừ thuế đầu vào của doanh nghiệp, hoàn toàn khác, và nằm ở phần dưới của bài.
          </P>
          <P>
            Ngay cả với người đủ điều kiện, <strong>&ldquo;hoàn 10%&rdquo; cũng không phải số tiền
            nhận về</strong>. Thuế GTGT tính trên giá chưa thuế, nên phần thuế nằm trong số tiền đã
            trả chỉ khoảng một phần mười một, tức gần 9%. Người xuất cảnh nhận 85% số thuế đó; 15%
            còn lại là phí dịch vụ của ngân hàng thương mại đặt quầy hoàn thuế. Tính ra còn khoảng
            7,5% giá ghi trên hóa đơn.
          </P>
          <P>
            Và phải xuất cảnh qua cửa khẩu có triển khai hoàn thuế. Thực tế là các sân bay quốc tế
            lớn &mdash; Tân Sơn Nhất, Nội Bài, Đà Nẵng là những nơi đa số đi qua &mdash; cùng một số
            sân bay và cảng biển khác. Danh sách này do cơ quan trung ương quy định và đã được mở
            rộng qua các năm, nên hãy kiểm tra đúng nơi mình bay thay vì suy đoán. Đi đường bộ sang
            Campuchia hay Lào thì không có thủ tục này.
          </P>
        </>
      ),
    },
    {
      id: 'mua-cho-nguoi-sap-xuat-canh',
      title: 'Mua hộ người sắp bay: hóa đơn phải đứng tên ai',
      body: (
        <>
          <P>
            Đây mới là tình huống thường gặp với người Việt: mua máy cho con đang du học, cho bạn
            nước ngoài, hoặc cho người thân là Việt kiều sắp quay lại nước ngoài. Nguyên tắc gói trong một câu,
            nhưng làm sai là mất trắng phần hoàn thuế: <strong>hóa đơn kiêm tờ khai hoàn thuế phải
            mang đúng họ tên và số hộ chiếu của người sẽ xuất cảnh</strong>, và phải được lập ngay
            tại quầy lúc thanh toán.
          </P>
          <P>
            Nghĩa là mang theo hộ chiếu bản gốc của người đó khi đi mua, hoặc để chính người đó ra
            cửa hàng. Ảnh chụp hộ chiếu trong điện thoại thường không được chấp nhận, vì nhân viên
            đang chép lại một giấy tờ tùy thân chứ không phải ghi cho có. Bạn vẫn có thể là người trả
            tiền &mdash; thứ bắt buộc phải đúng tên là tờ hóa đơn, không phải cái thẻ.
          </P>
          <P>
            Và không sửa được sau. Hóa đơn đã xuất sai tên hoặc sai một ký tự trong số hộ chiếu thì
            cửa hàng dù thiện chí cũng rất khó xử lý, còn hải quan ở sân bay không có thẩm quyền chấp
            nhận một bản khác. Kiểm tra ngay tại quầy, trước khi rời khỏi cửa hàng.
          </P>
          <P>Những mốc cần nhớ, tất cả đều quyết định từ trước khi ra sân bay:</P>
          <Ul>
            <li>Mua trong vòng <strong>60 ngày</strong> tính đến ngày xuất cảnh.</li>
            <li>
              Tối thiểu <strong>2.000.000 đ</strong> hàng hóa tại <em>cùng một cửa hàng, trong cùng
              một ngày</em>. Hóa đơn cùng cửa hàng cùng ngày được cộng dồn; hóa đơn của nhiều cửa
              hàng khác nhau thì không.
            </li>
            <li>
              Máy phải đi trong <strong>hành lý xách tay</strong>, còn nguyên hộp nếu giữ được. Hải
              quan có quyền yêu cầu xem hàng.
            </li>
            <li>
              Làm thủ tục hải quan <strong>trước khi check-in</strong>, tại khu vực làm thủ tục; nhận
              tiền ở quầy ngân hàng sau khi qua xuất nhập cảnh.
            </li>
            <li>Giữ hóa đơn bản gốc. Bản photo hoặc ảnh chụp không dùng được.</li>
            <li>IMEI trên hóa đơn phải khớp với máy và với vỏ hộp.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'cua-hang-nao-xuat-duoc',
      title: 'Cửa hàng nào xuất được loại hóa đơn này',
      body: (
        <>
          <P>
            Không phải cửa hàng nào cũng xuất được. Đây phải là cơ sở đã <strong>đăng ký bán hàng
            hoàn thuế GTGT</strong> với cơ quan thuế &mdash; các nơi này thường treo biển hoặc dán
            nhãn hoàn thuế cho người nước ngoài ngay tại quầy. Cửa hàng chưa đăng ký thì không thể
            xuất, dù nhân viên có muốn giúp đến đâu, và một tờ hóa đơn đỏ thông thường không nâng cấp
            thành tờ khai hoàn thuế được.
          </P>
          <P>
            Trên thực tế, đại lý ủy quyền và các chuỗi bán lẻ lớn ở khu trung tâm những thành phố
            lớn, cùng các quầy trong sân bay, thường nằm trong diện này. Cửa hàng chuyên hàng xách
            tay phần lớn thì không, và người bán cá nhân thì chắc chắn không &mdash; đó là đặc điểm
            của kênh bán chứ không phải dấu hiệu làm ăn không đàng hoàng.
          </P>
          <P>
            Câu nên hỏi trước khi chọn máy, chứ không phải sau khi đã trả tiền:{' '}
            <em>&ldquo;Ở đây có xuất hóa đơn hoàn thuế GTGT cho người nước ngoài không?&rdquo;</em>{' '}
            Bài{' '}
            <HereLink href="/mua-iphone-o-dau-uy-tin">mua iPhone ở đâu uy tín</HereLink> mô tả từng
            kiểu cửa hàng, còn{' '}
            <HereLink href="/iphone-chinh-hang-va-xach-tay">chính hãng và xách tay khác nhau ra sao</HereLink>{' '}
            giải thích vì sao nơi rẻ nhất lại thường là nơi không giúp được bạn chuyện này.
          </P>
        </>
      ),
    },
    {
      id: 'hoa-don-do-trong-nuoc',
      title: 'Hóa đơn đỏ dùng trong nước: khi nào thật sự có giá trị',
      body: (
        <>
          <P>
            Nếu trong nhà không có ai sắp xuất cảnh, thứ đáng quan tâm không phải quầy hoàn thuế ở
            sân bay mà là hóa đơn GTGT dùng trong nước. Nó có ba công dụng rõ ràng và một công dụng
            mà rất nhiều người tưởng là có.
          </P>
          <Ul>
            <li>
              <strong>Khấu trừ thuế GTGT đầu vào cho doanh nghiệp.</strong> Hóa đơn phải mang tên và
              mã số thuế của công ty, máy phải phục vụ hoạt động sản xuất kinh doanh, và phải thanh
              toán không dùng tiền mặt. Ngưỡng bắt buộc thanh toán không dùng tiền mặt đã được hạ
              xuống trong quy định thuế GTGT hiện hành, nên với một chiếc điện thoại thì cứ chuyển
              khoản hoặc quẹt thẻ cho chắc, đừng trả tiền mặt rồi xin hóa đơn sau.
            </li>
            <li>
              <strong>Chứng minh nguồn gốc khi bảo hành.</strong> Hóa đơn có IMEI là căn cứ mạnh hơn
              hẳn một tờ phiếu viết tay khi trung tâm bảo hành hỏi đến ngày mua và nơi mua.
            </li>
            <li>
              <strong>Bán lại về sau.</strong> Máy còn hóa đơn và hộp luôn dễ bán hơn và giữ giá tốt
              hơn &mdash; xem{' '}
              <HereLink href="/ban-dien-thoai-cu-duoc-gia">cách bán điện thoại cũ được giá</HereLink>.
            </li>
            <li>
              <strong>Công dụng KHÔNG có:</strong> cá nhân mua máy để dùng riêng thì hóa đơn đỏ không
              giúp lấy lại một đồng thuế nào. Nó là chứng từ, không phải phiếu hoàn tiền.
            </li>
          </Ul>
          <P>
            Hóa đơn bây giờ là hóa đơn điện tử: cửa hàng gửi bản PDF kèm mã tra cứu. Nên tra trên
            cổng tra cứu hóa đơn điện tử của cơ quan thuế để chắc rằng hóa đơn đã thực sự được phát
            hành, chứ không chỉ là một tệp PDF trình bày đẹp. Việc này mất chưa tới một phút và là
            cách duy nhất biết chắc.
          </P>
          <P>
            Máy xách tay và máy mua lại của người bán cá nhân thì không có hóa đơn GTGT, nên cả ba công dụng
            đầu đều khép lại. Nếu bạn vẫn chọn hướng đó, hãy đổi sang thứ thay thế được: phiếu
            bảo hành của chính cửa hàng, ảnh chụp IMEI và biên nhận có chữ ký &mdash;{' '}
            <HereLink href="/kinh-nghiem-mua-iphone-cu">kinh nghiệm mua iPhone cũ</HereLink> nói kỹ
            phần này. Giá thị trường hôm nay của dòng mới nhất thì có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, đọc trực tiếp từ tin
            rao chứ không phải từ thông cáo báo chí.
          </P>
        </>
      ),
    },
    {
      id: 'loi-thuong-gap',
      title: 'Những lỗi làm mất quyền hoàn thuế',
      body: (
        <>
          <P>
            Gần như mọi hồ sơ bị từ chối đều rơi vào một trong các lỗi sau, và hầu hết đã quyết định
            xong từ trước khi ra sân bay:
          </P>
          <Ul>
            <li>
              <strong>Cho máy vào hành lý ký gửi</strong> rồi mới đi tìm quầy hải quan. Hàng đã qua
              băng chuyền thì không ai kiểm tra được nữa, và không có cách cứu.
            </li>
            <li>
              <strong>Làm thủ tục sau khi đã check-in.</strong> Thứ tự đúng là hải quan trước, quầy
              hàng không sau.
            </li>
            <li>
              <strong>Hóa đơn đứng tên người mua hộ</strong> chứ không phải người bay, hoặc sai một
              ký tự trong số hộ chiếu.
            </li>
            <li>
              <strong>Mua ở cửa hàng chưa đăng ký hoàn thuế.</strong> Kiểm tra trước khi chọn máy.
            </li>
            <li>
              <strong>Mua quá sớm.</strong> Quá 60 ngày tính đến ngày bay là hết hiệu lực &mdash; mua
              sớm &ldquo;cho chắc&rdquo; lại là lỗi hay gặp nhất trong nhóm này.
            </li>
            <li>
              <strong>Gom hóa đơn của nhiều cửa hàng</strong> cho đủ mốc 2.000.000 đ. Mốc này tính
              theo từng cửa hàng, từng ngày.
            </li>
            <li>
              <strong>Bóc hộp và vứt vỏ trước khi bay.</strong> Hộp không bắt buộc về mặt giấy tờ
              nhưng giúp khâu kiểm tra trôi nhanh hơn nhiều.
            </li>
            <li>
              <strong>Chỉ mang bản photo hóa đơn.</strong> Bắt buộc bản gốc, để riêng trong hành lý
              xách tay cùng với máy.
            </li>
          </Ul>
          <P>
            Rút gọn lại chỉ còn ba thói quen: mua ở cửa hàng có đăng ký, đưa hộ chiếu gốc của người
            bay ra ngay tại quầy thanh toán, và để máy cùng hóa đơn trong hành lý xách tay. Làm đủ ba
            việc đó thì phần còn lại chỉ là xếp hàng.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Người Việt Nam có được hoàn thuế VAT khi mua điện thoại không?',
      a: 'Không. Hoàn thuế GTGT tại sân bay chỉ dành cho người nước ngoài và người Việt định cư ở nước ngoài, nhập cảnh và xuất cảnh bằng hộ chiếu nước ngoài. Công dân Việt Nam mang hộ chiếu Việt Nam không thuộc diện này, kể cả khi đi công tác hay đi học.',
    },
    {
      q: 'Hoàn thuế VAT ở sân bay được bao nhiêu phần trăm?',
      a: 'Ít hơn 10%. Thuế GTGT tính trên giá chưa thuế nên phần thuế trong số tiền đã trả chỉ khoảng một phần mười một, và người xuất cảnh chỉ nhận 85% số thuế đó — 15% còn lại là phí dịch vụ của ngân hàng đặt quầy. Thực nhận khoảng 7,5% giá trên hóa đơn.',
    },
    {
      q: 'Mua điện thoại bao nhiêu tiền thì được hoàn thuế?',
      a: 'Tối thiểu 2.000.000 đ hàng hóa tại cùng một cửa hàng trong cùng một ngày. Nhiều hóa đơn của cùng cửa hàng trong cùng ngày được cộng dồn, còn hóa đơn của các cửa hàng khác nhau thì không được cộng để đủ mốc.',
    },
    {
      q: 'Mua hộ người nước ngoài thì hóa đơn đứng tên ai?',
      a: 'Tên và số hộ chiếu của người sẽ xuất cảnh, lập ngay tại quầy lúc thanh toán. Ai trả tiền không quan trọng. Hóa đơn đã xuất sai tên thì không sửa lại được và hải quan sân bay không chấp nhận, nên phải mang hộ chiếu bản gốc của người đó đi mua.',
    },
    {
      q: 'Mua điện thoại cho công ty có được khấu trừ thuế GTGT không?',
      a: 'Được, nếu hóa đơn mang tên và mã số thuế công ty, máy phục vụ hoạt động sản xuất kinh doanh, và khoản mua được thanh toán không dùng tiền mặt. Ngưỡng bắt buộc chuyển khoản đã hạ xuống trong quy định hiện hành, nên cứ chuyển khoản thay vì trả tiền mặt.',
    },
    {
      q: 'Cửa hàng nào xuất hóa đơn hoàn thuế cho người nước ngoài?',
      a: 'Chỉ các cơ sở đã đăng ký bán hàng hoàn thuế GTGT, thường treo biển hoàn thuế tại quầy — trong thực tế là đại lý ủy quyền và các chuỗi bán lẻ lớn ở khu trung tâm, cùng các quầy trong sân bay. Cửa hàng xách tay phần lớn không đăng ký. Hãy hỏi trước khi chọn máy.',
    },
    {
      q: 'Máy xách tay có xuất được hóa đơn đỏ không?',
      a: 'Thường là không, vì đó là đặc điểm của kênh nhập chứ không phải dấu hiệu cửa hàng làm ăn không đàng hoàng. Không có hóa đơn GTGT thì không khấu trừ được cho công ty, không hoàn thuế được tại sân bay, và việc chứng minh nguồn gốc khi bảo hành hay bán lại sẽ khó hơn.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Hoàn thuế VAT khi mua điện thoại — ai được hoàn, hóa đơn đứng tên ai | ${SITE_NAME}`,
  description:
    'Hoàn thuế GTGT tại sân bay chỉ dành cho người mang hộ chiếu nước ngoài. Bài viết giải thích thực nhận bao nhiêu phần trăm, mốc 2.000.000 đ, cách lấy đúng hóa đơn khi mua hộ người sắp bay, và khi nào hóa đơn đỏ có giá trị với người mua trong nước.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function HoanThueVatMuaDienThoaiPage() {
  return <SeoArticle content={CONTENT} />
}
