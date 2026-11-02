# Part 3 — environment verification report

Status: **complete**. The two-site acceptance suite passed with a recorded process exit code of zero, and the compiled-service storefront/restart checks passed.

## Implemented

- Durable, owned environment records, leased lifecycle operations, local snapshots and operation events; versioned migration `002_environments.sql`.
- API/CLI creation, inspection, startup, shutdown, stopped snapshot/restore, fixed isolation probes, private admin credentials and safe removal.
- A rootless Linux backend using bubblewrap and transient systemd user services/slices. Docker is not used by this backend.
- Per-environment MariaDB, WordPress configuration/salts/admin account, uploads, cache and child-theme Git workspace. Shared parent/core/plugins are read-only.
- An authenticated loopback preview gateway with fixed Unix upstream, per-site token/cookie handling, cross-origin rejection, request bounds and a pinned socket inode.
- Separate website and offline reference command profiles; host home/controller/other clients/Docker access excluded; outbound network and nested user namespaces disabled.
- Cgroup CPU/memory/swap/process limits, hard inherited per-file size limits, command/service deadlines, bounded output, disk/file-count monitoring and TTL/retention cleanup.
- A bounded private mail sink and blocked external integrations. No bank gateway or external email is contacted.

Operational setup, commands and boundaries: [ENVIRONMENTS.md](ENVIRONMENTS.md).

## Verification

Recorded on 2026-11-02 on the local Arch Linux host, using the pinned Part 1 PHP/MariaDB/WordPress/WooCommerce runtime and the real Part 2 PostgreSQL/pg-boss controller.

| Check | Result |
|---|---|
| TypeScript source and test type checking | Passed |
| Compiled controller and migration copying | Passed |
| Baseline source/archive integrity | 94 files and three deterministic archives passed |
| Existing static/helper checks | 28 static checks and ten helper cases passed |
| Python package/extraction/runner/database safety | Twelve passed |
| Preview socket/security regression suite | Two passed |
| Full two-environment integration suite | Eight passed; exit code 0; zero failures/skips |
| Part 2 controller regression suite | Fourteen passed |
| Compiled API lifecycle demonstration/restart | Creation, private credentials, queue settings, never-started retention, protected RTL storefront, isolation probe and API restart passed |

The short security suite uses actual Unix HTTP sockets: a pinned preview continues reaching its original site after its pathname is replaced with a symlink to a different site. Initial pins reject symlinks and regular files. The Python suite covers path traversal, unsafe snapshot links, excessive output, timeout termination, interrupted snapshot/restore recovery, checksum rejection before overwriting working data, partial database installation retry and preservation of existing site data when initialization state is uncertain.

The full environment suite creates two real sites with separate files, database identities and credentials. It checks private previews, namespace boundaries, enforced cgroup/per-file settings, reference-profile separation, mail interception, controller/site-token separation, cross-site cookie filtering, Chromium WordPress administration, manager restart, real file/database snapshot restoration, expiry, disk monitoring and deletion while the other site remains live. Final certification evidence is in ignored `.runtime/controller/environment-tests-confirmation.log`, `.runtime/controller/environment-tests-confirmation.json` and `.runtime/controller/environment-preview.png`.

An earlier long terminal session returned SIGTERM after reporting eight passing cases. A detached recorder reran the complete suite and recorded exit code 0 on 2026-11-02 at 08:49 UTC. All test environments were removed; the compiled demonstration remains separate from the integration-test database/root.

PHP preview workers also have a direct concurrency check: an asset must remain available within five seconds while another request is deliberately sleeping for eleven seconds. The browser's 30-second navigation deadline remains unchanged. Two worker children prevent WordPress dashboard background requests from serializing the entire preview.

The compiled API retained the demonstration site across an API/worker restart. Its preview still rejected unauthenticated requests, returned HTTP 200 with its own token and kept the original expiry. Private evidence is in `.runtime/controller/environment-demo-result.json`; no credentials are included in that result. The mobile admin product-list screenshot was inspected; external avatars are excluded by the browser's offline-resource policy.

## Operational limits

The certified backend is local Linux with available user namespaces and a working systemd user manager. The digest-pinned Docker fixture remains configuration-validated only; no multi-environment Docker backend is claimed. Other hosts need their own runtime verification.

Cold WooCommerce activation/database setup takes several minutes on this machine. A fresh-database run exceeded its original 100-second setup cap; database installation now has a 180-second bound, separate from the 240-second WordPress bootstrap and ordinary 120-second command budget. Successful database initialization has a durable marker; interrupted initial system-table copies can retry, while ambiguous existing site data stops for review. Stale socket files are removed before restart, and the preview binds to a verified socket inode rather than following an agent-writable pathname. The Unix bridge now shares the proxy's 30-second inactivity timeout after a measured 22-second first admin request exposed an earlier 10-second cutoff. Snapshots require stopped services, retain initialization state, verify hashes and recover unfinished copies.

Aggregate disk usage is monitored every five seconds; it is not a hard filesystem quota. Per-file limits and cgroup resource limits are kernel-enforced. An absent controller delays disk/retention monitoring; independent systemd service TTLs still stop the site. Hard aggregate quotas, supervised server services, HTTPS, host reboot behavior and production backup/restore belong to Part 13.

Reference browsing is separated but currently offline. External capture and URL/private-network validation belong to Part 5. Snapshots are same-environment checkpoints, not portable client releases. AI/provider execution starts in Part 4; automatic building, harsh independent QA and final client handoff are later parts.
