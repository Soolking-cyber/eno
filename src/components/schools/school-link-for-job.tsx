import Link from 'next/link'
import { GraduationCap } from '@/components/ui/icons'
import { Bilingual } from '@/components/marketplace/bilingual'
import { schoolForJob } from '@/lib/schools/queries'

/**
 * On a job page: "What teachers say about <school>" when the ad's employer is a school in the directory
 * (2026-10-04). A server component; renders nothing when there is no match or the read fails.
 */
export async function SchoolLinkForJob({ employer, sellerId, className }: { employer: unknown; sellerId: string; className?: string }) {
  const school = await schoolForJob(employer, sellerId)
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
