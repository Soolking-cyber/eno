# eno.forum monorepo cutover

`apps/forum` is the deployable source for the existing Vercel project `eno-forum`.
The marketplace remains the repository-root deployment for the Vercel project `eno`.

## Preconditions

- The forum-only commit is present on `Soolking-cyber/eno` `main`.
- `cd apps/forum && npm install && npm run typecheck && npm run lint && npm test && npm run build` passes.
- The existing `eno-forum` production deployment is recorded as the rollback target.
- Do not archive `Soolking-cyber/eno-forum` until the new production deployment passes the checks below.

## Re-point the existing project

In Vercel, open `eno-forum` and change the existing project—do not create a new project:

1. **Settings → Git → Connected Git Repository:** disconnect `Soolking-cyber/eno-forum`, then connect `Soolking-cyber/eno`.
2. **Settings → Build and Deployment → Root Directory:** set `apps/forum`.
3. Confirm **Framework Preset = Next.js**, **Node.js = 24.x**, install command `npm install`, and build command `npm run build`.
4. Confirm the existing `eno.forum` and `www.eno.forum` domains are still assigned.
5. Confirm the existing environment variables and their Production/Preview scopes; never copy secret values into Git.

Vercel supports multiple projects connected to separate directories in one repository. The Root Directory is also the working directory for the Ignored Build Step: [Vercel monorepo documentation](https://vercel.com/docs/monorepos), [Ignored Build Step guide](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel).

## Scope deployments

The repository does not currently define JavaScript workspaces at its root, so use an Ignored Build Step instead of Vercel's workspace-aware “Skip unaffected projects” feature.

For `eno-forum` (Root Directory `apps/forum`):

```sh
git diff HEAD^ HEAD --quiet -- .
```

For `eno` (Root Directory `.`):

```sh
git diff HEAD^ HEAD --quiet -- . ':(exclude)apps/forum/**'
```

Exit code `0` skips the build; a non-zero exit code builds it. When manually redeploying or rolling back, uncheck **Use project's Ignore Build Step** so Vercel does not suppress the requested deployment.

## Cutover verification

Use a commit that changes `apps/forum/**` only. Confirm `eno-forum` builds and `eno` is skipped, then verify:

- `https://eno.forum/`, `/itinerary`, `/visa`, and `/dashboard` return 200.
- Sign-in completes on `eno.forum` and does not redirect to `eno.vn/?code=...`.
- The account rail links both applications and marks the current forum service active.
- An itinerary can be generated, saved, and downloaded as a valid `.docx`.
- A visa draft can be created and its two private images can be uploaded and reviewed.
- `https://eno.forum/favicon.ico` returns the search favicon.
- The admin AI-health endpoint remains private and the visa prefill control is visible only to the configured admin.

Then use a root-only commit and confirm the inverse: `eno` builds and `eno-forum` is skipped.

## Rollback and archive

If the new deployment fails, immediately promote the recorded known-good `eno-forum` deployment; Vercel retains deployments even after the Git connection changes. Reconnect the standalone repository only if promotion is insufficient.

After both scoped deployment tests pass, archive `Soolking-cyber/eno-forum` on GitHub. Keep it read-only as migration history; do not continue feature work there.
