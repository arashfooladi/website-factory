<?php
/** Iranian physical-store account defaults. */
namespace Maintheme_Iran_Commerce\Account;

defined( 'ABSPATH' ) || exit;

function menu_items( array $items ): array {
	$hidden = (array) apply_filters( 'maintheme_iran_hidden_account_endpoints', array( 'downloads' ) );
	foreach ( $hidden as $endpoint ) {
		unset( $items[ $endpoint ] );
	}
	return $items;
}
add_filter( 'woocommerce_account_menu_items', __NAMESPACE__ . '\\menu_items', 20 );
