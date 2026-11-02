<?php
/**
 * Frontend assets.
 *
 * @package Maintheme
 */

namespace Maintheme\Assets;

defined( 'ABSPATH' ) || exit;

/**
 * Return a development-friendly asset version.
 */
function version( string $relative_path ): string {
	$file = MAINTHEME_PATH . '/' . ltrim( $relative_path, '/' );
	return is_readable( $file ) ? (string) filemtime( $file ) : MAINTHEME_VERSION;
}

/**
 * Enqueue the parent and child theme styles in a deterministic order.
 */
function enqueue(): void {
	wp_enqueue_style(
		'maintheme-parent',
		MAINTHEME_URL . '/style.css',
		array(),
		version( 'style.css' )
	);

	wp_enqueue_style(
		'maintheme-components',
		MAINTHEME_URL . '/assets/css/components.css',
		array( 'maintheme-parent' ),
		version( 'assets/css/components.css' )
	);

	$last_parent_handle = 'maintheme-components';

	if ( class_exists( 'WooCommerce' ) ) {
		wp_enqueue_style(
			'maintheme-woocommerce',
			MAINTHEME_URL . '/assets/css/woocommerce.css',
			array( 'maintheme-components' ),
			version( 'assets/css/woocommerce.css' )
		);
		$last_parent_handle = 'maintheme-woocommerce';
	}

	if ( is_child_theme() ) {
		$child_theme        = wp_get_theme();
		$child_dependencies = (array) apply_filters(
			'maintheme_child_style_dependencies',
			array( $last_parent_handle )
		);

		wp_enqueue_style(
			'maintheme-child',
			get_stylesheet_uri(),
			array_values( array_unique( array_filter( $child_dependencies ) ) ),
			(string) $child_theme->get( 'Version' )
		);
	}
}
add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue' );
