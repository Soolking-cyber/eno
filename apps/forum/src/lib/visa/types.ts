// Shared client-side shapes for visa application API payloads — the single source
// of truth for the document/event/application objects both the applicant assistant
// (visa-assistant.tsx) and the admin case view (visa-admin-case.tsx) render.
// Extracted so the two views can't drift (the admin copy had lost the
// warnings/corrections/normalized keys of validationReport).
import type { VisaPayload } from '@/lib/visa/schema'

export type VisaImageReport = {
  issues?: string[]
  warnings?: string[]
  corrections?: string[]
  normalized?: { format?: string; sizeBytes?: number; width?: number | null; height?: number | null }
}

export type VisaDocument = {
  id: string; kind: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null
  validationStatus?: 'pending' | 'passed' | 'failed' | 'unavailable'
  validationReport?: VisaImageReport
  createdAt: string
}

export type VisaEvent = { id: string; actorType: string; event: string; metadata: Record<string, unknown>; createdAt: string }

export type VisaApplication = {
  id: string; status: string; payload?: VisaPayload; checklist: string[]; applicantConfirmedAt: string | null;
  authorizedAt: string | null; assignedAdmin: string | null; submittedAt: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string; documents: VisaDocument[]; events?: VisaEvent[]
}
