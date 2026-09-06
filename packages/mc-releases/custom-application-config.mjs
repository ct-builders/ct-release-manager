/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { PERMISSIONS, entryPointUriPath } from './src/constants';

/**
 * @type {import('@commercetools-frontend/application-config').ConfigOptionsForCustomApplication}
 */
const config = {
  name: 'Release Deployments',
  description:
    'Manage release deployments: audit keys, group products + promotions into releases, validate against live, preview the diff, and deploy stage → live.',
  entryPointUriPath,
  cloudIdentifier: 'gcp-us',
  // The app talks to the release-deploy HTTP service (Cloud Run).
  // deployServiceUrl is read at runtime via context.environment; the CSP
  // connect-src below must allow that origin or the browser blocks the fetch.
  additionalEnv: {
    deployServiceUrl: 'https://release-deploy-REPLACE-ME.us-central1.run.app',
    // A Custom Application is a static bundle with no server of its own: every
    // value here ships to the browser and is readable by anyone who loads the
    // app. Nothing secret belongs in it, so this stays a placeholder.
    deployServiceToken: 'REPLACE-ME',
    // stage storefront base for the "Test on stage" deep-link
    stageStorefrontUrl: 'https://storefront.example.com',
  },
  headers: {
    csp: {
      'connect-src': [
        'http://localhost:8080',
        'https://release-deploy-REPLACE-ME.us-central1.run.app',
      ],
    },
  },
  env: {
    development: {
      initialProjectKey: 'your-live-project',
    },
    production: {
      // applicationId assigned by MC on registration — paste it here and redeploy
      // (see REGISTRATION.md). Any non-empty value works until then.
      applicationId: 'cmrgdxmxs000h01xjbi4k3l80',
      url: 'https://your-mc-releases.netlify.app',
    },
  },
  oAuthScopes: {
    // The app's own logic runs against the external deploy service; it needs only
    // a minimal read scope to satisfy the MC permission model and render.
    view: ['view_products', 'view_key_value_documents'],
    manage: [],
  },
  icon: '${path:@commercetools-frontend/assets/application-icons/rocket.svg}',
  mainMenuLink: {
    defaultLabel: 'Release Deployments',
    labelAllLocales: [],
    permissions: [PERMISSIONS.View],
  },
  submenuLinks: [],
};

export default config;
