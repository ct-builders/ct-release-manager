# Registering & deploying "Release Deployments"

This Merchant Center Custom Application drives the `release-deploy`
HTTP service. Both must be deployed for it to work.

## 0. Deploy the service first

The app calls the `release-deploy` service from the browser. Deploy it
(GCP Cloud Run, or any host), note its HTTPS URL, then:

1. Set `additionalEnv.deployServiceUrl` in `custom-application-config.mjs` to that URL.
2. Add the same origin to `headers.csp['connect-src']` (already includes localhost +
   an `example.com` placeholder — replace with the real origin).
3. Leave `additionalEnv.deployServiceToken` as the placeholder. `additionalEnv` is
   public: a Custom Application is a static bundle with no server of its own, so
   every value in it is served to the browser in a `window.app` blob that any
   unauthenticated visitor to the Netlify URL can read. Merchant Center SSO governs
   the Merchant Center, not this origin. A shared bearer placed here is a credential
   published to everyone — give the service one that identifies the caller instead.

## 1. Build

```bash
npm install
npm run build   # typechecks + emits public/
```

## 2. Deploy to Netlify

Create the site in a team account rather than a personal one, and wire
native Git auto-publish (see the global Netlify notes). Build settings come from
`netlify.toml` (`npm run build` → publish `public/`). Suggested site name:
`mc-releases` → serve on `https://releases.example.com`
(Cloudflare DNS-only CNAME → `<site>.netlify.app`, Netlify custom domain + SSL).

> Per the global MC-app note, an MC Custom App works fine on the plain
> `<site>.netlify.app` URL — the custom domain is optional. If you use the custom
> domain, DNS+SSL must resolve **before** you point `env.production.url` at it
> (appkit bakes the URL into `<base href>`).

## 3. Register in the Merchant Center

your commercetools organization → **Settings → Custom Applications → Add**. Use:

- **Application URL**: the deployed URL (`https://releases.example.com`
  or the `.netlify.app` URL)
- **Application entry point URI path**: `releases`
- Permissions/menu link are read from `custom-application-config.mjs`.

MC assigns an **Application ID**. Paste it into `env.production.applicationId` in
`custom-application-config.mjs`, rebuild, and redeploy. Install the app for the
project (`your-live-project`).

## 4. Verify

Open the app in MC. **Releases** lists releases from the stage project; **Key Audit**
shows the live project's key coverage. Create a release, walk it draft → testing →
approved, hit **Validate & preview diff**, then **Deploy to Live**.

## Config recap

| Where | Set |
|---|---|
| `custom-application-config.mjs` → `additionalEnv.deployServiceUrl` | deployed service URL |
| `custom-application-config.mjs` → `headers.csp['connect-src']` | same origin |
| `custom-application-config.mjs` → `additionalEnv.stageStorefrontUrl` | stage storefront (Test-on-stage link) |
| `custom-application-config.mjs` → `env.production.applicationId` | MC-assigned id (after step 3) |
| `custom-application-config.mjs` → `env.production.url` | deployed URL |
