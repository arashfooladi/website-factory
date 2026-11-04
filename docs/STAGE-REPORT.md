# Website Factory — current project status

Updated **2026-11-05**. Private repository: [arashfooladi/website-factory](https://github.com/arashfooladi/website-factory).

## What this project is

Website Factory is a private server application for a website studio. An operator supplies a client brief, reference URLs, assets and design preferences. Controlled AI workers inspect screenshots together with rendered HTML, CSS/layout geometry and observed interaction flows, plan the design, and build a complete website in an isolated environment.

The first output is a **WordPress child theme using a pinned MainTheme bundle**, with real WooCommerce content. Clients manage products, stock and orders through their own WordPress administration. A portable complete-site delivery and production hosting workflow are planned; this checkpoint does not yet produce a certified client handoff.

It is an application plus controlled agent runtime and versioned skills. It is not a WordPress plugin that runs the factory on a client's public site. The local development backend uses TypeScript, PostgreSQL/pg-boss, private WordPress/MariaDB instances, Linux namespaces/systemd resource limits and browser evidence capture. Codex is the implemented provider; Claude/DeepSeek and Next.js remain planned.

## How much is done

**Seven of the fifteen numbered milestones have accepted completion evidence. Parts 8 and 9 are in progress. Parts 10–15 have not started.** This milestone count is not an estimate of remaining engineering hours: the stages are different sizes.

| Part | Status | What exists / what remains |
| --- | --- | --- |
| 1. MainTheme foundation | Complete | Pinned baseline, reproducible packages, real WordPress/WooCommerce certification. |
| 2. Durable controller | Complete | Owned API/CLI, PostgreSQL queue, leases, cancellation, budgets and recovery. |
| 3. Isolated environments | Complete | Separate site/database/uploads/workspace, private previews, snapshots and cleanup. |
| 4. Coding agent | Complete | Codex adapter, controlled source/browser tools, image input, evidence, usage and candidate commits. |
| 5. Intake/reference capture | Complete | Brief/assets, acceptance manifests, screenshots + HTML/styles/geometry and observed flow inventory. |
| 6. Design/MainTheme skills | Complete | Versioned instructions, protected DESIGN.md, strict/semi-copy/inspiration/custom settings, per-page overrides and pinned anti-slop packs. |
| 7. Website builder prototype | Complete with recovery qualification | A browsable nine-route Persian shop and a published candidate passed 21 trusted preflight checks after operator-assisted recovery. Earlier failed attempts remain failed. |
| 8. Independent visual QA | In progress | Isolated matrix capture, breakpoint sweeps, RTL/content stress, independent vision, reference-policy benchmark, accepted-baseline comparisons and resumable evidence. Final prototype assessment remains held. |
| 9. Functional/admin/commerce QA | In progress | Navigation/search/filter/form/keyboard fixture checks, accessibility, native product/category/image administration, durable QA job API and Firefox bridge. Variation and commerce runners still need native acceptance. |
| 10. Repair/release gates | Not started | Connect structured defects to repairs, candidate publication, targeted/final retests and bounded failure handling. |
| 11. Delivery/restore | Not started | Clean child + site/media/database export, fresh-host restore, retest and client handoff. |
| 12. Operator dashboard | Not started | Authenticated browser workflow over the existing API. |
| 13. Production WordPress v1 | Not started | Three representative pilots, server deployment, recovery/backups and hosting handoff. |
| 14. Additional providers | Not started | Claude/DeepSeek adapters and per-role capability benchmarks. |
| 15. Next.js | Not started | Separate scaffold, application/runtime contract, QA and export. |

## Verified in the current development slice

- Native client-admin pilot `5ec81757-0ec1-4cdf-a93e-d0586ad9da7d` passed Persian product creation/editing, category creation/assignment, PNG upload/byte verification/featured image, catalog visibility, price/stock readback, unavailable storefront and cleanup. Seven paired evidence states were saved privately. The disposable clone was deleted; the original source was preserved.
- Controlled browser fixtures passed healthy navigation, Persian positive/negative search, filtering, persisted form submission and keyboard activation. Deliberately wrong links, ignored filters/search, unreachable keyboard targets and false form-success pages failed.
- Automated accessibility fixtures passed healthy desktop/mobile pages and caught unnamed buttons with paired evidence. Incomplete automated checks remain review items.
- Firefox's isolated single-origin bridge passed redirects, cookies, Persian POST submission, paired captures and denial of other origins. This is transport verification, not a completed cross-browser client-commerce pass.
- PostgreSQL tests cover owned functional jobs, cancellation, stale-worker fencing, source/QA lifecycle guards, unknown/invalid usage, wrong candidates and artifact tampering.
- Accepted visual-baseline tests cover explicit owner acceptance, candidate/acceptance binding, PNG differences/dimensions, immutable evidence and tamper rejection. Baseline acceptance is a trusted operator action, not a builder tool.
- Visual reuse now imports only confirmed completed route assessments, remaps their immutable evidence IDs and requires provenance events for chained reuse. Review prompts attach candidate screenshots and paired excerpts initially to reduce repeated retrieval.

## Open acceptance failures and limitations

**Part 8:** the full candidate matrix contains 54 paired ordinary/stress captures and 54 breakpoint samples with no deterministic findings. The real vision defect benchmark caught an awkward 844×390 clipping defect; reference-policy benchmarks distinguished strict copy from an allowed adaptation. Across retained attempts, eight of the nine route assessments completed with confirmed per-task usage. The latest attempt `f5f5759d-b4b0-4f7b-98f6-fb3aa7014358` stopped on the final route with `visual_review_usage_unconfirmed`; its 661,937 observed tokens and unknown remainder do not constitute a completed review. Completed route records can be reused without repeating those assessments. No actual client baseline has been approved and no complete prototype visual pass is claimed.

**Part 9:** variable-product creation/editing and cart/checkout/order-management code are present but have not passed the native acceptance pilot. Two clone setup attempts failed; the later variation pilot retained an isolated clone after an admin-login timeout. Healthy/broken native commerce and variation tests, client account journeys, project-specific forms/persistence adapters, configured gateway success/failure profiles and the complete durable native suite remain open. The current durable plan supports navigation/search/filter/keyboard, admin, COD-commerce and automated accessibility assignments; the generic form runner still requires a trusted persistence oracle outside that plan. Unassigned or missing integrations must not become passing release checks.

WebKit download failed on this machine, so WebKit remains unverified. Firefox transport passes, but additional-engine critical commerce journeys are still required. The aggregate functional suite has no release authority. Part 10 has not started because Parts 8/9 are not accepted as complete.

## Next build order

1. Finish the last visual route from confirmed prior evidence; verify full coverage and preserve any real defects.
2. Diagnose the retained clone's admin-login failure, finish native variations and commerce/order readback/cleanup, and add deliberately broken native cases.
3. Finish required forms/accounts/gateway, keyboard/accessibility and additional-engine critical journeys; exercise the complete owned functional job against a real clone.
4. Begin Part 10 automatically once Parts 8/9 acceptance checks pass: repairs, exact-candidate retests and protected release gates.
5. Continue Parts 11–15 in their documented order.

## What GitHub contains

All tracked source, tests, skills/licensing, MainTheme baseline packages, fixtures, migrations, tools and documentation are included. `.runtime/`, credentials, authenticated preview links, provider sessions, client database contents, local logs and dependency/build directories are excluded. GitHub is a source checkpoint, not a backup of private live environments.

Setup: [README](../README.md). Detailed history: [PROGRESS.md](PROGRESS.md). Full numbered acceptance criteria: [BUILD-ORDER.md](BUILD-ORDER.md). Functional API and scope: [FUNCTIONAL-QA.md](FUNCTIONAL-QA.md).

**Release status: `releaseEligible: false`. This is a working development prototype, not a production-ready or release-certified website factory.**

## Checkpoint validation

Before upload, `npm run check` passed TypeScript, the 94-file/three-archive baseline lock, 28 static checks, 10 Iran helper cases, 18 Python safety tests and the actual PHP build-probe syntax test. Compilation and compiled service restart/health passed. Separate PostgreSQL suites passed 2 baseline tests, 4 functional-job tests and 4 visual-job regressions sequentially. Five focused admin-guard/upload/assessment/reuse/preview tests passed. The previously run 2 functional-browser fixtures, accessibility fixture and Firefox transport fixture also passed. This validation does not supersede the native acceptance failures listed above.
