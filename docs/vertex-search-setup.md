# Vertex AI Search setup — the AI concierge that draws the GenAI App Builder credit

The AI concierge (the ✨ button in the search bars) reasons over a **Vertex AI Search**
data store of your listings. That's deliberate: catalog search + generated summaries
bill under the **"Vertex AI Search & Conversation"** SKUs — the ones the *Trial credit
for GenAI App Builder* actually covers. (Gemini API is **not** covered, which is why the
concierge does **not** use Gemini.) Until the steps below are done, the concierge falls
back to a plain Postgres keyword search (`source:"fallback"`, no AI, no credit draw) so
the UI still works.

## Prerequisites
- GCP project **`eno-vn`** (the one linked to billing `01F9D6-540E00-D5BEFA`, where the
  ₫26.3M credit lives — so the spend nets against the credit).
- The Vertex service account you already made for Gemini (`eno-vertex@eno-vn…`).

## 1. Enable the API + grant the service account
```bash
gcloud services enable discoveryengine.googleapis.com --project eno-vn
gcloud projects add-iam-policy-binding eno-vn \
  --member="serviceAccount:eno-vertex@eno-vn.iam.gserviceaccount.com" \
  --role="roles/discoveryengine.editor"     # read+write documents + query
```

## 2. Create the Search app + data store
Console → **AI Applications** (formerly Agent Builder) → **Create app** → **Search**.
- Turn ON **Enterprise edition features** and **Advanced LLM features** (required for the
  generated summary the concierge shows — this is the credit-covered generative SKU).
- Create a new **data store** → **Structured data** → **empty / API** (we push docs via
  the API, not a GCS/BigQuery import).
- Region: **global** (matches `VERTEX_SEARCH_LOCATION=global`).
- Note the **Data store ID** and the **App/Engine ID**.

Document schema (set fields after the first doc is pushed, or up front):
| Field | Type | Settings |
|---|---|---|
| `title`, `titleVi`, `description` | string | **Searchable**, Retrievable |
| `categorySlug`, `brandSlug`, `condition`, `listingType`, `district`, `province`, `ward` | string | **Filterable**, Retrievable |
| `price`, `trustScore`, `postedAt` | number | **Filterable** (price/trustScore also used for the boost) |

## 3. Set env (then redeploy)
Same place as the other secrets (and later on Cloud Run). `GOOGLE_VERTEX_PROJECT` +
`GOOGLE_VERTEX_CREDENTIALS` are already set from the Gemini work.
```
VERTEX_SEARCH_LOCATION=global
VERTEX_SEARCH_DATASTORE_ID=<data store id>
VERTEX_SEARCH_ENGINE_ID=<app/engine id>
```

## 4. Backfill the catalog
With an admin session, run the (re-runnable) backfill — it pushes every public
listing (public fields only; **never** seller phone/PII) into the data store:
```bash
curl -X POST https://eno.vn/api/admin/vertex-backfill   # → { ok, indexed, failed }
```
Re-run after a DB reset. (Live incremental sync on create/edit/sold is the next small
step — see "Follow-ups".)

## 5. Verify it works + draws the credit
- Open the ✨ AI mode, ask "road bike under 8M near Thảo Điền" → you should get a
  generated reply + product cards. The concierge response includes `source:"vertex"`
  when it's running on the data store (vs `"fallback"`).
- **Credit draw:** Billing → Reports, group by SKU → you'll see **Vertex AI Search**
  SKUs accruing and the credit line offsetting them (≥24h lag). This is the spend the
  ₫26.3M was meant for.

## Follow-ups (small, fast)
- **Live sync hooks**: index on create / re-index on edit / remove on sold·hidden·delete
  via `syncListingToVertex()` in the listing mutation routes, so new listings appear in
  AI search without waiting for a backfill.
- **Semantic results page**: `vertexSearchListingIds()` is ready to power a full semantic
  search results page (not just the concierge) when you want it.
