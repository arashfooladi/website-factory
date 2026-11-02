<?php
/**
 * Title: New arrivals
 * Slug: maintheme/new-arrivals
 * Categories: maintheme-commerce, maintheme-sections
 * Viewport Width: 1280
 * Inserter: yes
 * Block Types: woocommerce/product-collection
 *
 * @package Maintheme
 */
?>
<!-- wp:group {"align":"wide","style":{"spacing":{"margin":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide" style="margin-top:var(--wp--preset--spacing--70);margin-bottom:var(--wp--preset--spacing--70)"><!-- wp:group {"className":"maintheme-section-heading","layout":{"type":"flex","justifyContent":"space-between","verticalAlignment":"bottom"}} -->
<div class="wp-block-group maintheme-section-heading"><!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">تازه‌ترین محصولات</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"fontSize":"small"} -->
<p class="has-small-font-size"><a href="<?php echo esc_url( \Maintheme\Presentation\resolve_url( '/shop/' ) ); ?>">مشاهده فروشگاه</a></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:woocommerce/product-collection {"queryId":2,"query":{"woocommerceAttributes":[],"woocommerceStockStatus":["instock","outofstock","onbackorder"],"taxQuery":{},"isProductCollectionBlock":true,"perPage":4,"pages":0,"offset":0,"postType":"product","order":"desc","orderBy":"date","search":"","exclude":[],"sticky":"","inherit":false},"tagName":"div","dimensions":{"widthType":"fill","fixedWidth":""},"displayLayout":{"type":"flex","columns":4,"shrinkColumns":true},"convertedFromProducts":false,"queryContextIncludes":["collection"]} -->
<div class="wp-block-woocommerce-product-collection"><!-- wp:woocommerce/product-template {"className":"maintheme-product-template"} -->
<!-- wp:woocommerce/product-image {"showSaleBadge":true,"imageSizing":"thumbnail","isDescendentOfQueryLoop":true} /-->
<!-- wp:post-title {"textAlign":"center","level":3,"isLink":true,"fontSize":"medium","__woocommerceNamespace":"woocommerce/product-collection/product-title"} /-->
<!-- wp:woocommerce/product-price {"textAlign":"center","isDescendentOfQueryLoop":true,"fontSize":"small"} /-->
<!-- wp:woocommerce/product-button {"textAlign":"center","isDescendentOfQueryLoop":true,"fontSize":"small"} /-->
<!-- /wp:woocommerce/product-template --></div>
<!-- /wp:woocommerce/product-collection --></div>
<!-- /wp:group -->

