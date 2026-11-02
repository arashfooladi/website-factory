# Child themes

## Minimum files

```text
client-theme/
├── style.css
├── theme.json
└── functions.php
```

The `style.css` header must include:

```css
Template: maintheme
```

The parent automatically enqueues its styles before the child stylesheet. Do not enqueue the parent stylesheet again.

## Recommended customization order

1. Change palette, typography and custom tokens in the child `theme.json`.
2. Add small client-specific rules to the child `style.css`.
3. Copy only a template part that requires structural change, such as `parts/header.html`.
4. Copy a top-level template only when the client truly needs a different layout.
5. Put shipping, gateway, SMS, stock and order behavior in plugins, never in a child theme.

## Template override behavior

Parent templates now reference parts only by slug. A child file such as `parts/header.html` can therefore override the parent header. Site Editor customizations saved in the database still take priority over both parent and child files.

## Product cards

Every WooCommerce Product Template list item receives:

```text
maintheme-product-card
```

Optional parent variants are:

```text
maintheme-product-card--compact
maintheme-product-card--minimal
```

A child theme can add classes through `maintheme_product_card_classes`.
