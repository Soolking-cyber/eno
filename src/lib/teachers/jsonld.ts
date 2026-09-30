/**
 * Structured data for a teacher profile page (2026-09-30): a ProfilePage whose mainEntity is a
 * Person. ⛔ NEVER Product/Offer — a person is not a product, and Google treats that markup as
 * misrepresentation (the same rule the PDP applies to jobs). ⛔ No contact data: telephone, email
 * and the CV stay behind the teacher's "Share" tap, so they are never in the page at all.
 */
export type TeacherLdInput = {
  url: string
  fullName: string
  headline: string
  photoUrl: string | null
  nationality: string
  languages: string[]
  cityLabel: string
  degreeLevel: string | null
  degreeMajor: string | null
  degreeInstitution: string | null
  certificates: { type: string; provider: string }[]
  updatedAt: Date
}

const DEGREE_NAMES: Record<string, string> = {
  phd: 'Doctoral degree', master: "Master's degree", bachelor: "Bachelor's degree", associate: 'Associate degree',
}

export function teacherProfileLd(t: TeacherLdInput) {
  const credentials = [
    ...(t.degreeLevel && DEGREE_NAMES[t.degreeLevel]
      ? [{ '@type': 'EducationalOccupationalCredential', credentialCategory: 'degree', name: [DEGREE_NAMES[t.degreeLevel], t.degreeMajor].filter(Boolean).join(', ') }]
      : []),
    ...t.certificates.filter((c) => c.type).map((c) => ({
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: 'certificate',
      name: c.type.toUpperCase(),
      ...(c.provider ? { recognizedBy: { '@type': 'Organization', name: c.provider } } : {}),
    })),
  ]
  return {
    '@context': 'https://schema.org/',
    '@type': 'ProfilePage',
    url: t.url,
    dateModified: t.updatedAt.toISOString(),
    mainEntity: {
      '@type': 'Person',
      name: t.fullName,
      description: t.headline,
      jobTitle: 'Teacher',
      ...(t.photoUrl ? { image: t.photoUrl } : {}),
      ...(t.nationality ? { nationality: { '@type': 'Country', name: t.nationality } } : {}),
      ...(t.languages.length ? { knowsLanguage: t.languages } : {}),
      homeLocation: { '@type': 'Place', name: `${t.cityLabel}, Vietnam` },
      ...(t.degreeInstitution ? { alumniOf: { '@type': 'CollegeOrUniversity', name: t.degreeInstitution } } : {}),
      ...(credentials.length ? { hasCredential: credentials } : {}),
    },
  }
}
