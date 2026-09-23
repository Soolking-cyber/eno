import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * ĐĂNG TIN BÁN HÀNG MIỄN PHÍ — the marketplace's own seller-acquisition guide, in Vietnamese.
 *
 * ⛔ AN ORDINARY `page.tsx`, SO EVERY WORD IS SUBJECT TO THE EDITION RULE. This route compiles on
 * BOTH builds, so nothing here may name a visa, an itinerary or PayPal. The subject is posting a
 * listing on a marketplace, which is exactly the licensed company's own business, so it can live
 * here without qualification.
 *
 * ⚠️ WRITTEN FOR A VIETNAMESE SELLER, NOT TRANSLATED. The English guides answer an arriving expat;
 * this one answers someone deciding where to post a sofa or a used phone this evening, and the two
 * halves of their question are "does it cost me anything" and "is free going to mean nobody sees
 * it". Both are answered with numbers from this codebase.
 *
 * ⛔ NO THIRD-PARTY PRICING, NO COMPETITOR FEE SCHEDULE. A first draft opened on a named rival's
 * listing fees and the date they started — figures nothing here can verify and nobody re-checks
 * when the rival changes them. Every number printed below is either measured from our own API
 * (the inventory and price bands, 2026-09-23) or read out of the source file named beside it. If a
 * figure has no such source, it does not go on the page: a marketplace that prints a competitor's
 * price wrong is making a claim about someone else's business, which is a different kind of wrong
 * from a typo.
 *
 * ⚠️ EVERY RULE QUOTED BELOW IS THE ONE THE SERVER ACTUALLY ENFORCES, and it is cheap to keep it
 * that way — the sources are src/lib/publish-guard.ts (3 distinct angles, contact screens, location),
 * src/lib/duplicate-guard.ts (the two duplicate signals and their thresholds), src/lib/stale.ts
 * (7-day bump cooldown, 3-day availability), src/lib/ranking-formula.ts (the weights) and
 * src/app/api/listings/route.ts (15/hour). A guide that describes a publish gate loosely is worse
 * than none: a seller who is refused for a reason we did not print blames the site, not the rule.
 *
 * ⛔ NO IDENTITY-VERIFICATION CLAIM. `identityGateEnforced()` is behind `IDENTITY_GATE_ENFORCED`
 * and defaults to OFF (src/lib/compliance/account-state.ts), so telling a seller they must verify
 * first would be false today. Add it here on the same day that switch is flipped, not before.
 */
const SLUG = 'dang-tin-ban-hang-mien-phi'

const CONTENT: ArticleContent = {
  eyebrow: 'Hướng dẫn cho người bán',
  h1: 'Đăng tin bán hàng miễn phí — và làm sao để tin không thành tin rác',
  intro:
    `Trên ${SITE_NAME}, đăng tin miễn phí ở mọi danh mục: không phí đăng, không phí theo tháng, không gói đẩy tin, không vị trí trả tiền. Nhưng miễn phí không đồng nghĩa với đăng gì cũng được. Bài này nói rõ tin phải đạt những gì mới lên sàn, bộ lọc trùng tin chạy theo tiêu chí nào, thứ hạng được tính bằng công thức ra sao, và mặt bằng giá đọc từ chính tin rao đang chạy trên sàn.`,
  canonical: `/${SLUG}`,
  published: '2026-09-23',
  lang: 'vi',
  sections: [
    {
      id: 'mien-phi-o-day-nghia-la-gi',
      title: 'Miễn phí ở đây nghĩa là gì',
      body: (
        <>
          <P>
            Câu người bán thật sự muốn hỏi thường không dừng ở &ldquo;có mất phí không&rdquo;, mà là
            &ldquo;không trả đồng nào thì tin của tôi còn ai thấy nữa không&rdquo;. Hai vế đó phải
            trả lời tách nhau: phần phí ở ngay dưới đây, phần hiển thị nằm ở mục thứ hạng.
          </P>
          <P>
            Phần phí ngắn: không có phí nào cả. Không phí đăng, không phí theo tháng, không gói đẩy
            tin, không vị trí trả tiền, và điều đó đúng ở mọi danh mục &mdash; xe cộ, cho thuê, đồ
            gia dụng như nhau. Hiện sàn có <strong>98.754 tin đang hoạt động</strong>. Giới hạn duy
            nhất là hàng rào chống spam &mdash;{' '}
            <strong>15 tin mỗi giờ</strong> cho một tài khoản &mdash; và đó là hạn mức theo giờ để
            chặn máy đăng tự động, không phải hạn mức tháng: bán mười món trong một buổi tối là
            chuyện bình thường.
          </P>
          <P>
            Nhãn <em>tin nổi bật</em> có tồn tại và có cộng điểm xếp hạng, nhưng do ban quản trị đặt
            chứ không bán. Nói cách khác, không có đường nào để trả tiền vượt lên trên một người bán
            khác &mdash; phần sau sẽ nói rõ cái gì mới quyết định thứ hạng.
          </P>
        </>
      ),
    },
    {
      id: 'tin-can-gi-de-duoc-duyet',
      title: 'Tin cần gì để được đăng',
      body: (
        <>
          <P>
            Không có hàng chờ duyệt. Tin hợp lệ lên sàn ngay lập tức; tin không hợp lệ bị từ chối
            ngay tại bước đăng, kèm đúng lý do để bạn sửa và bấm lại &mdash; thay vì nằm chờ hai ngày
            rồi biến mất không rõ nguyên nhân. Danh sách kiểm tra rất ngắn:
          </P>
          <Ul>
            <li>
              <strong>Ít nhất 3 ảnh khác góc.</strong> Máy chủ so ảnh bằng vân ảnh, nên tải cùng một
              tấm lên ba lần vẫn chỉ được tính là một góc. Riêng danh mục dịch vụ chỉ cần một ảnh, vì
              ở đó không có món đồ nào để chụp ba mặt. Ba góc là mức tối thiểu để người mua nhìn được
              tình trạng thật; cũng là bộ lọc rẻ nhất với tin dựng lên từ ảnh lấy trên mạng.
            </li>
            <li>
              <strong>Không thông tin liên hệ ngoài sàn trong tiêu đề và mô tả.</strong> Số điện
              thoại, email (kể cả kiểu viết né &ldquo;abc at gmail dot com&rdquo;), đường link, tên
              tài khoản dạng @handle, hay &ldquo;zalo: 09…&rdquo; đều bị chặn. Ghi quận, phường,
              khu vực thì hoàn toàn được &mdash; tin cho thuê cần điều đó; chỉ số nhà cụ thể là bị
              chặn.
            </li>
            <li>
              <strong>Tên hiển thị của tài khoản cũng bị soi</strong> theo đúng bộ quy tắc đó, và báo
              lỗi riêng, vì chỗ sửa nằm trong phần Cài đặt tài khoản chứ không nằm trong tin đăng.
            </li>
            <li>
              <strong>Phải chọn khu vực.</strong> Phường/quận là đủ; ghim vị trí chính xác là tùy
              chọn. Một tin không nói ở đâu thì người mua không tính được quãng đường đi xem hàng, và
              trong thực tế đó là tin không ai bấm.
            </li>
            <li>
              <strong>Không thuộc nhóm hàng cấm.</strong> Bộ lọc chỉ bắt hàng hóa và dịch vụ bất hợp
              pháp, không bắt từ ngữ đánh giá &mdash; viết &ldquo;hàng thật, không lừa đảo&rdquo;
              trong mô tả là bình thường và không làm tin bị chặn.
            </li>
          </Ul>
          <P>
            Bộ quy tắc này áp dụng cả khi <strong>sửa tin</strong>, không chỉ lúc đăng. Đăng một tin
            sạch rồi vào sửa để chèn số điện thoại là đường vòng đã bị bịt, và biết trước điều đó tiết
            kiệm cho bạn một buổi tối.
          </P>
          <P>
            Nếu muốn xem quy trình bằng màn hình thật, cứ mở{' '}
            <HereLink href="/post">trang đăng tin</HereLink> và đi qua các bước &mdash; các kiểm tra
            ở trên chạy ngay trong lúc điền, không đợi đến lúc bấm đăng.
          </P>
        </>
      ),
    },
    {
      id: 'bo-loc-trung-tin',
      title: 'Bộ lọc trùng tin, và vì sao nó có lợi cho người bán thật',
      body: (
        <>
          <P>
            Thứ làm một sàn miễn phí biến thành bãi rác không phải là số lượng tin, mà là việc cùng
            một món được đăng lại mỗi sáng để leo lên đầu trang. Bộ lọc trùng tin ở đây nhắm đúng hành
            vi đó, và chỉ nó thôi: bộ lọc <strong>chỉ đối chiếu trong các tin đang hoạt động của
            chính bạn</strong>, không bao giờ so tin của bạn với tin của người khác. Một tin bị coi là
            trùng khi rơi vào một trong hai trường hợp:
          </P>
          <Ul>
            <li>
              Tiêu đề trùng gần như hoàn toàn, cùng danh mục và giá gần như nhau.
            </li>
            <li>
              Toàn bộ nội dung gần như sao chép &mdash; tức là trường hợp chép
              nguyên tin cũ rồi sửa vài chữ ở tiêu đề.
            </li>
          </Ul>
          <P>
            Hai ngưỡng đó được đặt để biến thể thật đi lọt. &ldquo;iPhone 15 Pro 128GB&rdquo; và
            &ldquo;iPhone 15 Pro 256GB&rdquo; khác nhau cả ở từ trong tiêu đề lẫn ở giá, nên đăng cả
            hai là bình thường. Và tin đã bán, đã ẩn hoặc đã xóa thì không còn nằm trong phạm vi đối
            chiếu &mdash; bán hụt rồi đăng lại luôn luôn được.
          </P>
          <P>
            Cách đúng để làm mới một tin đang chạy là nút xác nhận <strong>còn hàng</strong> trong{' '}
            <HereLink href="/dashboard/listings">Tin của tôi</HereLink>: nó đẩy lại mốc thời gian đăng
            và nhờ đó kéo lại điểm độ mới, tối đa <strong>một lần mỗi 7 ngày</strong>. Chiều ngược
            lại, tin quá <strong>3 ngày</strong> chưa xác nhận sẽ bị đánh dấu cần xác nhận lại &mdash;
            người mua không phải nhắn cho mười món đã bán từ tháng trước.
          </P>
          <P>
            Đây chính là lý do &ldquo;miễn phí&rdquo; ở đây không đồng nghĩa với rác. Thứ cần chặn
            không phải người bán, mà là <em>hành vi lặp lại</em>: cùng một món, đăng lại mỗi sáng.
            Một cái ngưỡng đọc được và một nút xác nhận còn hàng làm đúng việc đó, và không cần thu
            của ai đồng nào.
          </P>
        </>
      ),
    },
    {
      id: 'thu-hang-khong-mua-duoc',
      title: 'Thứ hạng ở đây không mua được — nó được tính',
      body: (
        <>
          <P>
            Vì không bán vị trí, thứ tự hiển thị phải đến từ một công thức, và công thức đó công khai.
            Khi người mua duyệt danh mục mà không gõ từ khóa, điểm của tin là:{' '}
            <strong>0,60 uy tín người bán + 0,25 nhu cầu + 0,15 độ mới</strong>. Khi người mua có gõ
            từ khóa, mức khớp phải dẫn đầu vì họ đã nói rõ họ cần gì:{' '}
            <strong>0,50 mức khớp + 0,40 uy tín + 0,10 độ mới</strong>.
          </P>
          <Ul>
            <li>
              <strong>Độ mới</strong> suy giảm theo hàm mũ với chu kỳ 14 ngày: tin vừa đăng được 1;
              sau hai tuần còn khoảng 0,37; sau một tháng còn khoảng 0,12. Nó là yếu tố phân định giữa
              những tin ngang nhau, không phải thứ kéo một tin yếu lên đầu.
            </li>
            <li>
              <strong>Nhu cầu</strong> tính từ lượt xem cộng lượt bấm xem liên hệ, trong đó{' '}
              <strong>một lượt bấm xem liên hệ có trọng số cao hơn hẳn một lượt xem</strong> &mdash; vì bấm xem
              liên hệ là ý định mua thật, còn lướt qua thì không. Tin mới có nhu cầu bằng 0, nên nó
              sống nhờ uy tín và độ mới cho đến khi có người quan tâm.
            </li>
            <li>
              <strong>Uy tín</strong> là điểm của người bán, tích lũy từ lịch sử giao dịch và cách
              phản hồi, chứ không mua được. Đây là lý do một người bán cá nhân đàng hoàng vẫn đứng
              trên một shop lớn mới lập.
            </li>
            <li>
              Trang đầu còn <strong>xoay vòng theo người bán</strong>: mỗi người bán được một suất
              trước khi ai đó có suất thứ hai. Một shop có hàng trăm tin không thể chiếm trọn màn
              hình đầu tiên của người mua.
            </li>
          </Ul>
          <P>
            Rút ra cho người bán rất thẳng: chụp đủ ảnh và chụp thật, đặt giá nằm trong khoảng thị
            trường, và <strong>trả lời tin nhắn nhanh</strong>. Ba việc đó tác động tới đúng những
            biến trong công thức trên, và cả ba đều miễn phí.
          </P>
        </>
      ),
    },
    {
      id: 'ban-gi-thi-co-nguoi-mua',
      title: 'Bán gì ở đây thì có sẵn người mua, và đặt giá bao nhiêu',
      body: (
        <>
          <P>
            Đăng miễn phí chỉ có nghĩa nếu món của bạn nằm trong nhóm đang có người tìm. Trong{' '}
            <strong>98.754 tin đang hoạt động</strong> hiện có,{' '}
            <HereLink href="/c/furniture-appliances">đồ gia dụng và nội thất cũ</HereLink> có{' '}
            <strong>3.201 tin</strong>, đồ điện tử cũ có <strong>3.507 tin</strong>, và{' '}
            <HereLink href="/c/rentals">cho thuê</HereLink> có <strong>19.359 tin</strong> &mdash;
            mảng cho thuê tập trung ở các quận TP.HCM.
          </P>
          <P>
            Với đồ gia dụng và nội thất cũ, đây là mặt bằng giá đọc trực tiếp từ tin rao thật trên
            sàn (mẫu 300 tin), không phải giá niêm yết của cửa hàng. Giá chung: trung vị{' '}
            <strong>2.480.000 đ</strong>, một phần tư số tin dưới 1.050.000 đ và một phần tư trên
            4.100.000 đ. Theo từng món:
          </P>
          <Ul>
            <li>
              <strong>Máy lạnh</strong> &mdash; trung vị 4.298.000 đ, phần lớn nằm trong khoảng
              3.948.000 đ đến 5.498.000 đ.
            </li>
            <li>
              <strong>Máy giặt</strong> &mdash; trung vị 2.730.000 đ, khoảng phổ biến 1.648.000 đ đến
              3.480.000 đ.
            </li>
            <li>
              <strong>Sofa</strong> &mdash; trung vị 2.515.000 đ, khoảng phổ biến 1.390.000 đ đến
              4.510.000 đ.
            </li>
            <li>
              <strong>Tủ quần áo</strong> &mdash; trung vị 6.200.000 đ, khoảng phổ biến 3.980.000 đ
              đến 7.800.000 đ. Đây là nhóm giữ giá tốt nhất.
            </li>
            <li>
              <strong>Bàn các loại</strong> &mdash; trung vị 1.650.000 đ, khoảng phổ biến 1.050.000 đ
              đến 3.200.000 đ.
            </li>
            <li>
              <strong>Kệ và tủ</strong> &mdash; trung vị 1.980.000 đ, khoảng phổ biến 1.180.000 đ đến
              3.380.000 đ.
            </li>
            <li>
              <strong>Máy lọc không khí</strong> trung vị 6.000.000 đ và <strong>robot hút bụi</strong>{' '}
              trung vị 9.000.000 đ &mdash; hai nhóm mẫu còn mỏng, nên hãy đọc như một mốc tham chiếu
              chứ chưa phải mặt bằng chắc chắn.
            </li>
          </Ul>
          <P>
            Cách dùng mấy con số này rất đơn giản: đặt giá trong khoảng một phần tư dưới đến một phần
            tư trên là vùng bán được. Muốn đặt cao hơn mức một phần tư trên thì lý do phải{' '}
            <strong>nhìn thấy được trong ảnh</strong> &mdash; còn hộp, còn bảo hành, gỗ thật thay vì
            gỗ công nghiệp. Đặt dưới mức một phần tư dưới thì nên nói rõ vì sao rẻ, nếu không người
            mua sẽ tự đoán, và họ thường đoán theo hướng xấu.
          </P>
          <P>
            Lưu ý khi so sánh: phần lớn hàng cũ đang niêm yết ở đây đến từ các đơn vị bán đồ cũ tại
            TP.HCM, nên giá của họ đã gồm phần lãi và phần vận chuyển. Người bán cá nhân bán lại đồ
            nhà mình hoàn toàn có thể đứng thấp hơn mặt bằng đó một bậc mà vẫn có lời &mdash; và đó
            thường là tin bán nhanh nhất trong danh mục.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept(SLUG),
  faqs: [
    {
      q: 'Đăng tin bán hàng trên ' + SITE_NAME + ' có mất phí không?',
      a: 'Không. Đăng tin miễn phí ở tất cả danh mục: không phí đăng, không phí theo tháng, không gói đẩy tin và không vị trí trả tiền. Nhãn tin nổi bật do ban quản trị đặt chứ không bán, nên không có đường nào trả tiền để vượt lên trên một người bán khác. Giới hạn duy nhất là hàng rào chống spam: 15 tin mỗi giờ cho một tài khoản.',
    },
    {
      q: 'Một tài khoản đăng được bao nhiêu tin?',
      a: 'Không có hạn mức theo tháng. Giới hạn duy nhất là chống spam: 15 tin mỗi giờ cho một tài khoản, đủ rộng cho một buổi tối dọn nhà và đủ chặt để máy đăng tự động không chạy được.',
    },
    {
      q: 'Vì sao tin của tôi bị từ chối khi ghi số điện thoại trong tiêu đề?',
      a: 'Vì số điện thoại, email, link, @handle hay "zalo: 09…" trong tiêu đề và mô tả đều bị chặn — người mua nhắn ngay trong sàn, và khi có tranh chấp thì đoạn tin nhắn đó là thứ duy nhất đối chiếu được. Ghi quận, phường, khu vực thì vẫn được; chỉ số nhà cụ thể mới bị chặn. Nếu báo lỗi chỉ vào tên tài khoản thì chỗ sửa nằm ở Cài đặt tài khoản, không nằm trong tin đăng.',
    },
    {
      q: 'Đăng lại tin cũ để lên đầu trang có được không?',
      a: 'Không, nếu tin cũ vẫn đang chạy: hệ thống đối chiếu trong chính các tin đang hoạt động của bạn và chặn bản sao khi tiêu đề trùng gần hết, cùng danh mục và giá gần như nhau. Cách đúng là bấm xác nhận còn hàng trong Tin của tôi, tối đa một lần mỗi 7 ngày. Tin đã bán hoặc đã gỡ thì đăng lại bình thường.',
    },
    {
      q: 'Cần tối thiểu bao nhiêu ảnh thì tin mới được đăng?',
      a: 'Ba ảnh khác góc với hàng hóa, một ảnh với danh mục dịch vụ. Máy chủ so bằng vân ảnh nên tải cùng một tấm ba lần vẫn chỉ tính là một góc. Tin đạt yêu cầu lên sàn ngay, không có hàng chờ duyệt.',
    },
    {
      q: 'Không trả tiền thì tin của tôi có bị đẩy xuống dưới không?',
      a: 'Không có chỗ nào để trả tiền vượt lên. Khi duyệt danh mục, điểm xếp hạng là 0,60 uy tín người bán cộng 0,25 nhu cầu cộng 0,15 độ mới; khi tìm bằng từ khóa là 0,50 mức khớp cộng 0,40 uy tín cộng 0,10 độ mới. Ngoài ra trang đầu xoay vòng theo người bán, nên một shop nhiều tin không chiếm trọn màn hình đầu tiên.`,',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Đăng tin bán hàng miễn phí — điều kiện để tin được duyệt | ${SITE_NAME}`,
  description:
    `Đăng tin miễn phí ở mọi danh mục trên sàn 98.754 tin. Tin cần tối thiểu 3 ảnh khác góc, không số điện thoại trong tiêu đề, và bộ lọc trùng tin chặn đăng lại — kèm công thức xếp hạng đầy đủ.`,
  alternates: { canonical: `/${SLUG}` },
  openGraph: {
    title: `Đăng tin bán hàng miễn phí — điều kiện để tin được duyệt | ${SITE_NAME}`,
    description:
      `Miễn phí thật, và vì sao miễn phí không có nghĩa là tin rác: điều kiện đăng, bộ lọc trùng tin, và công thức xếp hạng không mua được.`,
  },
}

export default function DangTinBanHangMienPhiPage() {
  return <SeoArticle content={CONTENT} />
}
