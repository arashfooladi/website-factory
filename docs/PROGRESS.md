# Build progress

Completed: **Part 1 — MainTheme foundation and certification**, verified on the native fixture.

Completed: **Part 2 — durable server controller**, verified with real PostgreSQL and pg-boss.

Completed: **Part 3 — isolated website environments**, verified with two real isolated WordPress sites.

Completed: **Part 4 — connect the first coding agent**, verified with real Codex image/tool input, WordPress edits, session continuation and cancellation.

Completed: **Part 5 — project intake and reference capture**, verified with isolated Chromium, real public HTTPS and actual Codex screenshot/HTML/CSS/flow inspection.

Completed: **Part 6 — design and MainTheme skills**, verified with role-limited structured output, exact instruction hashes and a real Codex design/continuation.

In progress: **Part 7 — build the website automatically**. The latest operator instruction requests a working checkpoint and new GitHub repository because Codex quota is low. Finish local checks and publish the checkpoint; do not start further provider-consuming pilots in this handoff. The earlier instruction to proceed through all numbered parts resumes only when this quota-limited handoff is reopened.

Additional user requirements for the active work: import/replace MainTheme updates as immutable selectable bundles, pin each project to its version, and expose editable strict-copy/semi-copy/inspiration/custom design modes, per-page preferences and selectable strict anti-slop/design packs. The intended Unslop repo was clarified to **heydamir/unslop**; that actual UI skill is now the `unslop` option. The different mshumer calibration workflow is a separate optional `unslop-calibration` pack, disabled by default. Part 7 is not complete.

Implemented:

- Factory Git repository, project documentation and WordPress delivery contract.
- Imported parent/child/plugin sources and preserved original 0.4.0 archives.
- Correct Vazirmatn license with upstream commit provenance.
- Reviewed source/archive hash manifest and deterministic packaging.
- Portable upstream validators and Iran helper tests.
- Unprivileged, project-local PHP/MariaDB fixture, pinned WordPress/WooCommerce downloads and Persian core/plugin translations.
- Dedicated loopback preview, random private fixture credentials, mail interception and outbound WordPress HTTP blocking.
- Digest-pinned Docker Compose fixture configuration.
- Initial browser smoke suite for runtime, responsive/RTL rendering, admin access and checkout/order persistence.

Completed verification so far:

- 94 source files and three deterministic archives match the recorded baseline.
- 28 upstream static checks and 10 Iran helper cases passed.
- Five package/extraction-safety tests passed.
- Docker Compose configuration parses successfully; Docker runtime is unavailable to this account.
- Seven browser smoke tests passed with zero failures, skips or retries.
- Fresh-database and repeat installation passed, with one admin and no password in installer output.
- Repeated fixture setup retained product IDs; real checkout order records persisted through restart.
- Desktop/mobile/short-landscape screenshots inspected; no new WordPress debug log during the final browser suite.

Detailed environment, commands, acceptance evidence and limits: [Part 1 certification report](PART-1-REPORT.md).

Part 2 implemented:

- TypeScript API/CLI, compiled-service lifecycle and shared job/provider/artifact contracts.
- Private project-local PostgreSQL with a non-superuser application role and separate integration-test database.
- Versioned schema for projects, jobs, stages, requirements, attempts, usage, artifacts and events.
- Transactional queue insertion, stage checkpoints, leases, atomic heartbeats and stale-attempt fencing.
- Cancellation, explicit resumption, retry/backoff, usage caps and execution deadlines.
- Authenticated loopback API with ownership filtering, strict inputs and bounded request bodies.
- Immutable artifact hashes and a trusted three-stage smoke handler; no AI or arbitrary shell execution.

Part 2 verification:

- TypeScript source and integration-test type checks and compiled build passed.
- Fourteen PostgreSQL integration tests passed, including competing workers, a real SIGKILL/replacement, transactional rollback, stale publication rejection, cancellation, budgets, timeouts, stranded-delivery rescue and API access/input limits.
- Compiled API/CLI completed a real three-stage demonstration job and recorded three artifacts.
- API/worker/PostgreSQL restart retained the job and artifact hashes.
- Existing baseline checks and five Python safety tests still pass.

Details: [controller documentation](CONTROLLER.md), [Part 2 report](PART-2-REPORT.md).

Part 3 implemented:

- Durable environment/lifecycle/snapshot/event records, an owned API/CLI and leased operation queue.
- Rootless bubblewrap namespaces and systemd user slices, without Docker access or sudo.
- Separate WordPress/MariaDB, admin credentials, salts, uploads, cache and child-theme Git workspace for every site.
- Read-only parent/core/plugins, authenticated loopback previews and socket/cookie isolation between clients.
- Separate offline reference profile, blocked outbound integrations and bounded local mail capture.
- Kernel CPU/memory/swap/process/per-file limits, bounded command/service runtimes and output, monitored aggregate disk usage, expiry and retention cleanup.
- Stopped snapshots with integrity checks, interrupted-copy recovery and actual file/database restoration.
- Safe initial database retry, preservation of existing data when state is uncertain, and concurrent PHP preview workers for admin requests.

Part 3 verification:

- All eight environment integration tests passed with real WordPress/MariaDB and Chromium, including mobile admin product access, two independent sites, gateway restart, actual snapshot restoration, expiry/disk cleanup and deletion isolation.
- A separate full confirmation run recorded exit code 0 and removed both test environments.
- Both preview-security tests passed, including replacement of a socket path with a symlink to another site's socket.
- All twelve Python safety tests and fourteen existing PostgreSQL controller regression tests passed.
- TypeScript type checks, compiled build, 94-file baseline integrity, 28 static checks and ten helper cases passed.
- The compiled API created an environment, retrieved credentials without exposing them in reports and removed a never-started expired environment while preserving another.
- The compiled service served its protected RTL storefront and recovered that preview after restart, with authentication and the original expiry preserved.

The tested backend is local Linux. Aggregate disk use is monitored rather than enforced by a filesystem quota. Reference fetching is still offline; AI execution and production server deployment remain later parts.

Details: [environment setup](ENVIRONMENTS.md), [Part 3 report](PART-3-REPORT.md).

Part 4 implemented and verified:

- Provider-neutral role/task/usage contracts and the isolated Codex app-server adapter.
- Explicit protected instruction hashes/versions, role-limited files/browser tools and a credential-free model harness.
- Paired screenshot/HTML/structure/styles/geometry captures, responsive viewports and observed interaction transitions.
- Durable agent runs/events/artifacts, token accounting with unknown monetary cost, runtime/tool/artifact limits and stale-publication fencing.
- Protected candidate Git commits, independent syntax/source/preview verification, cancellation and session continuation.
- Five real WordPress agent integration cases, one real image-input/dynamic-image-tool case, six browser/provider cases, fourteen controller regressions and fourteen Python safety cases passed.
- TypeScript checks, compiled build/restart, baseline integrity, static checks and helper tests passed.

Details: [agent runtime](AGENT-RUNTIME.md), [Part 4 report](PART-4-REPORT.md).

Part 5 implemented and verified:

- Strict owned/revisioned briefs, binary client-asset upload and protected acceptance manifests.
- Separate public reference browser/fetch profile with DNS/redirect/TCP destination checks, blocked writes and bounded resources.
- Desktop/mobile screenshots paired with HTML, semantic/form details, styles/geometry, source resources and observed before/after transitions.
- Route/state/flow maps that distinguish executed actions from inferred links and unverified submissions.
- Durable capture queue, cancellation/recovery/fencing and hash-verified private specification artifacts.
- Read-only agent reference tools, paginated catalogs, labelled reference/current images and exact intake binding through continuation.
- Eight intake, four network, one catalog and one real reference-agent check passed; the reference agent inspected an actual menu-result screenshot, paired HTML/structure, CSS and the flow map.
- Fourteen controller regressions, six browser/provider checks, TypeScript/build, Python and baseline/static/helper checks passed. A real public page completed through the compiled API.

Details: [reference capture](REFERENCE-CAPTURE.md), [Part 5 report](PART-5-REPORT.md).

Part 6 implemented and verified:

- Portable versioned reference/design/MainTheme skills, role selection, instruction/capability artifacts and provider/configuration checks.
- Reference-only design before WordPress setup, paired evidence bundles and hash-verified assigned asset inspection.
- Required structured design submission, protected DESIGN.md/record publication and exact design/intake binding for builders.
- Gates for required pages/checks/assumptions, genuine paired evidence, client asset IDs, source paths and text/control contrast.
- Four controlled-provider design cases, a real Codex design and real scope-correcting continuation passed; the actual final design was read and reviewed.
- Five real WordPress agent regressions, fourteen controller regressions, seven browser/provider checks, catalog/pairing, TypeScript/build/restart, Python and baseline/static/helper checks passed.
- Initial 200k-token design attempts were held honestly; the measured complete task used a larger explicit allocation. No monetary cap or aesthetic guarantee is claimed.

Details: [design skills](DESIGN-SKILLS.md), [Part 6 report](PART-6-REPORT.md).

Part 7 source work in progress:

- Immutable MainTheme library/import/certification/default-selection API and CLI; explicit intake/environment pins, source/runtime cache keys and actual assigned extension-document reading. Canonical source and original archives remain unchanged.
- Editable four-mode fidelity policy, global/page overrides, fonts/palette, density/motion, keep/avoid constraints and selected packs. Merge-patch revisions preserve history; null resets a setting. Font and known palette mismatches are rejected by design validation.
- Default factory skillset v2, with the actual **heydamir/unslop** UI skill, reference text/images and retained CC BY 4.0 attribution, alongside Impeccable and frontend-design. All pack/reference hashes are recorded. Upstream host snapshot/video scripts are not agent capabilities. Historic v1 files remain unchanged.
- The separately implemented, optional mshumer calibration uses controlled provider calls and isolated desktop/mobile renders, counted exact-source evidence and a held-out comparison. Four controlled cases passed. A real Codex four-sample pilot completed with 164,985 observed tokens, confirmed usage and unknown monetary cost; the desktop/mobile comparison was also inspected manually. It is provisional and is not proof of WordPress or final client-site quality.
- A discovered preview request storm dropped WordPress script dependencies at the gateway's connection limit. The browser bridge now bounds requests to six and closes its native upstream connections. The 48-script regression passed, and an actual protected WordPress catalog then loaded `wp` with no page/resource errors. No source/hash assertions were removed to address this failure.
- Durable whole-site build state machine, child-stage idempotency records, real content/product/media helpers, initial preview verification, owned API and CLI are written. Related child-file batch writes reduce repeated model context, retain role limits and report partial writes honestly.
- WordPress projects now retain their first selected bundle for future briefs/environments; explicit per-job overrides and a deliberate project-default change are separate operations. The builder pins its instruction selection when created and rejects changed shared design-skill content.
- Chromium now intercepts every redirect hop through the controlled CDP bridge, preserving URL, cookies, Persian form bodies and 307 POST semantics. The preview uses a same-origin referrer policy so valid form origins survive; foreign/null origins remain denied. Real URL-encoded and multipart form regressions pass.
- The compiled local API now serves the Part 7 source. A fixed Persian typographic-print shop pilot and repeatable runner exist. Original code-rendered artwork was inspected, uploaded and bound to an immutable brief using the actual Unslop UI pack. Its fresh nine-route design completed with 232,198 observed tokens and was read/reviewed. The follow-on build was cancelled before the coding agent started at the operator's quota request; no whole-site candidate has completed yet.

Current verification: ten intake cases (including real browser redirects), five policy/pack cases, five design cases, four controlled calibration cases, twelve browser/provider/batch cases, fourteen controller cases, three native content/media cases and four durable-build cases passed. A fresh native Codex image/dynamic-image capability check also passed. TypeScript, compiled build/restart and the 94-file/28-static/10-helper/16-Python checks passed. All five factory v2 skills and the actual upstream heydamir skill passed skill validation. Bounded sandbox-log reads additionally reject links and special files.

Still required before Part 7 can complete: complete one actual whole-site builder pilot with a traceable candidate. All four final theme-update integration cases passed: immutable import restrictions, real compatibility certification, default/project-version pins and broken-update rejection. Compatibility includes nine responsive renders, real Persian checkout, product administration and an empty debug log. An argument-free trace identified Jetpack's first nonce-cleanup/heartbeat scheduling during plugins_loaded; the trusted fresh-activation helper now schedules those same tasks after init. Debug evidence is retained before environment cleanup, and the empty-log gate remains intact.

The first whole-site design attempt hit the transport's old three-minute request limit; its last known 183,766 observed tokens and unknown remainder are retained, and the build correctly stopped at needs_review. A continuation then returned a provider HTTP error. The transport now allows a request within the existing agent deadline, keeps cancellation/unknown-usage gates and records safe HTTP-status diagnostics. The account's fresh image capability check passed. The fresh design completed; failed attempts remain separate and are not counted as successful designs or builds. An earlier overlapping pair of intake test workers caused a failed run; sequential reruns passed and queue-sharing guidance is recorded in AGENTS.md.

Details: [customization](CUSTOMIZATION.md), [theme updates](THEME-UPDATES.md), [build automation and current scope](BUILD-AUTOMATION.md). Parts 8–15 are not implemented. This is not a release-certified website factory; `controller-smoke-v1` remains a labelled orchestration demonstration.
