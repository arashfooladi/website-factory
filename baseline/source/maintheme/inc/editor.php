<?php
/**
 * Editor integrations and reusable block styles.
 *
 * @package Maintheme
 */

namespace Maintheme\Editor;

defined( 'ABSPATH' ) || exit;

/**
 * Register reusable block styles that form part of the child-theme API.
 */
function register_block_styles(): void {
	$styles = array(
		'core/group' => array(
			array( 'name' => 'maintheme-card', 'label' => __( 'کارت', 'maintheme' ) ),
			array( 'name' => 'maintheme-interactive-card', 'label' => __( 'کارت تعاملی', 'maintheme' ) ),
			array( 'name' => 'maintheme-surface-muted', 'label' => __( 'سطح کم‌رنگ', 'maintheme' ) ),
			array( 'name' => 'maintheme-outline', 'label' => __( 'حاشیه‌دار', 'maintheme' ) ),
		),
		'core/image' => array(
			array( 'name' => 'maintheme-rounded', 'label' => __( 'گوشه‌گرد', 'maintheme' ) ),
		),
		'core/button' => array(
			array( 'name' => 'maintheme-soft', 'label' => __( 'رنگ ملایم', 'maintheme' ) ),
			array( 'name' => 'maintheme-full', 'label' => __( 'تمام‌عرض', 'maintheme' ) ),
		),
	);

	foreach ( $styles as $block_name => $block_styles ) {
		foreach ( $block_styles as $style ) {
			register_block_style( $block_name, $style );
		}
	}
}
add_action( 'init', __NAMESPACE__ . '\\register_block_styles' );
