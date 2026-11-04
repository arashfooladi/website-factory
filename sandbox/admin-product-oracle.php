<?php
/** Controller-only readback and cleanup of a uniquely scoped disposable QA product. */
$input = json_decode(file_get_contents('php://stdin'), true, 16, JSON_THROW_ON_ERROR);
if (get_option('factory_environment_id') !== ($input['environmentId'] ?? null) || getenv('FACTORY_ENVIRONMENT_ID') !== $input['environmentId']) throw new RuntimeException('admin_qa_environment_mismatch');
if (!preg_match('/^factory-qa-[a-f0-9-]{36}$/D', $input['sku'] ?? '')) throw new RuntimeException('admin_qa_sku_invalid');
if (!in_array($input['action'] ?? '', array('inspect','cleanup'), true)) throw new RuntimeException('admin_qa_action_invalid');
$id = wc_get_product_id_by_sku($input['sku']);
$product = $id ? wc_get_product($id) : false;
if ($input['action'] === 'cleanup') {
    if ($product) $product->delete(true);
    echo wp_json_encode(array('removed'=>!wc_get_product_id_by_sku($input['sku'])));
    return;
}
$user = get_user_by('login', 'client_admin');
echo wp_json_encode(array('canEdit'=>$user && user_can($user, 'edit_products'), 'canPublish'=>$user && user_can($user, 'publish_products'),
    'product'=>$product ? array('id'=>$id, 'name'=>$product->get_name(), 'status'=>$product->get_status(), 'price'=>$product->get_regular_price(),
    'displayPrice'=>wc_get_price_to_display($product), 'formattedPrice'=>html_entity_decode(wp_strip_all_tags($product->get_price_html()), ENT_QUOTES, 'UTF-8'), 'stock'=>$product->get_stock_quantity(), 'managed'=>$product->get_manage_stock(), 'inStock'=>$product->is_in_stock(),
    'url'=>get_permalink($id)) : null));
