<?php
/** Iran-only WooCommerce checkout behavior. */
namespace Maintheme_Iran_Commerce\Checkout;

use function Maintheme_Iran_Commerce\Helpers\enabled;
use function Maintheme_Iran_Commerce\Helpers\normalize_mobile;
use function Maintheme_Iran_Commerce\Helpers\normalize_postcode;
use function Maintheme_Iran_Commerce\Helpers\valid_mobile;
use function Maintheme_Iran_Commerce\Helpers\valid_postcode;

defined( 'ABSPATH' ) || exit;

function allowed_countries( array $countries ): array {
	if ( ! enabled() || ! apply_filters( 'maintheme_iran_limit_countries', true ) ) {
		return $countries;
	}
	return isset( $countries['IR'] ) ? array( 'IR' => $countries['IR'] ) : $countries;
}
add_filter( 'woocommerce_countries_allowed_countries', __NAMESPACE__ . '\\allowed_countries' );
add_filter( 'woocommerce_countries_shipping_countries', __NAMESPACE__ . '\\allowed_countries' );

function default_customer_location( array $location ): array {
	return enabled() ? array( 'country' => 'IR', 'state' => '' ) : $location;
}
add_filter( 'woocommerce_customer_default_location_array', __NAMESPACE__ . '\\default_customer_location' );

function country_locale( array $locales ): array {
	if ( ! enabled() || empty( $locales['IR'] ) ) {
		return $locales;
	}
	$fields = array(
		'state'     => array( 'required' => true, 'label' => __( 'استان', 'maintheme-iran-commerce' ) ),
		'city'      => array( 'required' => true, 'label' => __( 'شهر', 'maintheme-iran-commerce' ) ),
		'address_1' => array( 'required' => true, 'label' => __( 'نشانی دقیق', 'maintheme-iran-commerce' ) ),
		'postcode'  => array( 'required' => true, 'label' => __( 'کد پستی ۱۰ رقمی', 'maintheme-iran-commerce' ) ),
		'phone'     => array( 'required' => true, 'label' => __( 'شماره موبایل', 'maintheme-iran-commerce' ) ),
	);
	foreach ( $fields as $key => $settings ) {
		$locales['IR'][ $key ] = wp_parse_args( $settings, $locales['IR'][ $key ] ?? array() );
	}
	return $locales;
}
add_filter( 'woocommerce_get_country_locale', __NAMESPACE__ . '\\country_locale' );

function classic_checkout_fields( array $fields ): array {
	if ( ! enabled() ) {
		return $fields;
	}
	foreach ( array( 'billing_phone', 'billing_postcode', 'billing_state', 'billing_city', 'billing_address_1' ) as $key ) {
		if ( isset( $fields['billing'][ $key ] ) ) {
			$fields['billing'][ $key ]['required'] = true;
		}
	}
	foreach ( array( 'shipping_postcode', 'shipping_state', 'shipping_city', 'shipping_address_1' ) as $key ) {
		if ( isset( $fields['shipping'][ $key ] ) ) {
			$fields['shipping'][ $key ]['required'] = true;
		}
	}
	return $fields;
}
add_filter( 'woocommerce_checkout_fields', __NAMESPACE__ . '\\classic_checkout_fields', 20 );

function normalize_posted_data( array $data ): array {
	foreach ( array( 'billing_postcode', 'shipping_postcode' ) as $key ) {
		if ( isset( $data[ $key ] ) ) {
			$data[ $key ] = normalize_postcode( (string) $data[ $key ] );
		}
	}
	if ( isset( $data['billing_phone'] ) ) {
		$data['billing_phone'] = normalize_mobile( (string) $data['billing_phone'] );
	}
	return $data;
}
add_filter( 'woocommerce_checkout_posted_data', __NAMESPACE__ . '\\normalize_posted_data' );

function validate_classic_checkout( array $data, \WP_Error $errors ): void {
	if ( ! enabled() ) {
		return;
	}
	if ( 'IR' === (string) ( $data['billing_country'] ?? 'IR' ) && ! valid_mobile( (string) ( $data['billing_phone'] ?? '' ) ) ) {
		$errors->add( 'billing_phone', __( 'شماره موبایل را به صورت ۰۹xxxxxxxxx وارد کنید.', 'maintheme-iran-commerce' ) );
	}
	if ( 'IR' === (string) ( $data['billing_country'] ?? 'IR' ) && ! valid_postcode( (string) ( $data['billing_postcode'] ?? '' ) ) ) {
		$errors->add( 'billing_postcode', __( 'کد پستی صورتحساب باید دقیقاً ۱۰ رقم باشد.', 'maintheme-iran-commerce' ) );
	}
	$ship_to_different = ! empty( $data['ship_to_different_address'] );
	if ( $ship_to_different && 'IR' === (string) ( $data['shipping_country'] ?? 'IR' ) && ! valid_postcode( (string) ( $data['shipping_postcode'] ?? '' ) ) ) {
		$errors->add( 'shipping_postcode', __( 'کد پستی نشانی ارسال باید دقیقاً ۱۰ رقم باشد.', 'maintheme-iran-commerce' ) );
	}
}
add_action( 'woocommerce_after_checkout_validation', __NAMESPACE__ . '\\validate_classic_checkout', 20, 2 );

function validate_store_api_order( \WC_Order $order, \WP_REST_Request $request ): void {
	unset( $request );
	if ( ! enabled() ) {
		return;
	}
	$billing_phone = normalize_mobile( (string) $order->get_billing_phone() );
	$order->set_billing_phone( $billing_phone );
	if ( 'IR' === $order->get_billing_country() && ! valid_mobile( $billing_phone ) ) {
		throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException( 'maintheme_invalid_phone', __( 'شماره موبایل را به صورت ۰۹xxxxxxxxx وارد کنید.', 'maintheme-iran-commerce' ), 400 );
	}
	foreach ( array( 'billing', 'shipping' ) as $type ) {
		$get_country  = "get_{$type}_country";
		$get_postcode = "get_{$type}_postcode";
		$set_postcode = "set_{$type}_postcode";
		if ( ! is_callable( array( $order, $get_country ) ) || 'IR' !== $order->{$get_country}() ) {
			continue;
		}
		$postcode = normalize_postcode( (string) $order->{$get_postcode}() );
		$order->{$set_postcode}( $postcode );
		if ( ! valid_postcode( $postcode ) ) {
			throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException( 'maintheme_invalid_' . $type . '_postcode', __( 'کد پستی باید دقیقاً ۱۰ رقم باشد.', 'maintheme-iran-commerce' ), 400 );
		}
	}
}
add_action( 'woocommerce_store_api_checkout_update_order_from_request', __NAMESPACE__ . '\\validate_store_api_order', 20, 2 );

function shipping_rate_labels( array $rates ): array {
	$labels = array(
		'Free shipping' => __( 'ارسال رایگان', 'maintheme-iran-commerce' ),
		'Flat rate'     => __( 'ارسال با نرخ ثابت', 'maintheme-iran-commerce' ),
		'Local pickup'  => __( 'تحویل حضوری', 'maintheme-iran-commerce' ),
	);
	foreach ( $rates as $rate ) {
		if ( $rate instanceof \WC_Shipping_Rate && isset( $labels[ $rate->get_label() ] ) ) {
			$rate->set_label( $labels[ $rate->get_label() ] );
		}
	}
	return $rates;
}
add_filter( 'woocommerce_package_rates', __NAMESPACE__ . '\\shipping_rate_labels', 20 );
