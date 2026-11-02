<?php
/**
 * Theme setup dashboard and presentation settings.
 *
 * @package Maintheme
 */

namespace Maintheme\Admin;

use function Maintheme\Starter_Content\install as install_starter_content;

defined( 'ABSPATH' ) || exit;

/**
 * Define the settings schema. Child themes may add fields with the
 * maintheme_settings_schema filter.
 *
 * @return array<string,array<string,mixed>>
 */
function settings_schema(): array {
	$schema = array(
		'announcement_enabled' => array(
			'label'   => __( 'نمایش نوار اطلاع‌رسانی', 'maintheme' ),
			'type'    => 'checkbox',
			'default' => true,
			'section' => 'announcement',
		),
		'announcement_text' => array(
			'label'       => __( 'متن اطلاع‌رسانی', 'maintheme' ),
			'type'        => 'text',
			'default'     => 'خرید مطمئن با ثبت نشانی تحویل دقیق',
			'section'     => 'announcement',
			'sanitize'    => 'sanitize_text_field',
		),
		'announcement_link_label' => array(
			'label'       => __( 'عنوان پیوند اطلاع‌رسانی', 'maintheme' ),
			'type'        => 'text',
			'default'     => 'مشاهده پیشنهادها',
			'sanitize'    => 'sanitize_text_field',
			'section'     => 'announcement',
		),
		'announcement_link_url' => array(
			'label'       => __( 'نشانی پیوند اطلاع‌رسانی', 'maintheme' ),
			'type'        => 'text',
			'default'     => '/shop/',
			'description' => __( 'نشانی کامل یا مسیر داخلی مانند /shop/ وارد کنید.', 'maintheme' ),
			'sanitize'    => __NAMESPACE__ . '\\sanitize_theme_url',
			'section'     => 'announcement',
		),
		'support_phone' => array(
			'label'       => __( 'شماره پشتیبانی', 'maintheme' ),
			'type'        => 'tel',
			'default'     => '',
			'sanitize'    => 'sanitize_text_field',
			'section'     => 'contact',
		),
		'support_email' => array(
			'label'       => __( 'ایمیل پشتیبانی', 'maintheme' ),
			'type'        => 'email',
			'default'     => '',
			'sanitize'    => 'sanitize_email',
			'section'     => 'contact',
		),
		'support_hours' => array(
			'label'       => __( 'ساعات پاسخ‌گویی', 'maintheme' ),
			'type'        => 'text',
			'default'     => '',
			'sanitize'    => 'sanitize_text_field',
			'section'     => 'contact',
		),
		'store_address' => array(
			'label'       => __( 'نشانی فروشگاه', 'maintheme' ),
			'type'        => 'textarea',
			'default'     => '',
			'sanitize'    => 'sanitize_textarea_field',
			'section'     => 'contact',
		),
		'instagram_url' => array(
			'label'       => __( 'اینستاگرام', 'maintheme' ),
			'type'        => 'url',
			'default'     => '',
			'sanitize'    => 'esc_url_raw',
			'section'     => 'social',
		),
		'telegram_url' => array(
			'label'       => __( 'تلگرام', 'maintheme' ),
			'type'        => 'url',
			'default'     => '',
			'sanitize'    => 'esc_url_raw',
			'section'     => 'social',
		),
		'whatsapp_url' => array(
			'label'       => __( 'واتساپ', 'maintheme' ),
			'type'        => 'url',
			'default'     => '',
			'sanitize'    => 'esc_url_raw',
			'section'     => 'social',
		),
		'footer_note' => array(
			'label'       => __( 'متن معرفی پابرگ', 'maintheme' ),
			'type'        => 'textarea',
			'default'     => 'یک تجربه خرید ساده، قابل اعتماد و فارسی.',
			'sanitize'    => 'sanitize_textarea_field',
			'section'     => 'footer',
		),
		'copyright_text' => array(
			'label'       => __( 'متن حق نشر', 'maintheme' ),
			'type'        => 'text',
			'default'     => 'تمامی حقوق این فروشگاه محفوظ است.',
			'sanitize'    => 'sanitize_text_field',
			'section'     => 'footer',
		),
		'product_delivery_note' => array(
			'label'       => __( 'پیام ارسال در صفحه محصول', 'maintheme' ),
			'type'        => 'text',
			'default'     => 'زمان و هزینه ارسال در مرحله تسویه‌حساب نمایش داده می‌شود.',
			'sanitize'    => 'sanitize_text_field',
			'section'     => 'product',
		),
		'product_return_note' => array(
			'label'       => __( 'پیام بازگشت کالا', 'maintheme' ),
			'type'        => 'text',
			'default'     => 'شرایط بازگشت را پیش از خرید در برگه ارسال و بازگشت مطالعه کنید.',
			'sanitize'    => 'sanitize_text_field',
			'section'     => 'product',
		),
		'return_policy_url' => array(
			'label'       => __( 'پیوند شرایط ارسال و بازگشت', 'maintheme' ),
			'type'        => 'text',
			'default'     => '/shipping-returns/',
			'description' => __( 'نشانی کامل یا مسیر داخلی وارد کنید.', 'maintheme' ),
			'sanitize'    => __NAMESPACE__ . '\\sanitize_theme_url',
			'section'     => 'product',
		),
	);

	return (array) apply_filters( 'maintheme_settings_schema', $schema );
}

/**
 * Permit safe absolute URLs and root-relative internal URLs.
 */
function sanitize_theme_url( string $url ): string {
	$url = trim( $url );
	if ( '' === $url ) {
		return '';
	}

	if ( 0 === strpos( $url, '/' ) && 0 !== strpos( $url, '//' ) ) {
		return '/' . ltrim( sanitize_text_field( $url ), '/' );
	}

	return esc_url_raw( $url );
}

/**
 * Default theme options.
 *
 * @return array<string,mixed>
 */
function defaults(): array {
	$defaults = array();
	foreach ( settings_schema() as $key => $field ) {
		$defaults[ $key ] = $field['default'] ?? '';
	}

	return (array) apply_filters( 'maintheme_default_options', $defaults );
}

/**
 * Read merged theme options.
 *
 * @return array<string,mixed>
 */
function options(): array {
	$value = get_option( 'maintheme_options', array() );
	return wp_parse_args( is_array( $value ) ? $value : array(), defaults() );
}

/**
 * Get a single theme option.
 *
 * @return mixed
 */
function option( string $key, $fallback = '' ) {
	$options = options();
	return array_key_exists( $key, $options ) ? $options[ $key ] : $fallback;
}

/**
 * Sanitize saved settings from the schema.
 *
 * @param mixed $input Untrusted settings input.
 * @return array<string,mixed>
 */
function sanitize_options( $input ): array {
	$input     = is_array( $input ) ? $input : array();
	$sanitized = array();

	foreach ( settings_schema() as $key => $field ) {
		$value = $input[ $key ] ?? '';
		if ( 'checkbox' === ( $field['type'] ?? '' ) ) {
			$value = ! empty( $value );
		} else {
			$callback = $field['sanitize'] ?? 'sanitize_text_field';
			$value    = is_callable( $callback ) ? call_user_func( $callback, (string) $value ) : sanitize_text_field( (string) $value );
		}

		$sanitized[ $key ] = apply_filters( 'maintheme_sanitize_option', $value, $key, $input, $field );
	}

	return $sanitized;
}

/** Register theme settings. */
function register_settings(): void {
	register_setting(
		'maintheme_settings',
		'maintheme_options',
		array(
			'type'              => 'array',
			'sanitize_callback' => __NAMESPACE__ . '\\sanitize_options',
			'default'           => defaults(),
		)
	);
}
add_action( 'admin_init', __NAMESPACE__ . '\\register_settings' );

/** Register the Appearance submenu. */
function register_menu(): void {
	add_theme_page(
		__( 'تنظیمات قالب مادر', 'maintheme' ),
		__( 'قالب مادر', 'maintheme' ),
		'edit_theme_options',
		'maintheme',
		__NAMESPACE__ . '\\render_page'
	);
}
add_action( 'admin_menu', __NAMESPACE__ . '\\register_menu' );

/** Enqueue dashboard-only styles. */
function enqueue_admin_assets( string $hook_suffix ): void {
	if ( 'appearance_page_maintheme' !== $hook_suffix ) {
		return;
	}

	wp_enqueue_style(
		'maintheme-admin',
		MAINTHEME_URL . '/assets/css/admin.css',
		array(),
		MAINTHEME_VERSION
	);
}
add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue_admin_assets' );

/** Render one schema-driven settings row. */
function render_field( string $key, array $field, array $current_options ): void {
	$type        = (string) ( $field['type'] ?? 'text' );
	$label       = (string) ( $field['label'] ?? $key );
	$value       = $current_options[ $key ] ?? '';
	$description = (string) ( $field['description'] ?? '' );
	$id          = 'maintheme-' . sanitize_html_class( $key );

	echo '<tr><th scope="row"><label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label></th><td>';

	if ( 'checkbox' === $type ) {
		echo '<label><input id="' . esc_attr( $id ) . '" name="maintheme_options[' . esc_attr( $key ) . ']" type="checkbox" value="1" ' . checked( ! empty( $value ), true, false ) . '> ' . esc_html__( 'فعال باشد', 'maintheme' ) . '</label>';
	} elseif ( 'textarea' === $type ) {
		echo '<textarea class="large-text" id="' . esc_attr( $id ) . '" name="maintheme_options[' . esc_attr( $key ) . ']" rows="3">' . esc_textarea( (string) $value ) . '</textarea>';
	} else {
		echo '<input class="regular-text" id="' . esc_attr( $id ) . '" name="maintheme_options[' . esc_attr( $key ) . ']" type="' . esc_attr( $type ) . '" value="' . esc_attr( (string) $value ) . '">';
	}

	if ( $description ) {
		echo '<p class="description">' . esc_html( $description ) . '</p>';
	}

	echo '</td></tr>';
}

/** Render settings belonging to a named section. */
function render_section_fields( string $section, array $current_options ): void {
	foreach ( settings_schema() as $key => $field ) {
		if ( $section === ( $field['section'] ?? '' ) ) {
			render_field( $key, $field, $current_options );
		}
	}
}

/** Render the theme dashboard. */
function render_page(): void {
	if ( ! current_user_can( 'edit_theme_options' ) ) {
		return;
	}

	$current_options = options();
	$created         = isset( $_GET['starter-created'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Display-only status flag.
	$plugin_active   = defined( 'MAINTHEME_IR_COMMERCE_VERSION' );
	?>
	<div class="wrap maintheme-admin-wrap">
		<h1><?php esc_html_e( 'قالب مادر ۰.۴.۰', 'maintheme' ); ?></h1>
		<p class="maintheme-admin-lead"><?php esc_html_e( 'پایه فروشگاه‌های فارسی و راست‌به‌چپ در ایران؛ طراحی با ویرایشگر سایت، قوانین فروشگاه با ووکامرس و افزونه همراه تجارت ایران.', 'maintheme' ); ?></p>

		<?php if ( $created ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'برگه‌های اولیه ایجاد یا بررسی شدند و هیچ محتوای موجودی بازنویسی نشد.', 'maintheme' ); ?></p></div>
		<?php endif; ?>

		<div class="maintheme-admin-grid">
			<section class="maintheme-admin-card">
				<h2><?php esc_html_e( 'وضعیت فروشگاه', 'maintheme' ); ?></h2>
				<ul class="maintheme-status-list">
					<li><strong><?php esc_html_e( 'ووکامرس:', 'maintheme' ); ?></strong> <?php echo class_exists( 'WooCommerce' ) ? esc_html__( 'فعال', 'maintheme' ) : esc_html__( 'غیرفعال', 'maintheme' ); ?></li>
					<li><strong><?php esc_html_e( 'افزونه تجارت ایران:', 'maintheme' ); ?></strong> <?php echo $plugin_active ? esc_html__( 'فعال', 'maintheme' ) : esc_html__( 'غیرفعال؛ فایل ZIP همراه بسته انتشار است', 'maintheme' ); ?></li>
					<li><strong><?php esc_html_e( 'نوع قالب:', 'maintheme' ); ?></strong> <?php esc_html_e( 'قالب بلوکی مادر با پشتیبانی Child Theme', 'maintheme' ); ?></li>
				</ul>
			</section>

			<section class="maintheme-admin-card">
				<h2><?php esc_html_e( 'شروع سریع', 'maintheme' ); ?></h2>
				<p><?php esc_html_e( 'برگه‌های خانه، مجله، درباره ما، تماس، پرسش‌ها، ارسال و بازگشت، ضمانت، حریم خصوصی و قوانین را به‌صورت غیرمخرب ایجاد کنید.', 'maintheme' ); ?></p>
				<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
					<input type="hidden" name="action" value="maintheme_install_starter">
					<?php wp_nonce_field( 'maintheme_install_starter' ); ?>
					<?php submit_button( __( 'ایجاد یا بررسی برگه‌های اولیه', 'maintheme' ), 'secondary', 'submit', false ); ?>
				</form>
			</section>

			<section class="maintheme-admin-card">
				<h2><?php esc_html_e( 'میان‌برهای ویرایش', 'maintheme' ); ?></h2>
				<ul class="maintheme-admin-links">
					<li><a href="<?php echo esc_url( admin_url( 'site-editor.php' ) ); ?>"><?php esc_html_e( 'ویرایشگر کامل سایت', 'maintheme' ); ?></a></li>
					<li><a href="<?php echo esc_url( admin_url( 'site-editor.php?path=/wp-global-styles' ) ); ?>"><?php esc_html_e( 'رنگ‌ها و تایپوگرافی', 'maintheme' ); ?></a></li>
					<li><a href="<?php echo esc_url( admin_url( 'site-editor.php?path=/patterns' ) ); ?>"><?php esc_html_e( 'الگوها و بخش‌های آماده', 'maintheme' ); ?></a></li>
					<li><a href="<?php echo esc_url( admin_url( 'edit.php?post_type=page' ) ); ?>"><?php esc_html_e( 'برگه‌ها', 'maintheme' ); ?></a></li>
					<?php if ( class_exists( 'WooCommerce' ) ) : ?>
						<li><a href="<?php echo esc_url( admin_url( 'edit.php?post_type=product' ) ); ?>"><?php esc_html_e( 'محصولات ووکامرس', 'maintheme' ); ?></a></li>
						<li><a href="<?php echo esc_url( admin_url( 'admin.php?page=wc-settings' ) ); ?>"><?php esc_html_e( 'تنظیمات ووکامرس', 'maintheme' ); ?></a></li>
					<?php endif; ?>
				</ul>
			</section>
		</div>

		<form action="options.php" method="post" class="maintheme-admin-card maintheme-admin-settings">
			<?php settings_fields( 'maintheme_settings' ); ?>
			<?php do_action( 'maintheme_settings_before', $current_options ); ?>

			<h2><?php esc_html_e( 'نوار اطلاع‌رسانی', 'maintheme' ); ?></h2>
			<table class="form-table" role="presentation"><?php render_section_fields( 'announcement', $current_options ); ?></table>

			<h2><?php esc_html_e( 'اطلاعات تماس', 'maintheme' ); ?></h2>
			<table class="form-table" role="presentation"><?php render_section_fields( 'contact', $current_options ); ?></table>

			<h2><?php esc_html_e( 'شبکه‌های اجتماعی', 'maintheme' ); ?></h2>
			<table class="form-table" role="presentation"><?php render_section_fields( 'social', $current_options ); ?></table>

			<h2><?php esc_html_e( 'پابرگ', 'maintheme' ); ?></h2>
			<table class="form-table" role="presentation"><?php render_section_fields( 'footer', $current_options ); ?></table>

			<h2><?php esc_html_e( 'پیام‌های صفحه محصول', 'maintheme' ); ?></h2>
			<table class="form-table" role="presentation"><?php render_section_fields( 'product', $current_options ); ?></table>

			<?php do_action( 'maintheme_settings_after', $current_options ); ?>
			<?php submit_button( __( 'ذخیره تنظیمات قالب', 'maintheme' ) ); ?>
		</form>
	</div>
	<?php
}

/** Handle the explicit starter-content action. */
function install_starter(): void {
	if ( ! current_user_can( 'edit_theme_options' ) ) {
		wp_die( esc_html__( 'شما اجازه انجام این کار را ندارید.', 'maintheme' ) );
	}

	check_admin_referer( 'maintheme_install_starter' );
	install_starter_content();

	wp_safe_redirect( add_query_arg( 'starter-created', '1', admin_url( 'themes.php?page=maintheme' ) ) );
	exit;
}
add_action( 'admin_post_maintheme_install_starter', __NAMESPACE__ . '\\install_starter' );
