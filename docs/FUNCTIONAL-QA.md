# Functional QA — development API and scope

Part 9 is in progress. The default controller now registers a durable, owner-scoped functional review worker. No AI provider is called by these protected checks.

`POST /v1/functional-reviews` accepts a published builder `candidateRunId`, a protected `plan`, and optional `maxRuntimeMs` (10 seconds to one hour; default 30 minutes). Use the normal private controller bearer credential. Inspect with `GET /v1/functional-reviews/:id`, cancel with `POST /v1/functional-reviews/:id/cancel`, and download immutable evidence with `GET /v1/functional-reviews/:id/artifacts/:artifactId`.

Example of a small operator-authored plan:

```json
{
  "candidateRunId": "PUBLISHED_BUILDER_RUN_UUID",
  "plan": {
    "journeys": [{
      "id": "catalog-link",
      "requirementId": "navigation:catalog",
      "kind": "navigation",
      "path": "/",
      "linkText": "فروشگاه",
      "expectedPath": "/shop/",
      "expectedText": "فروشگاه"
    }],
    "requiredChecks": ["catalog-link"]
  }
}
```

A small plan proves only its assigned checks. It is not a complete-site or release pass. Use project-specific protected text/selectors and include every required assignment. The schema rejects missing/duplicate required IDs.

Supported journey kinds are `navigation`, `search` (`query`), `filter` (`selector`, `value`, `excludedText`) and `keyboard` (`target`, `expectedPath`, optional `maxTabs`). Each has an `id`, `requirementId`, route and expected main-content text. Filters must demonstrate both inclusion and exclusion. Keyboard checks use actual Tab/Enter events.

Optional modules:

- `admin`: `{ "categories": true, "media": true, "variations": true }`, required ID `admin:product-management`.
- `commerce`: `{ "gateway": "cod", "shipping": 50000, "orderStatus": "processing", "quantity": 2 }`, required ID `commerce:checkout-orders`. These amounts/status are protected expectations, not values inferred from the tested checkout. This runner currently supports COD only and remains pending native acceptance.
- `accessibility`: an array of routes, required ID `accessibility:automated`. Automated WCAG A/AA rules run at desktop/mobile; violations and incomplete checks hold the result for review.

The worker verifies the published source, creates a private functional clone with read-only child/workspace and writable cloned uploads, records provenance, runs assignments, checks source stability and destroys the clone. WordPress writes use the ordinary client-admin browser session. A controller-only PHP oracle verifies persistence and deletes only uniquely scoped QA products, terms, images and orders. The original site is not the mutation target.

The lower-level form runner requires both explicit mutation authorization from trusted controller code and a persistence oracle. A success message alone cannot pass a form. It is not yet exposed in the durable plan because project-specific sink/account adapters remain unfinished.

Checks produce candidate-bound artifacts and `releaseEligible: false`. Cancelled/interrupted/stale workers cannot publish a passing report. Required but unassigned integrations, real gateway credentials and further browser coverage are remaining work, as recorded in the [stage report](STAGE-REPORT.md).

Local verification commands:

```sh
npm run test:functional-qa
npm run test:admin-qa
npm run test:accessibility-qa
npm run test:browser-upload
# Requires prepared PostgreSQL test database; run queue suites sequentially:
npm run test:functional-jobs
npm run test:visual-baselines
```

`npm run test:browser-engines` requires `npx playwright install firefox webkit` plus compatible system libraries. Firefox transport passed locally; WebKit download failed and its test is not claimed passing. Neither engine bypasses the network namespace: their HTTP proxy forwards through a scoped Unix socket to the same single-origin controller bridge. CONNECT and other origins are denied.

`npm run pilot:admin -- --categories --media --variations --retainFailed` is the operator pilot for the fixed Part 7 candidate. `--commerceOnly --shipping 50000` selects the unfinished native commerce pilot. These tools reference the local pilot candidate and require its private runtime; they are not portable client release commands. Retained failures still expire according to environment limits.
