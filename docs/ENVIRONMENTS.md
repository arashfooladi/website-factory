# Part 3 — isolated WordPress environments

The trusted controller creates disposable WordPress sites with separate databases, uploads, child-theme Git workspaces, credentials and protected previews. Lifecycle requests are asynchronous PostgreSQL/pg-boss operations. This part does not call an AI provider or build client-specific pages.

## Runtime and prerequisites

The implemented backend uses unprivileged Linux namespaces through `bubblewrap`, plus transient systemd **user** services and cgroup v2 limits. It works on the current Arch Linux machine without sudo or Docker access. The earlier Docker Compose file remains the Part 1 fixture; it is not the multi-environment backend.

Required: Node 22.12+, Python 3.11+, Git, `bwrap` with `--disable-userns` support, `prlimit`, a working `systemctl --user`/`systemd-run --user` session with delegated CPU/memory/process controllers, PostgreSQL, and the pinned native PHP/MariaDB tools. Other Linux servers need equivalent libraries and user-service support. No Windows/macOS backend is implemented. Deployment, HTTPS, service supervision and server hardening are Part 13.

Prepare the native tools/downloads and controller:

```bash
npm ci
npm run fixture:prepare
npm run controller:db:prepare
npm run controller:db:up
npm run controller:build
npm run controller:up
```

The controller must run from the repository root. Source changes require a compiled build and API restart. The API process owns the environment-operation worker and preview gateways; the separate worker still handles only the Part 2 demonstration jobs.

## CLI lifecycle

```bash
npm run controller:cli -- project:create --name "Example client"
npm run controller:cli -- env:create --project PROJECT_UUID
npm run controller:cli -- env --id ENVIRONMENT_UUID
npm run controller:cli -- env:start --id ENVIRONMENT_UUID
npm run controller:cli -- env --id ENVIRONMENT_UUID
```

Creation returns an environment ID and operation ID. Poll `env` until `status` is `stopped` and `current_operation_id` is null; then request start and poll until `running`. A cold site installs its private database and activates/seeds WordPress/WooCommerce. Allow several minutes on this development machine. Later starts reuse its existing site and database.

Inspection of a running environment returns a private `previewUrl`. Opening it sets a per-environment HttpOnly cookie and redirects to the storefront. Previews bind only to `127.0.0.1`, starting at port 9000. On a server, access requires a private tunnel until the server deployment part provides authenticated HTTPS. Do not expose these development ports publicly.

Use the same local and remote preview port when tunneling: the proxy checks the request's host and origin against its assigned port. The preview uses PHP's development server with two configured worker children so slow admin requests do not block every asset request. This worker mode is for controlled testing; the production web-server stack belongs to Part 13. [PHP server documentation](https://www.php.net/manual/en/features.commandline.webserver.php)

```bash
npm run controller:cli -- env:credentials --id ENVIRONMENT_UUID
npm run controller:cli -- env:probe --id ENVIRONMENT_UUID
npm run controller:cli -- env:probe --id ENVIRONMENT_UUID --profile reference
npm run controller:cli -- env:stop --id ENVIRONMENT_UUID
npm run controller:cli -- env:snapshot --id ENVIRONMENT_UUID
npm run controller:cli -- env --id ENVIRONMENT_UUID
npm run controller:cli -- env:restore --id ENVIRONMENT_UUID --snapshot SNAPSHOT_UUID
npm run controller:cli -- env:start --id ENVIRONMENT_UUID
npm run controller:cli -- env:destroy --id ENVIRONMENT_UUID
```

The credentials command intentionally prints this disposable site's admin login. Keep its output private. It is separate from the controller API token and every other site's credentials. Clients will receive their final hosting accounts through the later handoff workflow.

Snapshot and restore require a fully stopped environment. A snapshot includes the child workspace/Git history, uploads, cache and cleanly stopped MariaDB data. It rejects symlinks and special files and records SHA-256 hashes plus the pinned runtime version. Restoring verifies all files before replacing working data. Retries discard unfinished snapshot copies and recover interrupted restores. Snapshots consume the environment's disk budget; creation fails if another full copy would exceed it. These are local checkpoints for the same environment/runtime, not the portable client export planned for Part 11.

Destroy stops the entire environment slice and removes only that UUID's private directory and its bounded host diagnostic log. PostgreSQL operation/event records remain for audit. API shutdown closes previews while site services remain bounded by their systemd runtime limit. Restarting the API recovers gateways from stored state; it does not reset a site's expiry. Explicitly stop/destroy sites when finished.

## Files and isolation

Each environment lives under `.runtime/environments/instances/ENVIRONMENT_UUID/` by default:

| Host path | Sandbox access |
|---|---|
| `workspace/child-theme/` | Writable at `/workspace/child-theme` and the active child theme |
| `workspace/.git/` | The site's own initial repository |
| `uploads/`, `cache/` | Writable WordPress content directories |
| `data/` | This site's private MariaDB data |
| `run/` | Its own database and preview Unix sockets |
| `logs/` | Private web/database/PHP logs and intercepted mail |
| `reference/` | Only the separate reference profile |
| `private.json`, `etc/`, `wp-config.php`, `snapshots/` | Controller-managed configuration/checkpoints; secrets are not part of the workspace |

WordPress core, the MainTheme parent, required plugins, languages and trusted helpers are read-only mounts. Only this site's `wp-config.php` is readable inside its website sandbox. It contains its own disposable database credentials and salts. The host home, controller files, production credentials, other environments and Docker socket are not mounted.

The website profile has its own filesystem, PID, user and network namespaces, drops capabilities, sets no-new-privileges and disables nested user namespaces. Its MariaDB listens only on its Unix socket. PHP listens on loopback **inside** that network namespace; a Unix bridge feeds the authenticated host preview proxy. The proxy pins a socket inode without following symlinks, so replacing its pathname cannot redirect it to another site. Preview tokens and cookies are filtered before upstream requests; only cookies belonging to the assigned WordPress site are forwarded.

The reference command profile has no site, database, WordPress login or child workspace. It currently has no internet access either. The controlled external reference fetch/browser and private-network URL rejection belong to Part 5. The profile here establishes the credential/filesystem separation it will use.

WordPress mail is captured in the site's private `logs/mail.jsonl` and discarded without transport. Entries and the sink size are bounded. WordPress external HTTP requests return an error; the namespace also blocks direct outbound network access. Test commerce uses local cash-on-delivery. Real payment, shipping, email and other external effects remain unavailable until explicitly configured sandbox integrations exist.

## Resource budgets and retention

Use `env:create --file limits.json` to override selected defaults:

```json
{
  "memoryMiB": 1024,
  "tasks": 128,
  "cpuPercent": 100,
  "diskMiB": 1024,
  "fileSizeMiB": 128,
  "ttlSeconds": 3600,
  "retentionSeconds": 86400
}
```

- Memory, zero swap, total process count and CPU quota apply to the whole environment's systemd slice, including concurrent commands and its site/database processes.
- The hard per-file size limit is inherited by sandbox children. Core dumps are disabled. Temporary filesystem sizes are bounded.
- Aggregate disk usage and a 100,000-entry ceiling are checked by the controller every five seconds while running. Crossing either closes the preview and queues a stop. **Aggregate disk usage is a monitored limit, not a filesystem quota.** A burst of writes can exceed it before monitoring runs; monitoring requires a running controller. Production hard disk quotas remain a server-deployment concern.
- Normal sandbox commands have a 120-second runtime cap and bounded output. Trusted first-time database installation is capped at 180 seconds; WordPress bootstrap has a 240-second cap; an overall native lifecycle call is capped at 600 seconds. Site services have an independent systemd TTL even if the controller exits.
- A site's TTL begins when the start request is accepted, including queued/bootstrap time. After that it stops and retains data for the retention window, then the controller removes it. A never-started environment expires after its creation retention window. Starting a stopped site grants a fresh TTL/retention window; starting an already-running site is idempotent and does not extend it.
- Default controller capacity is four non-deleted environments, including stopped/failed sites and their snapshots. The capacity and preview-port allocation are serialized in PostgreSQL.

Environment operations have renewable leases and fenced database completion. A per-UUID host file lock serializes native actions; recovery can retry interrupted operations without running two native mutations at once. A failed start stops its sandbox rather than exposing a partial site as ready. Protected rules and the trusted host runner stay outside future agent workspaces. There is no HTTP API for arbitrary shell commands.

## API and verification

All controller routes use the existing private bearer token and enforce project ownership:

| Method | Route | Result |
|---|---|---|
| POST | `/v1/environments` | Create from `{ "projectId": "UUID", "limits": {} }` |
| GET | `/v1/environments/:id` | State, operations, snapshots, private preview link |
| POST | `/v1/environments/:id/start` | Queue startup |
| POST | `/v1/environments/:id/stop` | Queue shutdown |
| POST | `/v1/environments/:id/snapshot` | Queue a stopped checkpoint |
| POST | `/v1/environments/:id/restore` | Queue restore from `{ "snapshotId": "UUID" }` |
| DELETE | `/v1/environments/:id` | Queue removal |
| GET | `/v1/environments/:id/credentials` | Initial disposable WordPress admin login |
| POST | `/v1/environments/:id/probe` | Fixed diagnostics, `{ "profile": "website" }` or `reference` |

Lifecycle creation/action responses use HTTP 202. Inspect completion before sending dependent actions. An in-progress operation rejects conflicting requests. Invalid paths/limits/unknown fields are rejected; another owner's environment is returned as not found.

Optional private controller configuration: `environmentRoot`, `previewPortBase` and `maxEnvironments`. The native runner is internal to the controller; do not give its host process or control files to a model. Future adapters must call the assigned sandbox rather than launch model-supplied commands on the host.

```bash
npm run check
npm run test:preview
npm run test:environments
npm run test:controller
```

The environment suite uses `website_factory_test`, a separate environment root and ports starting at 9400. It creates two real sites, authenticates a Chromium session, exercises isolation and resource checks, restores actual WordPress data, and removes one while the other continues serving. Its screenshot is private at `.runtime/controller/environment-preview.png`. The short preview suite checks symlink replacement against actual Unix sockets without needing WordPress.

Allow at least twenty minutes in an automated command runner on this machine; a full two-site run currently takes about thirteen minutes, mostly first-time database and WooCommerce setup. An ordinary terminal can run the command directly.
