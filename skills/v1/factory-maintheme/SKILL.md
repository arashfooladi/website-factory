---
name: factory-maintheme
description: Plan or implement a portable Website Factory WordPress child theme against the pinned MainTheme parent while preserving WooCommerce data and client administration.
metadata:
  version: "1.0.0"
---

Target the pinned MainTheme 0.4.0 parent. With source tools, read `parent/docs/CHILD-THEMES.md` and `parent/docs/DEVELOPER-API.md` for the relevant extension. A reference-only designer uses the pinned contract here and names source checks for the builder. Keep the child `Template: maintheme` header. The parent already loads its styles before the child's; do not enqueue the parent twice.

Prefer child `theme.json` tokens, then focused CSS, then only the template parts requiring structural change. Override whole templates when composition requires it. Use real WordPress/WooCommerce blocks and product queries, not hardcoded catalog cards. Products clients add later must inherit the design; cart, variations, stock and orders must remain live behavior.

Stable hooks include `maintheme_child_style_dependencies`, `maintheme_settings_schema`, `maintheme_default_options`, `maintheme_homepage_patterns`, `maintheme_starter_pages` and `maintheme_product_card_classes`. Read the actual contract before using one. Use semantic/logical CSS for RTL; inspect both long Persian strings and mixed content.

Template parts are referenced by slug, so child `parts/header.html` can override the parent header. Product-template items receive `maintheme-product-card`; stable layout classes include `maintheme-product-layout`, `maintheme-product-summary`, `maintheme-shop-layout`, `maintheme-shop-toolbar` and `maintheme-commerce-page`. Parent tokens include `--wp--custom--layout--content|wide|store|checkout`, radius variants, control height and product image ratio/card gap. These are presentation contracts, not permission to replace WooCommerce data behavior.

Keep shipping, gateways, email/SMS integrations, order/stock behavior and reusable business features in dedicated plugins. Theme PHP is for presentation hooks, not bypassing commerce. Identify missing plugin capabilities in the plan; never pretend static forms or placeholder buttons implement them.

File templates must be the portable source of truth. Site Editor database overrides take priority over child files; identify/export them deliberately rather than delivering a child ZIP that omits the visible layout. Preserve client admin/product editing and list the required content/media/plugin state alongside source. A clean child alone does not reproduce a whole site.

Verify actual routes and interactions after changes. Preserve protected acceptance/reference files. Report candidate/evidence IDs and unresolved dependencies; the controller owns candidate commits, QA and release eligibility.
