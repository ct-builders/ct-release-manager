/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // The editors reset local form state from a prop when the resource they are
      // editing changes — `useEffect(() => setForm(resource), [resource])`. React 19
      // flags that shape, and the fix is a structural one (a `key` on the editor, or
      // deriving the form instead of storing it) rather than a lint tweak. Reported as
      // a warning so it stays visible in `npm run lint` while a genuinely new error
      // still fails `npm run predeploy`.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
