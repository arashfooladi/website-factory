<?php
/** Trusted raster/font import. Runs only through the isolated controller runner. */
if (!defined('WP_CLI') || !WP_CLI || wp_get_environment_type() !== 'local') throw new RuntimeException('build_local_only');
$request = json_decode(file_get_contents('php://stdin'), true, 64, JSON_THROW_ON_ERROR);
$environment = getenv('FACTORY_ENVIRONMENT_ID');
if (!$environment || get_option('factory_environment_id') !== $environment || $request['environmentId'] !== $environment || get_option('factory_build_id') !== $request['buildId']) throw new RuntimeException('build_asset_scope_mismatch');
$asset = $request['asset'];
$types = array('image/png'=>'png','image/jpeg'=>'jpg','image/webp'=>'webp','image/gif'=>'gif','image/avif'=>'avif','font/woff2'=>'woff2','font/ttf'=>'ttf');
if (!isset($types[$asset['mediaType']])) throw new RuntimeException('build_asset_type_unsupported');
if (!preg_match('/^[a-f0-9-]{36}$/D',$asset['id'])) throw new RuntimeException('build_asset_id_invalid');
$bytes = base64_decode($asset['data'], true);
if ($bytes === false || strlen($bytes) > 16777216 || hash('sha256',$bytes) !== $asset['sha256']) throw new RuntimeException('build_asset_integrity_failed');
if (str_starts_with($asset['mediaType'], 'image/') && (getimagesizefromstring($bytes)['mime'] ?? null) !== $asset['mediaType']) throw new RuntimeException('build_asset_media_mismatch');
if ($asset['mediaType'] === 'font/woff2' && substr($bytes,0,4) !== 'wOF2') throw new RuntimeException('build_asset_media_mismatch');
if ($asset['mediaType'] === 'font/ttf' && substr($bytes,0,4) !== "\x00\x01\x00\x00") throw new RuntimeException('build_asset_media_mismatch');
require_once ABSPATH.'wp-admin/includes/image.php';
$key = $request['buildId'].':asset:'.$asset['id'];
$post_name = 'factory-'.$request['buildId'].'-'.$asset['id'];
$upload = wp_upload_dir();$relative = 'factory/'.$request['buildId'].'/'.$asset['id'].'.'.$types[$asset['mediaType']];
$file = $upload['basedir'].'/'.$relative;
if (!wp_mkdir_p(dirname($file))) throw new RuntimeException('build_asset_directory_failed');
if (file_exists($file)) {
    if (is_link($file) || hash_file('sha256',$file) !== $asset['sha256']) throw new RuntimeException('build_asset_revision_mismatch');
} else {
    $temporary = tempnam(dirname($file),'asset-');
    if (!$temporary || file_put_contents($temporary,$bytes) !== strlen($bytes) || !rename($temporary,$file)) throw new RuntimeException('build_asset_write_failed');
    chmod($file,0644);
}
$existing = get_posts(array('post_type'=>'attachment','post_status'=>'inherit','numberposts'=>1,'fields'=>'ids','meta_key'=>'_factory_build_key','meta_value'=>$key));
if (!$existing) $existing = get_posts(array('post_type'=>'attachment','post_status'=>'inherit','name'=>$post_name,'numberposts'=>1,'fields'=>'ids'));
if ($existing) $id = (int)$existing[0];
else {
    $id = wp_insert_attachment(array('post_mime_type'=>$asset['mediaType'],'post_title'=>sanitize_text_field($asset['name']),'post_name'=>$post_name,'post_status'=>'inherit',
        'meta_input'=>array('_factory_build_key'=>$key,'_factory_asset_sha256'=>$asset['sha256'])),$file,0,true);
    if (is_wp_error($id)) throw new RuntimeException('build_asset_attachment_failed');
}
foreach (array('_factory_build_key'=>$key,'_factory_asset_sha256'=>$asset['sha256']) as $meta=>$value) {
    $previous = get_post_meta($id,$meta,true);if ($previous && $previous !== $value) throw new RuntimeException('build_asset_revision_mismatch');update_post_meta($id,$meta,$value);
}
update_attached_file($id,$file);
if (str_starts_with($asset['mediaType'],'image/') && !wp_get_attachment_metadata($id)) wp_update_attachment_metadata($id,wp_generate_attachment_metadata($id,$file));
if (get_post_meta($id,'_factory_asset_sha256',true) !== $asset['sha256']) throw new RuntimeException('build_asset_revision_mismatch');
$manifest = get_option('factory_build_manifest');
foreach ($manifest['products'] as $product) if (($product['imageAssetId'] ?? null) === $asset['id']) {
    $data = wc_get_product($product['id']);$data->set_image_id($id);$data->save();
}
$result = array('assetId'=>$asset['id'],'attachmentId'=>$id,'path'=>wp_make_link_relative(wp_get_attachment_url($id)),'sha256'=>$asset['sha256'],'mediaType'=>$asset['mediaType']);
$manifest['assets'][$asset['id']] = $result;update_option('factory_build_manifest',$manifest);
echo wp_json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
