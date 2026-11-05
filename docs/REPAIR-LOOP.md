# Part 10 — repair loop foundation

Part 10 is in progress. `src/repair-policy.ts` is a tested decision core, not a connected automatic repair worker. It is deliberately absent from agent tools and HTTP input contracts. Trusted orchestration must construct its input from owned, immutable, hash-verified artifacts and the complete protected acceptance manifest; passing arbitrary JSON to this function does not certify a site.

A snapshot binds every review to builder run, intake, candidate commit, child source digest and acceptance SHA-256. Required checks map explicitly to requirements. Missing, blocked, duplicate, conflicting, incomplete or evidence-free assignments hold for review. All unresolved findings, including minor issues, need repair; no automatic waiver is implemented.

A failed check or finding can request `repair` only within the configured repair-round, runtime, token and optional monetary limits. Unconfirmed usage or unknown cost under a monetary cap holds for review. An affected-area pass requests a full fresh final suite. Reused captures or partial suites cannot establish final readiness. A fully passing final snapshot can become `ready_for_export`; every decision retains `releaseEligible: false`, because fresh-host restore/delivery remains Part 11.

The existing Satr pilot has `maxRepairRounds: 0`. Its defects must therefore yield a review hold, with the best candidate and evidence preserved. Do not overwrite that brief to demonstrate repairs. Use a separate fixture with an explicit repair budget for the Part 10 acceptance pilot.

Remaining work:

1. Normalize owned QA artifacts into evidence-backed defects and complete acceptance coverage, including content checks and explicit infrastructure-block classification.
2. Persist repair sessions, budgets, attempts and fenced transitions with cancellation/restart behavior.
3. Create a writable repair workspace from an immutable candidate/data snapshot, allowing early QA while subsequent builder work remains isolated.
4. Feed scoped defects/evidence to the builder and publish a new immutable candidate after every repair.
5. Retest affected areas, run the full fresh final suite, and preserve failures/usage across retries.
6. Demonstrate actual automatic repair of an injected defect and a separate unfixable/over-budget stop at `needs_review`.

Run the foundation regressions with `npm run test:repair-policy`. Their controlled snapshots exercise policy decisions; they do not claim an agent has repaired a real site or that Part 10 acceptance has passed.
