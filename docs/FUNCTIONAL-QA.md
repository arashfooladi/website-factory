# Functional QA — development API and scope

Part 9 acceptance is complete for the supported Chromium/Firefox COD profile. The default controller now registers a durable, owner-scoped functional review worker. No AI provider is called by these protected checks.

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
- `commerce`: `{ "gateway": "cod", "shipping": 50000, "orderStatus": "processing", "quantity": 2 }`, required ID `commerce:checkout-orders`. These amounts/status are protected expectations, not values inferred from the tested checkout. The COD profile has native Chromium/Firefox acceptance evidence; other configured profiles still need their own verification.
- `accessibility`: an array of routes, required ID `accessibility:automated`. Automated WCAG A/AA rules run at desktop/mobile; violations and incomplete checks hold the result for review.

The worker verifies the published source, creates a private functional clone with read-only child/workspace and writable cloned uploads, records provenance, runs assignments, checks source stability and destroys the clone. WordPress writes use the ordinary client-admin browser session. A controller-only PHP oracle verifies persistence and deletes only uniquely scoped QA products, terms, images and orders. The original site is not the mutation target.

Form writes require explicit mutation authorization from trusted controller code and a persistence oracle. The durable `forms` assignments use the isolated correlated mail sink described below; a success message alone cannot pass a form. Other persistence backends require their own protected adapters.

Checks produce candidate-bound artifacts and `releaseEligible: false`. Cancelled/interrupted/stale workers cannot publish a passing report. A required integration without a supported sandbox adapter remains blocked. Additional browser/payment profiles need their own verification, as recorded in the [stage report](STAGE-REPORT.md).

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

`npm run test:browser-engines` requires `npx playwright install firefox webkit` plus compatible system libraries. Firefox transport and native COD commerce passed locally; WebKit downloaded but lacks host libraries and is not claimed passing. Neither engine bypasses the network namespace: their HTTP proxy forwards through a scoped Unix socket to the same single-origin controller bridge. CONNECT and other origins are denied.

`npm run pilot:admin -- --categories --media --variations --retainFailed` is the operator pilot for the fixed Part 7 candidate. `--commerceOnly --shipping 50000` selects the native commerce pilot. These tools reference the local pilot candidate and require its private runtime; they are not portable client release commands. Retained failures still expire according to environment limits.

## Extended Part 9 checks (2026-11-05)

Plans now accept `engines` (default `["chromium"]`), `accounts`, `forms` and `integrations`. Journey assignments can include a `viewport`; navigation can include a `menuToggle`. Menu checks require the toggle's controlled panel to become visible before following a link inside it, so an unrelated footer link cannot hide a broken mobile menu. The same assigned navigation/keyboard/search and commerce checks run in each selected engine.

`accounts: { "path": "/account/" }` adds required check ID `accounts:customer`: a uniquely scoped customer fixture, incorrect/correct password handling, Persian account edits with trusted persistence readback, denial of product administration, logout, reset mail in the private sink, and removal of the temporary customer. No account password or reset link is included in the public report.

`forms` contains operator-authored form assignments with `id`, `requirementId`, `path`, `expectedPath`, `expectedText`, `fields`, `submit` and `mail`. Use `{{qaToken}}` in at least one submitted field and in the mail's `messageIncludes` or `subjectIncludes`. The controller replaces it with a unique correlation value and checks the isolated mail sink for the expected recipient and contents. A success message without matching persistence fails. Only a verified functional clone permits these writes; sink reads reject links, special files and oversized files.

`integrations` can declare required external gateway probes, for example `{ "id": "gateway:bank", "type": "payment-gateway", "gatewayId": "bank-sandbox" }`. An unavailable adapter/sandbox credential remains an explicit blocked check with incomplete coverage; it does not become a passing check or an instruction to repair the website. Built-in offline `cod`/`bacs` gateways use the commerce module. COD has native acceptance evidence; BACS remains subject to the selected site's configuration and further profile testing.

Native COD commerce passed Chromium run `dd7fee25-402b-4140-8b5b-ac1c038b64b5` and Firefox run `42c4b9f3-351b-4b6a-b51d-45e9d7ab76b2`, each with eight evidence states and verified cleanup. Customer run `04dfd928-9f7a-48d2-9e6f-f35e41ead8ad` passed six states and verified customer cleanup. Negative role fixture `1443f0fa-5a64-4e09-9916-29fce1e7db20` confirmed that denied product-management permissions fail the admin suite with a real 403, then restored the original cloned role.

Trusted WordPress fixture/oracle commands skip themes so candidate child hooks cannot substitute the readback. Product/variation readback, order values/items/stock and customer metadata remain independent of screenshots. Order cleanup also correlates by the uniquely scoped line item, covering a broken checkout that saves an unexpected email.

The fixed synthetic shop's complete protected assignment is [part-9-pilot-plan.json](../fixtures/part-9-pilot-plan.json). Run once with `npm run pilot:functional -- --create --candidate BUILDER_UUID --plan fixtures/part-9-pilot-plan.json`, then `npm run pilot:functional` to watch its saved job. Reusing a state directory does not create another job; changed candidate/plan inputs are refused. A terminal reviewed report with defects or incomplete coverage gives a failing pilot exit status. It still has no release authority.

WebKit's binary has now downloaded, but this Arch host lacks required shared libraries. The profile remains unverified and is blocked if selected. The tested native commerce engines are Chromium and Firefox. Native variable-product verification and the complete aggregate processor run have finished. The supplemental job preserved its Firefox traversal failure; a corrected native Firefox keyboard checkout subsequently passed.

Native variable-product pilot `b6c5fb45-8678-4497-b91c-967392bf25bb` now passes eleven states, including persisted variation price/stock edits, unavailable-choice behavior and an actual valid variation/cart transition. Dashboard pilot `40475eb5-8249-49ac-afae-2dc2a78e647e` independently verifies the client's dashboard/widgets page. Use `dashboard: true` with required ID `baseline:wp-admin-access` for that durable assignment.

Search assignments may specify a protected `expectedPath` for WooCommerce's legitimate single-product redirect. The checker must still observe a navigation request carrying the actual GET search query; an arbitrary product link cannot satisfy the search check. An empty-search page without its required no-results message still fails. The prototype currently has that defect, reserved for the repair loop.

The complete aggregate job `695c708a-d17c-4d87-a147-36732c14a8cf` finished with all thirteen original assignments covered and the prototype held for repairs. Both engines caught the missing empty-search notice. Automated WCAG checks found a serious `target-size` violation on the account `.show-password-input` at desktop/mobile sizes; home/shop passed. Admin categories, media and variations, accounts and Firefox checkout passed. Chromium checkout encountered a response-body eviction race after immediate navigation. The bridge now copies a protected response receipt before browser delivery; immediate-redirect regressions pass in both engines. The original aggregate report remains unchanged.

Critical account/admin login and checkout text fields now require actual Tab traversal; login/checkout submission uses Enter. Generic correlated mail-form fields/submission also require keyboard reachability. These checks do not substitute for full assistive-technology review. The supplemental [keyboard plan](../fixtures/part-9-keyboard-plan.json) verifies the new native paths without repeating unchanged coverage. The current full pilot plan additionally includes the independent dashboard assignment; this does not retroactively alter the original thirteen-assignment job.


Part 9 acceptance evidence is consolidated in [PART-9-REPORT.md](PART-9-REPORT.md). The final Firefox native run `054d100a-9893-43dd-97eb-3044f2e7fa71` passed all eight states with keyboard verification and cleanup. The helper chooses Tab or Shift+Tab toward the actual target; it does not directly focus controls or assume forward Tab can wrap through Firefox browser chrome. Plain-form reordered-field and deliberate-trap regressions pass in both engines. Original failed records remain unchanged. Part 10's protected repair-decision core has started; automatic repairs and final release orchestration remain to connect.
