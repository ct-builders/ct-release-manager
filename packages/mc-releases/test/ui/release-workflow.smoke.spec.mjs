/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * release-workflow.smoke.spec.mjs — Playwright browser smoke test for the
 * post-approval publish prompt (release-detail.tsx).
 *
 * The real MC app renders inside an authenticated Merchant Center iframe, which is
 * impractical to drive headlessly, so this drives `publish-prompt.harness.html` —
 * a standalone page that reproduces the modal's exact markup + decision. It asserts
 * the three behaviours the component implements:
 *   1. approver WITH publish rights → prompt appears → can publish now
 *   2. approver WITHOUT publish rights → no prompt; a publisher must publish
 *   3. "Not now" → dismiss, leaving the release approved for a publisher
 *
 * Run on demand (Playwright is intentionally not a hard dependency of the app):
 *   cd packages/mc-releases && npx playwright test test/ui
 *
 * For the fully-authenticated click-path through the real MC app, see ./README.md.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const HARNESS =
  'file://' +
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'publish-prompt.harness.html'
  );

test.describe('release publish-prompt (browser)', () => {
  test('approver WITH publish rights is offered the prompt and can publish now', async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await expect(page.locator('#status')).toHaveText('ready-for-review');

    await page.locator('#approve').click();
    await expect(page.getByTestId('publish-prompt-overlay')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('approved');

    await page.getByTestId('publish-prompt-confirm').click();
    await expect(page.getByTestId('publish-prompt-overlay')).toBeHidden();
    await expect(page.locator('#status')).toHaveText('published');
    await expect(page.getByTestId('note')).toContainText(
      'Published to production'
    );
  });

  test('approver WITHOUT publish rights sees no prompt — a publisher must publish', async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.locator('#canPublish').uncheck();

    await page.locator('#approve').click();
    await expect(page.getByTestId('publish-prompt-overlay')).toBeHidden();
    await expect(page.getByTestId('note')).toContainText(
      'publisher needs to publish'
    );
    await expect(page.locator('#status')).toHaveText('approved');
  });

  test('"Not now" dismisses the prompt and leaves it approved for a publisher', async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.locator('#approve').click();
    await page.getByTestId('publish-prompt-dismiss').click();

    await expect(page.getByTestId('publish-prompt-overlay')).toBeHidden();
    await expect(page.getByTestId('note')).toContainText('when you');
    await expect(page.locator('#status')).toHaveText('approved');
  });
});
