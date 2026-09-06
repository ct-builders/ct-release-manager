# Registering & deploying "Branch Editor"

This Merchant Center Custom Application is the branch-aware product authoring UI.
Branch/version ops (fork, save-version, restore, list) call the
`release-deploy` HTTP service; deep product reads/writes go through the
MC API gateway (the logged-in user's permissions).

## 0. Prerequisite: the service

The app calls `release-deploy` (Cloud Run) for `/branches*` endpoints. It's
already deployed at the URL in `custom-application-config.mjs`
(`additionalEnv.deployServiceUrl`), and that origin is in `headers.csp['connect-src']`.
`additionalEnv` is public. A Custom Application is a static bundle with no server
of its own, so everything in `additionalEnv` is served to the browser — it lands in
a `window.app` blob in the app's HTML, which any unauthenticated visitor to the
Netlify URL can read. Merchant Center SSO governs the Merchant Center, not this
origin. Keep `additionalEnv` to non-secrets, and give the service a credential
that identifies the caller rather than a shared one every reader of the page holds.

## 1. Build

```bash
npm install
npm run build   # typecheck + emit public/
```

## 2. Deploy to Netlify

Create the site in a team account rather than a personal one. This is a
**monorepo package**, so set the site's **base directory to `packages/mc-branch-editor`**;
build settings then come from this package's `netlify.toml` (`npm run build` → publish
`public/`). Wire native Git auto-publish on push to `main`. Suggested site name:
`mc-branch-editor` → serve on the plain `https://<site>.netlify.app`.

> Per the global MC-app note, an MC Custom App works fine on the plain
> `<site>.netlify.app` URL — no custom domain needed (MC loads it in an iframe by
> registered URL). Point `env.production.url` at the `.netlify.app` URL.

## 3. Register in the Merchant Center

your commercetools organization → **Settings → Custom Applications → Add**. Use:

- **Application URL**: the deployed URL (`https://<site>.netlify.app`)
- **Application entry point URI path**: `branch-editor`
- Permissions (View: `view_products`, `view_categories`, `view_key_value_documents`;
  Manage: `manage_products`, `manage_categories`) and the menu link are read from
  `custom-application-config.mjs`.

MC assigns an **Application ID**. Paste it into `env.production.applicationId`, rebuild,
redeploy. Install the app for the **authoring** project (`your-stage-project`) — this app
edits branch content in the authoring project, not live.

## 4. Verify

Open the app in MC. Pick/create a branch in the top bar → **Fork a product onto this
branch** → click the product → edit name/slug/description → **Save to HEAD** → **Save
version** → confirm it appears under **Version history**, then **Restore** an earlier
version. Switching branches re-scopes the list; "← Back to products" is an in-app
transition (no full reload).

## Scope (this app grows in phases)

- **4a Products** — list / fork / edit (name, slug, description) / save-version / restore. ✅
- **4b Categories** — planned.
- **4c Discounts** — planned (all four types; validated-predicate editor).

## Config recap

| Where | Set |
|---|---|
| `additionalEnv.deployServiceUrl` | deployed service URL |
| `headers.csp['connect-src']` | same origin |
| `env.production.applicationId` | MC-assigned id (after step 3) |
| `env.production.url` | deployed `<site>.netlify.app` URL |
