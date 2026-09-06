# Contributing

Contributions are welcome. This repository is part of the
[`ct-builders`](https://github.com/ct-builders) org, which publishes reference code for
commercetools under the [MIT License](./LICENSE), `AS IS` and unsupported.

Please note the [support policy](./SUPPORT.md) before you invest much effort: pull requests
are read on a best-effort basis, and there is no response-time commitment.

## Two hard requirements

**1. Every source file carries the SPDX license header.**

```js
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */
```

No exceptions, including files you only edited. The header is what makes the terms survive
a single file being copied out of context — which is how most of this code will actually be
consumed. A PR that adds a source file without it will be asked to add it.

**2. You may only contribute code you have the right to license under MIT.**

Do not paste in code from another project, a customer engagement, a vendor's repository, or
a Stack Overflow answer unless its license permits redistribution under MIT *and* you
preserve the original copyright notice. If a file or directory is substantially someone
else's work, keep their license file alongside it and leave their headers intact — do not
overwrite them with ours.

If you are unsure whether you may contribute something, do not contribute it.

## This is a public repository

Public, permanently, including git history. Never commit:

- **Credentials of any kind** — API client secrets, tokens, passwords, private keys. Not
  even expired ones, and not even "just in a test fixture".
- **Customer or prospect names**, or anything identifying a specific commercial engagement.
- **Internal infrastructure** — internal hostnames, cloud project ids, commercetools project
  keys, database names, internal ticket references, internal tooling.
- **Personal data.** Use obviously-synthetic fixtures (`jane@example.com`).

If you commit a secret by accident, treat it as leaked: rotate it first, then worry about
the history.

## Before you open a PR

One command, from the repo root, covering every package:

```bash
npm run install:all   # first time only
npm run predeploy
```

That is the service's unit tests, then typecheck and lint across the console and both
Merchant Center apps, then a production build of the console. It runs in well under a
minute. **There is no CI in this repository** — `predeploy` is the whole gate, so a PR that
has not run it has not been checked by anything.

`npm run format` inside `packages/mc-releases` or `packages/mc-branch-editor` fixes most of
their lint failures, which are prettier formatting.

**The end-to-end suite is deliberately not part of that gate.** `npm run test:e2e` talks
to two real commercetools projects, creates and deletes data in both, and takes minutes
rather than milliseconds. Run it when you have changed the deploy path, against projects
you are willing to have written to — see
[`test/README-e2e.md`](packages/release-deploy/test/README-e2e.md). It refuses to run
unless the resolved project key matches `E2E_STAGE_PROJECT`, which is the only thing
standing between a stray `RUN_E2E=1` and somebody's production catalog. Do not weaken that
guard, and do not chain it into `predeploy`.

The same rule covers `packages/mc-releases/test/ui` — a Playwright smoke test over a
standalone harness page, run on demand with `npx playwright test test/ui`. Playwright is
deliberately not a dependency of that app.

## What good looks like here

This repository optimizes for **being read**. People land in it to understand how a pattern
works before writing their own version, so:

- **Comment the *why*, not the *what*.** `// bump the version` is noise. "commercetools
  rejects a stale version with a 409, so the registry uses compare-and-swap and two
  concurrent branch writes never silently drop one" is the reason the code is shaped the way
  it is, and it cannot be recovered from reading it.
- **Match the surrounding code.** Its naming, its comment density, its idioms. A PR that
  introduces a second style makes the codebase harder to read even if the new style is
  better in isolation.
- **Keep the service dependency-free.** `packages/release-deploy` has no `node_modules` and
  runs on plain Node ESM. That is a deliberate property, not an accident of youth: it makes
  the service auditable and its container trivial. Adding a dependency to it needs a real
  argument.
- **Keep the packages independent.** No workspace hoisting, one lockfile each, no package
  importing another's source. The console and the Merchant Center apps reach the service
  over HTTP, which is the same boundary a real deployment has — so a change that works only
  because two packages share a checkout is a change that breaks in production.
- **The release mechanics live in the service, not in a front end.** Branch, fork, merge,
  diff, deploy and rollback belong in `packages/release-deploy`, and every front end calls
  them. Reimplementing one of them in the console or an MC app puts two state machines in
  front of the same data.
- **Keep it project-agnostic.** Nothing about a particular deployment belongs in the code.
  Projects, credentials and URLs come from the environment; anything an operator should be
  able to change belongs in configuration, not a constant.
- **Treat the container names as frozen.** `release-registry`, `release-branch`,
  `release-acl` and friends are the wire contract between the service, the console and both
  MC apps. Renaming one is a data migration, not a rename — and it has to land in all four
  at once, plus `bin/migrate-containers.mjs`. The console mirrors them in two files
  (`lib/containers.ts` for the app, `tools/containers.mjs` for the operator scripts, which
  run outside the Next.js build and cannot import TypeScript); both have to agree.
- **Anything that writes to live needs a test.** The approval gate, the merge, the deploy
  and the rollback all have unit coverage that runs without credentials. If you touch them,
  extend it. "I ran it against my project once" is not coverage.

## Reporting a security issue

Open a GitHub issue. There is no private disclosure channel and no embargo process for this
repository — so if the issue is genuinely sensitive, please weigh that before filing.

**Do not** report commercetools *platform* vulnerabilities here. Those go to
[commercetools' official security contact](https://commercetools.com/privacy-and-security).
