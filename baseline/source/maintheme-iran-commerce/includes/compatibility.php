<?php
/** Plugin dependency and version guidance. */
namespace Maintheme_Iran_Commerce\Compatibility;

defined( 'ABSPATH' ) || exit;

/** Display non-blocking dependency guidance to administrators. */
function admin_notice(): void {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}

	if ( ! class_exists( 'WooCommerce' ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'Maintheme Iran Commerce برای کارکرد به ووکامرس نیاز دارد.', 'maintheme-iran-commerce' ) . '</p></div>';
		return;
	}

	if ( defined( 'WC_VERSION' ) && version_compare( WC_VERSION, MAINTHEME_IR_COMMERCE_MINIMUM_WOOCOMMERCE, '<' ) ) {
		echo '<div class="notice notice-warning"><p>' . sprintf(
			/* translators: 1: installed WooCommerce version, 2: recommended minimum version. */
			esc_html__( 'نسخه ووکامرس شما %1$s است. برای قوانین تسویه‌حساب این افزونه، ووکامرس %2$s یا جدیدتر پیشنهاد می‌شود.', 'maintheme-iran-commerce' ),
			esc_html( WC_VERSION ),
			esc_html( MAINTHEME_IR_COMMERCE_MINIMUM_WOOCOMMERCE )
		) . '</p></div>';
	}
}
add_action( 'admin_notices', __NAMESPACE__ . '\\admin_notice' );
