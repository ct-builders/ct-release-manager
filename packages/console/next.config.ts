/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import type { NextConfig } from "next";

/**
 * `turbopack.root` is pinned to this package rather than inferred.
 *
 * Turbopack finds the workspace root by walking up for a lockfile, and in a
 * monorepo that walk can leave the package — picking up a lockfile above it and
 * resolving modules against the wrong tree. Naming the directory makes the build
 * behave the same whatever sits above `packages/console`, which is what lets the
 * console be built directly, through `npm --prefix` from the repo root, and by
 * Netlify out of a base directory, all with the same result.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
