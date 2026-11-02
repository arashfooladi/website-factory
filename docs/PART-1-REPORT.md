# Part 1 — MainTheme baseline certification

Date: 2026-11-02. Result: **passed for the native fixture's tested scope**.

The factory repository now contains a canonical MainTheme baseline, reproducible packages, portable validation and a working disposable WordPress/WooCommerce environment. Existing client installations and the original MainTheme source checkout were not modified.

## Tested runtime

| Component | Version |
|---|---|
| MainTheme parent / child starter / Iran Commerce | 0.4.0; factory artifact revision 0.4.0-factory.1 |
| WordPress | 7.1.4 |
| WooCommerce | 11.2.1 |
| Native PHP | 8.4.14 |
| Native MariaDB | 13.0.2 |
| WP-CLI | 2.12.0 |
| Playwright | 1.64.1, using the host Chromium executable |
| Locale | fa_IR with pinned core and WooCommerce translations |

Download and source hashes are recorded in `fixtures/runtime.lock.json` and `baseline/manifest.json`. The original release ZIP hashes are verified before packaging; factory archives deliberately use uncompressed ZIP entries, fixed ordering, timestamps and permissions for cross-host reproducibility.

## Checks and observed results

| Check | Result |
|---|---|
| Reviewed baseline | 94 source files and three canonical archives match |
| Upstream static validator | 28 checks passed, including PHP syntax, JSON, block nesting and source hygiene |
| Iran helper cases | 10 normalization/validation cases passed |
| Package/extraction safety | Five tests passed, including traversal and symlink rejection |
| Fresh installation | Dedicated temporary empty database installed successfully |
| Repeat installation | One admin remains; installer output contains no generated password |
| Browser suite | Seven passed; zero failed, skipped or flaky; final run about 2.8 minutes |
| Fixture persistence | Child selection, seeded product IDs and actual order records survive restart |
| Immediate restart | Repeated stop/start verified after correcting a TIME_WAIT port-preflight issue |
| Docker configuration | Compose validation passed; images are pinned by digest |

The seven browser checks cover:

1. Correct parent/child/plugin activation, RTL locale and real product types.
2. Home, catalog and product rendering at 1440×900 without horizontal overflow or page JavaScript exceptions.
3. The same pages at 390×844.
4. The same pages at 844×390.
5. Admin login and access to the seeded product listing.
6. Selecting a real variable-product variation and preventing purchase of an out-of-stock product.
7. Completing a storefront COD checkout and verifying the persisted WooCommerce order: processing status, one line item, 250000 product subtotal plus 50000 shipping, total 300000, and saved contact details.

The desktop home page and mobile product screenshots were also visually inspected. Placeholder imagery and instructional starter copy remain intentional in this baseline fixture; it is not a client deliverable. The final browser run produced no new WordPress debug log.

## Reproduction

```bash
npm ci
npm run fixture:prepare
npm run check
npm run baseline:build
npm run fixture:up
npm run fixture:seed
npm run test:install
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

The local preview is http://127.0.0.1:8787. Private fixture credentials live in ignored `.runtime/credentials.json`. Browser screenshots/JSON are in ignored `test-results/`; the HTML report is in `playwright-report/`. Use `npm run fixture:down` to stop services while retaining the dedicated data.

## Boundaries

- Docker execution is not certified: the account cannot access the host daemon. Only the Compose configuration was validated. Its MariaDB image uses a separate pinned 11.8.5 profile, which needs actual runtime testing.
- The native PHP package is a compatibility fixture, not a production PHP deployment recommendation. Its binaries were signature-verified when imported and their downloads are SHA-256 pinned.
- Initial PHP 8.5 execution exposed WP-CLI vendor deprecations; the verified native profile uses PHP 8.4. No blanket PHP 8.5 compatibility claim is made.
- Bank gateways, block checkout, actual mail delivery, custom product-management workflows, minimum-version compatibility and Firefox/WebKit are not certified by these smoke tests.
- This is baseline certification. AI building, independent model criticism, automated repair, full client export/restoration, production migration and the dashboard belong to later numbered parts.

The Part 1 completion condition is met on the native profile: a fresh installation boots, the child extends the parent, representative products work and a controlled order completes. Next implementation is Part 2.
