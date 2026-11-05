import type {Page} from '@playwright/test';

/** Wait for the real WooCommerce persistence response, not merely a disappearing overlay. */
export async function submitWooAction(page:Page,selector:string,action:string){
 await page.locator(selector).waitFor({state:'visible'});
 const [response]=await Promise.all([
  page.waitForResponse(response=>new URL(response.url()).pathname==='/wp-admin/admin-ajax.php'&&new URLSearchParams(response.request().postData()??'').get('action')===action),
  page.locator(selector).click(),
 ]);
 if(response.status()!==200)throw new Error('admin_qa_ajax_save_failed');
 const body=await response.text();
 if(action==='woocommerce_save_attributes'){
  let result:any;try{result=JSON.parse(body);}catch{throw new Error('admin_qa_ajax_save_failed');}
  if(result?.success!==true||typeof result.data?.html!=='string')throw new Error('admin_qa_ajax_save_failed');
 }else if(action==='woocommerce_add_variation'){
  if(!/class=["'][^"']*woocommerce_variation/.test(body))throw new Error('admin_qa_ajax_save_failed');
 }else if(action==='woocommerce_save_variations'){
  // WooCommerce returns an empty successful body, or HTML containing validation errors.
  if(body.trim()!==''&&body.trim()!=='0')throw new Error('admin_qa_ajax_save_failed');
 }else throw new Error('admin_qa_ajax_action_unsupported');
}
