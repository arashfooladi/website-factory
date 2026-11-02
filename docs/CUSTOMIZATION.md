# Project customization

The API and CLI accept editable design settings now. The operator dashboard is still Part 12. A revision creates a new immutable intake and acceptance manifest; changing a preset or theme default does not silently rewrite an existing design or site.

`npm run controller:cli -- design:options` lists supported modes and packs.

| Mode | Default behavior |
| --- | --- |
| `replica` | Match reference layout, typography, palette, image treatment and observed interactions. |
| `semi-replica` | Match layout/interactions; adapt typography, palette and imagery for the client. |
| `inspiration` | Create a new composition/type direction; adapt useful reference ideas. |
| `custom` | Follow the custom prompt and explicit preferences. Reference URLs are optional. |

Modes supply defaults. Every axis can be `match`, `adapt` or `free`. Explicit global settings override the preset; explicit page settings override global settings. Exact page paths take precedence over the longest matching `/*` prefix. A custom home, semi-copy catalog and close-copy product template can coexist. A copy/inspiration page still needs actual reference input.

Example `design` settings within an intake:

```json
{
  "quality": "strict",
  "instructions": "Preserve the useful navigation, but use our supplied identity.",
  "axes": {"palette": "adapt"},
  "fonts": ["Vazirmatn"],
  "palette": {"surface": "#F7F6F2", "text": "#242321", "accent": "#A43D21", "on-accent": "#FFFFFF"},
  "density": "compact",
  "motion": "subtle",
  "mustKeep": ["Visible product search and the reference product-detail hierarchy"],
  "mustAvoid": ["Invented testimonials", "Decorative metric panels", "Interchangeable icon tiles"],
  "skillPacks": ["factory-design", "impeccable", "frontend-design", "unslop"],
  "domain": "WordPress small-business commerce",
  "pages": [
    {"path": "/", "mode": "custom", "instructions": "Lead with the catalog; keep the introduction concise."},
    {"path": "/shop/", "mode": "semi-replica"},
    {"path": "/product/*", "mode": "replica", "axes": {"palette": "adapt"}}
  ]
}
```

Supply font files as client assets when needed. The assigned theme's available fonts can also be used. Known palette roles map directly to the structured design tokens. Font and known palette mismatches are rejected before a design can publish; reference fidelity and actual rendered quality still need visual QA. An inaccessible pinned palette stays a conflict to resolve, not an excuse to change colors silently.

Quality can be `strict`, `balanced` or `custom`. Strict asks for deliberate composition, rendered self-critique and complete responsive/state coverage. All levels retain the protected functional, admin, commerce, accessibility and delivery checks. No prompt pack guarantees aesthetic quality by itself.

Edit an existing intake with a JSON merge patch:

```sh
npm run controller:cli -- intake:revise --id INTAKE_ID --file preferences-patch.json
```

For example, `{"mode":"semi-replica","design":{"density":"spacious","motion":"none"}}` preserves the other preferences. Arrays replace the old array. `null` removes a setting and restores its default: `{"design":{"fonts":[],"palette":null}}`. The previous brief and artifacts remain available. A revision inherits its pinned theme unless a different certified `themeBundleId` is explicitly selected.

## Selected design packs

Factory skillset v2 is the default for new runs. Historic v1 instructions remain available for their existing sessions/designs. A builder bound to a design inherits that design's skillset and empirical profile instead of picking a later default. Each run records the full instructions, manifest hash, individual skill hashes, tool capabilities and selected profile ID/hash.

The core factory design contract is required. The default optional packs are the project adaptation of local Impeccable 4.8.0, the pinned Anthropic frontend-design skill, and [heydamir/unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, CC BY 4.0. The Unslop UI skill is pinned at `a6f121eee5f29c2f74976b75456feae8b66afb3a`, with its upstream instruction, signs, tokens, visuals/effects guidance and example images. Attribution and license are retained.

Unslop audits the actual render, records a product-specific direction and applies spacing, color, icons, copy, type, layout, details, visuals and motion passes in order. The factory supplies screenshot/HTML/structure evidence and owned browser tools in place of the upstream host snapshot script. Its reference text is loaded with the pack; example images are available through the hash-checked `factory_reference` design_pack action. The output remains a working WordPress child theme with real content and plugin behavior. Story-video scripts are optional upstream utilities, not agent capabilities or part of a normal client website.

The packs' aesthetic advice applies within the client's resolved fidelity constraints; it must not turn a requested copy into an unsolicited redesign. Functional testers do not receive the optional aesthetic packs by default. The user's instruction to proceed without intermediate approvals supplies the unattended workflow; an imported pack cannot create repeated direction-approval pauses.

Sources and exact vendor hashes are in `skills/vendor/lock.json` and `skills/manifest.v2.json`. Vendored licenses are retained. Upstream scripts do not receive host execution through model tools.

## Separate optional calibration

`unslop` means the heydamir UI skill above. A different project, [mshumer/unslop](https://github.com/mshumer/unslop), supplies a sample-and-count calibration method. The factory implemented that method before the intended repo was clarified; it remains an optional `unslop-calibration` pack, disabled by default. It is not a requirement for using the UI Unslop skill.

```sh
npm run controller:cli -- design:calibrate --file fixtures/calibration-commerce-v1.json
npm run controller:cli -- design:profiles
npm run controller:cli -- design:profile --id PROFILE_ID
```

`POST /v1/design-profiles` starts a durable bounded calibration. The controlled provider adapter generates distinct static samples. An isolated, network-blocked Chromium captures desktop/mobile screenshots, HTML and structure. A fresh analysis context sees every sample and must cite exact source snippets for each occurrence. The controller computes counts and rejects invented/duplicate evidence. The generated avoidance profile is tested against a held-out prompt, with before/after captures and a separate review context. Inconclusive comparisons, layout regressions, cancellation, unknown usage and exhausted budgets cannot publish an eligible profile.

The workflow follows mshumer/unslop's sample/render/count/profile/compare method; it replaces the upstream script's host Claude CLI calls with factory capabilities. It does not run the vendored script on the host. This first implementation calibrates static visual defaults, not WordPress business behavior. It keeps failure artifacts and exact observed token usage; monetary cost remains unknown for the native login transport.

When `unslop-calibration` is explicitly selected, set `design.unslopProfileId` to pin an eligible profile. Otherwise a matching provider/model/domain profile in this configured artifact store can be selected automatically. A profile is fixed when the agent run is created. The UI Unslop pack alone does not start or load calibration. Four-sample calibrations are explicitly provisional. The calibration project's 20-sample workflow offers broader coverage, with a larger explicit runtime/token allocation.

`POST /v1/design-profiles/:id/cancel` cancels calibration. Artifact downloads use `/v1/design-profiles/:id/artifacts/:artifactId` and are attachment-only, hash-checked and owned.
