# Versioned design and MainTheme instructions

Part 6 packages three project-scoped skills under `skills/v1/`, selected through `skills/manifest.v1.json`:

- `factory-reference`: matched screenshot/HTML/structure analysis, observed flows and explicit unknowns.
- `factory-design`: client-specific art direction, tokens, responsive composition, content/imagery and inspiration/replica expectations.
- `factory-maintheme`: the pinned parent contract, selective child overrides, live WooCommerce data and preserved product/order administration.

The design starting point is local Impeccable 4.8.0. These are concise factory adaptations, not a dependency on the operator's global skill installation. The client's supplied brief and the requested autonomous workflow replace interactive interviews/option approval boards. No external Impeccable binary or image-comp approval service is required on the factory server. The builder/reviewer workflow still requires rendered evidence and independent QA at its later stages.

Every agent role explicitly loads its selected package through the controller. `skillsetVersion` defaults to `v1` in private configuration. Runs store the manifest hash, skill names/versions/content hashes and aggregate instructions hash. Queued execution checks that exact hash before starting. A private `agent_instructions` artifact retains the instruction bytes used by current runs. The provider receives the complete instructions and explicit capabilities/limits. The initial Codex adapter exposes observed token usage after tool calls so it can avoid redundant reads; the host continues enforcing limits.

## Produce a design

A designer can run from a completed reference specification before WordPress is provisioned:

```json
{
  "projectId":"PROJECT_UUID",
  "intakeId":"INTAKE_UUID",
  "role":"designer",
  "prompt":"Create the client art direction and MainTheme implementation plan from this brief and submit the complete design record.",
  "limits":{"maxRuntimeMs":600000,"maxObservedTokens":400000,"maxToolCalls":20,"maxArtifactBytes":33554432}
}
```

```bash
npm run controller:cli -- agent:create --file /path/to/private-design-request.json
npm run controller:cli -- agent --id RUN_UUID
```

Reference-only analysts/designers receive no editable child workspace or live-preview tool. They can inspect immutable reference evidence and assigned assets. The `state` action returns the matched screenshot, HTML excerpt and bounded layout summary together, reducing repeated inference context. Fuller artifacts remain available when the excerpt is insufficient.

The designer submits through `factory_design`. A final message alone cannot complete this role. Validation requires the correct intake/acceptance hash, every required page and acceptance check, known reference state/evidence IDs, a corresponding screenshot/HTML/structure triple, all recorded assumption keys, assigned client assets, valid child source paths and readable text/primary-control color contrast. The record includes numeric type/spacing/layout/color tokens, page composition and mobile behavior, imagery gaps, reduced motion, reference departures and plugin/source implementation responsibilities.

A completed design creates a protected design record and a `DESIGN.md` artifact. A named private copy is at `agentRoot/runs/RUN_UUID/design/DESIGN.md`. The stored record links its exact intake, acceptance and instruction versions. Cancellation, expired authority or missing/invalid submission prevents publication. These are planning gates; they cannot guarantee aesthetic quality or certify a website.

## Build from the plan

A builder request may include `designId` with `environmentId` and `intakeId`. The controller requires that the design belongs to the same project and intake, verifies its artifact and supplies the protected DESIGN.md. Continuation preserves the same bindings. The automatic builder stage uses this mechanism; manual small-change tasks remain available without an intake/design.

The design defines client-specific decisions. It does not grant permission to edit reference/acceptance rules, fake product functionality or move shipping/order/stock logic into the child. Whole-site generation and independent visual/admin/commerce verification remain separate build parts.

## Checks

```bash
python3 /home/arash/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/v1/factory-reference
python3 /home/arash/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/v1/factory-design
python3 /home/arash/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/v1/factory-maintheme
npm run test:design
npm run test:design-agent
```

The first commands are local authoring checks and are not server dependencies. `test:design` checks validation, role limits, exact skill recording, required submission and cancellation using a controlled provider. `test:design-agent` uses the real Codex adapter and the completed fixture from `test:intakes`, consuming provider usage. Successful structured output still requires review of its actual design content.
