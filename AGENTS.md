# Codex workspace boundary

- For every `eno.forum`, forum, itinerary, concierge, or Vietnam e-Visa request, work only in `/Users/mk1e3/eno.vn/apps/forum/**`.
- `/Users/mk1e3/eno.vn/apps/forum` is the sole source of truth and the deployable workspace for the `eno-forum` Vercel project.
- The former local checkout `/Users/mk1e3/eno-forum` and GitHub repository `Soolking-cyber/eno-forum` are retired migration history. Never edit, commit, push, or deploy from them.
- Do not modify the marketplace or other monorepo directories for a forum request unless the owner explicitly assigns a cross-app contract or native-shell change.
- Keep the `eno-forum` Vercel project: it owns the forum domains and environment variables while deploying this monorepo's `apps/forum` root.
- Codex only edits and validates `apps/forum/**`. Do not commit, push, trigger a deployment, or run the shipping workflow; Claude owns the whole-monorepo commit and push, and Vercel deploys automatically from that push.
