<?php
/**
 * Title: Split promotional banners
 * Slug: maintheme/promo-split
 * Categories: maintheme-commerce, maintheme-sections
 * Viewport Width: 1280
 * Inserter: yes
 *
 * @package Maintheme
 */
?>
<!-- wp:columns {"align":"wide","style":{"spacing":{"margin":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}}} -->
<div class="wp-block-columns alignwide" style="margin-top:var(--wp--preset--spacing--70);margin-bottom:var(--wp--preset--spacing--70)"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"backgroundColor":"accent-soft","className":"maintheme-promo-panel","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60","left":"var:preset|spacing|50","right":"var:preset|spacing|50"}},"dimensions":{"minHeight":"300px"}},"layout":{"type":"flex","orientation":"vertical","justifyContent":"center"}} -->
<div class="wp-block-group maintheme-promo-panel has-accent-soft-background-color has-background" style="min-height:300px;padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--50);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--50)"><!-- wp:paragraph {"textColor":"accent","fontSize":"small"} -->
<p class="has-accent-color has-text-color has-small-font-size">مجموعه منتخب</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">برای نیاز امروز شما</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>متن، رنگ، تصویر پس‌زمینه و پیوند این بنر را از ویرایشگر تغییر دهید.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( \Maintheme\Presentation\resolve_url( '/shop/' ) ); ?>">مشاهده مجموعه</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"backgroundColor":"contrast","textColor":"base","className":"maintheme-promo-panel","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60","left":"var:preset|spacing|50","right":"var:preset|spacing|50"}},"dimensions":{"minHeight":"300px"}},"layout":{"type":"flex","orientation":"vertical","justifyContent":"center"}} -->
<div class="wp-block-group maintheme-promo-panel has-base-color has-contrast-background-color has-text-color has-background" style="min-height:300px;padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--50);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--50)"><!-- wp:paragraph {"textColor":"highlight","fontSize":"small"} -->
<p class="has-highlight-color has-text-color has-small-font-size">فرصت محدود</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2,"textColor":"base"} -->
<h2 class="wp-block-heading has-base-color has-text-color">پیشنهاد ویژه فروشگاه</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>این قسمت برای کمپین‌ها، معرفی دسته یا پیام مهم فروشگاه آماده شده است.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"highlight","textColor":"contrast"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-contrast-color has-highlight-background-color has-text-color has-background wp-element-button" href="<?php echo esc_url( \Maintheme\Presentation\resolve_url( '/shop/' ) ); ?>">خرید کنید</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->

