import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * BUYING A USED iPHONE IN VIETNAM — the English half; Vietnamese half at /kinh-nghiem-mua-iphone-cu.
 *
 * ⚠️ THE INSPECTION IS THE ARTICLE. Everything else is framing: a reader who does the ten checks
 * below avoids essentially every expensive mistake in this market, and a reader who does none of
 * them is relying on luck whatever the listing said. So the checks are ordered by what they cost you
 * if skipped, not by how easy they are.
 */
const SLUG = 'buying-a-used-iphone-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Buying a used iPhone in Vietnam: the ten-minute inspection',
  intro:
    'Vietnam has one of the deepest second-hand iPhone markets anywhere, and most of it is honest. The risk is concentrated in a few specific failures — an activation-locked handset, a swapped screen, a tired battery sold as new — and every one of them is detectable in about ten minutes with the phone in your hand. This is that inspection, in the order that matters.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/kinh-nghiem-mua-iphone-cu' },
  sections: [
    {
      id: 'before-you-go',
      title: 'Before you go: decide the grade and the price',
      body: (
        <>
          <P>
            Vietnamese listings grade condition as a percentage — &ldquo;99%&rdquo;, &ldquo;98%&rdquo;,
            &ldquo;likenew&rdquo;. It is a cosmetic scale, not a technical one, and it is the
            seller&rsquo;s own opinion. Treat it as a rough guide to scratches and nothing more; two
            &ldquo;99%&rdquo; handsets can differ by a year of battery life.
          </P>
          <P>
            Set your price against what the same model currently costs new. If a used unit is within
            about 20% of a new VN/A price, the used discount is not paying you for the missing
            warranty. Agree the meeting place in advance: somewhere public, well lit, with Wi-Fi —
            you need a network to complete several of the checks below.
          </P>
        </>
      ),
    },
    {
      id: 'the-inspection',
      title: 'The inspection, in order of what it saves you',
      body: (
        <>
          <Ul>
            <li>
              <strong>1. iCloud is signed out.</strong> Settings › [name] must show no Apple account,
              and Find My must be off. An activation-locked iPhone is a paperweight and no repair shop
              can unlock it. This is the single most expensive mistake available in this market — do
              it first, and walk away if the seller stalls.
            </li>
            <li>
              <strong>2. IMEI matches in three places.</strong> Settings › General › About, the
              engraving or box, and Apple&rsquo;s coverage-check page. A mismatch means the housing,
              the logic board or the story has been changed.
            </li>
            <li>
              <strong>3. Battery health.</strong> Settings › Battery › Battery Health. Below 85%
              means a replacement is due and should come off the price; a missing battery-health
              reading altogether usually means a third-party battery is fitted.
            </li>
            <li>
              <strong>4. Face ID.</strong> Enrol a face, there and then. Face ID breaks when a phone
              has been opened carelessly, and a broken TrueDepth module is one of the costliest
              repairs on the device.
            </li>
            <li>
              <strong>5. The screen.</strong> On newer iPhones, Settings › General › About shows a
              &ldquo;Parts and Service History&rdquo; entry when the display or battery is not
              original. Also look for uneven colour at the edges, a slightly different white balance
              from the bezel inward, and touch that misses near the corners.
            </li>
            <li>
              <strong>6. Both cameras, all lenses.</strong> Shoot a photo and a video with each lens,
              front and back. Check for dust inside the glass and for autofocus hunting on the
              telephoto.
            </li>
            <li>
              <strong>7. Every port and speaker.</strong> Charge it, play audio, record a voice memo,
              make a call. Two microphones exist on modern iPhones and only one gets tested by a
              voice memo.
            </li>
            <li>
              <strong>8. Water damage.</strong> A used phone in a tropical country has seen humidity.
              Look for corrosion at the charging port with a torch, and for a screen that flickers
              when warm.
            </li>
            <li>
              <strong>9. Network.</strong> Put your own SIM in and make a real call and a data
              request. This also catches a carrier-locked máy lock unit being sold as unlocked.
            </li>
            <li>
              <strong>10. Restart it.</strong> A full power cycle in front of you catches boot loops
              and a surprising number of half-repaired handsets.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'shop-vs-private',
      title: 'Shop or private seller',
      body: (
        <>
          <P>
            A second-hand shop costs more and gives you something for the difference: a short warranty
            (usually 1&ndash;6 months), a physical address, and a unit that has usually been tested.
            If it fails in week two you have somewhere to go.
          </P>
          <P>
            A private seller is cheaper and the transaction is final. That is a perfectly good trade
            when you have done the inspection and the saving is real — and a bad one when you are
            rushing, meeting somewhere dark, or being told the battery health screen &ldquo;is not
            working on this model&rdquo;. It works on every model.
          </P>
          <P>
            On this marketplace both kinds of seller are listed, and{' '}
            <HereLink href="/c/electronics">the electronics category</HereLink> shows the shop&rsquo;s
            trust signals beside each listing.
          </P>
        </>
      ),
    },
    {
      id: 'paying',
      title: 'Paying, and what to keep',
      body: (
        <>
          <P>
            Pay only after the inspection, and pay in a way that leaves a record — a bank transfer
            beats cash for exactly one reason, which is that it proves the transaction happened. Get
            the seller&rsquo;s name and number, photograph the IMEI screen, and keep any warranty
            paper the shop issues.
          </P>
          <P>
            Never pay a deposit before seeing the handset, and be wary of pressure to complete quickly
            — the two together are the shape most problems in this market take.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'How do I check a used iPhone before buying in Vietnam?',
      a: 'Confirm iCloud is signed out and Find My is off, match the IMEI in Settings against the box and Apple’s coverage page, read battery health, enrol Face ID, test both cameras and all lenses, check ports and both microphones, insert your own SIM for a real call, and restart the phone in front of the seller.',
    },
    {
      q: 'What does 99% mean in a Vietnamese listing?',
      a: 'It is the seller’s own cosmetic grade — roughly “nearly unmarked”. It says nothing about battery health, repair history or whether parts are original, so treat it as a description of the scratches and check everything else yourself.',
    },
    {
      q: 'What battery health is acceptable on a used iPhone?',
      a: 'Above 90% is good, 85–90% is fair, and below 85% means a replacement is due soon and should be reflected in the price. If the battery health screen shows nothing at all, a third-party battery is usually fitted.',
    },
    {
      q: 'How can I tell if the screen has been replaced?',
      a: 'Newer iPhones list non-original parts under Settings › General › About as a Parts and Service History entry. Visually, look for a colour cast that differs from the bezel inward, uneven brightness at the edges, and touch that misses near the corners.',
    },
    {
      q: 'What is iCloud lock and why does it matter so much?',
      a: 'Activation Lock ties the handset to the previous owner’s Apple account. If it is still signed in, the phone cannot be set up by anyone else and no shop can remove it. It is the one fault that makes a phone worth nothing, which is why it is the first thing to check.',
    },
    {
      q: 'Is it safer to buy used from a shop than a private seller?',
      a: 'Usually yes — a shop gives a short warranty and an address you can return to, at a higher price. A private sale is final, which is fine if you have done the full inspection and the discount is genuine.',
    },
    {
      q: 'Should I buy a used iPhone or a cheaper new model?',
      a: 'Compare the used price against a new VN/A unit of the same model. Within about 20% of new, the discount is not compensating you for the lost warranty, and a newer budget model with a full warranty is often the better phone to own.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Buying a used iPhone in Vietnam — the ten-minute inspection | ${SITE_NAME}`,
  description:
    'The ten checks that catch an iCloud-locked handset, a swapped screen, a third-party battery and a carrier-locked unit before any money moves — plus what “99%” actually means in a Vietnamese listing.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function BuyingAUsedIPhoneVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
