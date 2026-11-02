# Part 5 — intake and reference capture verification

Verified 2026-11-02 on the local Linux backend. **Part 5 is complete.** A URL and client brief now produce captured evidence, a route/state/flow map and a protected versioned build specification.

## Delivered behavior

The authenticated API/CLI accepts reference URLs, client prompt, inspiration/replica mode, target pages, features, language/direction, uploaded client assets, journeys and limits. Durable capture runs have revisions, leases, deadlines, cancellation, recovery, ownership and immutable artifact hashes.

A separate public-reference browser profile retains screenshots together with rendered HTML, semantic/form information, styles/geometry and before/after interaction records. It preserves original document/CSS/script/media resources and records visited routes, menus, scroll positions and supplied journeys. Href links are explicitly inferred possibilities, rather than successful navigation tests. The pipeline emits named `brief.json`, `reference-inventory.json`, `flow-map.json`, `acceptance.json` and `build-specification.json` artifacts.

The acceptance manifest combines protected WordPress/commerce baseline cases with the client's required pages, features and visual mode. It records the baseline hash/revision and separates observed facts from assumptions. Incomplete required capture or failed styling produces `needs_review`. Completed capture never grants release eligibility.

Agent tasks can bind a completed intake from the same project. The model receives labelled current/reference images and a read-only reference tool, with paginated catalogs and bounded screenshot/HTML/CSS/structure/flow access. Continuation retains that exact reference revision. References and acceptance files are outside child-theme edit access.

Commands, schemas, evidence semantics and limits: [reference capture documentation](REFERENCE-CAPTURE.md).

## Verification

Eight intake integration cases passed with actual isolated Chromium, no failures or skips:

1. Private asset upload/download preserved the original bytes, Unicode name and hash, rejected foreign-project access and enforced the 16 MiB bound. Downloads used attachment disposition and restrictive CSP.
2. A store brief captured three routes, desktop/mobile states, menu results, lower scroll views, HTML/CSS and a search journey. Every transition referenced recorded before/after states. The protected specification included assets, operational requirements, assumptions and stable hashes.
3. Missing pages or exhausted state coverage yielded `needs_review`, without a false completed specification.
4. Private URLs/DNS, unauthenticated/foreign access, invalid page budgets and cross-project assets were rejected.
5. Cancelling a running capture stopped its isolated browser and did not publish a specification.
6. Failed styling, altered artifact bytes, incomplete references and foreign project bindings failed closed.
7. An injected expired lease stopped/recovered the browser and prevented later specification publication.
8. Real agent queue/SQL records retained the intake revision through continuation and rejected an unavailable reference. This case checks binding/queue behavior; it does not claim another native WordPress build.

The final representative fixture recorded **46 states across three routes**. Search steps were observed; the contact journey remained partial with `reference_write_flow_unverified`. Its acceptance SHA-256 was `8ac7bc175a5f2cf61191e2f075abe204df5397e74dcb7b866f4159f54556ce34`.

Four network cases passed: alternate/private/reserved address encodings, mixed DNS and rebinding, redirect checks, write/request/resource limits, actual pinned TCP Host behavior and bounded gzip decompression. A catalog check passed for pagination, mobile filtering and rejected foreign artifact IDs. Six existing browser/provider cases and fourteen PostgreSQL controller regressions passed. TypeScript, compiled build, fourteen Python safety cases and the baseline/static/helper checks passed.

A real Codex check explicitly retrieved the mobile menu-result screenshot, its matching HTML/structure, a stylesheet and the flow-map artifact. It returned observed menu/search, partial contact and unknown private backend correctly. The final run reported 89,359 provider tokens, including 8,064 cached input tokens, with monetary cost unknown. This verifies actual image/source/flow inspection through the reference tool, without treating a model capability declaration as evidence.

The compiled API also completed a real capture of the public example.com page through DNS, HTTPS and isolated Chromium. Both required device captures were present; the downloaded specification hash was checked. The newer asynchronous DNS resolver was separately verified against that same public HTTPS endpoint. No client site, production account or checkout was used.

Private evidence/logs are under ignored `.runtime/controller/`, including `intake-tests-final.log`, `reference-integration-evidence.json`, `reference-agent-evidence.json`, `reference-agent-tests-final.log`, `reference-demo-result.json`, `part5-controller-regression.log` and `part5-check.log`.

## Findings and limits

A repeat test exposed a false reporting path: a blocked POST could leave the original page visible, allowing a completed button action to be confused with a verified submission. The capture now records restricted form intent, blocked navigation/popups and network failures. A deterministic same-page asynchronous form test proves that it remains partial even while HTTP 200 and the original UI remain visible. No outbound write was permitted by the network layer.

DNS now uses asynchronous c-ares queries rather than occupying the host's filesystem worker pool. Both address families are checked; TCP is pinned to a validated result, and redirects are validated. Conservative public-address policy can reject special public services. Private/authenticated references and arbitrary outbound proxies are unsupported.

Automatic exploration is bounded, with fixed initial desktop/mobile sizes, limited ARIA menu discovery, viewport screenshots and explicit HTML/element/resource limits. Unknown, private, new-window and unvisited flows are not claimed understood. The reference profile blocks writes, WebSockets and downloads. Admin, payment, stock and contact-delivery behavior must come from the client brief and later protected tests.

Uploaded bytes are stored, not installed or published. Final media sanitization/import, complete-site generation, independent QA, delivery and operational retention remain later parts. The first adapter still uses the version-sensitive native Codex login bridge described in Part 4. Next: package the design and MainTheme skills.
