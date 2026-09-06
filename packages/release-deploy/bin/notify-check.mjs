#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * notify-check.mjs — send one sample notification to verify EMAIL_* provider config
 * end-to-end (without driving a whole release cycle).
 *
 *   node bin/notify-check.mjs you@example.com [--event submitted|approved|published|rejected]
 *
 * Reads EMAIL_* from the repo .env. With no provider key set it uses the "log"
 * transport (prints the message) — the same safe default the service uses.
 *
 * (Named "-check", not "-test", so Node's `--test` runner doesn't collect it.)
 */
import { fileURLToPath } from 'url';
import { loadEnv } from '../lib/ct.mjs';
import { sendTest, readConfig } from '../lib/notify.mjs';

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const to = args.find((a) => !a.startsWith('--'));
  const ei = args.indexOf('--event');
  const event = ei >= 0 ? args[ei + 1] : 'submitted';

  if (!to) {
    console.error('usage: node bin/notify-check.mjs <recipient-email> [--event submitted|approved|published|rejected]');
    process.exit(2);
  }

  const cfg = readConfig();
  console.log(`[notify-check] provider=${cfg.provider} from="${cfg.from}" enabled=${cfg.enabled} → sending "${event}" to ${to}`);
  const r = await sendTest(to, { event });
  console.log('[notify-check] result:', r);
  process.exit(r.ok ? 0 : 1);
}

// only run when invoked directly (never as an import)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
