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
  name: 'Branch Editor',
  description:
    'Branch-aware product authoring: pick a branch, fork/list/edit its products, and save & restore versions. Backed by the release-deploy service; deep product edits use the MC API gateway.',
  entryPointUriPath,
  cloudIdentifier: 'gcp-us',
  // Branch/version ops (fork, save-version, restore, list) go to the
  // release-deploy HTTP service (Cloud Run). Its origin must be in the
  // CSP connect-src below. Direct product reads/writes go through the MC API
  // gateway (see src/sdk/use-ctp.ts) and need no extra CSP entry.
  additionalEnv: {
    deployServiceUrl: 'https://release-deploy-REPLACE-ME.us-central1.run.app',
    deployServiceToken: 'c7b17f633b4bc10485e5f61832acab299c8d31d49113cd49',
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
      initialProjectKey: 'your-stage-project',
    },
    production: {
      // applicationId assigned by MC on registration (your commercetools organization).
      applicationId: 'cmrgsju31000v01xj4wwstefj',
      url: 'https://your-branch-editor.netlify.app',
    },
  },
  oAuthScopes: {
    // Reads/writes products, categories, and discounts directly via the MC gateway
    // (authoring project), plus key-value docs for the branch registry.
    view: ['view_products', 'view_categories', 'view_key_value_documents'],
    manage: ['manage_products', 'manage_categories'],
  },
  icon: '${path:@commercetools-frontend/assets/application-icons/stack.svg}',
  mainMenuLink: {
    defaultLabel: 'Branch Editor',
    labelAllLocales: [],
    permissions: [PERMISSIONS.View],
  },
  submenuLinks: [],
};

export default config;
