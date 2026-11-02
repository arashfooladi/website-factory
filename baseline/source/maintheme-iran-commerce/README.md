# Maintheme Iran Commerce 0.4.0

Iran-only checkout and address behavior for WooCommerce stores using Maintheme or another compatible theme.

## What it does

- Limits allowed and shipping countries to Iran by default.
- Defaults new guest customers to Iran without guessing a province.
- Requires province, city, detailed address, mobile number and postcode.
- Converts Persian and Arabic numerals to ASCII before validation and storage.
- Normalizes common Iranian mobile formats to `09xxxxxxxxx`.
- Validates billing and shipping postcodes as 10 digits.
- Supports classic WooCommerce checkout and Checkout Blocks/Store API orders.
- Localizes standard shipping-rate labels.
- Hides the Downloads account endpoint by default for physical-product stores.

## What it deliberately does not do

- It does not disable shipping calculation.
- It does not force stock management or backorder behavior.
- It does not install, select or configure a bank payment gateway.
- It does not convert Rial and Toman values.
- It does not calculate carrier rates, taxes, invoices or SMS notifications.

## Installation

1. Install and activate WooCommerce 9.6 or newer.
2. Upload the installable plugin ZIP from **Plugins → Add New → Upload Plugin**.
3. Activate **Maintheme Iran Commerce**.
4. Configure shipping zones and payment gateways in WooCommerce.
5. Complete the checkout tests in the parent theme's `docs/QA-CHECKLIST.md` before launch.

## Extension filters

- `maintheme_iran_commerce_enabled`
- `maintheme_iran_limit_countries`
- `maintheme_iran_hidden_account_endpoints`

All filters default to the Iran-focused behavior described above.

## Compatibility note

The source has been statically checked with PHP 7.4-compatible syntax. A staging-site checkout test is still required with the exact WordPress, WooCommerce, shipping and payment-gateway versions used by the store.
