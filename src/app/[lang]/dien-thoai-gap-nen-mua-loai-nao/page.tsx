import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * ĐIỆN THOẠI GẬP NÊN MUA LOẠI NÀO — the Vietnamese half.
 *
 * ⛔ SAME CAUTION AS THE ENGLISH PAGE AND FOR THE SAME REASON: no durability claim can be made
 * truthfully about a phone that launched days ago, so none is made in either direction. ⚠️ What
 * differs is the frame — this reader is comparing against a Galaxy Fold they can already buy
 * discounted in any chain, and is asking about bảo hành rơi vỡ and giá thay màn, not about whether
 * to carry the phone home on a plane.
 */
const SLUG = 'dien-thoai-gap-nen-mua-loai-nao'

const CONTENT: ArticleContent = {
  eyebrow: 'So sánh',
  h1: 'Điện thoại gập nên mua loại nào',
  intro:
    'iPhone Duo — máy gập đầu tiên của Apple — mở bán tại Việt Nam từ 23 tháng 10 năm 2026, bước vào phân khúc mà Samsung đã làm từ 2019. Bài này nói về giá thực tế của máy gập trong nước, những bộ phận thường hỏng, chi phí thay màn khi hết bảo hành, và vì sao đời đầu thường nên chờ.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/foldable-phones-vietnam' },
  sections: [
    {
      id: 'co-nhung-loai-nao',
      title: 'Thị trường trong nước đang có gì',
      body: (
        <>
          <P>
            <strong>Dạng gập ngang (kiểu sách)</strong> mở ra thành màn hình cỡ máy tính bảng &mdash;
            Galaxy Z Fold, vài hãng Trung Quốc, và nay là iPhone Duo. Đây là nhóm đắt nhất.{' '}
            <strong>Dạng gập dọc (kiểu vỏ sò)</strong> như Galaxy Z Flip gập lại thành khối vuông bỏ
            túi, giá thấp hơn đáng kể.
          </P>
          <P>
            Apple bán máy với tên <strong>iPhone Duo</strong>, không phải &ldquo;iPhone 18 Fold&rdquo;,
            dù nhiều cửa hàng trong nước vẫn rao theo cả hai cách. Đặt trước từ 19h ngày 16/10, giao
            máy từ 23/10; bản dung lượng cao nhất là chiếc iPhone đầu tiên bán chính hãng tại Việt Nam
            vượt mốc 100 triệu đồng. Giá thực tế có trên{' '}
            <HereLink href="/iphone-duo-vietnam">trang giá iPhone Duo</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'hong-o-dau',
      title: 'Máy gập thường hỏng ở đâu',
      body: (
        <>
          <P>
            Ba chỗ, xếp theo mức độ phổ biến của cả phân khúc từ 2019 đến nay. ⚠️ Đây không phải nhận
            định về riêng model nào của năm 2026 &mdash; đó là rủi ro chung mà bạn chấp nhận khi mua
            máy gập.
          </P>
          <Ul>
            <li>
              <strong>Màn hình trong.</strong> Lớp gập mềm hơn kính thường và vùng nếp gấp là điểm
              yếu. Đây cũng là linh kiện đắt nhất trên máy.
            </li>
            <li>
              <strong>Bản lề.</strong> Kẻ thù là bụi và cát &mdash; thứ Việt Nam không thiếu, nhất là
              mùa mưa. Các đời đầu của cả phân khúc đều gặp vấn đề này; thiết kế gần đây kín hơn nhiều.
            </li>
            <li>
              <strong>Miếng dán màn trong.</strong> Đây là một phần của cụm màn hình, không phải phụ
              kiện. ⚠️ Tự bóc ra là hỏng màn, và lỗi đó không bảo hành nào nhận.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'chi-phi-sua',
      title: 'Câu hỏi cần hỏi trước khi trả tiền',
      body: (
        <>
          <P>
            Hỏi cửa hàng: <strong>thay màn trong hết bảo hành tốn bao nhiêu, và sửa được trong nước
            hay phải gửi đi nước ngoài?</strong> Hỏi trước khi mua chứ không phải lúc máy đã hỏng. Với
            máy đời đầu, câu trả lời thường là phải gửi đi &mdash; nghĩa là mất máy vài tuần, cộng
            thêm tiền sửa.
          </P>
          <P>
            Hỏng màn do hao mòn theo thời gian thường không được tính là lỗi nhà sản xuất, nên không
            nằm trong bảo hành tiêu chuẩn. Đây là nhóm sản phẩm duy nhất mà gói bảo hành mở rộng hoặc
            bảo hành rơi vỡ thực sự thay đổi bài toán &mdash; nên hỏi giá gói đó cùng lúc với giá máy.
          </P>
        </>
      ),
    },
    {
      id: 'nen-mua-loai-nao',
      title: 'Ai nên mua, ai nên chờ',
      body: (
        <>
          <Ul>
            <li>
              <strong>Nên chờ</strong> nếu việc phải thay máy sẽ khiến bạn khó xử. Phần cứng đời đầu
              trong một phân khúc mà cơ cấu cơ khí là điểm yếu chính là trường hợp kinh điển nên để
              người khác thử trước.
            </li>
            <li>
              <strong>Samsung ít rủi ro hơn</strong> ở thời điểm này, thuần túy vì số thế hệ: bảy đời
              cải tiến bản lề và màn hình, có nhà máy trong nước, trung tâm bảo hành xử lý máy gập
              thường xuyên. Máy Samsung cũng giảm giá mạnh sau vài tháng, điều mà một sản phẩm Apple
              vừa mở bán không có.
            </li>
            <li>
              <strong>Bản gập dọc rẻ hơn nhiều.</strong> Nếu bạn thích kiểu dáng chứ không cần màn
              hình lớn bên trong, dạng vỏ sò cho trải nghiệm mới lạ tương tự với chi phí thấp hơn hẳn.
            </li>
            <li>
              <strong>Mua iPhone Duo</strong> nếu bạn thực sự muốn, chịu được chi phí sửa, và gắn bó
              với hệ sinh thái iOS đến mức máy Samsung không thay thế được. Đó là lựa chọn chính đáng
              &mdash; chỉ cần biết rõ mình đang chọn gì.
            </li>
          </Ul>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'iPhone Duo bán ở Việt Nam từ khi nào?',
      a: 'Đặt trước từ 19h ngày 16/10/2026 và giao máy từ 23/10/2026. Tin rao trước ngày đó đều là đặt trước, dù trang của cửa hàng ghi thế nào. Bản dung lượng cao nhất là chiếc iPhone đầu tiên bán chính hãng tại Việt Nam vượt 100 triệu đồng.',
    },
    {
      q: 'Điện thoại gập có bền không?',
      a: 'Các đời gần đây kín và bền hơn đời đầu nhiều, nhưng màn hình trong và bản lề vẫn là hai chỗ hỏng chính, trong khi bụi, cát và mưa ở Việt Nam đều sẵn. Không thể khẳng định độ bền của một chiếc máy vừa ra mắt vài ngày — và đó chính là lý do nên cân nhắc chờ.',
    },
    {
      q: 'Thay màn hình máy gập hết bao nhiêu tiền?',
      a: 'Đây là linh kiện đắt nhất trên máy, và hỏng do hao mòn thường không được bảo hành. Hãy hỏi cửa hàng con số cụ thể khi hết bảo hành và hỏi rõ sửa trong nước hay phải gửi đi — máy đời đầu thường phải gửi đi.',
    },
    {
      q: 'Nên mua iPhone Duo hay Galaxy Z Fold?',
      a: 'Xét riêng độ chín của công nghệ thì Samsung: bảy thế hệ cải tiến, có nhà máy trong nước, và giảm giá đáng kể sau vài tháng. Chọn iPhone Duo nếu hệ sinh thái iOS quan trọng đến mức máy Samsung không thay thế được và bạn chịu được chi phí sửa chữa.',
    },
    {
      q: 'Có được bóc miếng dán màn hình trong không?',
      a: 'Không. Miếng dán đó là một phần của cụm màn hình chứ không phải phụ kiện, tự bóc ra là hỏng màn và không bảo hành nào nhận. Nếu nó bong mép, hãy mang ra trung tâm bảo hành thay vì tự xử lý.',
    },
    {
      q: 'Máy gập dọc có rẻ hơn gập ngang không?',
      a: 'Rẻ hơn đáng kể. Bản gập dọc gập lại thành khối vuông bỏ túi thay vì mở ra màn hình lớn, và giá nằm thấp hơn hẳn nhóm gập ngang. Nếu bạn không cần màn hình lớn bên trong thì đây là cách vào phân khúc này với chi phí thấp.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Điện thoại gập nên mua loại nào — iPhone Duo hay Galaxy Z Fold | ${SITE_NAME}`,
  description:
    'Giá máy gập tại Việt Nam, những bộ phận thường hỏng, chi phí thay màn hình khi hết bảo hành, và vì sao máy gập đời đầu thường nên chờ thế hệ sau.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function DienThoaiGapNenMuaLoaiNaoPage() {
  return <SeoArticle content={CONTENT} />
}
