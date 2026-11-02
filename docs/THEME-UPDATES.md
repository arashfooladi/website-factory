# Replace MainTheme without rewriting client sites

The theme library stores immutable bundles containing the MainTheme parent, a child starter and the Iran commerce plugin. A bundle records every file hash, a combined source digest, component versions and import provenance. The current release number is not the identity: two packages with the same version header and different contents have different bundle IDs/digests.

The known baseline is `42b95616-7350-48de-9489-181df7c401bb`, MainTheme 0.4.0. Its previous certification is tied to the exact canonical manifest and native runtime lock. `baseline/source` and the original input ZIPs are unchanged by library imports.

The parent-update workflow is:

```sh
npm run controller:cli -- themes
npm run controller:cli -- theme:import --file /path/to/new-maintheme.zip --base BASE_BUNDLE_ID
npm run controller:cli -- theme:certify --id NEW_BUNDLE_ID
npm run controller:cli -- theme --id NEW_BUNDLE_ID
npm run controller:cli -- theme:default --id NEW_BUNDLE_ID
```

Import accepts a normal parent theme ZIP, either its files directly or one wrapper directory. It reuses the selected base bundle's child starter and commerce plugin, without modifying either. ZIP traversal, links, special files, collisions and oversized input are rejected. Import does not execute theme PHP. Full child/plugin replacement is not yet an import profile.

Certification runs all 28 static contract checks with the imported component's actual version labels, then boots a separate isolated WordPress/WooCommerce fixture. It checks actual theme/plugin/product types, nine RTL desktop/mobile/short-landscape page renders, variable/out-of-stock products, controlled Persian COD checkout, product-admin access and the WordPress debug log. Evidence and failures remain available. A failed, interrupted or uncertified bundle cannot become the default or enter an ordinary new build. Passing compatibility is not certification of a client's design or final release.

The first brief/environment pins its WordPress project. Changing the global default affects new unpinned projects; a new brief in an existing project inherits that project's version. Existing intakes, designs, builds, environment caches and client exports keep their recorded bundle. A revised brief inherits its original pin unless explicitly changed. A per-job `themeBundleId` can test another certified bundle without changing the project's default. To deliberately change a project's default for future jobs, use `project:theme --project PROJECT_ID --theme BUNDLE_ID` or `POST /v1/projects/:id/theme`. Neither action rewrites existing records or sites.

A builder cannot combine a design/intake from one bundle with an environment from another. Moving a completed client's site onto a new parent is a separate candidate, QA and restore/migration task; selecting a default does not upgrade it in place.

New environment caches include both the theme source digest and runtime-lock hash. Existing environments retain their original private cache path. Parent and plugin mounts remain read-only to agents. Reference/design tools expose the assigned bundle's actual version, digest and hash-checked extension documentation so updated hooks are not guessed from a hard-coded 0.4.0 skill.

The family contract currently remains `maintheme-v4`, parent slug `maintheme` and the documented child API. Breaking updates are held for review instead of silently passing as compatible. The user's forthcoming update has not been provided; testing uses labelled simulated packages.

API equivalents: `GET/POST /v1/theme-bundles`, `GET /v1/theme-bundles/:id`, `POST /v1/theme-bundles/:id/certify`, and `POST /v1/theme-bundles/:id/default`. The upload body is ZIP bytes with `Content-Type: application/zip` and optional `X-Factory-Base-Bundle`. Certificates expose their immutable evidence IDs; artifacts are downloaded as attachments through the owned API.
