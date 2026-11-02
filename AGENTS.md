# Website Factory

Read `docs/BUILD-ORDER.md` and `docs/PROGRESS.md` before extending this project.

- Deliver complete websites; clients use ordinary WordPress product/order administration.
- Keep work in the current build part until its acceptance checks pass. Record failures honestly.
- Original local client sites and the imported upstream ZIPs are read-only inputs.
- `baseline/source` is the canonical factory-maintained MainTheme baseline. Document every deviation in `baseline/PROVENANCE.md` and explicitly update its lock after review.
- Do not update expected checksums, remove tests, or weaken assertions merely to make a check pass.
- Treat `.runtime`, fixture credentials, database dumps and browser session state as disposable private data; never commit them.
- Fixture services bind to loopback and use a dedicated database. Do not run checkout tests on live sites.
- Keep shipping, gateways and order/stock behavior in plugins, not child-theme code.
- Any future agent worker must not receive host Docker access, production credentials or write access to protected release rules.
- Run the checks relevant to a change, and update progress with actual evidence and limits.
- Run native integration suites sharing the test database's intake/agent/environment queues sequentially unless they use the exact same worker configuration. Workers with different fixture transports or storage roots must not consume each other's jobs.
