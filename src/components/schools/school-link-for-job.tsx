import Link from 'next/link'
import { cache } from 'react'
import { GraduationCap } from '@/components/ui/icons'
import { Bilingual } from '@/components/marketplace/bilingual'
import { schoolForJob } from '@/lib/schools/queries'

/**
 * On a job page: "What teachers say about <school>" when the ad's employer is a school in the directory
 * (2026-10-04). A server component; renders nothing when there is no match or the read fails.
 */
/**
 * One read per render for one job: a linked job's page renders this link twice (an `md:hidden` copy after the rails on a phone,
 * owner-approved 2026-11-14, cook r06 jobs — page.tsx), and `cache()` compares arguments by identity, so it is keyed on the
 * primitives, not on a fresh `{ city }` object.
 */
const schoolFor = cache((employer: unknown, sellerId: string, city: string | null) => schoolForJob(employer, sellerId, { city }))

export async function SchoolLinkForJob({ employer, sellerId, city, className }: { employer: unknown; sellerId: string; city: string | null; className?: string }) {
  const school = await schoolFor(employer, sellerId, city)
  if (!school) return null
  return (
    <p className={className}>
      <GraduationCap aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
      <Link href={`/schools/${school.slug}`} className="font-semibold text-accent-foreground hover:underline">
        <Bilingual en="What teachers say about {name}" vi="Giáo viên nói gì về {name}" values={{ name: school.name }} />
      </Link>
    </p>
  )
}
