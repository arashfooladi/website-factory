<?php
/** Controlled installation; no password prompts or command-line secrets. */
if (!defined('WP_CLI') || !WP_CLI || !getenv('FACTORY_ADMIN_PASSWORD')) {
    throw new RuntimeException('Use the fixture installer with private fixture credentials.');
}
define('WP_INSTALLING', true);
$path = WP_CLI::get_runner()->config['path'];
require rtrim($path, '/') . '/wp-load.php';
require ABSPATH . 'wp-admin/includes/upgrade.php';
if (wp_get_environment_type() !== 'local') throw new RuntimeException('Local fixtures only.');
if (!is_blog_installed()) {
    wp_install('آزمایش کارخانه وب', getenv('FACTORY_ADMIN_USER'), 'admin@example.test', false,
        '', getenv('FACTORY_ADMIN_PASSWORD'));
}
WP_CLI::success('Private fixture installation complete.');
