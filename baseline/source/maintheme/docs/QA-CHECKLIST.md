# Pre-launch QA checklist

## General
- [ ] Logo, favicon, site title and navigation are correct.
- [ ] Header and footer work at 320px, 768px, 1024px and desktop widths.
- [ ] Keyboard focus is visible and not clipped.
- [ ] Site Editor preview broadly matches the frontend.
- [ ] 404, search, blog, standard page and landing page work.

## Catalog
- [ ] Category description appears when populated.
- [ ] Filters, active filters, sorting, count and pagination work together.
- [ ] Empty results provide a clear recovery path.
- [ ] Product cards have consistent image ratios, title heights, prices and buttons.
- [ ] Sale, out-of-stock, variable and simple products are tested.

## Product page
- [ ] Gallery zoom/lightbox/slider work.
- [ ] Short description appears once.
- [ ] Long description/details appear once.
- [ ] Variations, quantity and add-to-cart work.
- [ ] SKU/categories/tags are correct.
- [ ] Delivery and return text links to the correct policy.
- [ ] Related products render correctly.

## Checkout
- [ ] Shipping is still required for physical products.
- [ ] Shipping rates are calculated and selectable.
- [ ] Iranian province, city, address, mobile and postcode are required.
- [ ] Persian digits are normalized.
- [ ] Different shipping address is validated.
- [ ] Every enabled official bank gateway completes a test transaction.
- [ ] Failed, cancelled and successful payment returns are tested.
- [ ] Order confirmation and transactional emails are correct.

## Operations
- [ ] Inventory follows WooCommerce and product settings.
- [ ] Backorders follow product/store settings.
- [ ] Tax, invoice, SMS and fulfillment plugins are tested independently.
- [ ] Backups, caching and security layers are configured.
