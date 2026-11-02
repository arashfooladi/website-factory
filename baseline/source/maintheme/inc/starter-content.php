<?php
/**
 * Explicit, non-destructive starter content.
 *
 * @package Maintheme
 */

namespace Maintheme\Starter_Content;

defined( 'ABSPATH' ) || exit;

/** Load a bundled pattern's block markup. */
function pattern_content( string $slug ): string {
	$file = MAINTHEME_PATH . '/patterns/' . sanitize_file_name( $slug ) . '.php';
	if ( ! is_readable( $file ) ) {
		return '';
	}
	ob_start();
	include $file;
	return trim( (string) ob_get_clean() );
}

/** Return editable starter-homepage blocks. */
function homepage_content(): string {
	$patterns = (array) apply_filters(
		'maintheme_homepage_patterns',
		array(
			'hero',
			'category-grid',
			'sale-collection',
			'promo-split',
			'new-arrivals',
			'features',
			'testimonials',
			'faq',
			'newsletter',
		)
	);
	return implode( "\n\n", array_filter( array_map( __NAMESPACE__ . '\\pattern_content', $patterns ) ) );
}

/** Create a page only when the slug does not already exist. */
function create_page( string $slug, string $title, string $content = '', string $template = '' ): int {
	$existing = get_page_by_path( $slug, OBJECT, 'page' );
	if ( $existing instanceof \WP_Post ) {
		return (int) $existing->ID;
	}

	$status = (string) apply_filters( 'maintheme_starter_page_status', 'publish', $slug );
	$page_id = wp_insert_post(
		array(
			'post_type'    => 'page',
			'post_status'  => in_array( $status, array( 'publish', 'draft', 'private' ), true ) ? $status : 'publish',
			'post_title'   => $title,
			'post_name'    => $slug,
			'post_content' => $content,
		),
		true
	);
	if ( is_wp_error( $page_id ) ) {
		return 0;
	}
	if ( $template ) {
		update_post_meta( $page_id, '_wp_page_template', $template );
	}
	return (int) $page_id;
}

/** Return all starter-page definitions, filterable by child themes. */
function page_definitions(): array {
	$about = '<!-- wp:paragraph {"fontSize":"medium"} --><p class="has-medium-font-size">داستان، ارزش‌ها، مجوزها و دلیل اعتماد مشتریان به فروشگاه را اینجا بنویسید.</p><!-- /wp:paragraph --><!-- wp:columns --><div class="wp-block-columns"><!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":2} --><h2 class="wp-block-heading">داستان ما</h2><!-- /wp:heading --><!-- wp:paragraph --><p>این متن را با معرفی واقعی کسب‌وکار جایگزین کنید.</p><!-- /wp:paragraph --></div><!-- /wp:column --><!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":2} --><h2 class="wp-block-heading">تعهد ما</h2><!-- /wp:heading --><!-- wp:paragraph --><p>کیفیت، شفافیت، اصالت کالا و پشتیبانی خود را توضیح دهید.</p><!-- /wp:paragraph --></div><!-- /wp:column --></div><!-- /wp:columns -->';
	$contact = '<!-- wp:columns --><div class="wp-block-columns"><!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":2} --><h2 class="wp-block-heading">راه‌های ارتباطی</h2><!-- /wp:heading --><!-- wp:paragraph --><p>شماره تماس، ایمیل، نشانی، ساعات پاسخ‌گویی و شبکه‌های اجتماعی را وارد کنید.</p><!-- /wp:paragraph --></div><!-- /wp:column --><!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":2} --><h2 class="wp-block-heading">پیام شما</h2><!-- /wp:heading --><!-- wp:paragraph --><p>بلوک افزونه فرم تماس مورد اعتماد خود را در این قسمت قرار دهید.</p><!-- /wp:paragraph --></div><!-- /wp:column --></div><!-- /wp:columns -->';
	$shipping = '<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">روش‌ها و زمان ارسال</h2><!-- /wp:heading --><!-- wp:paragraph --><p>محدوده ارسال، هزینه‌ها، زمان آماده‌سازی و روش پیگیری سفارش را دقیق بنویسید.</p><!-- /wp:paragraph --><!-- wp:heading {"level":2} --><h2 class="wp-block-heading">شرایط بازگشت</h2><!-- /wp:heading --><!-- wp:paragraph --><p>مهلت، وضعیت قابل قبول کالا، استثناها، هزینه بازگشت و روش درخواست را شفاف توضیح دهید.</p><!-- /wp:paragraph -->';
	$warranty = '<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">اصالت و ضمانت</h2><!-- /wp:heading --><!-- wp:paragraph --><p>نوع ضمانت، مدت آن، شرکت ارائه‌دهنده، موارد خارج از پوشش و روش استفاده از خدمات را بنویسید.</p><!-- /wp:paragraph -->';
	$privacy = '<!-- wp:paragraph --><p>نوع اطلاعات جمع‌آوری‌شده، هدف استفاده، کوکی‌ها، درگاه پرداخت، ارسال‌کنندگان، مدت نگهداری و راه ارتباط برای درخواست‌های حریم خصوصی را تکمیل کنید.</p><!-- /wp:paragraph -->';
	$terms = '<!-- wp:paragraph --><p>قوانین خرید، قیمت‌گذاری، پرداخت، ارسال، لغو سفارش، بازگشت کالا، حریم خصوصی و مسئولیت‌های طرفین را با نظر متخصص حقوقی تکمیل کنید.</p><!-- /wp:paragraph -->';

	$pages = array(
		'home'     => array( 'title' => 'خانه', 'content' => homepage_content(), 'template' => 'page-full-width' ),
		'blog'     => array( 'title' => 'مجله', 'content' => '', 'template' => '' ),
		'about'    => array( 'title' => 'درباره ما', 'content' => $about, 'template' => '' ),
		'contact'  => array( 'title' => 'تماس با ما', 'content' => $contact, 'template' => '' ),
		'faq'      => array( 'title' => 'پرسش‌های متداول', 'content' => pattern_content( 'faq' ), 'template' => '' ),
		'shipping-returns' => array( 'title' => 'ارسال و بازگشت', 'content' => $shipping, 'template' => '' ),
		'warranty' => array( 'title' => 'ضمانت و اصالت', 'content' => $warranty, 'template' => '' ),
		'privacy'  => array( 'title' => 'حریم خصوصی', 'content' => $privacy, 'template' => '' ),
		'terms'    => array( 'title' => 'قوانین و مقررات', 'content' => $terms, 'template' => '' ),
	);

	return (array) apply_filters( 'maintheme_starter_pages', $pages );
}

/** Install starter pages after an explicit administrator action. */
function install(): array {
	$created = array();
	foreach ( page_definitions() as $slug => $page ) {
		$created[ $slug ] = create_page(
			(string) $slug,
			(string) ( $page['title'] ?? $slug ),
			(string) ( $page['content'] ?? '' ),
			(string) ( $page['template'] ?? '' )
		);
	}

	if ( ! empty( $created['home'] ) && ! (int) get_option( 'page_on_front' ) ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $created['home'] );
	}
	if ( ! empty( $created['blog'] ) && ! (int) get_option( 'page_for_posts' ) ) {
		update_option( 'page_for_posts', $created['blog'] );
	}

	update_option( 'maintheme_starter_version', MAINTHEME_VERSION );
	return $created;
}
