# Part 9 — functional, administration and commerce QA

The protected QA implementation runs without AI inference. Its supported native commerce profile is MainTheme/WordPress/WooCommerce with configured COD in Chromium and Firefox. Completion of this stage certifies the checker against healthy and deliberately broken fixtures; it does not certify the generated prototype for delivery.

Part 9 acceptance is complete for the supported profile. Part 10 has started; the prototype remains held for repairs.

## Native evidence

| Check | Native run | Outcome |
| --- | --- | --- |
| Product/category/media administration | `5ec81757-0ec1-4cdf-a93e-d0586ad9da7d` | Seven evidence states; Persian edits, media bytes, price/stock and cleanup passed. |
| Variable products | `b6c5fb45-8678-4497-b91c-967392bf25bb` | Eleven states; attribute/variation CRUD, unavailable selection, valid cart transition and cleanup passed. |
| COD checkout, Chromium | `dd7fee25-402b-4140-8b5b-ac1c038b64b5` | Eight states; rejected empty checkout, Persian address, shipping, order/stock, admin completion and cleanup passed. |
| COD checkout, Firefox | `42c4b9f3-351b-4b6a-b51d-45e9d7ab76b2` | Same native critical journey passed with eight states and cleanup. |
| Customer accounts | `04dfd928-9f7a-48d2-9e6f-f35e41ead8ad` | Six states; wrong/correct password, Persian profile edits, denied admin access, logout, sink reset mail and cleanup passed. |
| Deliberately denied product permissions | `1443f0fa-5a64-4e09-9916-29fce1e7db20` | Admin suite failed with actual HTTP 403; original cloned capabilities restored. |
| Client dashboard | `40475eb5-8249-49ac-afae-2dc2a78e647e` | Actual dashboard and widgets rendered; disposable clone removed. |
| Complete durable plan | `695c708a-d17c-4d87-a147-36732c14a8cf` | Reviewed with thirteen assigned checks covered; defects correctly prevent a passing pilot. |
| Supplemental keyboard/receipt plan | `c0afa4cc-0566-4c8c-8b32-68ad27a8c582` | Customer/dashboard and Chromium keyboard/receipt checks passed; Firefox exposed a forward-only traversal limitation, preserved in the original report. |
| Corrected Firefox keyboard checkout | `054d100a-9893-43dd-97eb-3044f2e7fa71` | Eight states passed with keyboard verification, order/stock readback, admin completion and cleanup; clone destroyed. |

All writes target verified disposable functional clones. Trusted WordPress readback skips candidate themes, uses unique fixture identities and verifies scoped cleanup. Source digest checks fence the original candidate before/after execution. Raw screenshots, DOM, mail and diagnostics remain private; run identifiers are local evidence references.

## Aggregate findings and runner corrections

The full job found a real missing empty-search notice in both engines. The account password-visibility control (`.show-password-input`) fails automated WCAG target-size checks at desktop/mobile sizes; home and shop passed. Product/category/image/variation administration, accounts and Firefox checkout passed.

Chromium checkout encountered a runner response-body eviction race during immediate navigation. The controller now copies the scoped checkout receipt before delivering it to the browser. Immediate-redirect regressions pass in Chromium and Firefox; this avoids relying on an evicted CDP response body. The original aggregate result is preserved unchanged. The supplemental durable job verified this path in Chromium plus account/dashboard keyboard traversal. Its Firefox failure was reproduced on a plain form: forward Tab traversal beyond the document did not return to an earlier field. The helper now chooses Tab or Shift+Tab toward the target without direct focus calls. Both engines pass reordered-field and deliberate-trap regressions, and corrected Firefox native run `054d100a-9893-43dd-97eb-3044f2e7fa71` passed. Diagnostic run `14c423ba-779c-4713-a943-372928ae0678` and the original aggregate/supplemental failures remain unchanged.

WooCommerce legitimately redirects a single-result search to its product. A protected expected destination now permits that behavior while still requiring observation of the actual submitted GET query. The no-results expectation remains intact. Unavailable variations may be omitted or disabled; the suite verifies they cannot be purchased and separately verifies an available choice.

## Verification and limits

`npm run check` passed TypeScript, the unchanged 94-file/three-archive baseline, 28 static checks, ten Iran helper cases, nineteen Python tests and PHP build-probe validation. Twelve sequential focused regressions passed navigation/search/filter/mobile-menu/keyboard, correlated form persistence and false-success rejection, accessibility positive/negative/redirect cases, missing-gateway blocking, task-directed login and durable functional-job ownership/cancellation/stale-worker/hash/usage guards. Two additional admin-guard/binary-upload regressions and two cross-engine immediate-redirect receipt regressions passed. Two cross-engine traversal/trap regressions and three login/form/sink regressions passed after the traversal correction.

The tested payment profile is COD; BACS is supported by the schema but has no native acceptance claim. External gateways without a supported sandbox adapter/credential remain blocked. WebKit's binary downloaded but required host shared libraries are missing; selecting it does not silently pass. Arbitrary form persistence backends require protected adapters; the implemented form oracle verifies actual correlated mail sink persistence. Automated accessibility and scoped keyboard checks do not claim exhaustive assistive-technology coverage.

Part 10 must repair site defects, publish a new immutable candidate, retest affected areas and run the full final suite. Delivery/fresh-host restore remains Part 11. All existing reports retain `releaseEligible: false`.
