# WordPress delivery contract, version 1

The production output is a complete client website, with a clean MainTheme child theme as one artifact. Client operations are standard WordPress/WooCommerce product, stock, order and account management. A bespoke page-layout editor is not a default requirement.

A future accepted release must contain:

- Client child-theme source and installable ZIP; real WordPress/WooCommerce content rendering, not static mock products.
- Required parent/plugin versions and checksums, with licensing or client activation requirements recorded.
- Database/content configuration and uploaded media sufficient to reproduce the finished website.
- A documented new-site restore/setup procedure with target-host requirements and environment-specific configuration.
- A separate targeted migration procedure for an existing store, preserving live orders/customers/products.
- A report binding acceptance-manifest revision, candidate revision, exact artifact hashes, fixture/runtime versions and test evidence.
- Installation/handoff and rollback instructions.

The new-site package must be restored on a fresh hostname and verified before release. The originating preview's database is not sufficient evidence. Secrets, test accounts/orders, fixture guards and development-only tools are excluded from client artifacts.

Production hosting migration is a separate, explicitly initiated operation against a reviewed release. This contract describes later implementation; Part 1 produces the trusted baseline, not client releases.
