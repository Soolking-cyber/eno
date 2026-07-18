# Claude prompt — one eno dashboard

Use this prompt in the root `Soolking-cyber/eno` workspace. Codex has already removed
the duplicate account/dashboard rail from `apps/forum`; do not restore it.

```text
Implement the owner's one-dashboard requirement in the eno.vn root application.

Outcome
- There is exactly one dashboard implementation: eno.vn `/dashboard`.
- The dashboard has one persistent left navigation rail. Selecting an item renders
  that section in the right content area through an internal Next.js route; it must
  not replace the dashboard shell, redirect to eno.forum, or open a second dashboard.
- Forum, Marketplace, Itineraries, Vietnam e-Visa, Settings, Help, and every applicable
  account section use this same shell and navigation model.
- Admins use the same shell structure, but see only the admin sections their server-
  verified role permits. Ordinary users must never receive or see admin navigation.

Existing state to preserve and consolidate
- `src/app/dashboard/layout.tsx` already owns the shared Header/main/Footer frame.
- The global account rail currently contains most navigation behavior.
- Internal dashboard pages already exist for `/dashboard/forum`, `/dashboard/trips`,
  `/dashboard/visa`, listings, availability, disputes, settings, and help.
- `apps/forum` is the sole forum/itinerary/visa product source and must not gain another
  dashboard. Its signed-in account controls now link directly to `https://eno.vn/dashboard`.
- The legacy `apps/forum/dashboard` route remains only for old bookmarks.

Required changes
1. Extract one canonical dashboard-shell/rail configuration and reuse it for desktop,
   mobile, user, seller/business, and admin variants. Do not maintain parallel nav lists.
2. Keep the rail on the left and the selected section on the right. Use nested internal
   routes and `Link`; preserve the shell between selections so there is no full-page
   dashboard replacement or layout jump.
3. Add a clear internal Marketplace overview section if the current dashboard home does
   not satisfy the Marketplace row. “Marketplace” must select marketplace content on the
   right, while “Forum” selects `/dashboard/forum`, “Itineraries” selects
   `/dashboard/trips`, and “Vietnam e-Visa” selects `/dashboard/visa`.
4. Remove dashboard-rail rows and dashboard service-card actions that use `goToForum`,
   absolute eno.forum anchors, or a redirect merely to display dashboard information.
   Dashboard summaries and management views must render in the right panel using the
   existing server loaders/proxies. Do not use an iframe and do not copy the forum app.
5. Keep full public/product tools on their owning domain, but do not disguise a cross-site
   action as a dashboard section. If a genuine tool handoff remains necessary, label it
   explicitly as a separate “Open planner/assistant/public forum” action outside the core
   dashboard rail; the rail itself stays internal.
6. Make authorization server-derived. Build the allowed navigation set from the verified
   user capabilities: ordinary user, seller, business seller, moderator/admin. Do not use
   pathname alone as proof of admin access. Admins should see relevant queues, including
   the visa operator queue when authorized; regular users should see only their own visa
   applications.
7. Ensure `/admin/*` uses the same visual shell and interaction model, with an admin-only
   item set in the same left rail position and right content region. Preserve every server
   authorization check on the page/API, not only UI hiding.
8. Keep the existing shared account, i18n, Base UI primitives, 44px targets, open borders,
   symmetric spacing, mobile drawer behavior, keyboard/focus handling, and native app
   navigation contracts.
9. Prevent layout jumps: the rail width and right-panel offset must be stable during auth
   and dashboard data loading. Use skeletons inside the right panel rather than swapping
   the whole shell.
10. Update tests to prove:
   - one rail exists at a time;
   - all core dashboard items have internal eno.vn hrefs;
   - selecting Forum/Marketplace/Trips/Visa preserves the shell and changes the right pane;
   - mobile uses the same item source in a focus-trapped drawer;
   - admin items are absent for users and present only for an authorized admin;
   - no dashboard navigation points at the retired Soolking-cyber/eno-forum repository or
     creates another dashboard under apps/forum.

Do not edit or deploy from `/Users/mk1e3/eno-forum` or `Soolking-cyber/eno-forum`.
Make the root-app changes, validate typecheck/lint/build and focused Playwright coverage,
then commit and push the whole monorepo according to the owner’s Claude shipping workflow.
```
