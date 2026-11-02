# Automatic WordPress prototype builds

Part 7 adds a durable builder behind the existing owned API/CLI. It takes a completed immutable intake, supplied page/product content and owned assets. It records the design, theme bundle, instruction hashes, environment, content/media manifest, model usage, candidate commit and initial verification evidence.

The state sequence is `queued → designing → provisioning → preparing → building → verifying → prototype_ready`. A supplied design from the same intake skips a new design call. The builder inherits that design's exact skillset and selected calibration profile. Unknown usage, changed input/instructions, failed setup, exhausted budgets and failed checks stop at `needs_review`. Cancellation drains the child agent before declaring the build cancelled. A controller restart reuses recorded child operations and the allocated environment.

Build token totals cover that build's child-agent runs. A reused design's earlier usage remains in its original agent record; include those separate records when assessing total project usage. Failed requests with unknown usage remain unknown and cannot establish an accurate monetary total.

For the saved local pilot, `node --import tsx tools/run_build_pilot.ts --retry` explicitly starts a new build from its completed design after a cancelled/review-needed attempt. It preserves prior build IDs, refuses an active or successful build, and grants a fresh bounded allocation. Running without `--retry` only watches the saved build.

Create a build with `npm run controller:cli -- build:create --file build.json` or `POST /v1/builds`. A representative input is:

```json
{
  "intakeId": "COMPLETED_INTAKE_UUID",
  "content": {
    "siteTitle": "Client shop",
    "synthetic": false,
    "currency": "IRR",
    "pages": [
      {"path": "/", "title": "Home", "kind": "home", "content": "<p>Supplied client introduction.</p>"},
      {"path": "/shop/", "title": "Shop", "kind": "shop"},
      {"path": "/cart/", "title": "Cart", "kind": "cart"},
      {"path": "/checkout/", "title": "Checkout", "kind": "checkout"}
    ],
    "products": [
      {"key": "client-product", "name": "Client product", "price": "650000", "stock": 12, "imageAssetId": "OWNED_ASSET_UUID"}
    ]
  },
  "agentLimits": {"maxRuntimeMs": 600000, "maxObservedTokens": 600000, "maxToolCalls": 50, "maxArtifactBytes": 67108864},
  "maxRuntimeMs": 3600000,
  "maxObservedTokens": 1500000
}
```

Upload media through `asset:upload` and include its ID in the intake before building. Build assets must belong to that project and intake. Raster images and WOFF2/TTF fonts are supported by the initial runtime importer. SVG/PDF uploads can be reference inputs but are not executable runtime media imports. Products support stock and a simple product or one variation attribute with multiple options. Prices for those initial variations share the supplied product price.

The trusted setup creates real WordPress pages and WooCommerce products, preserves the administrator and records IDs. Media import verifies bytes and provides stable attachment paths/IDs across retries. Layout lives in child source; agent-authored Site Editor database overrides are rejected. Demo builds enable clearly labelled test payment/shipping through the commerce runtime. A non-demo build still needs its actual payment/shipping configuration and later functional certification.

Inspect with `build --id BUILD_UUID`; cancel with `build:cancel --id BUILD_UUID`. API equivalents are `GET /v1/builds/:id`, `POST /v1/builds/:id/cancel` and owned artifact downloads at `/v1/builds/:id/artifacts/:artifactId`. Authenticated preview links and credentials stay in private runtime/API results.

Initial verification checks the exact candidate source, supplied products/prices/stock/media, preserved administration, required desktop/mobile routes, visible content, horizontal overflow, a real product/cart action and search when selected. Its report always says `releaseEligible: false`. Independent visual QA, full commerce/admin testing, repair gates and export/restore are Parts 8–11.

Current prototype scope is the certified MainTheme family, Persian or English, content pages and the `commerce`, `search` and `accounts` features. Accounts require a supplied account page. Contact forms, filters and blog ingestion currently return `build_feature_not_supported` rather than silently omitting requested functionality. Additional integrations need their implementation and protected checks before this build profile can accept them.

The fixed native-provider pilot is [fixtures/part-7-pilot.json](../fixtures/part-7-pilot.json). Run it explicitly with `node --import tsx tools/run_build_pilot.ts` against the running local API. It uses the configured Codex account, with a bounded two-million-observed-token total allocation and unknown monetary cost. The script creates two original code-rendered typographic artworks using the bundled licensed font, uploads them as merchandise images, submits a clearly synthetic Persian shop brief and starts the normal build API. It preserves its private state and watches the same build when rerun; it does not automatically spend another allocation after a terminal failure. Evidence and authenticated preview details are under `.runtime/controller/part-7-pilot/`. A started pilot is not a successful build; consult its actual terminal status and report.
