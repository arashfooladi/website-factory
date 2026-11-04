<?php
/** Trusted fixture and oracle. This runs only in an identity-checked disposable clone. */
$in=json_decode(file_get_contents('php://stdin'),true,16,JSON_THROW_ON_ERROR);
if (get_option('factory_environment_id')!==($in['environmentId']??null) || getenv('FACTORY_ENVIRONMENT_ID')!==$in['environmentId']) throw new RuntimeException('commerce_qa_environment_mismatch');
if (!preg_match('/^factory-qa-[a-f0-9-]{36}$/D',$in['sku']??'')) throw new RuntimeException('commerce_qa_scope_invalid');
$sku=$in['sku'];$email=$sku.'@example.test';$ids=array();
foreach (array('','-unavailable') as $suffix) { $id=wc_get_product_id_by_sku($sku.$suffix);if($id)$ids[]=$id; }
$orders=wc_get_orders(array('billing_email'=>$email,'limit'=>20));
$action=$in['action']??'';
if ($action==='cleanup') {
 foreach($orders as $order)$order->delete(true);
 foreach($ids as $id){$p=wc_get_product($id);if($p)$p->delete(true);}
 echo wp_json_encode(array('removed'=>!wc_get_product_id_by_sku($sku)&&!wc_get_product_id_by_sku($sku.'-unavailable')&&!wc_get_orders(array('billing_email'=>$email,'limit'=>1))));return;
}
if ($action==='prepare') {
 if($ids||$orders)throw new RuntimeException('commerce_qa_scope_exists');
 foreach(array(false,true) as $unavailable){
  $p=new WC_Product_Simple();$p->set_name($unavailable?'کالای ناموجود آزمایشی':'کالای خرید آزمایشی');$p->set_sku($sku.($unavailable?'-unavailable':''));$p->set_status('publish');
  $p->set_regular_price('100000');$p->set_manage_stock(true);$p->set_stock_quantity($unavailable?0:9);$p->set_stock_status($unavailable?'outofstock':'instock');$p->save();$ids[]=$p->get_id();
 }
} elseif($action!=='inspect')throw new RuntimeException('commerce_qa_action_invalid');
$gateways=array();foreach(WC()->payment_gateways()->payment_gateways() as $key=>$gateway)if($gateway->enabled==='yes')$gateways[]=$key;
echo wp_json_encode(array('email'=>$email,'gateways'=>$gateways,'products'=>array_map(function($id){$p=wc_get_product($id);return array('id'=>$id,'url'=>get_permalink($id),'stock'=>$p->get_stock_quantity(),'inStock'=>$p->is_in_stock());},$ids),
 'orders'=>array_map(function($o){return array('id'=>$o->get_id(),'status'=>$o->get_status(),'payment'=>$o->get_payment_method(),'total'=>$o->get_total(),'shipping'=>$o->get_shipping_total(),'email'=>$o->get_billing_email(),'phone'=>$o->get_billing_phone(),'city'=>$o->get_billing_city(),'address'=>$o->get_billing_address_1(),'postcode'=>$o->get_billing_postcode(),'firstName'=>$o->get_billing_first_name(),'items'=>array_map(function($item){return array('productId'=>$item->get_product_id(),'quantity'=>$item->get_quantity(),'total'=>$item->get_total());},array_values($o->get_items())));},$orders)));
