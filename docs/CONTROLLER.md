# Part 2 — server controller

The controller is a TypeScript service backed by PostgreSQL and pg-boss. Its only executable pipeline in this part is `controller-smoke-v1`: three trusted demonstration stages (`prepare`, `checkpoint`, `finalize`). It does not build a website or call an AI provider yet.

Part 3 adds a separate trusted environment-operation queue and protected WordPress previews to the API process. See [environment setup and lifecycle](ENVIRONMENTS.md) for those commands, isolation requirements and resource limits. The demonstration job pipeline described here remains unchanged.

## Start locally

Requirements: Node 22.12+, npm, Python 3.11+, and an accessible PostgreSQL. The project-local bootstrap below targets Arch Linux x86_64, using the host `psql` client and shared libraries. Other servers can supply PostgreSQL and a private configuration file instead.

```bash
npm ci
npm run controller:db:prepare
npm run controller:db:up
npm run controller:build
npm run controller:up
npm run controller:cli -- health
```

The API binds to `127.0.0.1:8790`; the database binds to `127.0.0.1:15432`. Private database credentials, API token and operator ID are generated in `.runtime/controller/config.json`, mode 0600. No sudo, global database service or Docker socket is used. The helper runs PostgreSQL with durable writes enabled; the application database role is not a superuser.

`controller:up` starts the compiled API and one worker. `controller:status` reports their state. `controller:down` stops both and retains data. `controller:db:down` separately stops PostgreSQL. Changes to source need a build and service restart.

Foreground development alternatives:

```bash
npm run controller:serve
# In another terminal:
npm run controller:worker
```

The local background helper tracks process start times to avoid signaling a reused PID. Full service supervision, host deployment, monitoring and backup policy belong to Part 13.

## Create and inspect a demo job

```bash
npm run controller:cli -- project:create --name "Example client"
npm run controller:cli -- job:create --project PROJECT_UUID
npm run controller:cli -- job --id JOB_UUID
```

Creation returns IDs. Inspection returns persisted stages, attempts, heartbeats, reservations, artifacts, requirements and events. Poll inspection to follow progress. `projects` lists projects belonging to the authenticated operator.

Use `job:create --project PROJECT_UUID --file job.json` to supply parameters:

```json
{
  "pipeline": "controller-smoke-v1",
  "input": {
    "delayMs": 100,
    "tokensPerStage": 10,
    "costMicrosPerStage": 100,
    "transientFailures": 0
  },
  "limits": {
    "maxRuntimeMs": 60000,
    "stageTimeoutMs": 15000,
    "maxTokens": 10000,
    "maxCostMicros": 1000000,
    "maxRetries": 2
  },
  "requirements": []
}
```

`transientFailures` deliberately fails that many initial attempts of the checkpoint stage. Values for tokens and cost are synthetic smoke-test reservations; no provider is contacted or billed. Monetary counters use integer USD microunits, avoiding floating-point accounting.

```bash
npm run controller:cli -- cancel --id JOB_UUID
npm run controller:cli -- resume --id JOB_UUID --file limits.json
```

Resume requires an explicit limits object. It is allowed only for failed, cancelled or review-needed jobs, grants a new execution generation, retains previous usage, and preserves completed stages. It never approves requirements or marks a client website ready. Completed smoke jobs cannot be resumed or cancelled.

## Durability and execution rules

- Job/stage/requirement creation and queue insertion commit in one database transaction. A failed enqueue leaves no half-created job.
- Each stage claim locks its application job, records a unique attempt and reserves its maximum usage before work begins. Concurrent claims cannot reserve the same stage twice.
- The normal lease is 15 seconds. Immediate, latency-aware heartbeats renew it in a single atomic database update. Stage and job deadlines cap renewal.
- Completion checks the current attempt, lease and deadlines under a row lock. Artifact metadata, the demo effect, stage completion and next-stage enqueue commit together. Duplicate or stale handlers cannot publish accepted results.
- Artifacts have immutable attempt-specific paths and SHA-256 metadata. The API does not expose filesystem storage paths. A rejected/abandoned attempt may leave an unreferenced private file; orphan cleanup is a later retention concern.
- Temporary failures use bounded exponential backoff. Exhausted retries fail; exhausted usage or execution deadlines stop for review.
- Recovery requeues expired running attempts and reconciles stranded queued jobs. Committed stages are retained. A live, renewed lease is not recovered as a crash.
- Cancellation immediately revokes publication authority in PostgreSQL. The cooperative demo handler notices cancellation through its heartbeat and stops. There is no generic untrusted code execution in this part; terminating future external tools requires the isolated process boundary in Parts 3–4.
- Reservations from failed/interrupted/cancelled attempts remain charged conservatively when actual usage is unknown. Future provider adapters must enforce their reserved upper bound and reconcile verified usage before claiming accurate billing.

The transactional demo effect is an exactly-once committed database effect. This does not promise exactly-once execution of arbitrary future external APIs: they also need idempotency keys and fenced publication.

## API and access boundary

All routes require `Authorization: Bearer <private token>`. The CLI reads the token locally without putting it in shell arguments. The initial deployment supports one private operator principal, not a user-management product. Project lookups enforce that principal's ownership; another owner's job is returned as not found. Browser origins are disabled until an authenticated dashboard is implemented.

| Method | Route | Purpose |
|---|---|---|
| GET | `/v1/health` | Authenticated database/API readiness |
| GET / POST | `/v1/projects` | List owned projects / create one |
| POST | `/v1/jobs` | Create a supported smoke pipeline |
| GET | `/v1/jobs/:id` | Inspect an owned job |
| POST | `/v1/jobs/:id/cancel` | Revoke an owned job |
| POST | `/v1/jobs/:id/resume` | Explicitly grant new limits and resume |

Inputs are strict, bodies are capped at 64 KiB, and request/header timeouts are bounded. API errors do not echo credentials, SQL or request values. No API route accepts shell commands, filesystem paths, raw provider credentials or a caller-supplied owner ID.

`src/contracts.ts` defines provider tasks/results, roles, capability requests, artifact references and tool policies for later adapters. Writable paths are relative to an assigned workspace; credentials must be resolved from owned references rather than supplied as raw secrets. Host Docker and production access are forbidden in that policy. These are future execution contracts; the current handler itself has no external tools or provider credentials.

`FACTORY_CONFIG` selects another private JSON configuration. Required keys are `databaseUrl`, `apiToken` (at least 32 characters), and `ownerId` (UUID). Optional keys include loopback `host`, `port`, `artifactRoot`, `leaseMs`, `pollMs` and `retryDelayMs`. Keep the file outside any future agent workspace and never commit it.

## Verification

```bash
npm run check
npm run test:controller
```

The integration suite requires the separate `website_factory_test` database and `.runtime/controller/config.test.json` generated by `controller:db:up`. It refuses the application database. Tests create their own projects and cancel unfinished test jobs during cleanup.

The suite exercises transactional rollback after actual queue insertion, concurrent claims, two workers renewing long stages, budget limits, explicit resumption, transient/exhausted retries, cancellation, stale-worker fencing, timeouts, stranded-delivery rescue, an actual `SIGKILL` and authenticated API behavior. The test lease is four seconds to accommodate measured durable-write latency; long test stages exceed that lease. The normal controller lease remains 15 seconds, and stage/job timeout assertions use independent shorter deadlines.

Relevant upstream behavior: pg-boss is an at-least-once queue with transaction-aware enqueue, so application fencing and idempotent effects remain necessary. [pg-boss introduction](https://pgboss.io/introduction)
