# Website Factory — project plan

Prepared 2026-11-02. Architecture document; see [PROGRESS.md](PROGRESS.md) for implementation and verification status.

Detailed implementation sequence: [numbered build order, Parts 1–15](BUILD-ORDER.md). Use those part numbers for implementation; the milestones below group the same work at a higher level.

## 1. Product and scope

Build a private system running on your server that turns a reference website and a client brief into a complete, tested client website. WordPress using Maintheme 0.4.0 is the primary output; Next.js is a later, separate output profile.

You build the finished website for the client. The client uses their own hosting and domain and manages products, orders and normal website operations. A page builder or a new layout-editing interface is not part of the default requirement. Existing WordPress administration remains available; additional controls are built only when the client brief requires them.

The normal workflow is:

```text
Reference URL + client brief + assets
                    |
           Capture and specification
                    |
         Art direction and site plan
                    |
      Build in isolated WordPress staging
                    |
       Independent visual review first
                    |
    Functional, admin and commerce testing
                    |
          Defects -> repairs -> retests
                    |
     Package -> restore on fresh installation
                    |
       Complete site + clean child theme
                    |
       Your review -> client-host handoff
```

The system should operate automatically inside the agreed brief. It asks for input only when a decision or missing dependency prevents completion, or when it reaches its repair/budget limit. Production migration is a separate, explicitly initiated action after reviewing the result.

Two design modes must be explicit:

| Mode | What the system should preserve | How it is judged |
|---|---|---|
| Inspiration | Selected layout ideas, atmosphere, hierarchy or interaction patterns; use the client's identity and content | Client brief, recorded design direction and usability |
| Close replica | Specified pages, geometry, typography, imagery treatment and visible interactions | Corresponding reference captures at matching sizes and states, plus functional requirements |

Allow exceptions by page or section: for example, reproduce the home page closely but redesign the product page. A public reference does not reveal private backend behavior; specify commerce and administration requirements independently. “1:1” must name its scope instead of implying every unseen part of the source site.

## 2. What your existing MainTheme provides

I inspected the local release at `/home/arash/Downloads/Maintheme-0.4.0` and source at `/home/arash/compmelli-work/maintheme-src`. The three ZIP checksums match between those locations. The source/package font-license discrepancy should be reconciled before creating the factory's canonical release.

Maintheme 0.4.0 already supplies:

- A Persian-first, RTL WordPress block theme with templates, template parts, patterns and `theme.json` tokens.
- A small child-theme starter and documented extension hooks.
- WooCommerce presentation and a separate Iran Commerce plugin for address/phone/postcode behavior.
- A settings schema, starter-page hooks, and a substantial launch checklist.

The factory should extend that contract: tokens first, small child CSS next, selective template-part overrides, and full template overrides only when needed. Parent styles already load before child styles. Shipping, gateways, order behavior and stock logic stay in WooCommerce or dedicated plugins. Storefront templates must render actual WooCommerce products and state, so products the client adds later automatically use the finished design; static product-card mockups do not satisfy delivery.

Important findings for implementation:

1. The release's test report explicitly says it was not booted in a real WordPress/WooCommerce environment. Certify the parent in a live test environment before relying on generated clients.
2. Both test utilities contain a hardcoded `/mnt/data/maintheme-v4-work` path. Make them portable.
3. Database-saved Site Editor templates take precedence over theme files. A preview can look correct while the exported child theme lacks its actual layout.
4. Starter content includes placeholders, including a contact-form placeholder. Replace these with real content and integrations.
5. The starter pattern loader reads the parent patterns directory. A child-only pattern name is not automatically a working installation path; use the documented starter-page content hook or deliberately extend the loader.
6. Custom settings are extensible but rich controls and new settings sections need explicit implementation. Do not assume any desired admin UI appears just by adding schema entries.

Local evidence: [child-theme contract](/home/arash/compmelli-work/maintheme-src/source/maintheme/docs/CHILD-THEMES.md:18), [developer API](/home/arash/compmelli-work/maintheme-src/source/maintheme/docs/DEVELOPER-API.md:3), [runtime testing gap](/home/arash/compmelli-work/maintheme-src/TEST-REPORT.md:24), [launch checklist](/home/arash/compmelli-work/maintheme-src/source/maintheme/docs/QA-CHECKLIST.md:3).

## 3. Server architecture

Use a small application to control jobs, with skills as versioned instruction packages inside it. Skills can describe good work; the application must enforce budgets, access, stage order, evidence and release eligibility.

Proposed initial stack:

| Part | Choice and responsibility |
|---|---|
| Controller | TypeScript/Node service; validates briefs, advances stages and authorizes tools |
| Persistent state | PostgreSQL for projects, requirements, attempts, findings and release records |
| Queue | pg-boss, using the same PostgreSQL installation |
| Execution | Separate Linux sandbox workspaces and WordPress databases per project/attempt; the first backend uses bubblewrap/systemd user services |
| Browser verification | Playwright, screenshots, traces, accessibility checks and controlled test inbox |
| Artifacts | Project directories initially, with an interface that can later use object storage |
| Source history | Git repository per client; immutable commits for test candidates |
| Operator access | CLI/API first; small authenticated dashboard once the pipeline works |

This avoids a separate Redis service for the initial queue. pg-boss supports persisted work and retries, but stage code must still tolerate repeated execution. [pg-boss introduction](https://pgboss.io/introduction)

Part 3 uses a rootless Linux backend because this account cannot access a Docker daemon. It preserves the separate files/database/preview boundary without requiring host privileges. The existing Docker Compose file is a baseline fixture; a multi-environment Docker backend remains unimplemented. See [runtime setup and limits](ENVIRONMENTS.md).

Persist transitions rather than keeping the workflow in an agent conversation:

```text
queued -> capturing -> specifying -> designing -> building
       -> visual_qa -> functional_qa -> packaging -> restore_test
       -> ready_for_review -> delivered

QA failure -> repairing -> new immutable candidate -> QA
Other states: needs_input, needs_review, failed, cancelled
```

Each stage records its input hashes, output artifacts, attempt ID, heartbeat, model/session, usage and error. Use locks and attempt fencing so an expired worker cannot overwrite a newer result. Setup/import stages must be idempotent. Retry temporary infrastructure failures separately from design repair rounds.

Start with one active project. Measure browser/WordPress memory, disk and CPU usage on the pilot before choosing production concurrency and server size. Models run through external services initially; local model hosting is a separate infrastructure project.

## 4. Provider adapters

Keep provider-specific execution behind one interface. Do not assume changing an API base URL produces an equivalent coding agent.

| Adapter | Proposed integration |
|---|---|
| Codex | Noninteractive CLI for the first adapter, or the Codex SDK when tighter session control is useful |
| Claude | Programmatic CLI or Claude Agent SDK |
| DeepSeek | API adapter with a tool execution loop owned by this system |
| Additional providers | Add after passing the same capability and reliability checks |

Codex exposes machine-readable events and schema-based final output for automation. Claude provides programmatic execution and an SDK. DeepSeek tool calls request external execution; your application still supplies filesystem, browser and command tools. [Codex automation](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Claude programmatic execution](https://code.claude.com/docs/en/headless), [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls/)

The normalized adapter input includes role, task, skill version, brief/artifact paths, workspace, candidate revision, tool permissions, credential references and limits. Output includes status, session ID, changed revision, artifacts, usage and structured findings. Support cancellation and resumption explicitly.

Register capabilities per configured model: image input, file changes, shell, browser access and reliable structured output. Run a smoke test before enabling it for a role. Route screenshot criticism only to a model verified to consume images. Capability support may differ within a provider; for example, DeepSeek documents image input for a specific model family. [DeepSeek vision](https://api-docs.deepseek.com/guides/vision/)

Use supported server authentication for each adapter and record account limits. Avoid making availability or price assumptions from a personal subscription. Choose default models by running a small benchmark on your own site tasks, comparing quality, repair count, cost and time.

## 5. Job input and persistent specifications

Keep the user-facing input small, but compile it into an explicit specification before building.

Required or defaultable fields:

- Client/project name, WordPress or Next.js, reference URLs and inspiration/replica mode.
- Required pages, sections, interactions and features; list what is intentionally out of scope.
- Brand assets, content, image sources, language, RTL/LTR and currency conventions.
- For stores: product types, filters, account requirements, shipping, payment gateway and expected order flow.
- Target hosting capabilities, new website versus replacing an existing site, and known plugin constraints.
- Provider choices, time/cost limits, repair limit and review preferences.

Record assumptions separately from facts. Missing client content can use clearly marked draft content during development, but unresolved placeholders block the final release. Do not invent business claims, prices or credentials.

Every job produces:

```text
brief.json             User intent, assumptions and constraints
reference/             Captures, route inventory and observed behavior
DESIGN.md              Visual direction, tokens and reference departures
acceptance.json        Required pages, states, journeys and evidence rules
dependencies.json      Exact parent/plugin/runtime versions and hashes
source/                Generated client source
evidence/<candidate>/  Screenshots, traces, logs and test results
delivery/              Restorable website, child ZIP and handoff files
```

The acceptance manifest is created before the builder starts. Each requirement gets an ID, scope, importance and verification method. Later scope changes create a new manifest revision and invalidate affected evidence.

## 6. Agent roles and design skills

Use separate roles with explicit outputs. They can share a provider; independence comes from separate context and permissions, with another provider available as an optional second opinion.

1. **Reference analyst:** browses the source, captures pages and important states, records layout and responsive transformations, and separates observations from guesses.
2. **Design director:** turns the client brief and reference evidence into a coherent design specification, including typography, spacing, imagery, grid and interaction rules.
3. **Builder:** implements the site and publishes a candidate revision. It reads defect reports and repairs the site.
4. **Visual critic:** inspects rendered screenshots and interactions against the specification, with exact locations and evidence for defects.
5. **Functional/admin tester:** exercises the real website and WordPress operations and submits reproducible findings.
6. **Release controller:** deterministic application code that evaluates gates, packages artifacts and verifies restoration.

Create versioned skills such as `reference-analysis`, `client-art-direction`, `maintheme-child-build`, `visual-critique`, `wordpress-operations-qa` and `site-release`. Use Impeccable's distinction between design criticism and technical auditing as the starting point. Pin the skill version and adapt its workflow for a server job with a complete supplied brief. Do not rely on a skill being automatically discovered by every coding runtime.

The anti-slop strategy is an explicit design direction plus enforced review:

- Define a client-specific visual identity and concrete references before coding.
- Document type scale, layout rhythm, content density, image treatment and component behavior.
- Detect repeated shortcuts: random gradients, indiscriminate rounded cards, inconsistent spacing, generic claims, dummy buttons and decorative sections with no client purpose.
- Review actual screenshots, including Persian typography and mixed RTL/Latin content.
- Treat style-detector hits as evidence to inspect, not a universal rule that overrides the client's reference.

A strict replica may legitimately contain patterns a generic anti-slop checklist dislikes. Fidelity requirements take precedence over stylistic preferences unless a documented functional/accessibility issue needs resolution. There is no reliable universal “AI slop score,” and an instruction file cannot guarantee good taste.

## 7. Building while another agent tests

Support continuous review without letting QA inspect files that change underneath it.

The builder completes a slice, such as header/navigation plus home page, and commits a candidate. The controller creates a separate preview from that revision. QA reviews that preview while the builder continues on the next slice. Findings always identify the tested revision and state. Keep reusable layout in child-theme source and deliberately export any Site Editor layout changes; ordinary pages, media and store data belong in the versioned setup/backup artifacts rather than undocumented preview-only database state.

During development, prioritize visual feedback first, then interaction and administration checks. The final candidate must pass the complete agreed suite after all repairs. Early passing results do not certify later code.

The builder cannot change protected acceptance tests, reference captures, approved visual baselines or release rules. QA may mutate its disposable WordPress database to test administration, but cannot change the candidate source or mark its own exceptions accepted. The controller runs protected checks and stores their output outside the candidate's writable filesystem.

## 8. Harsh visual and responsive QA

Use three distinct evaluations:

- **Reference fidelity:** compare corresponding captures in replica mode; record intentional deviations.
- **Design quality:** inspect hierarchy, typography, spacing, imagery, consistency and whether the result serves this client.
- **Regression:** protect an accepted candidate from accidental visual changes during repairs.

A screenshot diff does not decide whether an original design is good. Keep baseline creation separate from baseline approval, and never let repairs silently regenerate the expected images. Use a pinned browser/font environment for comparisons. [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)

Proposed matrix:

| Coverage | Sizes and cases |
|---|---|
| Every candidate | All required routes at 390×844 and 1440×900 |
| Release stress | Critical routes at 320×568, 768×1024, 844×390, 1024×600 and 2560×1080 |
| Breakpoints | Width sweep on representative pages, including breakpoint −1 and +1 px |
| Browsers | Full Chromium suite; important journeys in Firefox and WebKit |
| Content stress | Long titles, missing images, empty/many products, mixed RTL/Latin and large prices |
| User settings | Keyboard navigation, 200% zoom and reduced motion |

Capture full pages and scrolled viewport states. Exercise menus, sticky headers, modals, product galleries and floating contact controls; unusually short viewports expose failures a normal desktop capture misses. Test touch behavior separately from layout. Browser emulation is not a claim of physical-device testing. [Playwright emulation](https://playwright.dev/docs/emulation)

Each visual finding identifies requirement, route, viewport, state, severity, expected/actual result and screenshot. A hidden purchase button on a short screen is a release blocker even if the rest of the page looks excellent.

## 9. Website, admin and commerce QA

Verify outcomes, not just clicks or an agent's statement that it tested something.

**Whole website:** real navigation destinations; working search/filter/pagination; actual contact submission into a test inbox; useful validation; keyboard-operable menus/dialogs; no unexpected PHP/JavaScript errors, broken local assets or unresolved placeholders. Check headings, metadata, internal links, performance budgets and accessibility in important states. Automated accessibility checks supplement keyboard/manual review; they do not establish complete accessibility.

**Client operations:** use the role the client will actually receive. Add a simple product and a variable product; set categories, attributes, images, price, sale and stock; save; log out/in; verify the resulting storefront. Edit and unpublish a product. Confirm order visibility/status management, account access, media management and other operations promised in the brief. Test persistence and relevant cache invalidation.

Do not build or test a bespoke page-layout editor unless the client needs one. The key administration acceptance test is that ordinary product/order management genuinely works without developer intervention.

**Commerce:** exercise product types, unavailable variations, out-of-stock behavior, quantity changes, coupons, shipping fixtures, address validation, guest/account checkout as required, payment success/failure/cancellation/return, and the resulting order totals/status. Check Persian/Arabic digits, phone normalization, postcode and configured Rial/Toman display where relevant. Both classic and block checkout need testing if the project claims support for both.

Use isolated staging, gateway sandbox credentials and blocked or redirected email/SMS/fulfillment/webhook effects. WooCommerce notes that test orders may trigger ordinary integrations; gateway test mode alone is insufficient. [WooCommerce testing orders](https://woocommerce.com/document/managing-orders/testing-orders/)

Missing real integration credentials produce a blocked check with a clear reason. A fake gateway can verify local order flow but cannot establish compatibility with the client's actual bank gateway.

**Code/package integrity:** portable PHP/JSON/block validation, no parent modifications, correct child dependency, no duplicated parent stylesheet, no production secrets or development junk in delivery, and no business logic misplaced in the child theme. Test a declared WordPress/PHP/MainTheme/plugin matrix instead of claiming universal compatibility.

## 10. Repair loop and release rules

Use structured defect records, for example:

```json
{
  "requirement": "checkout-submit-visible",
  "candidate": "<commit-sha>",
  "severity": "P1",
  "route": "/checkout/",
  "viewport": {"width": 844, "height": 390},
  "steps": ["Fill a valid checkout", "Open order summary"],
  "expected": "Payment action remains reachable",
  "actual": "Sticky overlay prevents reaching the payment action",
  "evidence": ["screenshots/checkout-short-height.png"]
}
```

Start with a maximum of three repair rounds plus configurable time/token/cost limits. After a repair, rerun affected checks and related regressions; run the full release suite against the final artifact. Repeated unresolved defects or exhausted budgets move the job to `needs_review` with the best candidate and evidence preserved.

Release eligibility requires:

- Every required acceptance case passed with evidence; required blocked cases stop release.
- No unresolved P0/P1 defects; remaining minor issues resolved or explicitly accepted by you.
- Visual direction and replica-specific requirements satisfied; no aggregate score can hide a broken critical page.
- Exact delivery artifacts restored successfully in a new environment.
- Evidence bound to candidate SHA, artifact hashes, dependency versions, fixture version and acceptance-manifest revision.

Track flaky cases explicitly. “Passed on retry” must not quietly erase a recurring failure. Coverage means coverage of the agreed website, not a promise to test all WordPress behavior or eliminate every possible bug.

## 11. Complete website delivery and client hosting

The client receives a finished website. The clean child theme is an essential source artifact, but its ZIP alone does not include pages, media, menus, saved configuration and other database content.

Produce a delivery bundle containing:

```text
client-site/
  client-child-theme.zip
  site-backup/             Database + required themes/plugins/uploads
  setup/                   Restore/setup manifest and portable procedure
  dependencies.json        Versions, checksums, licenses/configuration needs
  QA-REPORT.html           Coverage, screenshots, known limits and evidence
  HANDOFF.md               Hosting installation, client operations and rollback
```

Include only redistributable plugin packages; list client-supplied licenses and activation requirements separately. Keep credentials out of the downloadable bundle and provision final admin access securely. Strip disposable accounts/test orders and rebuild the final deliverable, then test that exact revision. Set environment-specific keys, salts and database credentials during installation.

For a new site, restore the exported bundle into a fresh database and a different hostname. Verify URLs, media, permalinks, admin login, products, checkout and ordinary management. Use serialization-aware database URL replacement rather than raw text replacement. [WP-CLI search-replace](https://developer.wordpress.org/cli/commands/search-replace/)

For an existing live store, use a separate migration profile: preserve live products, orders, customers and uploads; back up first; deploy compatible code plus targeted content/config changes. Never replace an active store database with the staging database. This is different from installing a new website.

Prepare a host preflight: PHP/database compatibility, HTTPS, upload/disk limits, file permissions, cron, mail, caching and required extensions. Support a documented manual/control-panel handoff when SSH or WP-CLI is unavailable. A bundle tested on the factory server still needs a host-specific smoke check after migration. WordPress documents the distinct migration and URL-change steps. [WordPress migration](https://developer.wordpress.org/advanced-administration/upgrade/migrating/)

After your deployment decision, apply the reviewed release, verify the real domain, supply client administration access and retain a rollback. Do not leave staging noindex rules, sandbox checkout settings or test mail routing active on production; enabling real integrations belongs to the deployment procedure, not the automated test worker.

## 12. Isolation and operating limits

These controls belong in the controller/runtime, not only in prompts:

- Separate client files, databases, credentials and preview access.
- Mount the pinned parent read-only; generated child source is the writable theme area.
- The trusted runner controls isolated environments; agents never receive the Docker socket or production credentials.
- Separate external reference browsing from authenticated WordPress admin sessions.
- Restrict URL capture to public destinations, including DNS/redirect checks, so supplied URLs cannot reach internal services.
- Treat reference-page text as untrusted material, never as tool instructions.
- Keep provider credentials behind a broker/proxy where possible; do not expose them to generated application scripts.
- Enforce CPU, memory, disk, process, runtime, API usage and repair caps.
- Back up job state and artifacts; expire disposable environments with a defined retention policy.

## 13. Implementation milestones

The estimates below are planning assumptions for one experienced developer working with AI assistance. Validate them after the first complete pilot; custom gateway/plugin work and client asset delays can extend them.

| Milestone | Concrete deliverable | Exit condition | Initial effort |
|---|---|---|---|
| 0. Certify MainTheme | Canonical 0.4.0 source/package, portable validators, bootable WP/Woo fixture | Parent installs; navigation, product and basic sandbox order work | 2–3 days |
| 1. One complete pipeline | URL + brief -> one provider -> full small WP site -> restorable bundle | Fresh-hostname restore reproduces the candidate | 4–6 days |
| 2. Design and independent QA | Versioned skills, protected acceptance manifest, visual critic, defect/repair loop | Injected layout and functional failures are caught | 4–6 days |
| 3. Store operations | Product/admin/checkout suites, Persian edge cases and configured gateway adapter | Ordinary client operations and required sandbox journeys pass | 4–6 days |
| 4. Usable WordPress v1 | Minimal authenticated dashboard, pause/cancel/resume, evidence viewer, handoff and retention | Three different client-style pilots meet release gates | 3–5 days |
| 5. More providers | Claude and DeepSeek adapters behind the same role contract | Each passes capability tests and a fixed benchmark | Estimate after v1 |
| 6. Next.js profile | Separate scaffold, content/data requirements, build/runtime and deployment bundle | Complete reference-to-restored-app pilot | Estimate separately |

That puts a useful WordPress v1 at roughly 17–26 focused development days under the stated assumptions. Add providers earlier only if one-provider availability blocks the pilot. If Codex is first, the next adapter can be Claude; DeepSeek follows once the system's own tool loop is ready. The architecture supports all of them from the beginning without requiring all implementations before the first useful result.

The dashboard only needs job creation, provider settings, progress/cost, preview, defects, evidence and download. Build those around real pipeline data. A polished management UI comes after the factory can deliver a real site.

Next.js shares reference capture, design specification, model adapters and browser QA. Its build, data storage, CMS requirements and deployment are separate from WordPress; do not force its runtime through a theme-based workflow.

## 14. First pilot and success measures

Choose one realistic store brief with client branding, a fixed reference and a bounded page set: home, shop/category, product, cart, checkout, account, about and contact as applicable. Use seeded simple/variable/out-of-stock products and one configured sandbox payment path. Keep all content and test data controlled.

The first end-to-end demonstration must prove:

1. A reference and brief produce a recognizably deliberate site in the requested mode.
2. The independent reviewer catches an intentionally introduced mobile layout failure.
3. Functional QA catches an intentionally broken purchase/form action.
4. A client-role user can add/manage products and inspect/manage a resulting test order.
5. Repairs produce a new traceable candidate without weakening tests.
6. The complete site restores on a fresh hostname using the exact delivered artifacts.
7. A worker restart resumes persisted progress, and a budget exhaustion ends honestly in `needs_review`.

Track your review time per website, first-pass acceptance, repair rounds, escaped defects, restore success, and total model/infrastructure cost per accepted site. The business target is less manual implementation and fewer post-handoff problems while retaining your control over the final client result.

The first implementation task is MainTheme runtime certification plus a complete one-provider WordPress build/restore pipeline. That proves the central product before expanding the provider list or adding Next.js.
