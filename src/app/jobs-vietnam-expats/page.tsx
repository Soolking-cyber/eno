import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 86400

export const metadata: Metadata = {
  title: 'Jobs for Expats & Internationals in Vietnam | eno.vn',
  description:
    'Find jobs for expats and internationals in Vietnam — teaching, hospitality, marketing, tech and English-required roles in Ho Chi Minh City. Every eno.vn employer has a public trust score and bad listings get reported.',
  alternates: { canonical: '/jobs-vietnam-expats' },
  openGraph: {
    title: 'Jobs for Expats & Internationals in Vietnam | eno.vn',
    description:
      'Teaching, hospitality, marketing, tech and English-required roles for internationals in Vietnam — fewer fake and recycled postings.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Jobs · Vietnam',
  h1: 'Jobs for Expats & Internationals in Vietnam',
  intro:
    'Looking for work in Vietnam? Find jobs suited to expats and internationals — English teaching, hospitality, marketing, design, tech and roles where English is required — mostly across Ho Chi Minh City. Every eno.vn employer has a public trust score and bad listings get reported, so you skip the recycled and fake postings.',
  categorySlug: 'jobs',
  cta: 'Browse jobs',
  sections: [
    {
      title: 'Roles internationals look for',
      body: 'English teaching (centres and international schools), hospitality and F&B, digital marketing, software and design, plus customer-facing roles where a foreign language is an asset. Filter the listings to find roles that explicitly require English.',
    },
    {
      title: 'Apply directly, no middlemen',
      body: 'Message the employer or recruiter in-app and follow up on your own terms. You decide when to share your contact details — only after they reply.',
    },
    {
      title: 'Fewer scams, real opportunities',
      body: 'Job scams targeting newcomers are common. On eno.vn every employer has a public trust score and buyers can report bad listings, so problem posters get caught fast and you spend your time on genuine opportunities.',
    },
  ],
  faqs: [
    {
      q: 'What kinds of jobs are listed for expats?',
      a: 'English teaching, hospitality, marketing, tech, design and other roles where English or another foreign language is useful — primarily in Ho Chi Minh City.',
    },
    {
      q: 'Do I need a work permit?',
      a: 'Most full-time roles for foreigners require a work permit and visa. Ask the employer directly through in-app chat about sponsorship before you commit.',
    },
    {
      q: 'How do I apply?',
      a: 'Tap “Message” on a job listing to contact the employer in-app; share your CV or details once they reply.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
