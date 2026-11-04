<?php
/** Controller-only readback and cleanup of a uniquely scoped disposable QA product. */
$input = json_decode(file_get_contents('php://stdin'), true, 16, JSON_THROW_ON_ERROR);
if (get_option('factory_environment_id') !== ($input['environmentId'] ?? null) || getenv('FACTORY_ENVIRONMENT_ID') !== $input['environmentId']) throw new RuntimeException('admin_qa_environment_mismatch');
if (!preg_match('/^factory-qa-[a-f0-9-]{36}$/D', $input['sku'] ?? '')) throw new RuntimeException('admin_qa_sku_invalid');
if (!in_array($input['action'] ?? '', array('inspect','cleanup'), true)) throw new RuntimeException('admin_qa_action_invalid');
$id = wc_get_product_id_by_sku($input['sku']);
$product = $id ? wc_get_product($id) : false;
$category = get_term_by('slug', $input['sku'], 'product_cat');
$attachments = get_posts(array('post_type'=>'attachment', 'name'=>$input['sku'], 'post_status'=>'inherit', 'numberposts'=>1));
$image = $attachments ? $attachments[0]->ID : 0;
if ($input['action'] === 'cleanup') {
    if ($product) $product->delete(true);
    if ($category) wp_delete_term($category->term_id, 'product_cat');
    if ($image) wp_delete_attachment($image, true);
    echo wp_json_encode(array('removed'=>!wc_get_product_id_by_sku($input['sku']) && !get_term_by('slug', $input['sku'], 'product_cat') && (!$image || !get_post($image))));
    return;
}
$user = get_user_by('login', 'client_admin');
echo wp_json_encode(array('canEdit'=>$user && user_can($user, 'edit_products'), 'canPublish'=>$user && user_can($user, 'publish_products'),
    'canManageCategories'=>$user && user_can($user, 'manage_product_terms'),
    'category'=>$category ? array('id'=>$category->term_id, 'name'=>$category->name) : null,
    'canUpload'=>$user && user_can($user, 'upload_files'),
    'image'=>$image ? array('id'=>$image, 'mime'=>get_post_mime_type($image), 'url'=>wp_get_attachment_url($image)) : null,
    'product'=>$product ? array('id'=>$id, 'type'=>$product->get_type(), 'variations'=>$product->is_type('variable') ? array_map(function($child) { $v=wc_get_product($child); return array('id'=>$child, 'price'=>$v->get_regular_price(), 'stock'=>$v->get_stock_quantity(), 'managed'=>$v->get_manage_stock(), 'attributes'=>$v->get_attributes()); }, $product->get_children()) : array(), 'name'=>$product->get_name(), 'status'=>$product->get_status(), 'price'=>$product->get_regular_price(),
    'categoryIds'=>$product->get_category_ids(),
    'imageId'=>(int)$product->get_image_id(),
    'displayPrice'=>wc_get_price_to_display($product), 'formattedPrice'=>html_entity_decode(wp_strip_all_tags($product->get_price_html()), ENT_QUOTES, 'UTF-8'), 'stock'=>$product->get_stock_quantity(), 'managed'=>$product->get_manage_stock(), 'inStock'=>$product->is_in_stock(),
    'url'=>get_permalink($id)) : null));
