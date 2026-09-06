# MC app — browser tests (Release Deployments)

The "Release Deployments" app runs inside the authenticated Merchant Center iframe,
which is impractical to drive headlessly. The browser layer is therefore split into
an **automatable** part and a **manual** part.

## Automatable — publish-prompt behaviour

`publish-prompt.harness.html` is a standalone page that reproduces the exact markup
and decision of the post-approval publish prompt built into
[`release-detail.tsx`](../../src/components/releases/release-detail.tsx). It lets the
UI behaviour be verified in a real browser with no MC session.

`release-workflow.smoke.spec.mjs` (Playwright) drives that harness and asserts:

1. Approver **with** publish rights → the prompt appears → "Publish to production"
   runs the (mocked) deploy → status `published`.
2. Approver **without** publish rights → **no** prompt; an info note says a publisher
   must publish it (status stays `approved`).
3. "Not now" → the prompt is dismissed, leaving the release `approved` for a publisher.

```bash
cd packages/mc-releases
npx playwright test test/ui          # installs Playwright on first run
# or just open publish-prompt.harness.html in a browser and click through it
```

> The harness mirrors the component; keep it in sync when changing the modal
> (`doApprove` / `doDeploy` / the modal JSX in `release-detail.tsx`).

## Manual — full authenticated click-path (real MC app)

The end-to-end lifecycle against the live service must be exercised inside Merchant
Center (log in, open **Release Deployments**):

1. **Create** a release; add product / category / discount members.
2. **Publish to stage** — status → `ready-for-review`; use **Test on stage ↗** to
   preview. (The workflow data path is covered automatically by the deploy service's
   `test/e2e-release.test.mjs`.)
3. As a **reviewer** account, **Approve** with a note.
   - If that account also has the **publisher** role → the *"Publish to production
     now?"* prompt appears; **Publish to production** deploys stage → live.
   - If it does **not** → a note says a publisher must publish; sign in as a
     **publisher** account and use **Publish to production**.
4. Confirm the change on the production storefront.

The **reject** path (Reject → note required → back to `draft`) is a future addition —
see `../../../release-deploy/test/README-e2e.md`.
