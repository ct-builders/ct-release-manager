# Production versioning, deletions & undeploy

The stage→live deploy was **upsert-only**: it could create/update, never delete, and
kept **no history of production** — so a deploy couldn't be reversed and a release
couldn't remove anything from prod. This adds all three.

## Production baselines (`lib/prod-history.mjs`)

Every asset now has a production version timeline. Snapshots are immutable JSON in the
existing `release-asset-history` CustomObject container under a **reserved branch
`__prod__`**, stored in the **stage** (authoring) project so **production stays clean**.

```
history key = <resourceType>~<key>__<__prod__>__v<n>
```

Before a real deploy, `captureBaselines()` snapshots the **current prod content** of
every asset the deploy will touch (upserts + deletions):

- asset **absent** in prod (a create) → a **tombstone** `{ deleted: true }` — records
  "was absent," which is what lets a rollback of a create become a delete.
- asset **present** (an update or delete) → its full pre-deploy content.

The per-asset versions are recorded on the deploy's audit entry
(`release.deployments[].baselines`), so a rollback knows exactly which version to
restore.

**Bootstrap:** `bin/baseline-production.mjs --apply` files a `__prod__` v1 for every
keyed prod asset — a rollback floor for assets no release has touched yet
("baseline everything in production and file it as the version"). Idempotent.

## First-class deletions (`lib/deploy.mjs`)

A release can now carry **`deletions`** (same per-type shape as `members`). `deployBundle`
gained a `delete` action (unpublish products → delete-by-key) and a `delete` bucket in
its summary. Deletions apply after upserts, so one release can add some assets and remove
others. `PUT /releases/:key/members` accepts `{ members, deletions }`.

## Undeploy / rollback (`lib/undeploy.mjs`, `POST /releases/:key/undeploy`)

Rolls a release's last applied deploy back off production, using the recorded baselines:

- baseline was a **tombstone** → the deploy created it → **delete** it.
- baseline had **content** → the deploy updated/deleted it → **upsert the content back**.

The whole rollback is expressed as a restore bundle + a deletion list and run through the
same `deployBundle` — so it uses the exact tested upsert/delete machinery and snapshots a
fresh baseline first (the rollback is itself tracked). Requires the `publish` capability.
The release moves `published → rolled-back`; from there it can be re-deployed or sent back
to `draft` for revisions.

## Verified

`test/prod-history.test.mjs` (pure) + `test/e2e-undeploy.test.mjs` (opt-in `RUN_E2E=1`,
against real stage+live, self-cleaning) — all green:

1. **create → undeploy deletes** it (tombstone baseline).
2. **update → undeploy reverts** it to the prior content.
3. **delete via a release → prod deletes it; undeploy restores** it.

MC app: a **Undeploy / roll back** button on published releases (publish capability) with
a confirm, a `rolled-back` status badge, and rollbacks shown in the deployment history.
