<?php
/**
 * Frontend rendering for global theme settings.
 *
 * @package Maintheme
 */

namespace Maintheme\Presentation;

use function Maintheme\Admin\options;

defined( 'ABSPATH' ) || exit;

/** Check whether a parsed block has a custom class. */
function has_class( array $block, string $class ): bool {
	$class_name = (string) ( $block['attrs']['className'] ?? '' );
	return in_array( $class, preg_split( '/\s+/', trim( $class_name ) ) ?: array(), true );
}

/** Resolve an internal starter URL safely. */
function resolve_url( string $url ): string {
	$woocommerce_pages = array(
		'/shop/'       => 'shop',
		'/cart/'       => 'cart',
		'/checkout/'   => 'checkout',
		'/my-account/' => 'myaccount',
	);

	if ( isset( $woocommerce_pages[ $url ] ) && function_exists( 'wc_get_page_permalink' ) ) {
		$resolved = wc_get_page_permalink( $woocommerce_pages[ $url ] );
	} else {
		$resolved = home_url( $url );
	}

	return $resolved ?: $url;
}

/** Replace the inside of the first matching HTML tag while preserving attributes. */
function replace_first_tag_content( string $html, string $tag, string $replacement ): string {
	$pattern = sprintf( '/(<%1$s\b[^>]*>).*?(<\/%1$s>)/is', preg_quote( $tag, '/' ) );
	return (string) preg_replace_callback(
		$pattern,
		static fn( array $matches ): string => $matches[1] . $replacement . $matches[2],
		$html,
		1
	);
}

/** Render the announcement as a managed block without affecting unrelated blocks. */
function render_announcement( string $block_content, array $block ): string {
	if ( ! has_class( $block, 'maintheme-announcement' ) ) {
		return $block_content;
	}

	$settings = options();
	if ( empty( $settings['announcement_enabled'] ) || empty( $settings['announcement_text'] ) ) {
		return '';
	}

	$content = esc_html( (string) $settings['announcement_text'] );
	if ( ! empty( $settings['announcement_link_url'] ) && ! empty( $settings['announcement_link_label'] ) ) {
		$url = (string) $settings['announcement_link_url'];
		$url = 0 === strpos( $url, '/' ) ? resolve_url( $url ) : $url;
		$content .= sprintf(
			' <span aria-hidden="true">·</span> <a href="%1$s">%2$s</a>',
			esc_url( $url ),
			esc_html( (string) $settings['announcement_link_label'] )
		);
	}

	return replace_first_tag_content( $block_content, 'p', $content );
}
add_filter( 'render_block_core/group', __NAMESPACE__ . '\\render_announcement', 20, 2 );

/** Render managed footer text while preserving the block wrapper and styles. */
function render_managed_paragraphs( string $block_content, array $block ): string {
	$settings = options();

	if ( has_class( $block, 'maintheme-footer-note' ) ) {
		return replace_first_tag_content( $block_content, 'p', nl2br( esc_html( (string) $settings['footer_note'] ) ) );
	}

	if ( has_class( $block, 'maintheme-footer-copyright' ) ) {
		$content = sprintf(
			'© %1$s %2$s',
			esc_html( wp_date( 'Y' ) ),
			esc_html( (string) $settings['copyright_text'] )
		);
		return replace_first_tag_content( $block_content, 'p', $content );
	}

	if ( has_class( $block, 'maintheme-product-delivery-note' ) ) {
		return replace_first_tag_content( $block_content, 'p', esc_html( (string) $settings['product_delivery_note'] ) );
	}

	if ( has_class( $block, 'maintheme-product-return-note' ) ) {
		$url = (string) $settings['return_policy_url'];
		$url = 0 === strpos( $url, '/' ) ? resolve_url( $url ) : $url;
		$text = esc_html( (string) $settings['product_return_note'] );
		if ( $url ) {
			$text = sprintf( '<a href="%1$s">%2$s</a>', esc_url( $url ), $text );
		}
		return replace_first_tag_content( $block_content, 'p', $text );
	}

	return $block_content;
}
add_filter( 'render_block_core/paragraph', __NAMESPACE__ . '\\render_managed_paragraphs', 20, 2 );

/** Render the dedicated footer-contact component. */
function render_footer_contact( string $block_content, array $block ): string {
	if ( ! has_class( $block, 'maintheme-footer-contact' ) ) {
		return $block_content;
	}

	$settings      = options();
	$contact_items = array();
	$social_items  = array();

	if ( ! empty( $settings['support_phone'] ) ) {
		$phone           = (string) $settings['support_phone'];
		$contact_items[] = sprintf(
			'<span><a href="tel:%1$s" dir="ltr">%2$s</a></span>',
			esc_attr( preg_replace( '/[^0-9+]/', '', $phone ) ),
			esc_html( $phone )
		);
	}
	if ( ! empty( $settings['support_email'] ) ) {
		$email           = (string) $settings['support_email'];
		$contact_items[] = sprintf( '<span><a href="mailto:%1$s" dir="ltr">%1$s</a></span>', esc_attr( $email ) );
	}
	if ( ! empty( $settings['support_hours'] ) ) {
		$contact_items[] = '<span>' . esc_html( (string) $settings['support_hours'] ) . '</span>';
	}
	if ( ! empty( $settings['store_address'] ) ) {
		$contact_items[] = '<span>' . nl2br( esc_html( (string) $settings['store_address'] ) ) . '</span>';
	}

	foreach ( array( 'instagram_url' => 'اینستاگرام', 'telegram_url' => 'تلگرام', 'whatsapp_url' => 'واتساپ' ) as $key => $label ) {
		if ( ! empty( $settings[ $key ] ) ) {
			$social_items[] = sprintf(
				'<a href="%1$s" rel="noopener noreferrer">%2$s</a>',
				esc_url( (string) $settings[ $key ] ),
				esc_html( $label )
			);
		}
	}

	$details = $contact_items
		? '<address>' . implode( '', $contact_items ) . '</address>'
		: '<p>' . esc_html__( 'اطلاعات تماس را از نمایش ← قالب مادر وارد کنید.', 'maintheme' ) . '</p>';
	$social = $social_items
		? '<nav class="maintheme-footer-social" aria-label="' . esc_attr__( 'شبکه‌های اجتماعی', 'maintheme' ) . '">' . implode( '<span aria-hidden="true">·</span>', $social_items ) . '</nav>'
		: '';

	$managed_content = '<h3 class="wp-block-heading has-medium-font-size">' . esc_html__( 'ارتباط با ما', 'maintheme' ) . '</h3>' . $details . $social;

	return replace_first_tag_content( $block_content, 'div', $managed_content );
}
add_filter( 'render_block_core/group', __NAMESPACE__ . '\\render_footer_contact', 21, 2 );

/** Resolve only URLs explicitly marked as bundled starter links. */
function resolve_block_urls( array $parsed_block ): array {
	if ( ! has_class( $parsed_block, 'maintheme-resolve-url' ) ) {
		return $parsed_block;
	}

	$url = (string) ( $parsed_block['attrs']['url'] ?? '' );
	if ( $url && 0 === strpos( $url, '/' ) && 0 !== strpos( $url, '//' ) ) {
		$parsed_block['attrs']['url'] = resolve_url( $url );
	}

	return $parsed_block;
}
add_filter( 'render_block_data', __NAMESPACE__ . '\\resolve_block_urls' );

/** Resolve static anchors only inside explicitly marked starter blocks. */
function resolve_static_links( string $block_content, array $block ): string {
	if ( ! has_class( $block, 'maintheme-resolve-url' ) || false === strpos( $block_content, 'href="/' ) || ! class_exists( '\\WP_HTML_Tag_Processor' ) ) {
		return $block_content;
	}

	$processor = new \WP_HTML_Tag_Processor( $block_content );
	while ( $processor->next_tag( 'a' ) ) {
		$href = (string) $processor->get_attribute( 'href' );
		if ( 0 === strpos( $href, '/' ) && 0 !== strpos( $href, '//' ) ) {
			$processor->set_attribute( 'href', resolve_url( $href ) );
		}
	}

	return $processor->get_updated_html();
}
add_filter( 'render_block', __NAMESPACE__ . '\\resolve_static_links', 5, 2 );

/** Scope the header search to products and prevent duplicate hidden inputs. */
function product_search( string $block_content, array $block ): string {
	if ( ! has_class( $block, 'maintheme-product-search' ) || false === strpos( $block_content, '</form>' ) || false !== strpos( $block_content, 'name="post_type"' ) ) {
		return $block_content;
	}

	return str_replace( '</form>', '<input type="hidden" name="post_type" value="product"></form>', $block_content );
}
add_filter( 'render_block_core/search', __NAMESPACE__ . '\\product_search', 20, 2 );
