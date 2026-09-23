import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * BÁN ĐỒ CŨ Ở ĐÂU ĐƯỢC GIÁ — the marketplace's own Vietnamese resale guide.
 *
 * ⛔ AN ORDINARY `page.tsx`, SO EVERY WORD IS SUBJECT TO THE EDITION RULE. This route compiles on BOTH
 * builds, so nothing here may name a visa, an itinerary or PayPal — the three surfaces the licensed
 * marketplace may not advertise. The subject is secondhand furniture and appliances, which is exactly
 * why it can live on eno.vn when the services guides cannot.
 *
 * ⛔ WHY THIS PAGE CAN WIN THE QUERY. Everything currently ranking for "bán đồ cũ ở đâu được giá" is
 * published by a BUYER — a thu mua đồ cũ shop whose margin is the gap between what it pays the seller
 * and what it resells for. Their incentive is to keep the seller from ever seeing the resale price.
 * This page hands the seller exactly that number, per item type, and then explains the buyer's
 * economics honestly rather than accusing anyone of cheating.
 *
 * ⚠️ MỌI CON SỐ Ở ĐÂY LÀ GIÁ ĐANG RAO, đo trên chính sàn này ngày 2026-09-23 (n=300 tin đồ gia dụng
 * và nội thất cũ). Không phải giá đã chốt, và bài viết nói rõ điều đó — một hướng dẫn định giá mà
 * giấu nguồn số thì cũng chỉ là một trang thu mua khác. Nguồn hàng cũ trên sàn do NGƯỜI BÁN TẠI TP.HCM
 * đăng, phần lớn là cửa hàng chứ không phải người dọn nhà, nên không được mô tả nó là hàng thanh lý
 * của người nước ngoài sắp rời Việt Nam.
 */
const SLUG = 'ban-do-cu-o-dau-duoc-gia'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang bán lại',
  h1: 'Bán đồ cũ ở đâu được giá',
  intro:
    'Cùng một cái máy lạnh, một bộ sofa hay một cái tủ quần áo, bốn kênh bán cho ra bốn con số khác hẳn nhau. Phần lớn khoảng chênh đó không đến từ tài trả giá mà từ chỗ bạn bán ở đâu, bạn có biết món của mình đang được rao bao nhiêu hay không, và bạn còn bao nhiêu ngày. Bài này đưa ra khoảng giá thật đang niêm yết trên sàn, giải thích vì sao bán xô cho cửa hàng thu mua luôn thấp hơn, và nói thẳng cả những lúc bán xô mới là lựa chọn đúng.',
  canonical: `/${SLUG}`,
  published: '2026-09-23',
  lang: 'vi',
  sections: [
    {
      id: 'ban-o-dau',
      title: 'Bốn kênh bán và khoảng chênh thật sự',
      body: (
        <>
          <P>
            Thứ tự dưới đây đi từ nhanh nhất đến được giá nhất, và hai đầu đó luôn ngược nhau. Không có
            kênh nào vừa nhanh vừa được giá; chọn kênh chính là chọn bạn trả bằng thời gian hay trả
            bằng tiền.
          </P>
          <Ul>
            <li>
              <strong>Cửa hàng thu mua tận nhà.</strong> Gọi buổi sáng, chiều có người đến xem, chở đi
              trong ngày, trả tiền mặt. Đổi lại họ báo MỘT giá cho cả lô và đó là giá sỉ. Đây là kênh
              trả thấp nhất trong bốn kênh, gần như không có ngoại lệ.
            </li>
            <li>
              <strong>Vựa đồ cũ, bạn tự chở đến.</strong> Nhỉnh hơn một chút vì bạn gánh phần vận
              chuyển thay họ, nhưng vẫn là giá sỉ, và bạn mất công thuê xe.
            </li>
            <li>
              <strong>Nhóm cư dân, nhóm chung cư, người quen.</strong> Rất hợp với món nhỏ gọn và đồ
              còn mới: người mua ở cùng toà nhà nên không phát sinh tiền chở, và họ đã thấy căn hộ của
              bạn nên tin món đồ hơn. Nhược điểm là lượng người xem ít, và nhiều người hỏi cho vui.
            </li>
            <li>
              <strong>Đăng tin bán thẳng cho người dùng cuối.</strong> Giá cao nhất, vì bạn đứng đúng
              vị trí mà cửa hàng thu mua đang đứng: bán lẻ. Đổi lại bạn phải trả lời tin nhắn, hẹn
              người đến xem và tự chốt. Trên ${SITE_NAME}{' '}
              <HereLink href="/post">đăng tin là miễn phí</HereLink>, nên phép thử rẻ nhất là đăng
              trước vài ngày rồi mới gọi thu mua nếu không ai hỏi.
            </li>
          </Ul>
          <P>
            Cách dùng tốt nhất là kết hợp chứ không chọn một: tách ba đến năm món đáng tiền nhất ra bán
            riêng, rồi gọi thu mua đến gom phần còn lại. Phần còn lại vốn dĩ chẳng bán lẻ được, còn ba
            món kia chính là chỗ nằm gần hết số tiền.
          </P>
        </>
      ),
    },
    {
      id: 'gia-that',
      title: 'Món của bạn đang được rao bao nhiêu',
      body: (
        <>
          <P>
            Đây là khoảng giá đang niêm yết cho hàng gia dụng và nội thất đã qua sử dụng trên chính sàn
            này, đo ngày 23.09.2026 trên 300 tin, trong danh mục hiện có 3.201 tin. Trong mẫu 100 tin
            kiểm tra vị trí, cả 100 đều ở TP.HCM, nên hãy đọc nó như giá TP.HCM.
          </P>
          <P>
            Toàn danh mục: trung vị <strong>2.480.000 đ</strong>. Một phần tư số tin dưới 1.050.000 đ,
            một phần tư trên 4.100.000 đ. Theo từng loại món, trung vị và khoảng giữa:
          </P>
          <Ul>
            <li>
              <strong>Máy lạnh:</strong> 4.298.000 đ, nửa giữa số tin nằm trong 3.948.000 đ &ndash; 5.498.000 đ.
            </li>
            <li>
              <strong>Máy giặt:</strong> 2.730.000 đ, nửa giữa số tin nằm trong 1.648.000 đ &ndash; 3.480.000 đ.
            </li>
            <li>
              <strong>Sofa:</strong> 2.515.000 đ, nửa giữa số tin nằm trong 1.390.000 đ &ndash; 4.510.000 đ.
            </li>
            <li>
              <strong>Tủ quần áo:</strong> 6.200.000 đ, nửa giữa số tin nằm trong 3.980.000 đ &ndash; 7.800.000 đ.
              Đây là nhóm nội thất có trung vị cao nhất trong mẫu đo.
            </li>
            <li>
              <strong>Bàn các loại:</strong> 1.650.000 đ, nửa giữa số tin nằm trong 1.050.000 đ &ndash; 3.200.000 đ.
            </li>
            <li>
              <strong>Kệ và tủ nhỏ:</strong> 1.980.000 đ, nửa giữa số tin nằm trong 1.180.000 đ &ndash; 3.380.000 đ.
            </li>
            <li>
              <strong>Máy lọc không khí:</strong> trung vị 6.000.000 đ. <strong>Robot hút bụi:</strong>{' '}
              trung vị 9.000.000 đ. Hai nhóm này ít tin nên con số chỉ mang tính tham khảo, nhưng cả hai
              đều nằm cao hơn hẳn trung vị 2.480.000 đ của toàn danh mục.
            </li>
          </Ul>
          <P>
            Hai lưu ý để dùng đúng mấy con số này. Thứ nhất, đó là <strong>giá rao</strong>, không phải
            giá đã chốt; giá chốt thường thấp hơn một bậc thương lượng. Thứ hai, và đây mới là chỗ quan
            trọng: giá rao chính là giá mà người thu mua sẽ bán lại món đồ của bạn. Cho nên nó là cái
            thước đúng để đặt cạnh con số họ đưa cho bạn. Đồ điện tử cũ là danh mục riêng với 3.507 tin,
            còn{' '}
            <HereLink href="/c/furniture-appliances">danh mục đồ gia dụng và nội thất</HereLink> là nơi
            tra trực tiếp món giống món của bạn.
          </P>
        </>
      ),
    },
    {
      id: 'vi-sao-mat-gia',
      title: 'Vì sao bán xô luôn mất giá',
      body: (
        <>
          <P>
            Không phải vì người thu mua gian. Họ làm nghề bán sỉ, và cái giá họ đưa cho bạn buộc phải
            trừ ra khỏi giá rao ở trên toàn bộ phần việc còn lại: thuê xe và nhân công khiêng, kho chứa
            trong lúc chờ bán, vệ sinh và sửa chữa, khoản bảo hành họ hứa với người mua, và rủi ro
            có món nằm kho không ai lấy. Bạn bán một lần; họ ôm hàng.
          </P>
          <P>Vấn đề không nằm ở họ, nó nằm ở ba cơ chế khiến bạn nhận giá sỉ cho món lẽ ra bán lẻ được:</P>
          <Ul>
            <li>
              <strong>Một giá cho cả lô, nên món tốt gánh món kém.</strong> Cái máy lạnh còn chạy ngon
              bị gộp chung với cái bàn gãy chân và mấy thứ chỉ đáng bán ve chai, rồi bạn nghe một con
              số duy nhất cho tất cả. Hãy yêu cầu báo giá <strong>từng món</strong>. Nếu họ chỉ báo giá
              lô, đó là câu trả lời rồi: tách món đắt ra, bán riêng trước.
            </li>
            <li>
              <strong>Họ ra giá đúng lúc bạn yếu nhất.</strong> Tại nhà bạn, khi đồ đã kéo ra giữa
              phòng, khi xe đã đậu dưới sân và bạn còn hai ngày phải trả nhà. Giá đó có tính cả áp lực
              thời gian của bạn. Gọi họ khi còn sớm thì cùng món đó nghe khác hẳn.
            </li>
            <li>
              <strong>Bạn không biết món của mình đáng bao nhiêu, còn họ thì biết.</strong> Đó là toàn
              bộ lợi thế của bên kia bàn, và nó biến mất trong năm phút nếu bạn mở danh mục ra tra vài
              tin cùng loại trước khi nghe báo giá.
            </li>
          </Ul>
          <P>
            Phép thử đơn giản: cầm con số họ đưa cho món đắt nhất và đặt cạnh trung vị của loại đó ở
            trên. Khoảng chênh là chi phí và lãi của họ. Nếu bạn thấy nó xứng với việc chở đi trong
            ngày và không phải tiếp ai, bán là đúng. Nếu không, bạn vừa biết mình nên đăng tin.
          </P>
        </>
      ),
    },
    {
      id: 'dinh-gia',
      title: 'Định giá thế nào cho đúng',
      body: (
        <>
          <P>
            Giá mua ban đầu không liên quan gì đến giá bán lại, và đây là lỗi phổ biến nhất. Người mua
            không trả tiền cho việc bạn đã tốn bao nhiêu; họ so món của bạn với những tin đang rao cùng
            lúc. Vậy nên mốc duy nhất đáng dùng là tin cùng loại, cùng thương hiệu, cùng tình trạng,
            đang rao ở cùng thành phố.
          </P>
          <P>Từ mốc đó, chọn một trong ba mức tùy số ngày bạn còn:</P>
          <Ul>
            <li>
              <strong>Giá bán nhanh</strong> &ndash; quanh mức một phần tư thấp của loại món đó, ví dụ
              1.648.000 đ cho máy giặt. Dùng khi bạn còn dưới một tuần.
            </li>
            <li>
              <strong>Giá thị trường</strong> &ndash; quanh trung vị, ví dụ 2.730.000 đ cho máy giặt.
              Đây là mức đông người hỏi nhất.
            </li>
            <li>
              <strong>Giá chờ</strong> &ndash; quanh mức một phần tư cao, ví dụ 3.480.000 đ. Chỉ hợp lý
              khi món còn rất mới, còn hộp hoặc còn bảo hành, và bạn có ít nhất vài tuần.
            </li>
          </Ul>
          <P>
            Để dư đúng một bậc thương lượng rồi ghi rõ là có thương lượng: người mua đồ cũ ở Việt Nam
            gần như luôn trả giá, và một tin ghi cứng giá sẽ mất luôn những người ngại hỏi. Ngược lại,
            đừng viết thanh lý gấp hay dọn nhà bán rẻ ngay trên tiêu đề &mdash; câu đó nói thẳng với
            người mua rằng bạn không còn thời gian, và họ sẽ dùng đúng thông tin ấy.
          </P>
          <P>
            Cuối cùng, chốt trước chuyện vận chuyển và tháo lắp, vì đó là chỗ hay vỡ nhất. Cái tủ quần
            áo trung vị 6.200.000 đ mà nhà không có thang máy là một con số hoàn toàn khác: hãy ghi
            trong tin ai tháo, ai khiêng, tầng mấy, có thang máy không. Máy lạnh thì tiền tháo và lắp
            lại phải thống nhất trước khi chốt giá, không phải lúc thợ đã đến.
          </P>
        </>
      ),
    },
    {
      id: 'anh-va-mo-ta',
      title: 'Ảnh và mô tả quyết định bạn bán được giá nào',
      body: (
        <>
          <P>
            Ở cùng một mức giá, tin có ảnh sáng sủa và mô tả đầy đủ bán nhanh hơn hẳn, đơn giản vì
            người mua đồ cũ sợ nhất là mất công đi xem rồi hỏng việc. Mỗi câu hỏi mà tin của bạn trả
            lời sẵn là một lý do để họ đi.
          </P>
          <Ul>
            <li>
              <strong>Dọn nền rồi mới chụp.</strong> Lau món đồ, dẹp đồ đạc xung quanh, chụp ban ngày
              cạnh cửa sổ và không dùng đèn flash. Đây là việc tốn mười phút và ăn tiền nhất trong cả
              quy trình.
            </li>
            <li>
              <strong>Chụp đủ bốn mặt, thêm ảnh chỗ xước.</strong> Chủ động đưa khuyết điểm vào tin.
              Một vết xước đã ghi sẵn không làm giảm giá; một vết xước bị phát hiện lúc xem hàng thì
              thành cái cớ để trả giá xuống.
            </li>
            <li>
              <strong>Đồ điện thì chụp lúc đang chạy.</strong> Máy giặt sáng đèn, máy lạnh hiện nhiệt
              độ trên remote, robot hút bụi đang chạy về dock. Người mua đồ điện cũ giả định là hỏng
              cho tới khi thấy nó chạy.
            </li>
            <li>
              <strong>Ghi mã model và năm mua.</strong> Người mua tra được mã sẽ tự kiểm chứng giá của
              bạn, và một tin có mã model đứng hẳn ra khỏi đám tin chỉ ghi máy giặt cũ còn tốt.
            </li>
            <li>
              <strong>Kích thước bằng cm, không bằng chữ.</strong> Rộng, cao, sâu. Sofa và tủ là hai
              món hay bị hủy kèo ngay tại cửa vì không lọt cửa hoặc không lọt thang máy, và lỗi đó rơi
              vào bạn chứ không phải người mua.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'khi-nao-nen-ban-xo',
      title: 'Khi nào bán xô cho cửa hàng thu mua mới là đúng',
      body: (
        <>
          <P>
            Có những lúc gọi thu mua là quyết định hợp lý, và một bài viết không chịu nói ra điều đó
            thì cũng thiên vị y như mấy trang của bên thu mua.
          </P>
          <Ul>
            <li>
              <strong>Bạn còn dưới một tuần và phải trả nhà.</strong> Khoảng chênh không bù nổi rủi ro
              phải bỏ lại đồ, hoặc trả tiền cho chủ nhà để họ dọn.
            </li>
            <li>
              <strong>Món cồng kềnh nhưng giá thấp.</strong> Với những thứ nằm quanh hoặc dưới mức
              1.050.000 đ, việc hẹn hết người này đến người khác để nhích thêm một chút không đáng
              thời gian, nhất là khi lần nào bạn cũng phải có mặt ở nhà.
            </li>
            <li>
              <strong>Đồ hỏng, thiếu món, không đồng bộ.</strong> Người mua lẻ hầu như không quan tâm,
              trong khi vựa vẫn nhận vì họ sửa được hoặc rã ra lấy phụ kiện.
            </li>
            <li>
              <strong>Bạn cần căn nhà trống sạch.</strong> Thuê xe chở bỏ cũng mất tiền. Một bên thu
              mua chở hết cả phần không bán được đồng nghĩa bạn được dọn nhà miễn phí, và điều đó có
              giá trị thật.
            </li>
          </Ul>
          <P>
            Cách làm cân bằng nhất vẫn là chia đôi: bán riêng máy lạnh, tủ lạnh, máy giặt, tủ quần áo,
            sofa còn đẹp, robot hút bụi và máy lọc không khí &mdash; nhóm đắt tiền nhất và cũng dễ bán
            lẻ nhất &mdash; rồi để thu mua gom phần còn lại. Đăng tin nhóm kia sớm vài tuần thì bạn có
            cả hai: giá bán lẻ cho phần đáng tiền, và một buổi chiều dọn sạch cho phần còn lại.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept(SLUG),
  faqs: [
    {
      q: 'Bán đồ cũ ở đâu được giá nhất?',
      a: 'Bán thẳng cho người dùng cuối bằng một tin rao luôn được giá cao nhất, vì đó đúng là chỗ mà cửa hàng thu mua sẽ bán lại món của bạn. Trên sàn này, trung vị giá rao của hàng gia dụng và nội thất cũ tại TP.HCM là 2.480.000 đ, với một nửa số tin nằm trong khoảng 1.050.000 đ đến 4.100.000 đ. Cửa hàng thu mua tận nhà nhanh nhất nhưng trả giá sỉ; nhóm cư dân hợp với món nhỏ gọn.',
    },
    {
      q: 'Cửa hàng thu mua trả bao nhiêu thì hợp lý?',
      a: 'Không có một con số chung, nhưng có một phép thử. Hãy tra vài tin đang rao cùng loại, cùng tình trạng, rồi đặt con số họ đưa cạnh trung vị đó: khoảng chênh chính là tiền chở, kho, sửa, bảo hành và lãi của họ. Nếu bạn thấy xứng với việc xong trong một buổi chiều thì bán. Và luôn yêu cầu báo giá từng món, vì báo giá theo lô là cách món tốt gánh món kém.',
    },
    {
      q: 'Máy lạnh cũ bán được khoảng bao nhiêu?',
      a: 'Giá rao trên sàn tại TP.HCM có trung vị 4.298.000 đ, nửa giữa số tin nằm trong khoảng 3.948.000 đ đến 5.498.000 đ. Đây là giá rao chứ không phải giá đã chốt, và giá đó chưa tính chuyện tháo lắp: hãy thống nhất ai tháo, ai lắp lại và ai trả tiền thợ trước khi chốt, chứ đừng để đến lúc thợ đã tới.',
    },
    {
      q: 'Bao lâu thì bán được một món đồ cũ?',
      a: 'Điều đó do giá bạn đặt quyết định nhiều hơn là do món đồ. Đặt quanh mức một phần tư thấp của loại món đó thì bán nhanh, đặt quanh trung vị thì có nhiều người hỏi nhất, còn đặt quanh mức một phần tư cao thì phải chấp nhận chờ và chỉ hợp lý khi món còn rất mới hoặc còn bảo hành. Nếu vài ngày không ai nhắn, thứ cần sửa là giá và ảnh, không phải là kênh bán.',
    },
    {
      q: 'Có nên sửa hay vệ sinh trước khi bán không?',
      a: 'Chỉ làm những việc rẻ và chứng minh được bằng ảnh: vệ sinh máy lạnh, lau sạch máy giặt, thay cái ron cửa, siết lại chân bàn. Sửa lớn thì gần như không bao giờ hoàn vốn ở thị trường đồ cũ, và cách xử lý đúng với một món hỏng nặng là ghi rõ là hỏng rồi định giá theo đúng tình trạng đó.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Bán đồ cũ ở đâu được giá | ${SITE_NAME}`,
  description:
    'Khoảng giá thật đang rao cho đồ gia dụng và nội thất cũ tại TP.HCM theo từng loại món, vì sao bán xô cho cửa hàng thu mua luôn thấp hơn, cách định giá và chụp ảnh để bán nhanh, và khi nào bán xô mới là lựa chọn đúng.',
  alternates: { canonical: `/${SLUG}` },
  openGraph: {
    title: `Bán đồ cũ ở đâu được giá | ${SITE_NAME}`,
    description:
      'Trung vị giá rao 2.480.000 đ, và khoảng giá theo từng loại món: máy lạnh, máy giặt, sofa, tủ quần áo, bàn, kệ. Định giá bằng số liệu thay vì nghe báo giá.',
  },
}

export default function BanDoCuODauDuocGiaPage() {
  return <SeoArticle content={CONTENT} />
}
