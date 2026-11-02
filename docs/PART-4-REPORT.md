# Part 4 — first coding agent verification

Verified 2026-11-02 on the local Linux backend. **Part 4 is complete.** The result is a controlled small-change agent; it is not yet a complete automatic website builder.

## Delivered behavior

The controller queues a role-specific task against an owned, running WordPress environment. A Codex app-server harness receives explicit instructions, tool definitions, screenshot input and budgets. The harness, browser and website run in separate namespaces. A host-only inference broker keeps real login credentials outside them and rejects unassigned provider calls.

The agent can read the parent/child, edit child text files as builder, and inspect/interact with its assigned preview. Every browser action records a screenshot, rendered HTML, styles/geometry, semantic elements and observed before/after states. Evidence truncation is declared. The controller records durable events/session IDs/usage and independently checks changed source, syntax, final preview response and source stability before publishing a protected Git candidate. Cancellation, continuation and stale-worker fencing are implemented. Every candidate remains ineligible for release.

Operational commands, configuration, limits and credential boundary: [agent runtime](AGENT-RUNTIME.md).

## Acceptance evidence

Five live WordPress integration cases passed, with no failures or skips:

1. Actual Codex read the child stylesheet, appended a 7px `#128a44` body border and inspected the preview through the dynamic browser tool. The final independently captured DOM reported `7px` and `rgb(18, 138, 68)`, HTTP 200 and a stable source digest. Candidate `fe71dedc3118dac82c225e7974771c1762404c9e` was committed by the controller. Its screenshot was also inspected directly.
2. Continuation reused the same real provider session, reread current files, changed the border to 9px and verified the new preview. It produced distinct candidate `291a3d16fc733a5b75a94599b95868ad75b0cb2c`. Resuming the older run was rejected.
3. Unauthenticated requests, foreign-owner access, foreign artifact access, analyst editing, parent editing and traversal were rejected. Owned artifact download returned a restrictive content security policy.
4. A real active provider turn was cancelled. Its process group stopped and no candidate was published. A competing agent and an environment-stop request were rejected while the run was active.
5. An injected expired lease stopped/recovered the worker as `needs_review`, retained unknown usage and rejected late candidate publication.

The test environment was destroyed after the suite. The live suite completed in approximately 167 seconds using the already prepared disposable WordPress instance; fresh instance preparation takes additional minutes.

A separate real vision capability check passed: random six-character labels existed only in screenshot pixels. Codex transcribed both the initial image and the second image returned through a dynamic tool correctly. This verifies actual image transport in both directions, rather than relying on the model's capability declaration.

Six browser/provider checks passed, including actual menu/form/mobile interaction, blocked foreign requests, direct-function registry replacement, denied native tool calls, accounting for denied inference, and stopping an in-flight upstream request without marking unknown usage confirmed. Fourteen controller regression cases passed, including actual SIGKILL recovery. TypeScript checks, compiled build, fourteen Python safety cases, the 94-file baseline/archive checks, 28 static checks and ten helper cases passed.

The compiled service was rebuilt and restarted successfully; its authenticated health request passed. Private logs and run metadata are under ignored `.runtime/controller/`, including `agent-tests.log`, `codex-capabilities.log`, `part4-runs-evidence.json`, `part4-controller-regression.log` and `part4-check.log`. Candidate source/screenshots and session state remain private under the configured agent root.

## Observations and limits

The installed Codex version tested was 0.166.0 with gpt-6.1-sol. Its code-mode registry required replacing `additional_tools` input with the assigned direct factory functions. The namespace description is required by the native endpoint. This compatibility behavior is covered by checks; changing Codex/model/login mode requires revalidation.

The first source-change run reported 40,115 total provider tokens, and the continuation reported 88,592 for its own new inference requests. Continuation naturally carries prior context. The vision check reported 7,273. Monetary cost is unknown for this native-login route and is stored as `null`. The token limit is an observed threshold between requests, with possible overshoot in a single request. It is not a hard billing cap. Interrupted upstream inference stays unconfirmed.

One browser check initially exceeded the 20-second cold-start allowance during fresh database setup. A writable isolated font cache and a 60-second startup bound were added. The browser checks then passed, including the final six-case run. These limits remain inside the overall task deadline.

The tested native login bridge reads the existing operator login and does not refresh it. Expired/missing login stops for review. The browser currently visits only the assigned preview; public reference-site intake/capture is Part 5. Source export is bounded to small UTF-8 child themes. Media/content import, full design skills, complete-site generation, independent QA and portable delivery remain later parts.
