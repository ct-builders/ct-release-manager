/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

export type ReleaseStatus =
  | 'draft'
  | 'ready-for-review'
  | 'approved'
  | 'published'
  | 'rolled-back';

export type Role = 'author' | 'reviewer' | 'publisher' | 'admin';
export const ROLES: Role[] = ['author', 'reviewer', 'publisher', 'admin'];

export type Capabilities = {
  edit: boolean;
  approve: boolean;
  publish: boolean;
  admin: boolean;
};
export type Actor = {
  email: string;
  roles: Role[];
  open: boolean;
  can: Capabilities;
};
export type AclEntry = {
  email: string;
  roles: Role[];
  updatedAt?: string;
  updatedBy?: string;
};

export type Members = {
  products?: string[];
  categories?: string[];
  cartDiscounts?: string[];
  productDiscounts?: string[];
  discountCodes?: string[];
  discountGroups?: string[];
};

export type AutoAddConfig = {
  autoAddEnabled: boolean;
  currentReleaseKey: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type Deployment = {
  at: string;
  kind?: 'deploy' | 'undeploy';
  by: string;
  target: string;
  apply: boolean;
  hash?: string;
  ok: boolean;
  summary: {
    create: number;
    update: number;
    noop: number;
    delete?: number;
    error: number;
  };
};

export type Release = {
  key: string;
  title: string;
  description?: string;
  status: ReleaseStatus;
  author: string;
  approver?: string | null;
  members: Members;
  createdAt: string;
  updatedAt: string;
  deployments?: Deployment[];
  history?: { at: string; by: string; to: string; note?: string | null }[];
  lastDeployedHash?: string | null;
};

export const MEMBER_KINDS: { key: keyof Members; label: string }[] = [
  { key: 'products', label: 'Products' },
  { key: 'categories', label: 'Categories' },
  { key: 'cartDiscounts', label: 'Cart discounts' },
  { key: 'productDiscounts', label: 'Product discounts' },
  { key: 'discountCodes', label: 'Discount codes' },
  { key: 'discountGroups', label: 'Discount groups' },
];

export const memberCount = (m: Members = {}): number =>
  MEMBER_KINDS.reduce((n, k) => n + (m[k.key]?.length || 0), 0);
