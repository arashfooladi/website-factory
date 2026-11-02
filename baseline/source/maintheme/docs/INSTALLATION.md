# Installation

## Recommended order

1. Install WordPress 6.6 or newer and configure the site language as Persian.
2. Install WooCommerce and let it create Shop, Cart, Checkout and My Account pages.
3. Upload `maintheme-0.4.0.zip` from **Appearance → Themes → Add New → Upload Theme**.
4. Upload `maintheme-iran-commerce-0.4.0.zip` from **Plugins → Add New → Upload Plugin** and activate it.
5. Install a client child theme. Use the included starter or create one with `Template: maintheme`.
6. Open **Appearance → Maintheme** to enter announcement, support, footer and product reassurance text.
7. Run the explicit starter-page installer only when those pages are useful.
8. Open **Appearance → Editor** to set the logo, navigation, header, footer, colors and typography.
9. Configure WooCommerce shipping zones, inventory, taxes and the official bank payment gateway. The theme does not force these merchant decisions.

## Important after upgrading from 0.3.1

Activate the companion plugin before accepting new checkout traffic. Version 0.4.0 no longer contains checkout validation inside the theme.

Saved Site Editor templates and parts in the database override files shipped with the theme. Review customized templates after upgrading and use **Clear customizations** only when you deliberately want the new parent file.
