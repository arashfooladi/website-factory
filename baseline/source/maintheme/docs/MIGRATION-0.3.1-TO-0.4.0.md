# Migration from 0.3.1

1. Create a full database and `wp-content` backup.
2. Test the upgrade on staging.
3. Install and activate `Maintheme Iran Commerce 0.4.0`.
4. Upgrade the parent theme.
5. Confirm WooCommerce shipping zones and rates still appear at checkout.
6. Confirm stock management and backorders match merchant settings; the theme no longer overrides them.
7. Test Iranian mobile formats `0912...`, `912...`, `+98912...` and Persian digits.
8. Test billing and different shipping postcodes.
9. Review Site Editor customizations. Database-saved templates may still contain the old parent-pinned template-part attributes.
10. For each customized template, edit the Template Part block and resave it, or reset only that template and reapply intentional changes.
11. Verify Cart and Checkout pages contain their WooCommerce blocks in page content.
12. Clear full-page, object and CDN caches.
