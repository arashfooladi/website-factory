<?php
/** Known, pinned fixture plugins; normal WordPress activation hooks run. */
require_once ABSPATH . 'wp-admin/includes/plugin.php';
foreach (array('woocommerce/woocommerce.php', 'maintheme-iran-commerce/maintheme-iran-commerce.php') as $plugin) {
    if (!is_plugin_active($plugin)) {
        $result = activate_plugin($plugin);
        if (is_wp_error($result)) throw new RuntimeException($result->get_error_message());
    }
}
if (get_stylesheet() !== 'client-child') switch_theme('client-child');

// Fresh CLI activation happens after WordPress init. Schedule Jetpack's normal
// nonce cleanup and heartbeat now, while translations may safely load. Otherwise
// its first subsequent plugins_loaded callback schedules them too early and
// indirectly translates WC_Install's cron labels before theme/init hooks.
if (!did_action('init')) throw new RuntimeException('factory_activation_requires_wordpress_init');
if (class_exists('Automattic\\Jetpack\\Connection\\Nonce_Handler')) {
    (new \Automattic\Jetpack\Connection\Nonce_Handler())->init_schedule();
}
if (class_exists('Automattic\\Jetpack\\Heartbeat')) {
    \Automattic\Jetpack\Heartbeat::init();
}
