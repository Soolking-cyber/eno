-- eno.forum + itinerary persistence on the existing eno.vn Supabase project.
-- Additive only: no existing marketplace table or column is altered.
-- Identity always references public."Profile" (id = auth.users.id).

create table if not exists public."ForumProfile" (
  "profileId" uuid primary key references public."Profile"(id) on delete cascade,
  bio text,
  "homeBase" text,
  "residentSince" integer,
  reputation integer not null default 0,
  "postCount" integer not null default 0,
  "commentCount" integer not null default 0,
  "helpfulAnswerCount" integer not null default 0,
  "lastSeenAt" timestamp(3) without time zone not null default current_timestamp,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumProfile_residentSince_check"
    check ("residentSince" is null or "residentSince" between 1900 and 2200),
  constraint "ForumProfile_counters_check"
    check (reputation >= 0 and "postCount" >= 0 and "commentCount" >= 0 and "helpfulAnswerCount" >= 0)
);

create table if not exists public."ForumCommunity" (
  slug text primary key,
  name text not null,
  "nameVi" text not null,
  description text not null,
  "descriptionVi" text not null,
  icon text not null,
  location text,
  status text not null default 'active',
  "memberCount" integer not null default 0,
  "postCount" integer not null default 0,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumCommunity_status_check" check (status in ('active', 'archived', 'hidden')),
  constraint "ForumCommunity_counters_check" check ("memberCount" >= 0 and "postCount" >= 0)
);

create index if not exists "ForumCommunity_status_postCount_idx"
  on public."ForumCommunity" (status, "postCount");

create table if not exists public."ForumCommunityMember" (
  "communitySlug" text not null references public."ForumCommunity"(slug) on delete cascade,
  "profileId" uuid not null references public."Profile"(id) on delete cascade,
  role text not null default 'member',
  notifications boolean not null default true,
  "joinedAt" timestamp(3) without time zone not null default current_timestamp,
  primary key ("communitySlug", "profileId"),
  constraint "ForumCommunityMember_role_check" check (role in ('member', 'helper', 'moderator', 'admin'))
);

create index if not exists "ForumCommunityMember_profileId_joinedAt_idx"
  on public."ForumCommunityMember" ("profileId", "joinedAt");
create index if not exists "ForumCommunityMember_communitySlug_role_idx"
  on public."ForumCommunityMember" ("communitySlug", role);

create table if not exists public."ForumPost" (
  id text primary key,
  "communitySlug" text not null references public."ForumCommunity"(slug) on delete restrict,
  "authorProfileId" uuid references public."Profile"(id) on delete set null,
  "authorName" text,
  "authorRole" text,
  kind text not null default 'discussion',
  flair text not null,
  "flairVi" text not null,
  title text not null,
  body text not null,
  location text not null default 'all',
  "locationLabel" text,
  status text not null default 'published',
  pinned boolean not null default false,
  official boolean not null default false,
  score integer not null default 0,
  "commentCount" integer not null default 0,
  "viewCount" integer not null default 0,
  "hotScore" double precision not null default 0,
  "editedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumPost_kind_check" check (kind in ('guide', 'question', 'experience', 'event', 'discussion')),
  constraint "ForumPost_status_check" check (status in ('draft', 'published', 'hidden', 'removed', 'locked')),
  constraint "ForumPost_counters_check" check ("commentCount" >= 0 and "viewCount" >= 0),
  constraint "ForumPost_title_length_check" check (char_length(title) between 8 and 140),
  constraint "ForumPost_body_length_check" check (char_length(body) between 20 and 30000)
);

create index if not exists "ForumPost_status_pinned_hotScore_createdAt_idx"
  on public."ForumPost" (status, pinned, "hotScore", "createdAt");
create index if not exists "ForumPost_communitySlug_status_createdAt_idx"
  on public."ForumPost" ("communitySlug", status, "createdAt");
create index if not exists "ForumPost_authorProfileId_createdAt_idx"
  on public."ForumPost" ("authorProfileId", "createdAt");
create index if not exists "ForumPost_location_status_createdAt_idx"
  on public."ForumPost" (location, status, "createdAt");

create table if not exists public."ForumPostMedia" (
  id text primary key,
  "postId" text not null references public."ForumPost"(id) on delete cascade,
  "storagePath" text not null unique,
  "mimeType" text not null,
  width integer,
  height integer,
  position integer not null default 0,
  "altText" text,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumPostMedia_dimensions_check" check ((width is null or width > 0) and (height is null or height > 0)),
  constraint "ForumPostMedia_position_check" check (position >= 0),
  unique ("postId", position)
);

create index if not exists "ForumPostMedia_postId_idx" on public."ForumPostMedia" ("postId");

create table if not exists public."ForumComment" (
  id text primary key,
  "postId" text not null references public."ForumPost"(id) on delete cascade,
  "authorProfileId" uuid references public."Profile"(id) on delete set null,
  "authorName" text,
  "authorRole" text,
  "parentId" text references public."ForumComment"(id) on delete cascade,
  body text not null,
  status text not null default 'published',
  helpful boolean not null default false,
  score integer not null default 0,
  "replyCount" integer not null default 0,
  "editedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumComment_status_check" check (status in ('published', 'hidden', 'removed')),
  constraint "ForumComment_replyCount_check" check ("replyCount" >= 0),
  constraint "ForumComment_body_length_check" check (char_length(body) between 1 and 10000),
  constraint "ForumComment_not_own_parent_check" check ("parentId" is null or "parentId" <> id)
);

create index if not exists "ForumComment_postId_parentId_createdAt_idx"
  on public."ForumComment" ("postId", "parentId", "createdAt");
create index if not exists "ForumComment_authorProfileId_createdAt_idx"
  on public."ForumComment" ("authorProfileId", "createdAt");
create index if not exists "ForumComment_parentId_idx" on public."ForumComment" ("parentId");

create table if not exists public."ForumPostVote" (
  "postId" text not null references public."ForumPost"(id) on delete cascade,
  "profileId" uuid not null references public."Profile"(id) on delete cascade,
  value integer not null,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  primary key ("postId", "profileId"),
  constraint "ForumPostVote_value_check" check (value in (-1, 1))
);
create index if not exists "ForumPostVote_profileId_createdAt_idx"
  on public."ForumPostVote" ("profileId", "createdAt");

create table if not exists public."ForumCommentVote" (
  "commentId" text not null references public."ForumComment"(id) on delete cascade,
  "profileId" uuid not null references public."Profile"(id) on delete cascade,
  value integer not null,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  primary key ("commentId", "profileId"),
  constraint "ForumCommentVote_value_check" check (value in (-1, 1))
);
create index if not exists "ForumCommentVote_profileId_createdAt_idx"
  on public."ForumCommentVote" ("profileId", "createdAt");

create table if not exists public."ForumBookmark" (
  "postId" text not null references public."ForumPost"(id) on delete cascade,
  "profileId" uuid not null references public."Profile"(id) on delete cascade,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  primary key ("postId", "profileId")
);
create index if not exists "ForumBookmark_profileId_createdAt_idx"
  on public."ForumBookmark" ("profileId", "createdAt");

create table if not exists public."ForumPostSubscription" (
  "postId" text not null references public."ForumPost"(id) on delete cascade,
  "profileId" uuid not null references public."Profile"(id) on delete cascade,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  primary key ("postId", "profileId")
);
create index if not exists "ForumPostSubscription_profileId_createdAt_idx"
  on public."ForumPostSubscription" ("profileId", "createdAt");

create table if not exists public."ForumTag" (
  slug text primary key,
  label text not null,
  "labelVi" text not null,
  "usageCount" integer not null default 0,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumTag_usageCount_check" check ("usageCount" >= 0)
);
create index if not exists "ForumTag_usageCount_idx" on public."ForumTag" ("usageCount");

create table if not exists public."ForumPostTag" (
  "postId" text not null references public."ForumPost"(id) on delete cascade,
  "tagSlug" text not null references public."ForumTag"(slug) on delete cascade,
  primary key ("postId", "tagSlug")
);
create index if not exists "ForumPostTag_tagSlug_postId_idx"
  on public."ForumPostTag" ("tagSlug", "postId");

create table if not exists public."ForumUserBlock" (
  "blockerProfileId" uuid not null references public."Profile"(id) on delete cascade,
  "blockedProfileId" uuid not null references public."Profile"(id) on delete cascade,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  primary key ("blockerProfileId", "blockedProfileId"),
  constraint "ForumUserBlock_not_self_check" check ("blockerProfileId" <> "blockedProfileId")
);
create index if not exists "ForumUserBlock_blockedProfileId_idx"
  on public."ForumUserBlock" ("blockedProfileId");

create table if not exists public."ForumReport" (
  id text primary key,
  "reporterProfileId" uuid references public."Profile"(id) on delete set null,
  "targetProfileId" uuid references public."Profile"(id) on delete set null,
  "postId" text references public."ForumPost"(id) on delete set null,
  "commentId" text references public."ForumComment"(id) on delete set null,
  reason text not null,
  detail text,
  status text not null default 'open',
  "resolvedBy" text,
  "resolvedAt" timestamp(3) without time zone,
  "internalNote" text,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumReport_status_check" check (status in ('open', 'confirmed', 'dismissed', 'abusive')),
  constraint "ForumReport_target_check" check ("postId" is not null or "commentId" is not null or "targetProfileId" is not null),
  constraint "ForumReport_reason_check" check (reason in ('spam', 'scam', 'harassment', 'hate', 'privacy', 'misinformation', 'off_topic', 'other'))
);
create index if not exists "ForumReport_status_createdAt_idx" on public."ForumReport" (status, "createdAt");
create index if not exists "ForumReport_reporterProfileId_createdAt_idx" on public."ForumReport" ("reporterProfileId", "createdAt");
create index if not exists "ForumReport_targetProfileId_createdAt_idx" on public."ForumReport" ("targetProfileId", "createdAt");
create index if not exists "ForumReport_postId_idx" on public."ForumReport" ("postId");
create index if not exists "ForumReport_commentId_idx" on public."ForumReport" ("commentId");

create table if not exists public."ForumModerationAction" (
  id text primary key,
  "targetProfileId" uuid references public."Profile"(id) on delete set null,
  "moderatorProfileId" uuid references public."Profile"(id) on delete set null,
  "postId" text references public."ForumPost"(id) on delete set null,
  "commentId" text references public."ForumComment"(id) on delete set null,
  action text not null,
  reason text not null,
  note text,
  "expiresAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ForumModerationAction_action_check" check (action in ('warn', 'hide', 'remove', 'lock', 'suspend')),
  constraint "ForumModerationAction_target_check" check ("targetProfileId" is not null or "postId" is not null or "commentId" is not null)
);
create index if not exists "ForumModerationAction_targetProfileId_createdAt_idx" on public."ForumModerationAction" ("targetProfileId", "createdAt");
create index if not exists "ForumModerationAction_postId_createdAt_idx" on public."ForumModerationAction" ("postId", "createdAt");
create index if not exists "ForumModerationAction_commentId_createdAt_idx" on public."ForumModerationAction" ("commentId", "createdAt");

create table if not exists public."ForumPostRevision" (
  id text primary key,
  "postId" text not null references public."ForumPost"(id) on delete cascade,
  "editorProfileId" uuid references public."Profile"(id) on delete set null,
  title text not null,
  body text not null,
  "createdAt" timestamp(3) without time zone not null default current_timestamp
);
create index if not exists "ForumPostRevision_postId_createdAt_idx" on public."ForumPostRevision" ("postId", "createdAt");

create table if not exists public."ForumCommentRevision" (
  id text primary key,
  "commentId" text not null references public."ForumComment"(id) on delete cascade,
  "editorProfileId" uuid references public."Profile"(id) on delete set null,
  body text not null,
  "createdAt" timestamp(3) without time zone not null default current_timestamp
);
create index if not exists "ForumCommentRevision_commentId_createdAt_idx" on public."ForumCommentRevision" ("commentId", "createdAt");

create table if not exists public."Itinerary" (
  id text primary key,
  "profileId" uuid not null references public."Profile"(id) on delete cascade,
  title text not null,
  "destinationId" text not null,
  days integer not null,
  "budgetId" text not null,
  interests text not null default '[]',
  status text not null default 'ready',
  "estimatedBudget" integer,
  currency text not null default 'VND',
  "generatedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "Itinerary_days_check" check (days between 1 and 30),
  constraint "Itinerary_status_check" check (status in ('draft', 'ready', 'archived')),
  constraint "Itinerary_estimatedBudget_check" check ("estimatedBudget" is null or "estimatedBudget" >= 0),
  constraint "Itinerary_interests_json_check" check (jsonb_typeof(interests::jsonb) = 'array')
);
create index if not exists "Itinerary_profileId_updatedAt_idx" on public."Itinerary" ("profileId", "updatedAt");
create index if not exists "Itinerary_status_updatedAt_idx" on public."Itinerary" (status, "updatedAt");

create table if not exists public."ItineraryDay" (
  id text primary key,
  "itineraryId" text not null references public."Itinerary"(id) on delete cascade,
  "dayNumber" integer not null,
  area text not null,
  "areaVi" text,
  title text not null,
  "titleVi" text,
  morning text not null,
  "morningVi" text,
  afternoon text not null,
  "afternoonVi" text,
  evening text not null,
  "eveningVi" text,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ItineraryDay_dayNumber_check" check ("dayNumber" between 1 and 30),
  unique ("itineraryId", "dayNumber")
);
create index if not exists "ItineraryDay_itineraryId_idx" on public."ItineraryDay" ("itineraryId");

create table if not exists public."ItineraryStay" (
  id text primary key,
  "itineraryId" text not null references public."Itinerary"(id) on delete cascade,
  position integer not null,
  name text not null,
  "nameVi" text,
  area text not null,
  "areaVi" text,
  note text,
  "noteVi" text,
  "estimatedNightly" integer,
  currency text not null default 'VND',
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  constraint "ItineraryStay_position_check" check (position >= 0),
  constraint "ItineraryStay_estimatedNightly_check" check ("estimatedNightly" is null or "estimatedNightly" >= 0),
  unique ("itineraryId", position)
);
create index if not exists "ItineraryStay_itineraryId_idx" on public."ItineraryStay" ("itineraryId");

-- Seed only canonical community metadata. Preview discussions remain frontend
-- fallback content until real members publish; no fake user accounts are inserted.
insert into public."ForumCommunity" (slug, name, "nameVi", description, "descriptionVi", icon, location)
values
  ('vietnam-101', 'Vietnam 101', 'Nhập môn Việt Nam', 'Practical answers for getting settled.', 'Câu trả lời thực tế để bắt đầu cuộc sống.', 'compass', null),
  ('visas-residency', 'Visas & residency', 'Thị thực & cư trú', 'Visas, work permits, TRCs, and border runs.', 'Thị thực, giấy phép lao động, thẻ tạm trú.', 'file-text', null),
  ('housing', 'Housing', 'Nhà ở', 'Renting, neighborhoods, and landlord questions.', 'Thuê nhà, khu vực sống và chủ nhà.', 'house', null),
  ('jobs-careers', 'Jobs & careers', 'Việc làm & sự nghiệp', 'Contracts, hiring, and working in Vietnam.', 'Hợp đồng, tuyển dụng và làm việc tại Việt Nam.', 'briefcase-business', null),
  ('daily-life', 'Daily life', 'Đời sống hằng ngày', 'The useful details you only learn by living here.', 'Những điều hữu ích chỉ biết khi sống tại đây.', 'coffee', null),
  ('hanoi', 'Hanoi', 'Hà Nội', 'Local advice from the capital.', 'Kinh nghiệm địa phương tại thủ đô.', 'home', 'hanoi'),
  ('hcmc', 'Ho Chi Minh City', 'TP. Hồ Chí Minh', 'Life, places, and people around Saigon.', 'Cuộc sống, địa điểm và con người ở Sài Gòn.', 'building-2', 'hcmc'),
  ('danang', 'Da Nang', 'Đà Nẵng', 'Coastal living and central Vietnam.', 'Cuộc sống ven biển và miền Trung Việt Nam.', 'waves', 'danang'),
  ('families-schools', 'Families & schools', 'Gia đình & trường học', 'Schools, childcare, and family life.', 'Trường học, chăm sóc trẻ và đời sống gia đình.', 'users', null),
  ('events-meetups', 'Events & meetups', 'Sự kiện & gặp gỡ', 'Find your people offline.', 'Tìm cộng đồng của bạn ngoài đời.', 'calendar-days', null)
on conflict (slug) do update set
  name = excluded.name,
  "nameVi" = excluded."nameVi",
  description = excluded.description,
  "descriptionVi" = excluded."descriptionVi",
  icon = excluded.icon,
  location = excluded.location,
  "updatedAt" = current_timestamp;

-- New content is exposed only through authenticated eno server routes. RLS is
-- still enabled on every table so the public Supabase Data API is deny-by-default.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'ForumProfile', 'ForumCommunity', 'ForumCommunityMember', 'ForumPost',
    'ForumPostMedia', 'ForumComment', 'ForumPostVote', 'ForumCommentVote',
    'ForumBookmark', 'ForumPostSubscription', 'ForumTag', 'ForumPostTag',
    'ForumUserBlock', 'ForumReport', 'ForumModerationAction',
    'ForumPostRevision', 'ForumCommentRevision', 'Itinerary', 'ItineraryDay',
    'ItineraryStay'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- Forum images use the same Supabase Storage project. The user UUID is the
-- first path segment: <auth.uid()>/<post-id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'forum-media',
  'forum-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "forum_media_public_read" on storage.objects;
create policy "forum_media_public_read"
  on storage.objects for select
  using (bucket_id = 'forum-media');

drop policy if exists "forum_media_insert_own_folder" on storage.objects;
create policy "forum_media_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "forum_media_update_own_folder" on storage.objects;
create policy "forum_media_update_own_folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "forum_media_delete_own_folder" on storage.objects;
create policy "forum_media_delete_own_folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

comment on table public."ForumPost" is 'eno.forum discussions; authors reference the marketplace Profile identity';
comment on table public."ForumComment" is 'Threaded eno.forum replies with soft-delete status';
comment on table public."Itinerary" is 'Saved eno.forum itinerary preferences and generated plan metadata';
