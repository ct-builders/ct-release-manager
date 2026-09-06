/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { lazy } from 'react';
import {
  ApplicationShell,
  setupGlobalErrorListener,
} from '@commercetools-frontend/application-shell';
import type { ApplicationWindow } from '@commercetools-frontend/constants';
import loadMessages from '../../load-messages';

declare let window: ApplicationWindow;

const AsyncApplicationRoutes = lazy(
  () => import('../../routes' /* webpackChunkName: "routes" */)
);

setupGlobalErrorListener();

const EntryPoint = () => (
  <ApplicationShell
    enableReactStrictMode
    environment={window.app}
    applicationMessages={loadMessages}
  >
    <AsyncApplicationRoutes />
  </ApplicationShell>
);
EntryPoint.displayName = 'EntryPoint';

export default EntryPoint;
