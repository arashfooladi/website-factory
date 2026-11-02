<?php
/**
 * Plugin Name: Website Factory disposable fixture guard
 * Description: Test-only outbound isolation. Never ship this to a client.
 */
defined('ABSPATH') || exit;

add_filter('pre_wp_mail', static fn() => true, PHP_INT_MAX);
add_filter('pre_http_request', static function ($pre, $args, $url) {
    $host = wp_parse_url($url, PHP_URL_HOST);
    if (in_array($host, array('127.0.0.1', 'localhost', '::1'), true)) {
        return $pre;
    }
    return new WP_Error('factory_fixture_outbound_blocked', 'External HTTP is disabled in the disposable fixture.');
}, PHP_INT_MAX, 3);
add_filter('woocommerce_allow_tracking', '__return_false');
add_filter('automatic_updater_disabled', '__return_true');
add_filter('woocommerce_feature_onboarding_enabled', '__return_false');
// This fixture pins its own releases/translations; admin update checks would
// otherwise attempt intentionally blocked HTTP and produce misleading warnings.
add_action('admin_init', static function () {
    remove_action('admin_init', '_maybe_update_core');
    remove_action('admin_init', '_maybe_update_plugins');
    remove_action('admin_init', '_maybe_update_themes');
}, -100);
add_filter('translations_api', static fn() => array('translations' => array()));
