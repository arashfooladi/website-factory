<?php
$in=json_decode(file_get_contents('php://stdin'),true,16,JSON_THROW_ON_ERROR);
if(get_option('factory_environment_id')!==($in['environmentId']??null)||getenv('FACTORY_ENVIRONMENT_ID')!==$in['environmentId'])throw new RuntimeException('customer_qa_environment_mismatch');
$scope=$in['scope']??'';if(!preg_match('/^factory-qa-[a-f0-9-]{36}$/D',$scope))throw new RuntimeException('customer_qa_scope_invalid');
$user=get_user_by('login',$scope);$action=$in['action']??'';
if($user&&get_user_meta($user->ID,'factory_qa_scope',true)!==$scope)throw new RuntimeException('customer_qa_scope_mismatch');
if($action==='prepare'){
 if($user||!is_string($in['password']??null)||strlen($in['password'])<32)throw new RuntimeException('customer_qa_prepare_invalid');
 $id=wp_insert_user(array('user_login'=>$scope,'user_email'=>$scope.'@example.test','user_pass'=>$in['password'],'role'=>'customer','first_name'=>'آزمایش','last_name'=>'کارخانه','display_name'=>'آزمایش کارخانه'));
 if(is_wp_error($id))throw new RuntimeException('customer_qa_prepare_failed');update_user_meta($id,'factory_qa_scope',$scope);$user=get_user_by('id',$id);
}elseif($action==='cleanup'){
 if($user){require_once ABSPATH.'wp-admin/includes/user.php';if(!in_array('customer',$user->roles,true)||user_can($user,'edit_products'))throw new RuntimeException('customer_qa_cleanup_refused');wp_delete_user($user->ID);}
 echo wp_json_encode(array('removed'=>!get_user_by('login',$scope)));return;
}elseif($action!=='inspect')throw new RuntimeException('customer_qa_action_invalid');
echo wp_json_encode(array('id'=>$user?$user->ID:null,'email'=>$user?$user->user_email:null,'firstName'=>$user?get_user_meta($user->ID,'first_name',true):null,'lastName'=>$user?get_user_meta($user->ID,'last_name',true):null,'displayName'=>$user?$user->display_name:null,'canEditProducts'=>$user&&user_can($user,'edit_products'),'roles'=>$user?$user->roles:array()));
