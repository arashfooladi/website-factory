# Developer API

## Theme filters

### `maintheme_child_style_dependencies`
Changes the stylesheet handles loaded before the child stylesheet.

### `maintheme_settings_schema`
Adds or changes fields on Appearance → Maintheme. Each field supports `label`, `type`, `default`, `sanitize`, `section` and `description`.

### `maintheme_default_options`
Changes final default option values.

### `maintheme_sanitize_option`
Receives the sanitized value, option key, complete submitted input and field schema.

### `maintheme_homepage_patterns`
Changes the pattern sequence used by the starter homepage.

### `maintheme_starter_pages`
Adds, removes or changes explicit starter pages.

### `maintheme_starter_page_status`
Changes the status of a newly created starter page.

### `maintheme_product_card_classes`
Adds stable classes to each rendered WooCommerce product card.

## Theme actions

- `maintheme_settings_before`
- `maintheme_settings_after`

Both receive the merged current options.

## Companion plugin filters

- `maintheme_iran_commerce_enabled`
- `maintheme_iran_limit_countries`
- `maintheme_iran_hidden_account_endpoints`

## Stable CSS custom properties

- `--wp--custom--layout--content`
- `--wp--custom--layout--wide`
- `--wp--custom--layout--store`
- `--wp--custom--layout--checkout`
- `--wp--custom--radius--small|medium|large|pill`
- `--wp--custom--control--height`
- `--wp--custom--product--image-ratio`
- `--wp--custom--product--card-gap`
- `--wp--custom--transition--standard`

## Stable classes

- `maintheme-main`
- `maintheme-site-header`
- `maintheme-site-footer`
- `maintheme-product-card`
- `maintheme-product-layout`
- `maintheme-product-summary`
- `maintheme-shop-layout`
- `maintheme-shop-filters`
- `maintheme-shop-toolbar`
- `maintheme-commerce-page`
- `maintheme-product-reassurance`

WooCommerce internal class names are not part of the theme's compatibility promise.
