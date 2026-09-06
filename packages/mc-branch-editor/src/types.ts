/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/** Shapes returned by the release-deploy service for branch data. */

export type BranchStatus = 'open' | 'frozen' | 'merged' | 'abandoned';

/** One asset's HEAD state on a branch (keyed by canonicalKey in branch.assets). */
export type BranchAsset = {
  headKey: string;
  version: number;
  forkedFromHash?: string | null;
  updatedAt?: string;
};

export type Branch = {
  branchId: string;
  title: string;
  baseBranch: string;
  status: BranchStatus;
  author: string;
  forkedFromHash?: string | null;
  assets: Record<string, BranchAsset>;
  createdAt: string;
  updatedAt: string;
};

/** A version-history snapshot record. */
export type AssetVersion = {
  logicalId: string;
  branchId: string;
  version: number;
  at: string;
};

/** A catalog member (canonical product) available to fork onto a branch. */
export type CatalogProduct = { key: string; name: string };

/** Minimal commercetools Product shape we read/write in the editor. */
export type LocalizedString = Record<string, string>;
export type CtAttribute = { name: string; value: unknown };
export type CtVariant = {
  id: number;
  sku?: string;
  key?: string;
  attributes?: CtAttribute[];
};
export type CtProductData = {
  name: LocalizedString;
  slug: LocalizedString;
  description?: LocalizedString;
  masterVariant: CtVariant;
  variants: CtVariant[];
};
export type CtProduct = {
  id: string;
  key?: string;
  version: number;
  masterData: {
    current: CtProductData;
    staged: CtProductData;
    hasStagedChanges: boolean;
    published: boolean;
  };
};
