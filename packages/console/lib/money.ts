/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// Shared money display helpers. Every money value is shown with the currency's
// default fraction digits (2 for USD/EUR/GBP, 0 for JPY, 3 for BHD, …) via Intl,
// so amounts always render "12.00" — never "12" — and honor odd currencies.
// Grouping and decimal separators follow the configured LOCALE.

import { LOCALE, CURRENCY } from "./config";

/** Default fraction digits for a currency (falls back to 2 on unknown codes). */
function currencyFractionDigits(currencyCode: string): number {
  try {
    return (
      new Intl.NumberFormat(LOCALE, { style: "currency", currency: currencyCode })
        .resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Format a major-unit amount (already divided out of minor units) for display. */
export function formatAmount(amount: number, currencyCode = CURRENCY): string {
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

/**
 * Format a commercetools Money (centAmount in minor units) for display.
 * Uses the money's own fractionDigits when present, else the currency default.
 */
export function formatMoney(centAmount: number, currencyCode: string, fractionDigits?: number): string {
  const digits = fractionDigits ?? currencyFractionDigits(currencyCode);
  return formatAmount(centAmount / 10 ** digits, currencyCode);
}
