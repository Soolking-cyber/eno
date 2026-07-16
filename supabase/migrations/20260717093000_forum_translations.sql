create table if not exists public.forum_translations (
  source_hash text not null,
  target_language text not null check (target_language in ('en', 'vi', 'zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi')),
  source_text text not null,
  translated_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_hash, target_language)
);

alter table public.forum_translations enable row level security;

comment on table public.forum_translations is 'Server-only translation cache for the standalone eno.forum UI and community content.';
