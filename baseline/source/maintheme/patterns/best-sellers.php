<?php
/**
 * Title: Best sellers
 * Slug: maintheme/best-sellers
 * Categories: maintheme-commerce, maintheme-sections
 * Viewport Width: 1280
 * Inserter: yes
 * Block Types: woocommerce/product-collection
 *
 * @package Maintheme
 */
?>
<!-- wp:group {"align":"wide","style":{"spacing":{"margin":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide" style="margin-top:var(--wp--preset--spacing--70);margin-bottom:var(--wp--preset--spacing--70)"><!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">پرفروش‌ترین محصولات</h2>
<!-- /wp:heading -->

<!-- wp:woocommerce/product-collection {"queryId":3,"query":{"woocommerceAttributes":[],"woocommerceStockStatus":["instock","outofstock","onbackorder"],"taxQuery":{},"isProductCollectionBlock":true,"perPage":4,"pages":0,"offset":0,"postType":"product","order":"desc","orderBy":"popularity","search":"","exclude":[],"sticky":"","inherit":false},"tagName":"div","dimensions":{"widthType":"fill","fixedWidth":""},"displayLayout":{"type":"flex","columns":4,"shrinkColumns":true},"convertedFromProducts":false,"queryContextIncludes":["collection"]} -->
<div class="wp-block-woocommerce-product-collection"><!-- wp:woocommerce/product-template {"className":"maintheme-product-template"} -->
<!-- wp:woocommerce/product-image {"showSaleBadge":true,"imageSizing":"thumbnail","isDescendentOfQueryLoop":true} /-->
<!-- wp:post-title {"textAlign":"center","level":3,"isLink":true,"fontSize":"medium","__woocommerceNamespace":"woocommerce/product-collection/product-title"} /-->
<!-- wp:woocommerce/product-price {"textAlign":"center","isDescendentOfQueryLoop":true,"fontSize":"small"} /-->
<!-- wp:woocommerce/product-button {"textAlign":"center","isDescendentOfQueryLoop":true,"fontSize":"small"} /-->
<!-- /wp:woocommerce/product-template --></div>
<!-- /wp:woocommerce/product-collection --></div>
<!-- /wp:group -->
