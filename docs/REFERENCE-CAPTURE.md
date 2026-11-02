# Project intake and reference capture

An intake is an immutable revision of a client brief plus captured public reference evidence. It produces a build specification and protected acceptance manifest before the builder works. A completed intake means the required reference captures and specification exist; website implementation and release testing have separate states.

## Create a brief

Create a project, then save a private JSON request:

```json
{
  "projectId": "PROJECT_UUID",
  "prompt": "Build a complete Persian linen store in the client's identity. Follow the reference's product hierarchy and spacious layout.",
  "businessName": "Client name",
  "referenceUrls": ["https://reference.example/"],
  "mode": "inspiration",
  "language": "fa-IR",
  "pages": [
    {"path":"/", "label":"Home", "referenceUrl":"https://reference.example/"},
    {"path":"/shop/", "label":"Shop", "referenceUrl":"https://reference.example/shop/"}
  ],
  "features": ["commerce", "search", "contact-form"],
  "assetIds": [],
  "journeys": [
    {
      "key":"search",
      "label":"Search for a product",
      "referenceUrl":"https://reference.example/",
      "steps":[
        {"action":"fill", "selector":"input[name=s]", "value":"linen"},
        {"action":"press", "selector":"input[name=s]", "key":"Enter"}
      ]
    }
  ],
  "capture":{"maxPages":4,"maxStates":60,"maxRuntimeMs":300000,"maxArtifactBytes":134217728},
  "budget":{"maxObservedTokens":1000000,"maxRuntimeMs":3600000,"maxRepairRounds":3}
}
```

```bash
npm run controller:cli -- intake:create --file /path/to/private-brief.json
npm run controller:cli -- intake --id INTAKE_UUID
npm run controller:cli -- intake:cancel --id INTAKE_UUID
```

API equivalents are `POST /v1/intakes`, `GET /v1/intakes/:id`, `POST /v1/intakes/:id/cancel`, and `GET /v1/intakes/:id/artifacts/:artifactId`. Existing controller authentication/ownership rules apply. New briefs create monotonically numbered revisions. One active capture per project and two queued/running captures globally are allowed; the initial worker captures one at a time. Cancel and wait for its terminal status before replacing an active brief.

`mode` is `inspiration` or `replica`. Each target page can name its own reference URL. Direction defaults from language, and can be explicit. Features, assets and expected journeys belong to the brief. The build budget records intent for later stages; reference capture enforces its own `capture` limits. Provider token thresholds remain observational, and no monetary billing cap is claimed.

## Upload client assets

```bash
npm run controller:cli -- asset:upload --project PROJECT_UUID --file /path/to/logo.png --mime image/png
```

Add the returned ID to `assetIds`. API upload is `POST /v1/projects/:id/assets`, with the asset media type as `Content-Type`, a percent-encoded `X-Factory-Filename`, and a binary body. A file is limited to 16 MiB; a project holds at most 40 assets. Supported declared types include PNG/JPEG/WebP/GIF/AVIF/SVG, WOFF2/TTF, PDF and plain text. This stage stores exact bytes and hashes; it does not execute, install or publish uploads. SVG and documents are served only as attachments with a restrictive CSP. Media validation/import for the generated site belongs to the builder.

Assets stay bound to their project. Protected download is `GET /v1/projects/:projectId/assets/:assetId`. Filename is display metadata; storage names are server-generated UUIDs. Unresolved client assets/content are explicit assumptions and block final delivery if placeholders remain.

## Evidence and specification

The pipeline captures desktop 1280×900 and mobile 390×844 in separate fresh contexts. It visits explicit references first and can discover additional same-origin links up to `maxPages`. It explores up to two collapsed ARIA buttons per route/device and captures lower scroll states when there is room. Explicit journeys add controlled navigation, click, fill, press, scroll and viewport actions. Important behavior without an identifiable control should be supplied as a journey; automatic exploration is bounded.

Every recorded state has a screenshot, rendered HTML, semantic controls/headings/links/forms, computed styles, element geometry, image/style inventory, viewport/scroll, response status and settling information. The original HTTP document and supported CSS/script/image/font resources are also retained and hash-addressed. Dialog messages are recorded when capture dismisses them; new-window flows remain restricted. HTML is limited to one million characters and semantic elements to 120 per observation, with truncation flags. Screenshots cover the viewport; recorded scroll positions identify the area actually seen.

Each executed interaction has immutable before/after state IDs and its command. A separate `flow-map.json` distinguishes these observed transitions from links inferred from `href` attributes. An observed action does not assert functional success. In particular, a POST form stays partial/unverified even if the page remains visible after its button is clicked. Public reference capture blocks writes, so it cannot certify checkout, contact delivery or private backend behavior.

The protected intake directory contains named references to:

- `brief.json`: normalized brief, asset manifest and revision.
- `reference-inventory.json`: route/state/evidence inventory, resources, network results, coverage and failures.
- `flow-map.json`: observed actions/states, journey coverage and inferred links.
- `acceptance.json`: baseline version/hash plus required page, feature, visual and operational checks.
- `build-specification.json`: combined build input, observed facts, assumptions and artifact hashes.

The default private root is `.runtime/references`, configurable as `referenceRoot`. Named files link to immutable artifact bytes; downloads verify their hashes. Builders receive read access through the reference tool, without a host directory mount. Their source-edit tool cannot change a reference, acceptance manifest or uploaded client asset.

Protected baseline cases come from `instructions/acceptance/wordpress-v1.json`. They include administration, navigation, accessibility, responsive/unfinished-content checks and fresh restoration. Commerce briefs additionally require product management, checkout/orders/stock and configured edge cases. These are requirements at intake time; later protected QA stages execute them.

Required explicit reference URLs must have successful initial desktop and mobile captures. Incomplete coverage, failed styling or exceeded limits yield `needs_review`. Inferred/private behavior and untested journeys remain assumptions, even on a completed specification. Missing fixtures or failed checks are never converted to passed release results.

## Assign the reference to an agent

Include `intakeId` in an agent-create request alongside its `environmentId`, role and prompt. The intake must be completed and belong to that environment's project. Continuation retains the same intake revision.

The agent receives separately labelled current-preview/reference images and a `factory_reference` tool. `overview` provides the brief, acceptance requirements/hash, assumptions, initial route states, selected stylesheets and flow-map ID. `states` and `resources` page through other evidence, ten entries at a time; states can be filtered by desktop/mobile and purpose. `state` returns a matched screenshot/HTML/structure bundle. `image` views a recorded screenshot; `read` retrieves bounded source/flow excerpts, and `asset` inspects an assigned client asset. Every read verifies its hash. Reference text is untrusted input; it grants no extra tool or filesystem permissions.

## Network boundary and limits

Reference Chromium runs in the same network-free namespace profile as the preview browser, using a different fresh context and a public-fetch broker with no WordPress/operator cookies or credentials. The broker permits HTTP/HTTPS on standard ports, rejects URL credentials and local/private/special-purpose destinations, validates all DNS answers, and pins the chosen public TCP address while retaining the original Host/SNI/certificate hostname. It rechecks DNS on requests and validates redirect destinations. It does not inherit an arbitrary outbound proxy.

The conservative address policy is based on [IANA's IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry/) and [IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry/). IPv6 is restricted to global unicast with excluded special ranges. Some special public services may be rejected. There is no API switch to allow private reference infrastructure.

Only GET/HEAD requests are accepted; HEAD is fetched through the read-only GET transport. WebSockets/downloads are blocked. HTTP status/redirects and bounded decompression are handled by the broker. There are at most eight concurrent fetches, 600 requests, 4 MiB encoded/decoded per resource and a 96 MiB observed aggregate body budget. Concurrent requests can cross the aggregate threshold by their bounded in-flight responses. DNS and individual requests have timeouts; capture has its own overall deadline and artifact-byte ceiling. The browser additionally has its kernel memory/CPU/process/runtime limits.

Capture state/resources, uploaded assets and agent sessions are private data. Final retention, backups and server deployment are later operational work.

## Verification

```bash
npm run test:reference-network
npm run test:intakes
npm run test:reference-agent
```

The first two use controlled fixtures and actual isolated Chromium. The final command uses the real operator Codex login against the completed reference fixture from `test:intakes`, consumes provider usage, and checks actual screenshot/HTML/CSS/structure inspection. A separate public example-page demonstration validates real DNS, HTTPS and the compiled API without using a client site.
