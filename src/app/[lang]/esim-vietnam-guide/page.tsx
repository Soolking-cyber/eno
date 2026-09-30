import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { guideDates } from '@/lib/expat-guides'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'
import { seoBrowseHref } from '@/components/marketplace/seo-landing-href'

/**
 * eSIM IN VIETNAM — the English half; Vietnamese half at /esim-viettel-vinaphone-mobifone.
 *
 * ⚠️ THE FOREIGNER'S VERSION OF THIS TOPIC IS A DIFFERENT ARTICLE FROM THE LOCAL ONE, which is why
 * the pair diverges so far. Registration requirements, keeping a home number alive, and the tourist
 * data packages matter here; none of them is what a Vietnamese reader is searching for.
 *
 * ⛔ NO PRICES AND NO PACKAGE NAMES. Operator tariffs change constantly and a stale number in an
 * evergreen guide is a claim a reader acts on at a counter.
 *
 * ⚠️ THE PLANS THEMSELVES ARE ONE LINK AWAY, AND THAT IS HOW THE RULE ABOVE STAYS AFFORDABLE. The
 * networks' eSIMs and data plans are live listings (services › esim — 63 from 9 networks, measured
 * 2026-09-27 on /api/listings), refreshed by scripts/import-esim.ts, each opening the network's own
 * page. The guide carries no tariff; the listings carry the tariff and say where the current one is.
 * The href comes from seoBrowseHref — there is no /c/<cat>/<subcat> route, so a subcategory browse
 * is the explorer's query string, built in one place.
 *
 * ⚠️ NO "PASSPORT" IN THE PROSE — the brief's shared-page vocabulary rule (a page.tsx compiles on
 * eno.vn too). The requirement is written as "your own original identity document, the one you
 * entered Vietnam on", which is the same instruction to the reader.
 */
const SLUG = 'esim-vietnam-guide'

const ESIM_PLANS_HREF = seoBrowseHref({ categorySlug: 'services', subcategorySlug: 'esim' })

const CONTENT: ArticleContent = {
  eyebrow: 'Practical guide',
  h1: 'eSIM in Vietnam: networks, phones and getting one',
  intro:
    'Every Vietnamese network issues eSIM, which makes an eSIM-capable phone genuinely useful here: you can keep your home number live on the physical SIM or a second profile and run a local number for banking, delivery and ride-hailing apps that will not accept a foreign number. This guide covers which networks and handsets support it, what registration requires, and the traps worth knowing before you switch.',
  canonical: `/${SLUG}`,
  ...guideDates(SLUG),
  lang: 'en',
  alternate: { lang: 'vi', href: '/esim-viettel-vinaphone-mobifone' },
  sections: [
    {
      id: 'networks-and-phones',
      title: 'Which networks and which phones',
      body: (
        <>
          <P>
            All four operators — <strong>Viettel</strong>, <strong>VinaPhone</strong>,{' '}
            <strong>MobiFone</strong> and <strong>Vietnamobile</strong> — issue eSIM profiles. Viettel
            has the widest rural coverage, which matters if you travel outside the cities; in Hồ Chí
            Minh City and Hà Nội the practical difference between the big three is small.
          </P>
          <P>
            On the handset side, iPhone XS and later support eSIM, as do recent Samsung Galaxy S and
            Z models, Google Pixel and a growing set of Chinese flagships. ⚠️ Two exceptions catch
            people out: some mainland-China market variants ship without eSIM hardware entirely, and a
            carrier-locked máy lock unit usually cannot activate a Vietnamese profile at all.
          </P>
        </>
      ),
    },
    {
      id: 'registering',
      title: 'Registering one as a foreigner',
      body: (
        <>
          <P>
            Vietnamese SIMs must be registered to an identity document — anonymous prepaid SIMs were
            phased out and the rules have tightened repeatedly. As a foreigner you register with your
            own original identity document, the one you entered Vietnam on, usually in person at an
            official operator store; some networks also let a foreigner buy and register an eSIM
            online. Street vendors and phone shops sell SIMs too, and a SIM registered to somebody
            else&rsquo;s papers is one that can be cut off without warning; buying from the operator
            itself is worth the extra half hour.
          </P>
          <Ul>
            <li>Bring the original document itself, not a photocopy or a photo of it.</li>
            <li>Bring the phone — the QR profile is installed there and then, and a failed install is much easier to fix at the counter.</li>
            <li>Expect biometric or photo capture as part of registration; this is now routine.</li>
            <li>Keep the QR code and any activation paperwork. Some profiles can only be installed once.</li>
          </Ul>
          <P>
            eSIMs and data plans from Viettel, VinaPhone, MobiFone, Vietnamobile and several smaller
            networks are listed on this site under{' '}
            <HereLink href={ESIM_PLANS_HREF}>eSIM and data plans</HereLink>: each plan shows its data
            allowance and validity, and each listing says what a foreigner needs to register. The
            button on a listing opens the network&rsquo;s own page, which is where you buy and where
            the current price is.
          </P>
        </>
      ),
    },
    {
      id: 'why-bother',
      title: 'Why a local number matters here',
      body: (
        <>
          <P>
            More than connectivity. A Vietnamese number is effectively a prerequisite for daily life:
            banking apps send OTPs to local numbers only, ride-hailing and delivery apps verify with
            one, and a great many services will not complete a signup without it. Arriving with only
            a roaming foreign number means several things simply do not work.
          </P>
          <P>
            eSIM is what makes this painless — your home number stays reachable for messages from
            your bank abroad while the Vietnamese profile handles everything local, with no swapping
            of trays and no lost SIM in a hotel drawer.
          </P>
        </>
      ),
    },
    {
      id: 'traps',
      title: 'Traps worth knowing',
      body: (
        <>
          <Ul>
            <li>
              <strong>Transferring an eSIM to a new phone</strong> is not always self-service. Some
              operators require a shop visit to reissue the profile — worth asking about before you
              buy a new handset, not after you have wiped the old one.
            </li>
            <li>
              <strong>Tourist data packages</strong> sold at airport counters are convenient and
              generally cost more than the same operator&rsquo;s standard prepaid plan bought in town.
            </li>
            <li>
              <strong>Prepaid numbers expire.</strong> A number with no activity for an extended
              period can be recycled, which matters if you leave Vietnam for months and expect your
              banking OTPs to still arrive.
            </li>
            <li>
              <strong>Check eSIM support before buying a phone</strong> second-hand, particularly on
              imported units. It is listed in Settings, and it is easier to verify at the shop than to
              discover afterwards. See{' '}
              <HereLink href="/buying-a-used-iphone-vietnam">the used-iPhone inspection</HereLink>.
            </li>
          </Ul>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Do Vietnamese networks support eSIM?',
      a: 'Yes — Viettel, VinaPhone, MobiFone and Vietnamobile all issue eSIM profiles. Viettel has the widest rural coverage; in the major cities the practical difference between the big three is small.',
    },
    {
      q: 'Can a foreigner get an eSIM in Vietnam?',
      a: 'Yes. Register with your own original identity document — the one you entered Vietnam on, not a photocopy — usually in person at an official operator store, and bring the phone so the profile can be installed at the counter. Some networks also let a foreigner buy and register an eSIM online. Expect photo or biometric capture as part of registration.',
    },
    {
      q: 'Does an imported iPhone work with Vietnamese eSIM?',
      a: 'An unlocked international unit does. Two exceptions: some mainland-China market variants have no eSIM hardware, and a carrier-locked unit generally cannot activate a Vietnamese profile. Check the model number before buying.',
    },
    {
      q: 'Do I need a Vietnamese phone number?',
      a: 'For anything beyond a short holiday, effectively yes. Banking apps send OTPs only to local numbers, and ride-hailing, delivery and many other services require one to complete signup. eSIM lets you add it without giving up your home number.',
    },
    {
      q: 'Can I move my eSIM to a new phone myself?',
      a: 'Sometimes. Some operators allow self-transfer in the app and others require a shop visit to reissue the profile. Ask before you buy a new handset rather than after you have wiped the old one.',
    },
    {
      q: 'Is an airport tourist SIM a good deal?',
      a: 'It is convenient and usually more expensive than the same operator’s standard prepaid plan bought at a store in town. If you are staying more than a few days, the town store is worth the trip.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = withShare({
  title: `eSIM in Vietnam — networks, compatible phones and registration | ${SITE_NAME}`,
  description:
    'Which Vietnamese networks issue eSIM, which handsets support it, what a foreigner needs to register one, why a local number is effectively required for banking apps, and the transfer traps worth knowing.',
  alternates: phoneGuideAlternates(SLUG),
}, { type: 'article' })

export default function EsimVietnamGuidePage() {
  return <SeoArticle content={CONTENT} />
}
