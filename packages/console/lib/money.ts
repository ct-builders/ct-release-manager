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

// ---------------------------------------------------------------------------
// editable amounts
// ---------------------------------------------------------------------------

/*
 * The helpers above are for DISPLAY and go through Intl, which is what makes
 * them currency-correct. The two below are for the value of a
 * `<input type="number">`, and deliberately do not: Intl adds grouping
 * separators and a currency symbol, and both make a number input reject its own
 * value. So an editable amount is plain `toFixed(2)`.
 */

/**
 * Normalize an editable amount, for an input's `onBlur`.
 *
 * A blank field stays blank, because "no price" has to stay expressible — the
 * editors treat empty and zero differently, and snapping empty to "0.00" would
 * silently create a free product. Anything else lands on two decimals, so a
 * typed "50" shows as "50.00" once the field loses focus rather than looking
 * like a different number from every other amount on the page.
 */
export const amountField2 = (v: string): string =>
  v == null || String(v).trim() === "" ? "" : (Number(v) || 0).toFixed(2);

/**
 * Two-decimal display of a bare amount, with no currency symbol — for text that
 * supplies its own currency code alongside it. Blank and NaN both render
 * "0.00". Prefer `formatMoney` anywhere the symbol is wanted.
 */
export const amount2 = (v: string | number | null | undefined): string =>
  (Number(v) || 0).toFixed(2);
