<?php
/** Trusted, idempotent content setup in a newly allocated disposable build site. */
if (!defined('WP_CLI') || !WP_CLI || wp_get_environment_type() !== 'local') throw new RuntimeException('build_local_only');
$request = json_decode(file_get_contents('php://stdin'), true, 128, JSON_THROW_ON_ERROR);
$environment = getenv('FACTORY_ENVIRONMENT_ID');
if (!$environment || get_option('factory_environment_id') !== $environment || ($request['environmentId'] ?? '') !== $environment) throw new RuntimeException('build_environment_mismatch');
$build = $request['buildId'] ?? '';
if (!preg_match('/^[a-f0-9-]{36}$/D', $build)) throw new RuntimeException('build_id_invalid');
$previous = get_option('factory_build_id');
if ($previous && $previous !== $build) throw new RuntimeException('build_owner_mismatch');
if (get_option('factory_build_content_digest') && get_option('factory_build_content_digest') !== $request['contentDigest']) throw new RuntimeException('build_content_changed');
$completed = get_option('factory_build_manifest');
if (is_array($completed) && ($completed['buildId'] ?? null) === $build && ($completed['contentDigest'] ?? null) === $request['contentDigest']) {
    foreach ($completed['pages'] as $page) if (!get_post($page['id'])) throw new RuntimeException('build_content_drift');
    foreach ($completed['products'] as $product) if (!wc_get_product($product['id'])) throw new RuntimeException('build_content_drift');
    echo wp_json_encode($completed,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);return;
}
$content = $request['content'];
$language = $request['language'] ?? 'fa-IR';
if (!in_array($language, array('fa', 'fa-IR', 'en', 'en-US'), true)) throw new RuntimeException('build_locale_not_certified');

if (!$previous) {
    // This environment was created exclusively for this build. Keep users and
    // plugin configuration; remove baseline sample content and editor overrides.
    update_option('factory_build_id', $build);
    update_option('factory_build_cleanup_pending', true);
}
if (get_option('factory_build_cleanup_pending')) {
    foreach (array('product_variation', 'product', 'page', 'post', 'wp_navigation', 'wp_template', 'wp_template_part', 'attachment') as $type) {
        foreach (get_posts(array('post_type' => $type, 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids')) as $id) {
            if ($type === 'attachment') wp_delete_attachment($id, true); else wp_delete_post($id, true);
        }
    }
    delete_option('factory_build_cleanup_pending');
}
update_option('factory_build_content_digest', $request['contentDigest']);
update_option('blogname', sanitize_text_field($content['siteTitle']));
update_option('blogdescription', sanitize_text_field($content['description']));
// WordPress represents built-in US English with an empty option; en_US is not
// an installed translation and its option sanitizer can retain the old locale.
update_option('WPLANG', str_starts_with($language, 'fa') ? 'fa_IR' : '');
update_option('blog_public', '0');
update_option('woocommerce_currency', $content['currency']);
update_option('woocommerce_price_num_decimals', $content['currency'] === 'IRR' ? '0' : '2');
$gateway = get_option('woocommerce_cod_settings', array());$gateway['enabled'] = $content['synthetic'] ? 'yes' : 'no';
if ($content['synthetic']) {
    $gateway['title'] = str_starts_with($language,'fa') ? 'پرداخت آزمایشی هنگام تحویل' : 'Demo cash on delivery';
    $gateway['description'] = str_starts_with($language,'fa') ? 'فقط آزمایش محلی؛ بدون تراکنش بانکی.' : 'Local demonstration only; no banking transaction.';
}
update_option('woocommerce_cod_settings', $gateway);
$zone = new WC_Shipping_Zone(0);
foreach ($zone->get_shipping_methods() as $method) {
    if (!$content['synthetic']) $zone->delete_shipping_method($method->instance_id);
    elseif ($method->id === 'flat_rate') update_option('woocommerce_flat_rate_'.$method->instance_id.'_settings',array(
        'title'=>str_starts_with($language,'fa') ? 'ارسال آزمایشی' : 'Demo shipping','tax_status'=>'none','cost'=>$content['currency']==='IRR'?'50000':'5'));
}
$settings = \Maintheme\Admin\options();
foreach (array('support_email','support_phone','store_address') as $key) $settings[$key] = '';
update_option('maintheme_options', $settings);

$find = static function ($key, $type) use ($build) {
    $ids = get_posts(array('post_type'=>$type,'post_status'=>'any','numberposts'=>1,'fields'=>'ids',
        'meta_key'=>'_factory_build_key','meta_value'=>$build.':'.$key));return $ids ? (int)$ids[0] : 0;
};
$pages = array();
foreach ($content['pages'] as $page) {
    $segments = array_values(array_filter(explode('/', $page['path'])));
    $parent = 0;
    foreach ($segments as $index => $segment) {
        if ($index === count($segments)-1) break;
        $prefix = implode('/', array_slice($segments, 0, $index+1));
        $existing = get_page_by_path($prefix);
        $parent = $existing ? $existing->ID : wp_insert_post(array('post_type'=>'page','post_status'=>'publish','post_name'=>$segment,'post_parent'=>$parent,'post_title'=>ucwords(str_replace('-', ' ', $segment))), true);
        if (is_wp_error($parent)) throw new RuntimeException('build_parent_page_failed');
    }
    $slug = $segments ? end($segments) : 'home';
    $post_content = wp_kses_post($page['content']);
    $shortcodes = array('cart'=>'[woocommerce_cart]','checkout'=>'[woocommerce_checkout]','account'=>'[woocommerce_my_account]');
    if (isset($shortcodes[$page['kind']])) $post_content = '<!-- wp:shortcode -->'.$shortcodes[$page['kind']].'<!-- /wp:shortcode -->';
    $existing_id = $find('page:'.$page['path'], 'page');
    if (!$existing_id) { $existing_page = get_page_by_path($segments ? implode('/',$segments) : 'home');if ($existing_page) $existing_id = $existing_page->ID; }
    $id = wp_insert_post(array('ID'=>$existing_id,'post_type'=>'page','post_status'=>'publish','post_name'=>$slug,'post_parent'=>$parent,
        'post_title'=>sanitize_text_field($page['title']),'post_content'=>$post_content), true);
    if (is_wp_error($id)) throw new RuntimeException('build_page_failed');
    update_post_meta($id, '_factory_build_key', $build.':page:'.$page['path']);
    if ($page['kind'] === 'home') { update_option('show_on_front','page');update_option('page_on_front',$id); }
    $option = array('shop'=>'shop','cart'=>'cart','checkout'=>'checkout','account'=>'myaccount')[$page['kind']] ?? null;
    if ($option) update_option('woocommerce_'.$option.'_page_id',$id);
    $pages[] = array('id'=>$id,'path'=>$page['path'],'title'=>get_the_title($id),'kind'=>$page['kind']);
}
$products = array();
foreach ($content['products'] as $item) {
    $id = $find('product:'.$item['key'], 'product');
    $variable = isset($item['variations']);
    $product = $variable ? new WC_Product_Variable($id) : new WC_Product_Simple($id);
    $product->set_name(sanitize_text_field($item['name']));$product->set_slug($item['key']);$product->set_status('publish');
    $product->set_description(wp_kses_post($item['description']));$product->set_short_description(wp_kses_post($item['summary']));
    $product->set_regular_price($item['price']);$product->set_manage_stock(true);$product->set_stock_quantity($item['stock']);
    $product->set_stock_status($item['stock'] > 0 ? 'instock' : 'outofstock');
    if ($variable) {
        $attribute = new WC_Product_Attribute();$attribute->set_name($item['variations']['attribute']);$attribute->set_options($item['variations']['options']);
        $attribute->set_visible(true);$attribute->set_variation(true);$product->set_attributes(array($attribute));
    }
    $id = $product->save();update_post_meta($id,'_factory_build_key',$build.':product:'.$item['key']);
    if ($variable) {
        foreach ($item['variations']['options'] as $option) {
            $variation = null;
            foreach ($product->get_children() as $child_id) { $candidate = wc_get_product($child_id);if (in_array($option,$candidate->get_attributes(),true)) $variation = $candidate; }
            $variation = $variation ?: new WC_Product_Variation();$variation->set_parent_id($id);
            $variation->set_attributes(array(sanitize_title($item['variations']['attribute'])=>$option));$variation->set_regular_price($item['price']);$variation->set_status('publish');$variation->save();
        }
        WC_Product_Variable::sync($id);
    }
    $products[] = array('id'=>$id,'key'=>$item['key'],'type'=>$variable?'variable':'simple','name'=>$product->get_name(),'path'=>wp_make_link_relative(get_permalink($id)),
        'imageAssetId'=>$item['imageAssetId'] ?? null);
}
flush_rewrite_rules();wc_delete_product_transients();
$result = array('version'=>1,'buildId'=>$build,'environmentId'=>$environment,'contentDigest'=>$request['contentDigest'],'synthetic'=>$content['synthetic'],
    'language'=>$language,'pages'=>$pages,'products'=>$products,'adminPreserved'=>true,'editorOverrides'=>0,'pluginVersions'=>array('woocommerce'=>WC_VERSION));
update_option('factory_build_manifest',$result);
echo wp_json_encode($result, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
