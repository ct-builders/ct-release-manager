/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { NavLink } from 'react-router-dom';
import { useCapabilities } from '../sdk/use-capabilities';

const tabCss = `
.nav-tab{display:inline-flex;align-items:center;background:none;border:none;padding:11px 18px;font:inherit;font-weight:600;font-size:14px;color:#4b5563;cursor:pointer;text-decoration:none;border-bottom:3px solid transparent;margin-bottom:-1px;}
.nav-tab:hover{color:#1f2937;}
.nav-tab.active{color:#3c41c9;border-bottom-color:#3c41c9;}
`;

const NavTabs = ({ base }: { base: string }) => {
  const { can } = useCapabilities();
  const tabs = [
    { label: 'Releases', to: `${base}/releases` },
    { label: 'Key Audit', to: `${base}/audit` },
    ...(can.admin ? [{ label: 'Permissions', to: `${base}/permissions` }] : []),
  ];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flex: '0 0 auto',
        gap: 2,
        borderBottom: '1px solid #e3e3e3',
        padding: '0 24px',
        background: '#fff',
      }}
    >
      <style>{tabCss}</style>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className="nav-tab"
          activeClassName="active"
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
};
NavTabs.displayName = 'NavTabs';

export default NavTabs;
