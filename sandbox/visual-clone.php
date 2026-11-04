<?php
/** Trusted clone initialization; target credentials arrive only on stdin. */
$request = json_decode(file_get_contents('php://stdin'), true, 16, JSON_THROW_ON_ERROR);
if (get_option('factory_environment_id') !== $request['sourceEnvironmentId'] || getenv('FACTORY_ENVIRONMENT_ID') !== $request['environmentId']) {
    throw new RuntimeException('visual_clone_identity_mismatch');
}
update_option('factory_environment_id', $request['environmentId']);
// The cloned preview uses its own admin credential and rejects all copied sessions.
$user = get_user_by('login', 'client_admin');
if (!$user) throw new RuntimeException('visual_clone_admin_missing');
wp_set_password($request['adminPassword'], $user->ID);
foreach (get_users(array('fields'=>'ID')) as $id) delete_user_meta($id, 'session_tokens');
global $wpdb;
$wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
    $wpdb->esc_like('_transient_').'%', $wpdb->esc_like('_site_transient_').'%'));
if (class_exists('WC_Cache_Helper')) WC_Cache_Helper::get_transient_version('product', true);
echo 'Visual clone initialized.';
