# eno.forum

Independent Next.js application for the eno.forum community experience and Vietnam itinerary builder. It shares a Git repository with eno.vn but has its own dependencies, build, tests, environment variables, and Vercel project.

## Local development

```bash
npm install
npm run dev
```

The forum runs at `http://localhost:3101`. The marketplace remains on port 3000.

## Vercel project

Create a second Vercel project from the same Git repository with these settings:

- Root Directory: `apps/forum`
- Framework Preset: Next.js
- Build Command: `npm run build`
- Install Command: `npm install`
- Node.js: 24.x

Set these production environment variables:

```text
NEXT_PUBLIC_FORUM_URL=https://eno.forum
NEXT_PUBLIC_MARKETPLACE_URL=https://eno.vn
```

Add the custom domain to this forum project in Vercel. In the marketplace Vercel project, set `NEXT_PUBLIC_FORUM_URL` to the same forum origin and redeploy so its forum icon crosses to the separate application.

The current publish/reply/vote/save flows remain UI-preview state. A forum database and authentication bridge are a later backend phase.
