<?php
/** Iran-format normalization helpers. */
namespace Maintheme_Iran_Commerce\Helpers;

defined( 'ABSPATH' ) || exit;

function enabled(): bool {
	return (bool) apply_filters( 'maintheme_iran_commerce_enabled', true );
}

function normalize_digits( string $value ): string {
	return strtr( $value, array(
		'۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9',
		'٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
	) );
}

function normalize_mobile( string $value ): string {
	$value = preg_replace( '/[^0-9+]/', '', normalize_digits( $value ) ) ?: '';
	if ( 0 === strpos( $value, '+98' ) ) {
		$value = '0' . substr( $value, 3 );
	} elseif ( 0 === strpos( $value, '0098' ) ) {
		$value = '0' . substr( $value, 4 );
	} elseif ( 0 === strpos( $value, '98' ) && 12 === strlen( $value ) ) {
		$value = '0' . substr( $value, 2 );
	} elseif ( 10 === strlen( $value ) && '9' === $value[0] ) {
		$value = '0' . $value;
	}
	return $value;
}

function normalize_postcode( string $value ): string {
	return preg_replace( '/\D/', '', normalize_digits( $value ) ) ?: '';
}

function valid_mobile( string $value ): bool {
	return 1 === preg_match( '/^09\d{9}$/', normalize_mobile( $value ) );
}

function valid_postcode( string $value ): bool {
	return 1 === preg_match( '/^\d{10}$/', normalize_postcode( $value ) );
}
