# Changelog

## 0.4.0 — 2026-07-27

### Breaking architecture changes
- Removed Iran checkout business rules from the theme and released them as `Maintheme Iran Commerce`.
- Removed forced stock-management and backorder overrides.
- Removed the filters that told WooCommerce a physical cart did not need shipping.
- Removed forced WooCommerce gettext replacements.

### Child-theme support
- Removed all hardcoded `"theme":"maintheme"` template-part attributes.
- Added stable filters, actions, design tokens and product-card classes.
- Added a starter child theme package.

### Storefront
- Added the product short description in the product summary.
- Uses Product Details once, preventing duplicate long descriptions.
- Added configurable delivery and return reassurance.
- Added term descriptions and dedicated product taxonomy templates.
- Added wider Cart, Checkout, Account and Order Confirmation layouts.
- Added stronger empty states and product-card presentation.

### Quality
- Scoped starter URL rewriting to explicitly marked blocks.
- Removed automatic starter content on activation.
- Added editor/frontend style parity, CSS fallbacks and accessibility improvements.
- Added documentation, licensing notices and QA checklist.
