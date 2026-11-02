# Agent runtime

The controller can assign a role to an isolated Codex app-server session. It supports small site changes and reference-only structured design work. Automatic whole-site construction and independent release QA are subsequent build parts.

## Start a task

Use a running, disposable environment. Create a private JSON request:

```json
{
  "environmentId": "ENVIRONMENT_UUID",
  "role": "builder",
  "prompt": "Read child/style.css, make the requested change, and inspect the preview at desktop and mobile sizes.",
  "limits": {
    "maxRuntimeMs": 600000,
    "maxObservedTokens": 150000,
    "maxToolCalls": 30,
    "maxArtifactBytes": 33554432
  }
}
```

```bash
npm run controller:cli -- agent:create --file /path/to/private-request.json
npm run controller:cli -- agent --id RUN_UUID
npm run controller:cli -- agent:cancel --id RUN_UUID
npm run controller:cli -- agent:resume --id RUN_UUID --file /path/to/private-continuation.json
```

A continuation contains `prompt` and explicit `limits`, uses the last run in that session, and records a new run. It reuses the provider session, not the previous browser. Files and browser observations must be read again. An environment allows one active agent; lifecycle requests are rejected while it is active. Cancel an agent and wait for its terminal status before stopping the environment.

Include optional `intakeId` to bind a completed reference specification from the same project. The agent then receives a labelled reference image and read-only `factory_reference` access to screenshots, HTML/CSS, styles/geometry, recorded flows and acceptance requirements. Continuation retains that revision. See [reference capture](REFERENCE-CAPTURE.md).

Reference-only analysts/designers can use `projectId` and `intakeId` without `environmentId`; builders require a running environment. A designer requires a completed intake and a validated `factory_design` submission. A builder may bind `designId` from that same intake. See [design skills](DESIGN-SKILLS.md).

API equivalents are `POST /v1/agent-runs`, `GET /v1/agent-runs/:id`, and `POST /v1/agent-runs/:id/cancel` or `/resume`. Artifacts are available at `GET /v1/agent-runs/:id/artifacts/:artifactId`, with the controller token and project ownership enforced. HTML is served as an attachment with a restrictive content security policy.

## What the agent receives

`AgentTask` and `ProviderAdapter` in `src/agent-contracts.ts` define the implemented provider boundary. The controller passes role, explicit tools/limits, protected instructions/hash/versions and applicable screenshots/observations. Run, session, turn, events, usage, artifacts, source revision and design output are durable records. `skills/manifest.v1.json` selects base instructions and role packages; current runs preserve exact instruction/capability artifacts.

Tools available to every role:

- `factory_list` and `factory_read`: child-theme files and read-only parent source.
- `factory_browser`: navigate the assigned preview, click, fill, press a limited key, scroll, change viewport, inspect.
- `factory_evidence`: read bounded excerpts of this run's captured HTML/structure.

Only `builder` receives `factory_edit`. It replaces a complete child text file after reading it. Paths reject traversal, symlinks, Git/config directories and parent writes. Each file is limited to 256 KiB and the complete source export to 512 KiB. Binary media import and WordPress content operations are later builder capabilities. There is no arbitrary shell tool.

The isolated browser has no direct network. A trusted bridge fetches only the assigned loopback preview. Other origins, WebSockets and downloads are blocked. Preview authorization stays in the host bridge. Each action records paired screenshot, rendered HTML, semantic controls/headings/links, computed styles, geometry, viewport/scroll and a before/after transition. Password attributes are redacted. HTML/element truncation is explicit. These observations cover visited states; they do not establish complete knowledge of the website.

## Credential and execution boundary

The tested adapter uses native Codex **0.166.0**, its experimental app-server dynamic tools and the installed **gpt-6.1-sol** model. `codexBinary`, `codexModel`, `codexCredentialFile` and `agentRoot` are optional private controller settings. The default binary is resolved from the Node installation; the default login file is the operator's `.codex/auth.json`.

The app server runs in its own bubblewrap network/PID/user/mount namespaces and a systemd user service. It sees a dedicated session-state directory, an empty workspace, read-only executables and one private inference socket. It has no website mount, host home, controller database credentials, Docker access, production credentials or external network. CPU is 100%, memory 1 GiB, swap zero, tasks 128, file size 128 MiB and runtime bounded. The separate browser has a 1.5 GiB memory ceiling, two CPU allowance and 256 tasks.

The trusted host transport reads the operator's native Codex login on each inference and calls the native Codex response endpoint. This is a pinned compatibility bridge for the installed login, not public API OAuth compatibility. It does not refresh an expired login. Missing/expired credentials stop with `needs_review`; renew the operator login separately. No actual token enters the model harness, website or browser. The harness receives a per-run capability accepted only by the private inference broker.

Codex 0.166 advertises an internal code-mode tool registry. The broker removes that registry and advertises only assigned factory functions directly. It buffers inference output, checks every returned tool call against that assignment and then replays it. Shell, native patching, external tools, code-mode execution and unassigned functions cannot cross this bridge.

App-server dynamic tools and the native login endpoint are version-sensitive. Re-run the live capability and agent tests when changing Codex, model or authentication mode. Official protocol reference: [Codex app server](https://learn.chatgpt.com/docs/app-server). Local generated schemas were also checked for the installed binary.

## Completion, usage and interruption

Provider text alone never establishes success. For a builder task, the controller drains in-flight tools, checks PHP/JSON syntax, verifies source actually changed, copies the bounded source into a protected directory and commits it there. Git hooks and global/system Git configuration are disabled. It then captures the preview again, requires HTTP 200 and verifies source did not change during capture. Only the current unexpired lease can publish the candidate metadata. The candidate is always `releaseEligible: false`; full visual, commerce, admin and restore certification are later parts.

Cancellation interrupts the turn and stops the UUID-scoped process group. Already completed child edits can remain in the disposable workspace, but a cancelled run cannot publish a candidate. An expired worker lease stops its harness/browser, waits for the environment command lock and marks the run `needs_review` with unknown usage. It does not silently replay the model task. Session continuation is explicit.

`maxRuntimeMs`, tool count, request/output sizes and artifact bytes are bounded. `maxObservedTokens` is an observed threshold checked between buffered inference requests; one request can cross it. It is **not a hard provider token or monetary cap**. Usage records report provider token counts, including cached tokens. Monetary cost is `null` for the tested native-login route. Unknown/interrupted inference is marked unconfirmed; never interpret it as free. The earlier demonstration pipeline's synthetic usage budgets do not enforce billing on agent runs.

Private provider/session/browser records stay under ignored `.runtime/`. Do not distribute them with a client delivery.

## Checks

```bash
npm run typecheck
npm run test:agent-tools
npm test
npm run test:agent-capabilities
npm run test:agents
```

The last two commands use the operator's real Codex login and consume real provider usage. The capability check presents random labels only as screenshot pixels, including an image returned through a dynamic tool. The agent integration suite uses a dedicated test database and disposable WordPress instance, including actual edits, browser verification, continuation, cancellation, ownership and expired-lease handling.
