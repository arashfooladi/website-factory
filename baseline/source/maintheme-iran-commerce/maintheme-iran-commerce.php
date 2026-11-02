<?php
/**
 * Plugin Name: Maintheme Iran Commerce
 * Plugin URI: https://example.com/maintheme
 * Description: Iran-only WooCommerce checkout defaults: Iranian mobile and postcode normalization, domestic country rules, address requirements and Persian shipping labels.
 * Version: 0.4.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * Author: Maintheme Studio
 * License: GPL-2.0-or-later
 * Text Domain: maintheme-iran-commerce
 */

defined( 'ABSPATH' ) || exit;

define( 'MAINTHEME_IR_COMMERCE_VERSION', '0.4.0' );
define( 'MAINTHEME_IR_COMMERCE_MINIMUM_WOOCOMMERCE', '9.6' );
define( 'MAINTHEME_IR_COMMERCE_PATH', plugin_dir_path( __FILE__ ) );

require_once MAINTHEME_IR_COMMERCE_PATH . 'includes/helpers.php';
require_once MAINTHEME_IR_COMMERCE_PATH . 'includes/checkout.php';
require_once MAINTHEME_IR_COMMERCE_PATH . 'includes/account.php';
require_once MAINTHEME_IR_COMMERCE_PATH . 'includes/compatibility.php';

/** Load plugin translations. */
function maintheme_iran_commerce_load_textdomain(): void {
	load_plugin_textdomain( 'maintheme-iran-commerce', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}
add_action( 'plugins_loaded', 'maintheme_iran_commerce_load_textdomain' );
