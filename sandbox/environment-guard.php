<?php
/** Test-only local mail sink and integration isolation. Never export to clients. */
defined('ABSPATH') || exit;
require '/tools/fixture-guard.php';

// Preserve a useful argument-free trace when WordPress reports incorrect hook
// timing. This supplements its normal debug log; it never suppresses notices.
add_action('doing_it_wrong_run', static function ($function, $message, $version) {
    if (!defined('WP_DEBUG') || !WP_DEBUG) return;
    $path = '/logs/wordpress-diagnostics.jsonl';
    if (is_link($path) || (file_exists($path) && filesize($path) >= 262144)) return;
    $frames = array_map(static function ($frame) {
        return array_intersect_key($frame, array_flip(array('file', 'line', 'class', 'function')));
    }, array_slice(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS), 0, 24));
    $entry = array('at'=>gmdate('c'), 'function'=>$function, 'version'=>$version, 'sapi'=>PHP_SAPI,
        'init'=>did_action('init'), 'afterSetupTheme'=>did_action('after_setup_theme'), 'stack'=>$frames);
    if (file_put_contents($path, wp_json_encode($entry)."\n", FILE_APPEND | LOCK_EX) !== false) chmod($path, 0600);
}, 10, 3);

add_filter('pre_wp_mail', static function ($pre, $attributes) {
    $path = '/logs/mail.jsonl';
    // Keep evidence private and bounded; no mail transport is invoked.
    if (!file_exists($path) || filesize($path) < 262144) {
        $entry = array(
            'at' => gmdate('c'),
            'to' => substr(wp_json_encode($attributes['to'] ?? array()), 0, 4096),
            'subject' => substr((string) ($attributes['subject'] ?? ''), 0, 4096),
            'message' => substr((string) ($attributes['message'] ?? ''), 0, 16384),
        );
        if (file_put_contents($path, wp_json_encode($entry) . "\n", FILE_APPEND | LOCK_EX) !== false) {
            chmod($path, 0600);
        }
    }
    return true;
}, PHP_INT_MAX, 2);
