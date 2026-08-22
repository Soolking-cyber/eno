# Cloud Build — removed 2026-08-22

Owner: *"remove cloud build entirely we preview locally and deploy on box from now on
all future changes."*

⛔ **A PUSH IS NO LONGER A DEPLOY.** Nothing reaches users until `eno-deploy.sh` runs on
162.4.176.208. See `infra/vn-node/eno-deploy.sh`.

## Why it went

DNS moved to the VN box on 2026-08-21. Cloud Build kept building and deploying Cloud Run
faithfully for a full day afterwards — to a service with no traffic. Meanwhile the box
built from its own checkout, which nobody pulled. Production silently drifted **fourteen
commits behind**, including seven security fixes, while every pipeline reported green.

⚠️ The pipeline was never broken. It was pointed at somewhere that had stopped mattering,
and a green build is not evidence that users got the code.

## What was deleted

Two triggers in **asia-southeast1** (not europe-west1 — that region holds only the old
build history and will happily report a deploy that never happened), plus
`cloudbuild.yaml` and `cloudbuild.services.yaml`.

Their definitions are below verbatim, so this is reversible if the decision changes.

```yaml
--- eno-vn-deploy-asia
createTime: '2026-08-03T12:22:06.067652784Z'
filename: cloudbuild.yaml
github:
  name: eno
  owner: Soolking-cyber
  push:
    branch: ^main$
id: 4461d387-e49f-4cc4-9b59-d19c939d8469
ignoredFiles:
- apps/forum/**
- apps/ios/**
- apps/android/**
- ios/**
- android/**
- e2e/**
- test-results/**
- playwright-report/**
- docs/**
- .claude/**
- .github/**
- '*.md'
- playwright.config.ts
- vitest.config.ts
- .gitignore
name: eno-vn-deploy-asia
resourceName: projects/speedy-victory-500106-h8/locations/asia-southeast1/triggers/4461d387-e49f-4cc4-9b59-d19c939d8469
serviceAccount: projects/speedy-victory-500106-h8/serviceAccounts/71068369681-compute@developer.gserviceaccount.com
substitutions:
  _TAG: $SHORT_SHA
--- eno-forum-deploy-asia
createTime: '2026-08-17T05:24:06.567037517Z'
filename: cloudbuild.services.yaml
github:
  name: eno
  owner: Soolking-cyber
  push:
    branch: ^main$
id: a79bda39-a474-4773-8e1f-0da1c051f921
ignoredFiles:
- apps/forum/**
- apps/ios/**
- apps/android/**
- ios/**
- android/**
- e2e/**
- test-results/**
- playwright-report/**
- docs/**
- .claude/**
- .github/**
- '*.md'
- playwright.config.ts
- vitest.config.ts
- .gitignore
name: eno-forum-deploy-asia
resourceName: projects/speedy-victory-500106-h8/locations/asia-southeast1/triggers/a79bda39-a474-4773-8e1f-0da1c051f921
serviceAccount: projects/speedy-victory-500106-h8/serviceAccounts/71068369681-compute@developer.gserviceaccount.com
substitutions:
  _TAG: $SHORT_SHA
```
