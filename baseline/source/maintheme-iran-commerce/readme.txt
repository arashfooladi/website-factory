=== Maintheme Iran Commerce ===
Contributors: maintheme
Tags: iran, woocommerce, checkout, postcode, mobile
Requires at least: 6.6
Requires PHP: 7.4
Stable tag: 0.4.0
License: GPLv2 or later

Iran-only WooCommerce checkout normalization and validation for Maintheme stores.

== Description ==

* Restricts allowed and shipping countries to Iran by default.
* Defaults guest location to Iran without preselecting a province.
* Requires province, city, detailed address, phone and 10-digit postcode.
* Converts Persian and Arabic digits to ASCII before storage.
* Normalizes +98/0098 Iranian mobile numbers to 09xxxxxxxxx.
* Validates classic checkout and Checkout Block orders.
* Preserves WooCommerce shipping calculations and merchant inventory settings.
* Provides filters for child projects and custom plugins.

== Installation ==

1. Install and activate WooCommerce 9.6 or newer.
2. Upload this plugin ZIP from Plugins > Add New > Upload Plugin.
3. Activate the plugin.
4. Configure shipping zones and payment gateways in WooCommerce.

== Changelog ==

= 0.4.0 =
* Initial separated release from Maintheme parent theme.
