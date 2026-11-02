# Website Factory

Current development also includes [editable design modes and strict skill packs](docs/CUSTOMIZATION.md), including [heydamir/unslop](https://github.com/heydamir/unslop), a [versioned MainTheme update library](docs/THEME-UPDATES.md), and the [automatic WordPress prototype build API](docs/BUILD-AUTOMATION.md). See [actual progress and remaining acceptance work](docs/PROGRESS.md) before treating the whole-site pipeline as complete.

A private server application for producing complete client websites from a reference URL and brief. WordPress with MainTheme is the first output profile. The client receives a finished website and uses standard WordPress/WooCommerce administration for products and orders.

**Working development checkpoint:** Parts 1–6 are implemented: a certified MainTheme baseline, durable controller, isolated WordPress environments, a real Codex agent, reference intake/capture and versioned design/MainTheme skills. The AI inspects paired screenshots, HTML/CSS/layout evidence and recorded flows, then produces a protected design plan. Part 7's build API, content/media setup, customization and theme-update library are implemented, but its complete-site pilot remains unfinished. Independent QA, client export/restore and the dashboard are later parts. See [the checkpoint and resume guide](docs/CHECKPOINT.md).

- [Numbered build order](docs/BUILD-ORDER.md)
- [Progress and verification](docs/PROGRESS.md)
- [Current working checkpoint and resume guide](docs/CHECKPOINT.md)
- [Part 1 certification report](docs/PART-1-REPORT.md)
- [Controller setup and API](docs/CONTROLLER.md)
- [Part 2 verification report](docs/PART-2-REPORT.md)
- [Isolated environment setup and commands](docs/ENVIRONMENTS.md)
- [Part 3 verification report](docs/PART-3-REPORT.md)
- [Agent runtime and commands](docs/AGENT-RUNTIME.md)
- [Part 4 verification report](docs/PART-4-REPORT.md)
- [Client briefs, assets and reference capture](docs/REFERENCE-CAPTURE.md)
- [Part 5 verification report](docs/PART-5-REPORT.md)
- [Versioned design and MainTheme skills](docs/DESIGN-SKILLS.md)
- [Part 6 verification report](docs/PART-6-REPORT.md)
- [Full project plan](docs/PROJECT-PLAN.md)
- [Delivery contract](docs/DELIVERY-CONTRACT.md)
- [Baseline provenance](baseline/PROVENANCE.md)

## Current contents

`baseline/source` contains the canonical MainTheme parent, child starter and Iran Commerce plugin. Original release archives are retained separately. The baseline has portable static validation, reproducible ZIP packaging, a reviewed hash lock, and a real WordPress/WooCommerce fixture with browser smoke tests.

`fixtures/runtime.lock.json` pins downloaded WordPress, WooCommerce, translations, WP-CLI and optional native tools by SHA-256. Fixture data and credentials live only in ignored `.runtime/`.

`src/` contains the controller, versioned database migration, API/CLI, worker and shared provider/artifact contracts. Jobs, stages, attempts, events, requirements and usage reservations persist in PostgreSQL. The queue and application state commit together; leases fence stale workers before accepting results.

`sandbox/` and `tools/environments.py` provide the rootless Linux environment backend. Each site has a private MariaDB, uploads, child-theme Git workspace and authenticated preview. Core, plugins and the pinned parent theme are read-only. The controller queues lifecycle operations, checkpoints/restores stopped sites and applies resource/retention limits. Aggregate disk usage is monitored; hard filesystem quotas and production deployment remain Part 13 work.

## Controller setup

```bash
npm ci
npm run controller:db:prepare
npm run controller:db:up
npm run controller:build
npm run controller:up
npm run controller:cli -- health
npm run controller:cli -- project:create --name "Example client"
npm run controller:cli -- job:create --project PROJECT_UUID
npm run controller:cli -- job --id JOB_UUID
```

The private API is at `127.0.0.1:8790`; this is an API, not a dashboard. The CLI reads its token from ignored `.runtime/controller/config.json`. The local PostgreSQL bootstrap targets Arch x86_64; other systems can supply their own PostgreSQL and private config. See [controller documentation](docs/CONTROLLER.md) for cancellation, limits, resumption, external configuration and shutdown.

Run `npm run test:controller` after database setup to exercise the separate test database, including actual worker crash recovery. `npm run check` includes TypeScript source/test checking and the existing baseline checks.

`npm run check` and the controlled integration suites do not call a paid AI provider. Native agent tests and `tools/run_build_pilot.ts` use the configured Codex account; run them deliberately when quota is available. No website build starts automatically during normal service startup unless a previously queued job exists.

## Isolated client environments

The environment backend additionally needs `bwrap`, `prlimit`, cgroup v2 and a working systemd user manager, plus the native runtime prepared by `npm run fixture:prepare`. It does not require Docker access or sudo on the tested machine.

```bash
npm run controller:cli -- env:create --project PROJECT_UUID
npm run controller:cli -- env --id ENVIRONMENT_UUID
# After creation reaches stopped:
npm run controller:cli -- env:start --id ENVIRONMENT_UUID
npm run controller:cli -- env --id ENVIRONMENT_UUID
```

Actions are asynchronous. Wait for `running` and no current operation, then open the private `previewUrl` returned by inspection. A fresh WordPress/WooCommerce setup takes several minutes on this machine. Preview links and admin credentials are private; runtime data stays in ignored `.runtime/`.

```bash
npm run controller:cli -- env:stop --id ENVIRONMENT_UUID
npm run controller:cli -- env:snapshot --id ENVIRONMENT_UUID
npm run controller:cli -- env:restore --id ENVIRONMENT_UUID --snapshot SNAPSHOT_UUID
npm run controller:cli -- env:destroy --id ENVIRONMENT_UUID
npm run test:preview
npm run test:environments
```

Snapshot/restore require a stopped environment; poll each action before sending the next. [Environment documentation](docs/ENVIRONMENTS.md) covers all commands, credentials, isolation, local checkpoints, limits and Linux/server requirements. These are disposable test sites; the portable client handoff is Part 11.

## Local setup on Arch Linux x86_64

Requirements: Node 22.12+, npm, Python 3.11+, `bsdtar`, compatible Arch shared libraries, and Chromium or a Playwright Chromium install. No host PHP installation, database service, sudo or Docker access is required for this development fixture.

```bash
npm ci
npm run fixture:prepare
npm run baseline:build
npm run check
npm run fixture:up
npm run fixture:seed
npm run test:install
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

If using Playwright's browser instead, install it with `npx playwright install chromium` and omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

Preview: http://127.0.0.1:8787. The admin username/password are in `.runtime/credentials.json`; do not paste them into reports or commit them. The native database uses a project-local Unix socket and has no TCP listener.

```bash
npm run fixture:status
npm run fixture:down
```

`fixture:down` retains the dedicated database and files. `fixture:seed` is an idempotent test-data setup and resets the seeded products' stock; run it before repeating order tests. It is intentionally restricted to a local environment. This PHP development server is a certification fixture, not the eventual factory service or a client deployment.

## Docker fixture

Use a working Docker daemon with Compose on other server platforms. The Compose file pins image digests, mounts the baseline read-only, and publishes only the web port on loopback.

```bash
npm ci
export FACTORY_RUNTIME=docker
npm run fixture:prepare
npm run fixture:up
npm run fixture:seed
npx playwright install chromium
npm run test:browser
npm run fixture:down
```

Choose a backend before preparing the fixture. Native and Docker have separate databases; stop one before starting the other because both use port 8787. The Docker lifecycle needs runtime verification on an accessible daemon; validating its Compose configuration alone does not certify it.

## Verification and artifacts

`npm run check` checks baseline hashes, original ZIP integrity, 30 PHP sources, JSON/block/CSS structure, Iran phone/postcode helpers, packaging and archive-extraction safety tests. It requires PHP through `tools/php`. For a machine using only Docker, run PHP checks inside its PHP-equipped environment or provide a compatible host PHP through `FACTORY_PHP_BIN`. `npm run test:install` checks fresh-database and repeat installation on the native fixture without logging credentials.

`npm run test:browser` exercises the running fixture. It stores screenshots, failure traces and JSON results in `test-results/` and an HTML report in `playwright-report/`. The baseline suite checks runtime wiring, RTL storefront/product pages at desktop/mobile/landscape sizes, admin product listing and a local cash-on-delivery checkout with order totals verified through WooCommerce.

These smoke tests certify the baseline paths they exercise. Full client-specific visual criticism, product-management coverage, bank gateway integration, Firefox/WebKit and release restoration are separate build parts.

`npm run baseline:build` writes deterministic archives and checksums to `dist/baseline/`. To change the canonical baseline deliberately, review the diff, update provenance, and explicitly run `python3 tools/package_baseline.py --write-lock`. Normal builds and tests never approve changed baseline hashes implicitly.

Fixture mail is intercepted and WordPress outbound HTTP requests to external hosts are blocked by the test guard. Test checkout uses local COD, not a bank gateway. The guard is test-only and must not be shipped to clients.
