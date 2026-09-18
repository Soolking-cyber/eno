import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * NÊN MUA iPHONE HAY SAMSUNG — the Vietnamese half.
 *
 * ⛔ NO SPEC TABLE, same as the English page: the specs are identical in every country and the
 * useful answer is local. ⚠️ But the local answer differs BY READER, which is why the two pages
 * diverge: an expat weighs "will I take this home", a Vietnamese buyer weighs giá thu lại, bảo hành
 * chính hãng in their own province, and the fact that Samsung is assembled in Bắc Ninh and Thái
 * Nguyên. Translating the English version would miss all three.
 */
const SLUG = 'nen-mua-iphone-hay-samsung'

const CONTENT: ArticleContent = {
  eyebrow: 'So sánh',
  h1: 'Nên mua iPhone hay Samsung',
  intro:
    'Bảng thông số thì ở nước nào cũng như nhau và không phải lý do khiến lựa chọn này khó. Thứ khác biệt tại Việt Nam là giá bán lại, khả năng sửa chữa ở nơi bạn sống, và giá thực tế của từng hãng — trong đó Samsung có lợi thế của một nhà sản xuất đặt nhà máy ngay trong nước. Ba yếu tố này quyết định phần lớn các trường hợp.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/iphone-vs-samsung-vietnam' },
  sections: [
    {
      id: 'gia-ban-lai',
      title: '1. Giá bán lại — khác biệt cộng dồn theo thời gian',
      body: (
        <>
          <P>
            iPhone giữ giá tốt hơn mọi máy Android tại Việt Nam, và khoảng cách ở đây rộng hơn nhiều
            thị trường khác vì tầng máy cũ rất sôi động. Một chiếc iPhone hai năm tuổi có mức giá dễ
            đoán và luôn có người mua; một flagship Android cùng tuổi bán chậm hơn và thu về tỷ lệ
            thấp hơn so với giá mua ban đầu.
          </P>
          <P>
            Điều đó thay đổi chi phí sở hữu thật, không chỉ chuyện lúc bán. ⚠️ Nhưng lập luận này chỉ
            đúng nếu bạn thực sự đổi máy sau hai ba năm. Nếu bạn dùng máy đến khi hỏng hẳn, phần giữ
            giá của iPhone không bao giờ được hiện thực hóa &mdash; khi đó một máy Samsung tầm trung
            đơn giản là rẻ hơn thật.
          </P>
        </>
      ),
    },
    {
      id: 'bao-hanh-sua-chua',
      title: '2. Bảo hành và sửa chữa',
      body: (
        <>
          <P>
            Ở các thành phố lớn, cả hai hãng đều được phục vụ tốt và đây không phải lý do để loại bên
            nào. Khác biệt nằm ở vùng rìa: linh kiện iPhone và thợ sửa độc lập có ở gần như mọi quận
            huyện vì nguồn linh kiện quá dồi dào. Samsung có trung tâm bảo hành chính hãng phủ rộng và
            lợi thế nguồn linh kiện của nhà sản xuất nội địa.
          </P>
          <P>
            Câu hỏi thực tế là chọn <em>model</em> nào chứ không phải hãng nào. Flagship đời hiện tại
            của cả hai đều dễ sửa; một máy Android tầm trung ít phổ biến hoặc một bản iPhone thị trường
            Mỹ mới là lúc bạn phải chờ linh kiện.
          </P>
        </>
      ),
    },
    {
      id: 'gia-thuc-te',
      title: '3. Giá thực tế tại Việt Nam',
      body: (
        <>
          <P>
            Samsung lắp ráp phần lớn sản lượng toàn cầu tại Bắc Ninh và Thái Nguyên, và chính sách giá
            trong nước phản ánh điều đó: khuyến mãi mạnh, dòng tầm trung rất đáng tiền, và mức giảm
            giá trong năm sâu hơn Apple. Apple không sản xuất tại Việt Nam và giữ giá gần mức niêm yết
            lâu hơn sau khi mở bán.
          </P>
          <P>
            Ở phân khúc cao nhất hai bên gần như ngang nhau &mdash; máy gập của bên nào cũng đắt. Bên
            dưới mức đó, Samsung phủ những tầm giá mà Apple không tham gia, nên với ngân sách hạn chế
            thì câu trả lời thành thật gần như luôn là Android.
          </P>
        </>
      ),
    },
    {
      id: 'ket-luan',
      title: 'Vậy nên chọn gì',
      body: (
        <>
          <Ul>
            <li><strong>Đổi máy mỗi 2&ndash;3 năm, ngân sách flagship:</strong> iPhone, chỉ riêng bài toán giá bán lại đã đủ lý do.</li>
            <li><strong>Dùng đến khi hỏng:</strong> Samsung, và nhiều khả năng là bản tầm trung. Bạn sẽ không bao giờ thu lại phần chênh của iPhone.</li>
            <li><strong>Đã đầu tư vào một hệ sinh thái</strong> &mdash; đồng hồ, tai nghe, máy tính, chia sẻ gia đình &mdash; thì ở lại. Chi phí chuyển đổi là có thật.</li>
            <li><strong>Muốn máy gập:</strong> Samsung đã qua nhiều thế hệ và giảm giá mạnh sau vài tháng; máy của Apple mới là đời đầu. Xem <HereLink href="/dien-thoai-gap-nen-mua-loai-nao">bài về điện thoại gập</HereLink>.</li>
          </Ul>
          <P>
            Chọn hãng nào thì câu chuyện chính hãng và xách tay vẫn áp dụng như nhau &mdash; logic bảo
            hành giống hệt, xem{' '}
            <HereLink href="/iphone-chinh-hang-va-xach-tay">bài về máy chính hãng và xách tay</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'iPhone hay Samsung giữ giá tốt hơn ở Việt Nam?',
      a: 'iPhone, và khoảng cách rộng hơn nhiều thị trường khác vì tầng máy cũ trong nước rất sôi động. Máy iPhone hai năm tuổi bán nhanh với giá dễ đoán; flagship Android cùng tuổi bán chậm hơn và thu về tỷ lệ thấp hơn.',
    },
    {
      q: 'Samsung sản xuất tại Việt Nam thì có rẻ hơn không?',
      a: 'Samsung lắp ráp phần lớn sản lượng toàn cầu tại Bắc Ninh và Thái Nguyên, và chính sách giá cùng khuyến mãi trong nước rõ ràng mạnh tay hơn, nhất là ở phân khúc tầm trung. Ở phân khúc cao cấp nhất thì hai hãng gần như ngang nhau.',
    },
    {
      q: 'Máy nào dễ sửa hơn ở Việt Nam?',
      a: 'Cả hai đều tốt ở thành phố lớn. Linh kiện iPhone và thợ sửa độc lập phủ rộng hơn; Samsung mạnh về trung tâm bảo hành chính hãng và nguồn linh kiện nội địa. Yếu tố quyết định thật sự là model cụ thể chứ không phải hãng.',
    },
    {
      q: 'Đang dùng Android có nên chuyển sang iPhone không?',
      a: 'Chỉ nên nếu bạn vốn đã muốn đổi. Chi phí chuyển đổi — ứng dụng, đồng hồ, tai nghe, dữ liệu — là có thật, và không nền tảng nào vượt trội đủ để bù cho điều đó. Các lý do mang tính địa phương là giá bán lại và giá mua, không phải máy nào "tốt hơn".',
    },
    {
      q: 'Điện thoại nào đáng tiền nhất ở Việt Nam hiện nay?',
      a: 'Với đa số ngân sách, đó là một máy Samsung hoặc Xiaomi tầm trung mua mới còn bảo hành chính hãng, hoặc một flagship đời trước trong vài tuần sau khi đời mới mở bán. Flagship đời cũ luôn là thời điểm đáng tiền nhất của thị trường này.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Nên mua iPhone hay Samsung — giá bán lại, bảo hành, giá thực tế | ${SITE_NAME}`,
  description:
    'Ba yếu tố quyết định tại Việt Nam: iPhone giữ giá tốt hơn bao nhiêu trên thị trường máy cũ, khả năng sửa chữa và bảo hành của từng hãng, và giá thực tế khi Samsung đặt nhà máy ngay trong nước.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function NenMuaIPhoneHaySamsungPage() {
  return <SeoArticle content={CONTENT} />
}
