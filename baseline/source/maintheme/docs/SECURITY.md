# Security and data handling

- Theme settings use WordPress Settings API sanitization.
- The starter installer requires `edit_theme_options` and a valid nonce.
- Dynamic output is escaped for HTML, attributes or URLs as appropriate.
- The checkout plugin validates again on the server for both classic and Store API checkout.
- No gateway credentials, API keys or customer data are stored by the theme.
- Keep WordPress, WooCommerce, gateways and all extensions updated and test upgrades on staging.
