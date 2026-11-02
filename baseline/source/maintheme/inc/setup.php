<?php
/**
 * Theme setup.
 *
 * @package Maintheme
 */

namespace Maintheme\Setup;

defined( 'ABSPATH' ) || exit;

/**
 * Register theme supports and editor styles.
 */
function setup(): void {
	load_theme_textdomain( 'maintheme', get_template_directory() . '/languages' );

	add_theme_support( 'align-wide' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'editor-styles' );
	add_theme_support( 'html5', array( 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'wp-block-styles' );
	add_theme_support(
		'woocommerce',
		array(
			'thumbnail_image_width' => 720,
			'single_image_width'    => 1024,
			'product_grid'          => array(
				'default_rows'    => 4,
				'min_rows'        => 1,
				'max_rows'        => 8,
				'default_columns' => 3,
				'min_columns'     => 2,
				'max_columns'     => 5,
			),
		)
	);
	add_theme_support( 'wc-product-gallery-lightbox' );
	add_theme_support( 'wc-product-gallery-slider' );
	add_theme_support( 'wc-product-gallery-zoom' );

	add_editor_style(
		array(
			'style.css',
			'assets/css/components.css',
			'assets/css/woocommerce.css',
			'assets/css/editor.css',
		)
	);
}
add_action( 'after_setup_theme', __NAMESPACE__ . '\\setup' );

/**
 * Register theme pattern categories.
 */
function register_pattern_categories(): void {
	$categories = array(
		'maintheme-commerce' => __( 'قالب مادر: فروشگاه', 'maintheme' ),
		'maintheme-products' => __( 'قالب مادر: محصول', 'maintheme' ),
		'maintheme-sections' => __( 'قالب مادر: بخش‌ها', 'maintheme' ),
		'maintheme-pages'    => __( 'قالب مادر: برگه‌ها', 'maintheme' ),
	);

	foreach ( $categories as $slug => $label ) {
		register_block_pattern_category( $slug, array( 'label' => $label ) );
	}
}
add_action( 'init', __NAMESPACE__ . '\\register_pattern_categories' );
