# Working development checkpoint — 2026-11-05

Repository: [arashfooladi/website-factory](https://github.com/arashfooladi/website-factory) (private).

Read [the current stage report](STAGE-REPORT.md) first. **Parts 1–7 have completion evidence; Parts 8/9 remain in progress; Parts 10–15 have not started.** Part 7 required operator-assisted recovery. There is no production-ready or release-certified client export.

The repository contains the full source checkpoint, tests, skills, baseline packages, fixtures, tools and documentation. Private environments, databases/media, login credentials, provider sessions and raw evidence stay in ignored `.runtime/`. Runtime IDs in reports are evidence references on the original machine, not transferable installations.

Start on a new machine with the [README setup](../README.md). On the current machine, inspect `npm run controller:status` and `npm run controller:cli -- health` before changing services. A fresh compiled service applies migrations 017 (visual baselines) and 018 (functional reviews) and registers both QA workers. It can process existing queued work; a normal startup does not create a new paid inference job.

Useful checks without paid inference:

```sh
npm run check
npm run controller:build
npm run test:functional-qa
npm run test:admin-qa
npm run test:accessibility-qa
npm run test:browser-upload
npm run test:visual-reuse
# Requires prepared PostgreSQL test database; run these sequentially:
npm run test:visual-baselines
npm run test:functional-jobs
npm run test:visual-jobs
```

Native WordPress tests also require the prepared Linux runtime. Queue suites with different transports/storage roots must not run concurrently against the same test queues. Additional-engine tests require the Playwright binaries and compatible libraries; Firefox transport passes, WebKit remains unverified after a download failure.

Resume Part 8 by importing the latest terminal review's hash-checked captures and confirmed completed route assessments. Never rewrite a failed review to successful or repeat all finished routes unnecessarily. The final prototype route and complete final report remain outstanding; actual baseline approval remains an operator action.

Resume Part 9 with the retained variation clone's admin-login failure, then real variable-product and COD checkout/order tests, negative native fixtures, account/form/gateway coverage, additional-engine critical journeys and a complete durable native run. The [functional QA guide](FUNCTIONAL-QA.md) distinguishes implemented APIs from native acceptance gaps.

Once Parts 8/9 pass their original acceptance checks, proceed straight to Part 10's repair/retest/release gates, then Parts 11–15. Publishing this source checkpoint does not mark those tasks complete.
