-- Persist the upload checks used to prevent an applicant from sending an
-- unsuitable portrait or passport page to the official e-Visa form.

alter table public.visa_documents
  add column if not exists validation_status text not null default 'pending',
  add column if not exists validation_report jsonb not null default '{}'::jsonb;

alter table public.visa_documents
  drop constraint if exists visa_documents_validation_status_check;

alter table public.visa_documents
  add constraint visa_documents_validation_status_check
  check (validation_status in ('pending', 'passed', 'failed', 'unavailable'));

update public.visa_documents
set validation_status = 'passed'
where kind in ('supporting', 'result') and validation_status = 'pending';

comment on column public.visa_documents.validation_report is
  'Non-PII technical and image-quality checks; extracted identity values remain only in the encrypted application payload';
