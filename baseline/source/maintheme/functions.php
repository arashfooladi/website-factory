<?php
/**
 * Maintheme bootstrap.
 *
 * @package Maintheme
 */

defined( 'ABSPATH' ) || exit;

define( 'MAINTHEME_VERSION', '0.4.0' );
define( 'MAINTHEME_PATH', get_template_directory() );
define( 'MAINTHEME_URL', get_template_directory_uri() );

define( 'MAINTHEME_MINIMUM_WOOCOMMERCE', '9.6' );

$maintheme_files = array(
	'inc/setup.php',
	'inc/assets.php',
	'inc/editor.php',
	'inc/admin.php',
	'inc/presentation.php',
	'inc/starter-content.php',
	'inc/woocommerce.php',
	'inc/compatibility.php',
);

foreach ( $maintheme_files as $maintheme_file ) {
	require_once MAINTHEME_PATH . '/' . $maintheme_file;
}
