# Working development checkpoint — 2026-11-05

Repository: [arashfooladi/website-factory](https://github.com/arashfooladi/website-factory) (public source).

Read [the current stage report](STAGE-REPORT.md) first. **Parts 1–9 have completion evidence; Part 10 is in progress; Parts 11–15 have not started.** Part 7 required operator-assisted recovery. There is no production-ready or release-certified client export.

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

Native WordPress tests also require the prepared Linux runtime. Queue suites with different transports/storage roots must not run concurrently against the same test queues. Additional-engine tests require the Playwright binaries and compatible libraries; Firefox transport/native COD checks pass; WebKit downloaded but required host libraries are missing.

Part 8 is now complete: preserve review `fd89b69b-a83e-4071-bca5-e8395ea58742` and its 13 defects for the repair loop. It uses immutable reused captures and does not grant release approval. Earlier interrupted/unconfirmed rows remain unchanged. Actual baseline approval remains a trusted operator action.

Part 9 acceptance is complete for the Chromium/Firefox COD profile; see [PART-9-REPORT.md](PART-9-REPORT.md). Keep the prototype's empty-search, account accessibility and visual findings for Part 10. Original failed QA records remain unchanged; the corrected native Firefox keyboard checkout passed with cleanup.

Continue Part 10 from the tested protected decision core (`src/repair-policy.ts`). Connect owned hash-verified QA artifacts and acceptance coverage to durable orchestration, preserve the original pilot's zero repair budget, publish repairs as new candidates and run affected/full final retests. Test automatic repair and bounded failure using a separate authorized fixture. Part 10 is not complete. Follow with Parts 11–15 in order. This checkpoint is being pushed at the operator’s request; keep subsequent development local until another push request.
