=== Maintheme ===
Contributors: maintheme
Tags: e-commerce, full-site-editing, block-patterns, rtl-language-support, wide-blocks
Requires at least: 6.6
Requires PHP: 7.4
Stable tag: 0.4.0
License: GPLv2 or later

A Persian-first RTL block parent theme for Iranian WooCommerce stores and reusable child themes.

== Description ==

Maintheme provides editable block templates for product archives, product pages, cart, checkout, account, order confirmation, pages, posts, search and 404 pages. It includes responsive RTL styles, design tokens, style variations, patterns, an explicit starter-content installer and a documented child-theme API.

Iran-specific checkout business rules are intentionally supplied by the separate Maintheme Iran Commerce companion plugin so orders do not depend on the active theme.

== Installation ==

1. Upload and activate the parent theme.
2. Install WooCommerce.
3. Upload and activate Maintheme Iran Commerce from the release bundle.
4. Optionally install the starter child theme.
5. Open Appearance > Maintheme for setup and contact details.
6. Open Appearance > Editor to customize templates, parts, colors and typography.

== Changelog ==

= 0.4.0 =
* Correct child-theme template-part inheritance.
* Separate Iran checkout rules into a companion plugin.
* Preserve shipping calculation and merchant inventory settings.
* Add country-aware billing and shipping validation.
* Rebuild product page hierarchy and remove duplicate description output.
* Widen cart, checkout and account templates.
* Add taxonomy templates and term descriptions.
* Add stable product-card classes and variants.
* Scope starter-link URL resolution.
* Add schema-driven settings extension hooks.
* Expand theme.json design tokens and add a purple style variation.
* Load component and WooCommerce styles in the editor.
* Remove automatic starter-page publishing on theme activation.
* Add complete documentation and a child-theme starter.
