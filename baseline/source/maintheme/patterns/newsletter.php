<?php
/**
 * Title: Newsletter call to action
 * Slug: maintheme/newsletter
 * Categories: maintheme-sections
 * Viewport Width: 1280
 * Inserter: yes
 *
 * @package Maintheme
 */
?>
<!-- wp:group {"align":"wide","backgroundColor":"accent","textColor":"base","className":"maintheme-newsletter","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60","left":"var:preset|spacing|50","right":"var:preset|spacing|50"},"margin":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained","contentSize":"760px"}} -->
<div class="wp-block-group alignwide maintheme-newsletter has-base-color has-accent-background-color has-text-color has-background" style="margin-top:var(--wp--preset--spacing--70);margin-bottom:var(--wp--preset--spacing--70);padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--50);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--50)"><!-- wp:heading {"textAlign":"center","level":2,"textColor":"base"} -->
<h2 class="wp-block-heading has-text-align-center has-base-color has-text-color">از پیشنهادهای تازه باخبر شوید</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">بلوک فرم خبرنامه افزونه ایمیل خود را در این قسمت قرار دهید یا دکمه را به کانال ارتباطی فروشگاه متصل کنید.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"base","textColor":"accent"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-accent-color has-base-background-color has-text-color has-background wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>">ارتباط با ما</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group -->

