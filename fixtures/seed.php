<?php
/** Idempotent, test-only WordPress/WooCommerce baseline fixture. Run via WP-CLI. */
if (!defined('WP_CLI') || !WP_CLI || wp_get_environment_type() !== 'local') {
    throw new RuntimeException('Fixture seeding requires WP-CLI and a local environment.');
}
if (getenv('FACTORY_ADMIN_PASSWORD')) {
    $admin = get_user_by('login', getenv('FACTORY_ADMIN_USER'));
    if ($admin) wp_set_password(getenv('FACTORY_ADMIN_PASSWORD'), $admin->ID);
}

update_option('WPLANG', 'fa_IR');
update_option('blog_public', '0');
update_option('permalink_structure', '/%postname%/');
update_option('woocommerce_store_address', 'Fixture address');
update_option('woocommerce_store_city', 'تهران');
update_option('woocommerce_store_postcode', '1234567890');
update_option('woocommerce_default_country', 'IR:THR');
update_option('woocommerce_currency', 'IRR');
update_option('woocommerce_price_num_decimals', '0');
update_option('woocommerce_enable_guest_checkout', 'yes');
update_option('woocommerce_calc_taxes', 'no');
update_option('woocommerce_manage_stock', 'yes');
update_option('woocommerce_coming_soon', 'no');
update_option('woocommerce_cod_settings', array('enabled' => 'yes', 'title' => 'پرداخت آزمایشی هنگام تحویل',
    'description' => 'فقط آزمایش محلی؛ بدون تراکنش بانکی.', 'enable_for_virtual' => 'yes'));
update_option('woocommerce_onboarding_profile', array('completed' => true, 'skipped' => true));

$created = \Maintheme\Starter_Content\install();
$pages = array(
    'shop' => array('فروشگاه', ''),
    'cart' => array('سبد خرید', '<!-- wp:shortcode -->[woocommerce_cart]<!-- /wp:shortcode -->'),
    'checkout' => array('تسویه حساب', '<!-- wp:shortcode -->[woocommerce_checkout]<!-- /wp:shortcode -->'),
    'my-account' => array('حساب کاربری', '<!-- wp:shortcode -->[woocommerce_my_account]<!-- /wp:shortcode -->'),
);
foreach ($pages as $slug => [$title, $content]) {
    $existing = get_page_by_path($slug);
    $id = wp_insert_post(array('ID' => $existing ? $existing->ID : 0, 'post_name' => $slug,
        'post_title' => $title, 'post_type' => 'page', 'post_status' => 'publish', 'post_content' => $content), true);
    if (is_wp_error($id)) throw new RuntimeException($id->get_error_message());
    $key = $slug === 'my-account' ? 'myaccount' : $slug;
    update_option('woocommerce_' . $key . '_page_id', $id);
}

$settings = \Maintheme\Admin\options();
$settings['support_email'] = 'support@example.test';
$settings['support_phone'] = '02100000000';
$settings['store_address'] = 'نشانی آزمایشی، تهران';
update_option('maintheme_options', $settings);

$fixtures = array();
foreach (array(
    array('factory-simple', 'محصول ساده آزمایشی', 'simple', '250000', 8),
    array('factory-variable', 'محصول متغیر آزمایشی', 'variable', '350000', 6),
    array('factory-out-of-stock', 'محصول ناموجود آزمایشی', 'simple', '150000', 0),
) as [$slug, $name, $type, $price, $stock]) {
    $existing = get_page_by_path($slug, OBJECT, 'product');
    $product = $type === 'variable' ? new WC_Product_Variable($existing ? $existing->ID : 0) : new WC_Product_Simple($existing ? $existing->ID : 0);
    $product->set_name($name);
    $product->set_slug($slug);
    $product->set_status('publish');
    $product->set_description('توضیحات کامل محصول برای آزمایش واقعی قالب مادر.');
    $product->set_short_description('خلاصه محصول آزمایشی');
    $product->set_regular_price($price);
    $product->set_manage_stock(true);
    $product->set_stock_quantity($stock);
    $product->set_stock_status($stock ? 'instock' : 'outofstock');
    $product->set_virtual(false);
    if ($type === 'variable') {
        $attribute = new WC_Product_Attribute();
        $attribute->set_name('اندازه');
        $attribute->set_options(array('کوچک', 'بزرگ'));
        $attribute->set_visible(true);
        $attribute->set_variation(true);
        $product->set_attributes(array($attribute));
    }
    $id = $product->save();
    if ($type === 'variable') {
        foreach (array('کوچک', 'بزرگ') as $size) {
            $variation = null;
            foreach ($product->get_children() as $child_id) {
                $candidate = wc_get_product($child_id);
                if (in_array($size, $candidate->get_attributes(), true)) $variation = $candidate;
            }
            $variation = $variation ?: new WC_Product_Variation();
            $variation->set_parent_id($id);
            $variation->set_attributes(array('اندازه' => $size));
            $variation->set_regular_price($price);
            $variation->set_status('publish');
            $variation->save();
        }
        WC_Product_Variable::sync($id);
    }
    $fixtures[$slug] = $id;
}

$zone = new WC_Shipping_Zone(0);
$methods = $zone->get_shipping_methods();
if (!$methods) {
    $instance = $zone->add_shipping_method('flat_rate');
    update_option('woocommerce_flat_rate_' . $instance . '_settings', array('title' => 'ارسال آزمایشی',
        'tax_status' => 'none', 'cost' => '50000'));
}
flush_rewrite_rules();
wc_delete_product_transients();
update_option('factory_baseline_fixture', array('version' => 1, 'products' => $fixtures, 'pages' => $created));
WP_CLI::success('Baseline seeded: Persian/RTL, simple/variable/out-of-stock products, flat-rate shipping, local COD checkout.');
