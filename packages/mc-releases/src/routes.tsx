/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { Switch, Route, Redirect, useRouteMatch } from 'react-router-dom';
import NavTabs from './components/nav-tabs';
import ReleasesList from './components/releases/releases-list';
import ReleaseDetail from './components/releases/release-detail';
import CreateRelease from './components/releases/create-release';
import KeyAudit from './components/audit/key-audit';
import Permissions from './components/acl/permissions';

const ApplicationRoutes = () => {
  const match = useRouteMatch();
  const base = match.url.replace(/\/$/, '');

  return (
    <div>
      <NavTabs base={base} />
      <div style={{ padding: '20px 24px 40px' }}>
        <Switch>
          <Route exact path={`${match.path}/audit`}>
            <KeyAudit />
          </Route>
          <Route exact path={`${match.path}/permissions`}>
            <Permissions />
          </Route>
          <Route exact path={`${match.path}/releases/new`}>
            <CreateRelease base={base} />
          </Route>
          <Route path={`${match.path}/releases/:key`}>
            <ReleaseDetail base={base} />
          </Route>
          <Route exact path={`${match.path}/releases`}>
            <ReleasesList base={base} />
          </Route>
          <Route>
            <Redirect to={`${base}/releases`} />
          </Route>
        </Switch>
      </div>
    </div>
  );
};
ApplicationRoutes.displayName = 'ApplicationRoutes';

export default ApplicationRoutes;
