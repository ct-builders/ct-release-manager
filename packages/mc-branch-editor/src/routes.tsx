/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { Switch, Route, Redirect, useRouteMatch } from 'react-router-dom';
import { BranchProvider } from './branch-context';
import BranchBar from './components/branch/branch-bar';
import ProductsList from './components/products/products-list';
import ProductDetail from './components/products/product-detail';

const ApplicationRoutes = () => {
  const match = useRouteMatch();
  const base = match.url.replace(/\/$/, '');

  return (
    <BranchProvider>
      <BranchBar />
      <div style={{ padding: '20px 24px 40px' }}>
        <Switch>
          <Route path={`${match.path}/products/:canonicalKey`}>
            <ProductDetail base={base} />
          </Route>
          <Route exact path={`${match.path}/products`}>
            <ProductsList base={base} />
          </Route>
          <Route>
            <Redirect to={`${base}/products`} />
          </Route>
        </Switch>
      </div>
    </BranchProvider>
  );
};
ApplicationRoutes.displayName = 'ApplicationRoutes';

export default ApplicationRoutes;
