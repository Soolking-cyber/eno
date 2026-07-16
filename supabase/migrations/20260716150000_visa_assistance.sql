-- eno.forum-owned assisted Vietnam e-Visa feature. This migration is deployed
-- with the standalone forum project; it does not require eno.vn application code.

create table if not exists public.visa_applications (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft',
  encrypted_payload text not null,
  payload_version integer not null default 1,
  checklist jsonb not null default '[]'::jsonb,
  applicant_confirmation_version text,
  applicant_confirmed_at timestamptz,
  applicant_snapshot_hash text,
  authorization_version text,
  authorized_at timestamptz,
  authorization_snapshot_hash text,
  assigned_admin text,
  submitted_at timestamptz,
  resolved_at timestamptz,
  retention_until timestamptz,
  last_applicant_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visa_applications_status_check check (status in (
    'draft', 'ready_for_review', 'under_review', 'needs_changes',
    'applicant_approval', 'ready_to_submit', 'submitted',
    'payment_required', 'processing', 'approved', 'rejected', 'cancelled'
  )),
  constraint visa_applications_checklist_array check (jsonb_typeof(checklist) = 'array')
);
create index if not exists visa_applications_user_updated_idx on public.visa_applications(user_id, updated_at desc);
create index if not exists visa_applications_status_updated_idx on public.visa_applications(status, updated_at desc);
create index if not exists visa_applications_retention_idx on public.visa_applications(retention_until);

create table if not exists public.visa_documents (
  id uuid primary key,
  application_id uuid not null references public.visa_applications(id) on delete cascade,
  kind text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null,
  width integer,
  height integer,
  sha256 text not null,
  created_at timestamptz not null default now(),
  constraint visa_documents_kind_check check (kind in ('portrait', 'passport', 'supporting', 'result')),
  constraint visa_documents_size_check check (size_bytes > 0 and size_bytes <= 10485760)
);
create index if not exists visa_documents_application_kind_idx on public.visa_documents(application_id, kind, created_at);

create table if not exists public.visa_events (
  id uuid primary key,
  application_id uuid not null references public.visa_applications(id) on delete cascade,
  actor_type text not null,
  actor_ref text,
  event text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint visa_events_actor_check check (actor_type in ('applicant', 'admin', 'system')),
  constraint visa_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index if not exists visa_events_application_created_idx on public.visa_events(application_id, created_at);

create table if not exists public.visa_prefill_sessions (
  id uuid primary key,
  application_id uuid not null references public.visa_applications(id) on delete cascade,
  token_hash text not null unique,
  created_by text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists visa_prefill_application_idx on public.visa_prefill_sessions(application_id, created_at);
create index if not exists visa_prefill_expiry_idx on public.visa_prefill_sessions(expires_at, consumed_at);

alter table public.visa_applications enable row level security;
alter table public.visa_documents enable row level security;
alter table public.visa_events enable row level security;
alter table public.visa_prefill_sessions enable row level security;

-- No public Data API policies: all access is through eno.forum server routes,
-- which revalidate the Supabase user and scope every query to auth.users.id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visa-documents', 'visa-documents', false, 10485760, array['image/jpeg', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.visa_applications is 'eno.forum e-Visa cases; identity answers are AES-256-GCM encrypted before storage';
