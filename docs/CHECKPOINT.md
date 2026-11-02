# Working development checkpoint

The operator requested this checkpoint and GitHub handoff because Codex quota was running low. Further provider-consuming pilots were stopped. Continue development from this state when quota is available; do not treat the repository as a production-ready website factory.

Private source repository: https://github.com/arashfooladi/website-factory.

The working CLI/API supports durable jobs and cancellation/recovery, isolated MainTheme WordPress environments with private previews, controlled Codex source/browser tools, reference screenshot/HTML/CSS/geometry/flow capture, immutable briefs and validated DESIGN.md publication. These are the completed Parts 1–6.

Part 7 source adds selectable immutable theme bundles and project pins, strict-copy/semi-copy/inspiration/custom settings, page overrides, the actual pinned heydamir Unslop UI skill, Impeccable/frontend-design packs, real page/product/media preparation and a durable whole-site build API. Source/content setup, input protection, child-operation idempotency, cancellation and failure states have local integration coverage. The reference/design pipeline has also been exercised with actual Codex.

The fixed Persian print-shop pilot produced a validated nine-route design using the correct Unslop skill. That successful fresh design run reported 232,198 observed tokens with confirmed usage and unknown monetary cost. Earlier transport/continuation failures remain recorded separately, including unknown usage; they are not successful builds. The follow-on build was cancelled before its coding agent started at the operator's quota request. No complete generated website, successful whole-site candidate or release-certified client ZIP is claimed.

Final local verification passed compilation, baseline integrity/static/helper/Python checks, the controller/intake/design/controlled-calibration/build suites, browser/provider/tool checks and sandbox-log safety. All four theme-update integration cases passed, including nine responsive renders, real Persian checkout, WordPress product administration, empty debug logs, project pins and rejection of a broken update. The local API was restarted successfully. No AI agents remain queued/running; the cancelled pilot environment is stopped.

The safe entry point on a new machine is the [README setup](../README.md). Check local service state with `npm run controller:status` and `npm run controller:cli -- health`. All runtime configuration, login credentials, client media, previews, database contents, provider sessions and detailed artifacts remain in ignored `.runtime/`; the Git repository deliberately excludes them.

Local checks that do not consume Codex quota:

```sh
npm run check
npm run controller:build
npm run test:preview
npm run test:agent-tools
npm run test:reference-network
npm run test:design-policy
node --import tsx --test tests/controller/runtime-files.test.ts
# After the local PostgreSQL test database is prepared, run sequentially:
npm run test:controller
npm run test:intakes
npm run test:design
npm run test:design-profiles
npm run test:builds
npm run test:build-runtime
npm run test:themes
```

Native WordPress tests need the prepared Linux runtime. Suites sharing intake/agent/environment queues must run sequentially. Keep the canonical baseline hashes and all protected assertions intact when fixing failures.

To resume Part 7, inspect the private pilot evidence and saved design, then deliberately create a new build using that completed intake/design and supplied content/media. The existing cancelled build remains immutable history. On another machine, recreate the intake/assets from [the fixed brief](../fixtures/part-7-pilot.json); runtime IDs and private artifacts do not transfer through Git. The [build API guide](BUILD-AUTOMATION.md) explains the current supported features and explicit budgets.

Finish the complete-site candidate and initial interaction checks before marking Part 7 complete. Then follow Parts 8–11 for independent responsive/visual QA, functional/admin/commerce QA, repair gates and export/restore. Parts 12–15 add the dashboard, production server pilots, more providers and Next.js. Publishing this checkpoint does not mark the remaining stages complete.
