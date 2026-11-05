<?php
/** Controller-only negative fixture; never mounted into a client delivery. */
$in=json_decode(file_get_contents('php://stdin'),true,16,JSON_THROW_ON_ERROR);
if(get_option('factory_environment_id')!==($in['environmentId']??null)||getenv('FACTORY_ENVIRONMENT_ID')!==$in['environmentId'])throw new RuntimeException('permission_fixture_environment_mismatch');
$scope=$in['scope']??'';if(!preg_match('/^factory-qa-permission-[a-f0-9-]{36}$/D',$scope))throw new RuntimeException('permission_fixture_scope_invalid');
$user=get_user_by('login','client_admin');if(!$user)throw new RuntimeException('permission_fixture_user_missing');
$key='factory_qa_permission_'.$scope;
if(($in['action']??'')==='deny'){
 if(get_option($key)!==false||!user_can($user,'edit_products'))throw new RuntimeException('permission_fixture_initial_state_invalid');
 add_option($key,array('userId'=>$user->ID,'caps'=>$user->caps),'','no');$user->add_cap('edit_products',false);
}elseif(($in['action']??'')==='restore'){
 $saved=get_option($key);if($saved===false){echo wp_json_encode(array('canEditProducts'=>user_can($user,'edit_products'),'restored'=>true));return;}if(!is_array($saved)||$saved['userId']!==$user->ID||!is_array($saved['caps']))throw new RuntimeException('permission_fixture_restore_refused');
 update_user_meta($user->ID,$user->cap_key,$saved['caps']);clean_user_cache($user->ID);delete_option($key);$user=new WP_User($user->ID);
}else throw new RuntimeException('permission_fixture_action_invalid');
echo wp_json_encode(array('canEditProducts'=>user_can($user,'edit_products'),'restored'=>get_option($key)===false));
