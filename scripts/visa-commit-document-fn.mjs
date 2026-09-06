// visa_commit_document — the ATOMIC core of a visa document upload (2026-09-05 review, S04).
//
// The route used to: check status → upload → SELECT the old rows of that kind → INSERT the new row →
// DELETE the old rows → remove the old objects (fail-open). Every gap was a real state: a case
// submitted between the check and the INSERT took a document after lock; two concurrent uploads of
// the same kind each "replaced" the same old row and left two; a failed INSERT orphaned the new
// object; a failed removal orphaned the old ones with no row able to find them again.
//
// This function does the row work in ONE transaction, holding the application row:
//   1. SELECT … FOR UPDATE on the application, scoped to the caller (user_id) — not found → not_found
//   2. status must still be draft/needs_changes                              — else → application_locked
//   3. if p_replace: DELETE the previous rows of this kind and TOMBSTONE their storage paths
//      (public."StorageTombstone", the durable erasure queue) in the same statement
//   4. INSERT the new row from p_document with application_id PINNED to p_application_id (all twelve columns are
//      supplied by the route; the pin means a mis-built or hostile JSON can never land a document
//      in somebody else's case)
//   5. DROP the upload-intent tombstone the route wrote for the new object: it is referenced now
// Returns jsonb: {ok:true, old_paths:[…]} or {ok:false, code:'not_found'|'application_locked'}.
// The route then removes old_paths best-effort — a failure there is not a loss, the tombstones are
// swept by /api/cron/storage-tombstones after their grace hour.
//
// ⚠️ SECURITY: never callable by an end user over PostgREST — it writes rows for a case by id.
// EXECUTE is revoked from public/anon/authenticated and granted ONLY to service_role (getVisaDb).
//
// Run:  set -a; . ./.env; set +a; node scripts/visa-commit-document-fn.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url })
await client.connect()

// ⛔ THE PARAMETERS ARE NAMED, AND THE ROUTE CANNOT CALL THIS FUNCTION OTHERWISE. The first
// version declared them by TYPE ONLY — `(uuid, uuid, jsonb, boolean)` — so PostgreSQL stored
// `proargnames = NULL`, while documents/route.svc.ts calls
// `db.rpc('visa_commit_document', { p_application_id, p_user_id, p_document, p_replace })`.
// PostgREST resolves an RPC by ARGUMENT NAME, so a nameless function is unreachable from the app:
// every visa document upload fails. Confirmed against production 2026-09-06 —
// `select proargnames from pg_proc where proname='visa_commit_document'` returns NULL.
// ⚠️ SIG (named) IS FOR `create`; IDENTITY (types only) IS FOR `revoke`/`grant`, because
// `pg_get_function_identity_arguments` never includes names and the two must not be confused.
const SIG = 'public.visa_commit_document(p_application_id uuid, p_user_id uuid, p_document jsonb, p_replace boolean)'
const IDENTITY = 'public.visa_commit_document(uuid, uuid, jsonb, boolean)'
const stmts = [
  // Drop every existing overload by introspection (see visa-capture-payment-fn.mjs for why).
  `do $$
   declare r record;
   begin
     for r in select oid::regprocedure as sig from pg_proc
              where pronamespace = 'public'::regnamespace and proname = 'visa_commit_document'
     loop execute 'drop function ' || r.sig; end loop;
   end $$`,
  `create function ${SIG}
   returns jsonb
   language plpgsql
   security definer
   set search_path = public
   as $$
   declare
     v_status text;
     v_doc    jsonb := jsonb_set(p_document, '{application_id}', to_jsonb(p_application_id));  -- ⛔ PINNED to the locked case, whatever the JSON says
     v_kind   text := p_document->>'kind';
     v_path   text := p_document->>'storage_path';
     v_old    text[] := '{}';
   begin
     if v_kind is null or v_path is null then return jsonb_build_object('ok', false, 'code', 'invalid_document'); end if;
     select status into v_status from visa_applications where id = p_application_id and user_id = p_user_id for update;
     if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
     if v_status not in ('draft', 'needs_changes') then
       return jsonb_build_object('ok', false, 'code', 'application_locked');
     end if;
     if p_replace then
       -- ⚠️ DISTINCT, NOT NULL, AND NEVER THE NEW OBJECT'S OWN PATH: two legacy rows of one kind with
       -- the same path would make the upsert fail ("cannot affect row a second time") and lock the
       -- applicant out of that kind for ever; and a replaced row that happens to share the new path
       -- must not put the just-committed object into old_paths for the route to delete.
       with gone as (
         delete from visa_documents where application_id = p_application_id and kind = v_kind returning storage_path
       ), distinct_gone as (
         select distinct storage_path from gone where storage_path is not null and storage_path <> v_path
       ), stamped as (
         insert into "StorageTombstone" ("id", "bucket", "path", "reason", "createdAt", "notBefore", "attempts")
         -- ⚠️ "at time zone 'utc'": the column is timestamp WITHOUT time zone and Prisma reads it as UTC;
         -- a bare now() would be converted through the session zone and could land hours off.
         select gen_random_uuid()::text, 'visa-documents', storage_path, 'visa_document_replaced', (now() at time zone 'utc'), (now() at time zone 'utc') + interval '1 hour', 0
         from distinct_gone
         on conflict ("bucket", "path") do update set "reason" = excluded."reason", "notBefore" = excluded."notBefore", "lastError" = null, "attempts" = 0
         returning "path"
       )
       select coalesce(array_agg("path"), '{}'::text[]) into v_old from stamped;
     end if;
     -- ⚠️ EXPLICIT COLUMNS. "insert … select *" would turn any key missing from the JSON into an
     -- explicit NULL that bypasses the column default — a future column would break every upload.
     insert into visa_documents (id, application_id, kind, storage_path, mime_type, size_bytes, width, height,
                                 sha256, created_at, validation_status, validation_report)
     select coalesce(r.id, gen_random_uuid()), r.application_id, r.kind, r.storage_path, r.mime_type, r.size_bytes, r.width, r.height,
            r.sha256, coalesce(r.created_at, now()), coalesce(r.validation_status, 'pending'), coalesce(r.validation_report, '{}'::jsonb)
     from jsonb_populate_record(null::visa_documents, v_doc) as r;
     delete from "StorageTombstone" where "bucket" = 'visa-documents' and "path" = v_path;
     return jsonb_build_object('ok', true, 'old_paths', to_jsonb(v_old));
   end $$`,
  `revoke all on function ${IDENTITY} from public`,
  `revoke all on function ${IDENTITY} from anon, authenticated`,
  `grant execute on function ${IDENTITY} to service_role`,
  // ⛔ POSTGREST CACHES THE SCHEMA, INCLUDING ARGUMENT NAMES. Without this the API keeps serving
  // the previous signature until it happens to restart, so a correct migration can still look
  // like a broken deploy. The notification is cheap and harmless when nothing is listening.
  `notify pgrst, 'reload schema'`,
]

try {
  await client.query('begin')
  await client.query(`set local lock_timeout = '5s'`)
  for (const sql of stmts) await client.query(sql)
  await client.query('commit')
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('failed:', e.message)
  process.exit(1)
}
const { rows } = await client.query(
  `select proname, pg_get_function_identity_arguments(oid) as args,
          has_function_privilege('anon', oid, 'execute') as anon_can,
          has_function_privilege('service_role', oid, 'execute') as service_can
   from pg_proc where pronamespace = 'public'::regnamespace and proname = 'visa_commit_document'`,
)
console.log('visa_commit_document:', rows)
await client.end()
