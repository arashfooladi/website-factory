# Part 2 — durable server controller verification

Date: 2026-11-02. Result: **passed for the implemented controller scope**.

The controller runs a three-stage demonstration pipeline through a real PostgreSQL/pg-boss queue. This proves the orchestration foundation; website generation and provider execution are not implemented in this part.

## Runtime and implementation

- TypeScript 7.0.2, pg-boss 12.38.0, pg 8.23.1, Zod 4.6.7.
- PostgreSQL 18.6, project-local native installation; the imported packages were signature-verified and their downloads are checksum-pinned.
- Separate application and integration-test databases. The application role is not a PostgreSQL superuser.
- API on loopback port 8790, PostgreSQL on loopback port 15432; private token/configuration outside version control.
- Versioned database schema and compiled migration asset, plus provider/artifact/tool-policy contracts.

## Verification

`npm run typecheck` and `npm run controller:build` passed. `npm run check` passed the existing baseline validation, Iran helper cases and five Python safety tests.

`npm run test:controller` passed **14 integration tests**, zero failures/skips:

1. Three-stage execution with persisted events, usage and hash-verified artifacts.
2. Actual queue insertion followed by injected failure: job and queue transaction both roll back.
3. Concurrent claims reserve one attempt and one usage allocation.
4. Two workers and recovery loops keep long stages alive without extra attempts.
5. A transient stage retries without repeating committed effects.
6. Reconciliation rescues a delivery lost before application claim.
7. Exhausted retries fail honestly.
8. Token and monetary limits stop before exceeding reservations; explicit resume preserves completed stages.
9. Cancellation stops an active handler and prevents late publication.
10. Expired leases cannot be revived; a stale attempt cannot publish or overwrite a replacement.
11. Stage timeouts stop for review.
12. Overall deadlines stop a pipeline across queue boundaries.
13. An actual worker SIGKILL followed by a replacement resumes without duplicate committed effects.
14. API authentication/ownership, caller-owner injection rejection, strict pipeline validation, malformed JSON, unsupported media type and oversized-request handling.

The final full integration run took about 76 seconds. Its raw log is retained locally in ignored `.runtime/controller/integration-tests.log`.

The compiled API/CLI also created an application-database project and completed a three-stage job with three artifacts. The demonstration snapshot is in ignored `.runtime/controller/demo-job.json`. Restarting the API, worker and PostgreSQL preserved the completed job and artifact hashes; calling service startup repeatedly did not duplicate the services.

## Lease test findings

Stress testing exposed two issues: separate commits for application/attempt heartbeats and interval ticks skipped during slow commits. Heartbeats now update both rows in one atomic statement, renew immediately, and schedule the next renewal using elapsed query time.

Measured request/commit delays exceeded an initially unrealistic 1.2-second integration-test lease. The final test uses a four-second lease with 5.2-second stages, so renewal is still mandatory. Independent stage/overall deadline tests remain short. The normal application lease is 15 seconds. Expiry and stale-publication rejection remain strict.

## Boundaries and next part

- Only the fixed `controller-smoke-v1` handler executes. No arbitrary commands, provider credentials or paid API calls are accepted.
- Usage counters are conservative reservations, including unknown usage from interrupted attempts. Smoke values are synthetic; real billing reconciliation belongs with provider adapters.
- Cancellation revokes database publication immediately; terminating future untrusted subprocesses requires the isolation/process boundary in Parts 3–4.
- Artifact metadata is accepted transactionally. An abandoned attempt can leave an unreferenced private file; retention/orphan cleanup is future work.
- This is a single-operator private API, not a user-management dashboard or a production release gate.
- Native local startup is verified. Docker execution, production supervision and full backup restoration remain later work.
- The MainTheme baseline source and existing client installations were not changed in Part 2. Its existing static/helper checks were rerun; browser tests were not repeated for these backend-only changes.

The Part 2 acceptance condition is met: real multi-stage jobs survive worker replacement without duplicate committed effects, and cancellation/budget exhaustion produce honest persisted states. Next is Part 3: per-project website environments.
