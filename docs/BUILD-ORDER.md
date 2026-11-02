# Website Factory — numbered build order

Companion to [the architecture and project plan](PROJECT-PLAN.md). This is the implementation order; [PROGRESS.md](PROGRESS.md) records completed work.

Scope: you deliver a finished website. Clients manage products, orders and normal WordPress operations on their hosting. MainTheme/WordPress comes first; additional AI providers and Next.js follow the proven WordPress pipeline.

Every part produces a usable result and an explicit completion check. Keep the same part numbers in future implementation requests and progress reports. A part is complete only after its completion check passes; record blockers rather than silently reducing scope.

## Part 1 — Establish and certify the MainTheme foundation

Create the factory repository and record the initial WordPress output contract: complete website, clean child theme, dependency manifest and restorable content/media. Establish a canonical MainTheme 0.4.0 source/package with recorded checksums. Resolve the source/package discrepancy, make existing test utilities portable, and boot a representative WordPress/WooCommerce test installation.

Document the supported child extension points and plugin responsibilities. Verify the parent and starter child together, including RTL, representative product types and a basic controlled test order. Record the tested runtime/plugin versions.

**Complete when:** a fresh test installation runs the pinned parent and starter child, the baseline store journey passes, and known parent defects are fixed or explicitly block affected profiles.

## Part 2 — Build the durable server controller

Create the TypeScript service, PostgreSQL schema and durable queue. Define the shared job, provider and artifact contracts before implementing adapters. Store projects, stage transitions, attempts, requirements, artifacts, usage and failures. Implement cancellation, timeouts, heartbeats, retry policies and protection against stale workers committing results.

Define the role/tool permission model, credential boundary, project access rules and resource budgets now. Build the first CLI/API commands for creating and inspecting jobs. Use this development stack locally or on a development server; production factory deployment comes in Part 13.

**Complete when:** a sample multi-stage job survives a worker restart without duplicating effects, and cancellation/budget exhaustion produce an honest terminal or review state.

## Part 3 — Create isolated website environments

Automate the disposable setup used during Part 1: let the trusted controller create, start, snapshot and remove a WordPress environment for each client. Include its own database, uploads, Git workspace and protected preview URL. Mount the parent theme read-only and make the client child theme writable.

Separate reference browsing from authenticated WordPress testing. Keep the Docker socket and production credentials outside agent access. Configure controlled email/integration sinks and CPU, memory, process, disk and runtime limits. Add cleanup and retention.

**Complete when:** two test projects run with separate files/databases/access, and destroying one leaves the other intact.

## Part 4 — Connect the first coding agent

Implement the provider-neutral role/task interface, then one adapter, initially Codex unless availability suggests otherwise. Supply workspace, instructions, skills, capabilities and limits explicitly. Capture session IDs, events, usage, artifacts, errors and candidate commits.

Test image input and the actual tools needed by the assigned role. Implement process cancellation and session continuation without assuming the agent's last message proves success.

Browser capability must include paired screenshots and rendered HTML/DOM, useful computed styles and element geometry, and controlled navigation/click/fill/scroll/viewport actions. Preserve evidence before and after interactions so the agent can reason about UI structure and UX flows. Screenshot attachment alone does not establish this capability.

**Complete when:** the controller can ask the agent to make a small child-theme change, observe it in the preview, collect results, and stop or resume the run.

## Part 5 — Add project intake and reference capture

Accept the reference URLs, prompt, assets, page list, site features, language, inspiration/replica mode and budget. Capture corresponding reference pages at desktop/mobile sizes plus important menus, overlays and scroll states.

Produce `brief.json`, the reference inventory and a versioned acceptance manifest. Use protected baseline acceptance cases for WordPress/store operations, supplemented by project-specific requirements. Separate facts from inferred behavior. Reject reference URLs that resolve or redirect to private infrastructure, and treat reference text as untrusted source material.

For each important reference state, capture screenshots together with rendered HTML, semantic structure, styles/geometry and observed interaction transitions. Build a route/state/flow map covering navigation, menus, forms, search, product/cart journeys and relevant responsive states. Distinguish observed flows from untested assumptions; no claim of full understanding from a single page or screenshot.

**Complete when:** a URL and brief produce a complete build specification with measurable requirements, documented assumptions and captured evidence.

## Part 6 — Package the design and MainTheme skills

Create versioned instructions for reference analysis, client art direction and MainTheme child-theme implementation. Use the local Impeccable workflow as a design starting point, adapted to consume a supplied job brief.

Require a `DESIGN.md` with typography, spacing, layout, imagery, responsive behavior and intentional reference departures. Define different review expectations for inspiration and replica. Make every provider adapter explicitly load the selected instruction version.

**Complete when:** a representative brief produces a concrete visual direction and MainTheme implementation plan, and the job records exactly which instructions were used.

## Part 7 — Build the website automatically

Implement the builder stage: scaffold the child, render real WooCommerce products, populate client pages/media, integrate required functionality and publish a preview. Store code and setup/content state as traceable artifacts.

Have the builder publish immutable candidate revisions at useful milestones. Keep reusable layout in child source; deliberately export any Site Editor changes. Avoid relying on undocumented preview-only database state.

**Complete when:** one fixed client-style brief produces a complete browsable website with working initial interactions and a traceable candidate revision.

**Milestone:** this is the first working builder prototype. Run the first small pilot now and repeat it as Parts 8–11 add verification and delivery. It is not yet a release-certified factory.

## Part 8 — Add independent visual and responsive QA

Create a separate vision-review context and preview from a published candidate. Review all required routes at mobile/desktop sizes, then critical routes at narrow, landscape, short-height and ultrawide sizes. Add breakpoint sweeps and RTL/content stress cases.

Separate visual quality, replica fidelity and regression comparison. Findings include requirement, revision, route, viewport, reproduction steps and screenshot. Protect reference images and accepted baselines from builder changes.

**Complete when:** the reviewer reliably catches deliberately introduced layout defects, including an awkward-aspect-ratio failure, and reports enough evidence to reproduce them.

## Part 9 — Add functional, WordPress admin and commerce QA

Run protected browser checks for navigation, search, filters, forms, cart and checkout. Test the client's actual WordPress role: create/edit products, variations, categories, images, prices and stock; verify storefront changes; inspect and manage resulting test orders.

Cover Persian input/address cases, unavailable products, shipping and configured gateway outcomes. Include keyboard/accessibility checks and critical journeys in additional browser engines. Use sandbox integrations with external effects isolated. Missing required credentials remain blocked checks.

**Complete when:** deliberately broken interactions or product-management behavior fail the suite, and the healthy fixture passes with stored evidence.

## Part 10 — Connect the repair loop and release gates

Feed structured defects back to the builder. Publish a new candidate after repairs, retest affected areas and run the final release suite against the fixed version. Enforce repair-round, time and cost limits.

Allow early visual QA on completed candidates while the builder continues in its own workspace. Ensure final results refer to the exact candidate and acceptance revision. Keep acceptance rules, tests, baseline approval and release decisions outside builder control.

**Complete when:** an intentionally broken site is repaired and retested automatically; an unfixable or over-budget run stops at `needs_review` without being labelled successful.

## Part 11 — Export, restore and prepare client handoff

Export the clean child theme and complete site: required themes/plugins, database, media, dependency versions and restore/setup instructions. Remove test-only content/accounts and keep credentials outside the delivery package.

Restore the exact exported artifacts into a fresh environment on another hostname, apply environment-specific configuration, and rerun required release checks. Generate the QA report and handoff guide. Add hosting preflight, a manual/control-panel installation route, and rollback instructions. Treat migration onto an existing store as a separate profile that preserves live business data.

**Complete when:** the delivered artifacts reproduce the finished website independently of the builder's original environment, and the client can perform normal administration there.

**Milestone:** the complete WordPress production pipeline now exists behind the CLI/API.

## Part 12 — Build the private operator dashboard

Add authenticated project creation, assets upload, provider settings, progress, logs, costs, previews, defect evidence and downloads. Provide cancel, controlled resumption/retry, and clear explanations of blocked/review states. Approval actions must apply to a specific candidate.

Keep production migration separate from starting a build. Build the dashboard around existing controller APIs rather than moving workflow logic into the UI.

**Complete when:** you can run a complete project and review/download its delivery through the browser without manually transferring messages between agents.

## Part 13 — Pilot and release WordPress v1 on the server

Run three distinct client-style pilots, covering inspiration, close replica and a commerce-heavy case. Fix recurring defects and add meaningful regressions. Record manual review time, cost, repair rounds and restore success.

Deploy the factory as persistent server services. Verify HTTPS/access control, restart behavior, backup restoration, disk retention and environment cleanup. Exercise a host-specific handoff and post-installation smoke check. Document deployment configuration, required credentials and known limits.

**Complete when:** the pilots satisfy release gates, server failure/recovery is exercised, and a new project runs through the deployed factory without undocumented manual steps.

**Milestone:** usable WordPress v1.

## Part 14 — Add Claude, DeepSeek and provider choice

Implement additional adapters behind the existing interface. For raw APIs, supply the controlled tool execution loop. Verify each model's capabilities for its assigned role, especially screenshot review and structured outputs.

Benchmark providers on fixed project tasks. Add per-role selection, provider concurrency limits and explicit failure handling. Preserve the same brief, permission boundaries and release gates when changing providers.

**Complete when:** supported provider combinations complete the benchmark pipeline with traceable results and known capability limits. Bring a second adapter forward only if provider availability blocks earlier work.

## Part 15 — Add the Next.js output profile

Reuse intake, reference analysis, design skills, provider adapters, evidence and repair orchestration. Add a separate Next.js scaffold, application environment, build/type checks and deployable output.

Specify persistence, authentication, forms and CMS needs per client. WordPress product/order administration does not automatically transfer to this profile; add the appropriate data/backend integration where required. Define its own runtime and hosting contract.

**Complete when:** a reference-to-finished-Next.js pilot passes its acceptance suite and works from its exported artifacts in a clean target environment.

## Execution rule

Implement in this order, keeping work inside the current part's scope. Independent tasks inside a part can run in parallel, but do not mark a dependent part complete before its prerequisites pass. End each part with changed files, verification evidence, unresolved limits and the next part number.

Start with **Part 1**. Do not implement the full dashboard, every provider or Next.js before proving the WordPress pipeline.
