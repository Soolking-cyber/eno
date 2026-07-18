# eno.forum workspace rules

- `apps/forum` is the source of truth for `eno.forum`, including the forum, itinerary builder, concierge entry points, and Vietnam e-Visa assistant.
- It lives in the `Soolking-cyber/eno` monorepo but remains an independent Next.js application and Vercel project. The `eno-forum` Vercel project must use Root Directory `apps/forum`; browser domains and environment variables remain separate from the root marketplace project.
- Codex owns `apps/forum/**`. Do not edit files outside this directory unless the user explicitly assigns a cross-app contract change. Preserve unrelated root-worktree changes made by other collaborators.
- The former `Soolking-cyber/eno-forum` repository is migration history only after cutover and should be archived read-only. Never make it the deployment source again.
- Shared eno account, Supabase data, marketplace API integrations, and the native one-app handoff are intentional. Keep cross-origin tokens server-only or single-use, and keep OAuth callbacks outside verified-link path capture.
- Design priorities: open borders, balanced spacing, visual symmetry, pleasant proportions, and consistent control heights. Prefer clear, calm layouts over dense decoration. Check desktop and mobile together.
- Public forum, itinerary, and visa UI must support the same 11 languages as the marketplace. Preserve English and hand-authored Vietnamese copy; translate the other supported languages through the cached translation service.
