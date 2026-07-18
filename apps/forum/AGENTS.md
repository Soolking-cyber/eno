# eno.forum workspace rules

- `/Users/mk1e3/eno.vn/apps/forum` is the sole source of truth for `eno.forum`, including the forum, itinerary builder, concierge entry points, and Vietnam e-Visa assistant. Make all future changes to those products here and nowhere else.
- It lives in the `Soolking-cyber/eno` monorepo but remains an independent Next.js application and Vercel project. The `eno-forum` Vercel project must use Root Directory `apps/forum`; browser domains and environment variables remain separate from the root marketplace project.
- Codex owns `apps/forum/**`. Do not edit files outside this directory unless the user explicitly assigns a cross-app contract change. Preserve unrelated root-worktree changes made by other collaborators.
- Codex's role ends after making and validating local changes. Never commit, push, trigger Vercel, or run the shipping workflow; Claude owns the monorepo-wide commit and push, and Vercel builds automatically afterward.
- The former `/Users/mk1e3/eno-forum` checkout and `Soolking-cyber/eno-forum` repository are retired migration history. Never edit, commit, push, or deploy from either one; the GitHub repository should remain archived read-only.
- Shared eno account, Supabase data, marketplace API integrations, and the native one-app handoff are intentional. Keep cross-origin tokens server-only or single-use, and keep OAuth callbacks outside verified-link path capture.
- Design priorities: open borders, balanced spacing, visual symmetry, pleasant proportions, and consistent control heights. Prefer clear, calm layouts over dense decoration. Check desktop and mobile together.
- Public forum, itinerary, and visa UI must support the same 11 languages as the marketplace. Preserve English and hand-authored Vietnamese copy; translate the other supported languages through the cached translation service.
