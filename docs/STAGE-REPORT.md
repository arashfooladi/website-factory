# Website Factory — current project status

Updated **2026-11-05**. Public source repository: [arashfooladi/website-factory](https://github.com/arashfooladi/website-factory). This source checkpoint is being published at the operator’s request.

## What this project is

Website Factory is a server application for a website studio. An operator supplies a client brief, reference URLs, assets and design preferences. Controlled AI workers inspect screenshots together with rendered HTML, CSS/layout geometry and observed interaction flows, plan the design and build a complete website in an isolated environment.

The first output is a WordPress child theme using a pinned, replaceable MainTheme bundle and real WooCommerce content. Clients manage products, stock and orders through their own WordPress administration. It is an application plus controlled runtime and versioned skills. The local backend uses TypeScript, PostgreSQL/pg-boss, private WordPress/MariaDB instances, Linux namespaces/systemd limits and browser evidence capture. Codex is implemented; additional providers and Next.js remain planned.

## How much is done

**Nine of fifteen numbered milestones have accepted completion evidence. Part 10 is in progress. Parts 11–15 have not started.** Milestone count does not estimate remaining engineering hours.

| Part | Status | Evidence / remaining scope |
| --- | --- | --- |
| 1. MainTheme foundation | Complete | Pinned baseline, reproducible packages and native WordPress/WooCommerce certification. |
| 2. Durable controller | Complete | Owned API/CLI, queues, leases, cancellation, budgets and recovery. |
| 3. Isolated environments | Complete | Separate sites/databases/uploads/workspaces, previews, snapshots and cleanup. |
| 4. Coding agent | Complete | Codex adapter, controlled source/browser tools, image input, usage and candidate commits. |
| 5. Intake/reference capture | Complete | Brief/assets, acceptance manifest, screenshots + HTML/styles/geometry and observed flow inventory. |
| 6. Design/MainTheme skills | Complete | Versioned design instructions, protected DESIGN.md, copy/inspiration/custom settings, per-page overrides and pinned anti-slop packs. |
| 7. Website builder prototype | Complete with recovery qualification | Nine-route Persian shop and published candidate passed 21 trusted preflight checks after operator-assisted recovery. |
| 8. Independent visual QA | Complete; prototype held | Matrix captures, breakpoint/RTL/content stress, independent vision, fidelity-policy benchmarks and accepted-baseline protections. Nine-route prototype review found 13 defects. |
| 9. Functional/admin/commerce QA | Complete for supported profile | Protected healthy/broken browser fixtures; native products/variations/categories/media, accounts/dashboard, COD checkout/order/stock and keyboard journeys; Chromium/Firefox, accessibility and durable jobs. |
| 10. Repair/release gates | In progress | Tested protected decision core binds exact candidate/acceptance/evidence, budgets and final-suite requirements. Durable repair orchestration and actual automatic repair acceptance remain to build. |
| 11. Delivery/restore | Not started | Complete clean export, fresh-host restore, retest and client handoff. |
| 12. Operator dashboard | Not started | Authenticated browser workflow over existing APIs. |
| 13. Production WordPress v1 | Not started | Three representative pilots, persistent server deployment, recovery/backups and hosting handoff. |
| 14. Additional providers | Not started | Claude/DeepSeek adapters and capability benchmarks. |
| 15. Next.js | Not started | Separate scaffold, runtime/persistence contract, QA and export. |

## Native acceptance and actual site defects

Part 8 review `fd89b69b-a83e-4071-bca5-e8395ea58742` covers all nine routes using immutable captured evidence: one major and twelve minor findings. It uses the original snapshot and grants no fresh-site or baseline approval. See [PART-8-REPORT.md](PART-8-REPORT.md).

Part 9's complete durable job `695c708a-d17c-4d87-a147-36732c14a8cf` covered thirteen original assignments. It caught a missing empty-search message in both engines and serious account password-toggle target-size violations at desktop/mobile sizes. Admin categories/media/variations, accounts and Firefox checkout passed. A Chromium receipt race was corrected and cross-engine immediate-redirect regressions passed.

Supplemental job `c0afa4cc-0566-4c8c-8b32-68ad27a8c582` passed customer/dashboard and Chromium keyboard/checkout checks. It exposed forward-only Firefox traversal beyond the document. A plain-form reproduction led to genuine Tab/Shift+Tab traversal; both engines still reject deliberate traps. Corrected native Firefox run `054d100a-9893-43dd-97eb-3044f2e7fa71` passed eight states, Persian billing, configured shipping/COD, persisted order/stock, admin completion and cleanup. The clone was destroyed. Original failed/cancelled records remain unchanged. See [PART-9-REPORT.md](PART-9-REPORT.md).

These are QA implementation acceptance results. The prototype still needs its visual, search and accessibility defects repaired. Its original brief permits **zero repair rounds**; Part 10 must preserve that budget and demonstrate automatic repairs on a separate properly budgeted fixture.

## Part 10 and plans ahead

The decision core rejects mismatched candidate/source/intake/acceptance bindings, incomplete or blocked required checks, missing evidence, unresolved minor/major/blocker findings and exceeded/unconfirmed budgets. Affected-area or reused/partial results require a full fresh final suite. Every decision retains `releaseEligible: false`; export readiness cannot replace Part 11's restore gate.

Next, connect owned hash-verified QA artifacts and the complete acceptance manifest to durable repair sessions; isolate writable repair workspaces, publish new candidates, retest affected areas and run the final suite. Demonstrate actual automatic repair and an unfixable/over-budget review hold before completing Part 10. The current core is not yet connected to an API or automatic worker. See [REPAIR-LOOP.md](REPAIR-LOOP.md), then follow Parts 11–15 in [BUILD-ORDER.md](BUILD-ORDER.md).

## Supported scope and limits

Native critical commerce is verified for configured COD in Chromium and Firefox. BACS is schema-supported but not natively accepted. External gateways without a sandbox adapter/credentials remain blocked. WebKit downloaded but required host shared libraries are missing; selecting it does not silently pass. Generic forms currently verify actual correlated private mail persistence; other backends require protected adapters. Scoped keyboard and automated WCAG checks do not claim exhaustive assistive-technology coverage.

There is no portable client handoff, fresh-host restore, production deployment certification, browser operator dashboard, additional provider adapter or Next.js output yet.

## Validation and publication contents

`npm run check` passed TypeScript, the unchanged 94-file/three-archive baseline, 28 static checks, ten Iran helper cases, nineteen Python safety tests and PHP build-probe validation. Focused tests passed twelve browser/form/accessibility/functional-queue regressions, two admin/upload guards, two immediate-redirect receipt regressions, two cross-engine traversal/trap regressions and three post-correction login/form/sink regressions. Seven repair-policy regressions passed. Native evidence and limits are detailed in the stage reports above.

GitHub contains tracked source, tests, skills/licensing, baseline packages, fixtures, migrations, tools and documentation. Private runtime databases/media, credentials, authenticated preview links, sessions, raw evidence, logs and dependency/build directories are excluded. The public repository is source, not a backup of live environments.

**Release status: `releaseEligible: false`. This is a working development prototype with accepted QA components; it is not a release-certified or production-ready website factory.**
