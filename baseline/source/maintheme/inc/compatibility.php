<?php
/**
 * Compatibility checks and non-blocking admin guidance.
 *
 * @package Maintheme
 */

namespace Maintheme\Compatibility;

defined( 'ABSPATH' ) || exit;

/** Show compatibility guidance only on the Maintheme dashboard. */
function admin_notices(): void {
	if ( ! current_user_can( 'edit_theme_options' ) ) {
		return;
	}
	$screen = get_current_screen();
	if ( ! $screen || 'appearance_page_maintheme' !== $screen->id ) {
		return;
	}

	if ( ! class_exists( 'WooCommerce' ) ) {
		echo '<div class="notice notice-warning"><p>' . esc_html__( 'برای قابلیت‌های فروشگاهی، ووکامرس را نصب و فعال کنید. خود قالب بدون ووکامرس نیز خطای بحرانی ایجاد نمی‌کند.', 'maintheme' ) . '</p></div>';
		return;
	}

	if ( defined( 'WC_VERSION' ) && version_compare( WC_VERSION, MAINTHEME_MINIMUM_WOOCOMMERCE, '<' ) ) {
		echo '<div class="notice notice-warning"><p>' . sprintf(
			esc_html__( 'نسخه ووکامرس شما %1$s است. برای قالب مادر ۰.۴.۰، ووکامرس %2$s یا جدیدتر پیشنهاد می‌شود.', 'maintheme' ),
			esc_html( WC_VERSION ),
			esc_html( MAINTHEME_MINIMUM_WOOCOMMERCE )
		) . '</p></div>';
	}

	if ( ! defined( 'MAINTHEME_IR_COMMERCE_VERSION' ) ) {
		echo '<div class="notice notice-info"><p>' . esc_html__( 'قالب فقط ظاهر فروشگاه را مدیریت می‌کند. برای نرمال‌سازی شماره موبایل و کدپستی ایران و محدودکردن کشور به ایران، افزونه Maintheme Iran Commerce همراه بسته را فعال کنید.', 'maintheme' ) . '</p></div>';
	}
}
add_action( 'admin_notices', __NAMESPACE__ . '\\admin_notices' );
