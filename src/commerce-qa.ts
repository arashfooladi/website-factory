import {reachByKeyboard} from './keyboard-qa.js';
import {loginClientAdmin} from './admin-login.js';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AgentBrowser} from './agent-browser.js';
import {AgentWorkspace} from './agent-workspace.js';
import type {AgentArtifacts} from './agent-artifacts.js';
import type {Environments} from './environments.js';

export type CommercePlan={engine?:'chromium'|'firefox'|'webkit';gateway:'cod'|'bacs';shipping:number;orderStatus:'processing'|'on-hold';quantity:number};
/** Expectations are supplied by protected acceptance, never inferred from the checkout being tested. */
export async function checkCommerce(environments:Environments,owner:string,environmentId:string,candidate:{revision:string;sourceDigest:string;sourceEnvironmentId:string},plan:CommercePlan,artifacts:AgentArtifacts,signal:AbortSignal){
 const state=await environments.inspect(owner,environmentId);
 const secret=JSON.parse(await readFile(join(environments.controller.config.environmentRoot,'instances',environmentId,'private.json'),'utf8'));
 if(state.status!=='running'||state.current_operation_id||!secret.visualClone||secret.visualClone.sourceEnvironmentId!==candidate.sourceEnvironmentId||environmentId===candidate.sourceEnvironmentId||secret.visualClone.sourceDigest!==candidate.sourceDigest||secret.visualClone.purpose!=='functional')throw new Error('commerce_qa_isolated_clone_required');
 if(!/^[a-f0-9]{40}$/.test(candidate.revision)||!/^[a-f0-9]{64}$/.test(candidate.sourceDigest)||!['cod','bacs'].includes(plan.gateway)||!Number.isFinite(plan.shipping)||plan.shipping<0||!Number.isInteger(plan.quantity)||plan.quantity<1||plan.quantity>5||!['processing','on-hold'].includes(plan.orderStatus))throw new Error('commerce_qa_plan_invalid');
 const workspace=new AgentWorkspace(environments,environmentId),stable=async()=>{signal.throwIfAborted();if((await workspace.export()).sha256!==candidate.sourceDigest)throw new Error('commerce_qa_candidate_changed');};await stable();
 const sku='factory-qa-'+randomUUID(),origin=`http://127.0.0.1:${state.preview_port}`,evidence:any[]=[];
 const oracle=async(action:'prepare'|'inspect'|'cleanup')=>JSON.parse((await environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','--skip-themes','eval-file','/tools/commerce-qa.php'],{environmentId,sku,action})).stdout);
 let browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal,undefined,plan.engine),passed=false,reason:string|null=null,cleanupVerified=false,orderId:number|undefined,editOrderUrl='',phase='prepare';
 const capture=async(step:string)=>{evidence.push({step,...await browser.capture()});};
 try{
  const fixture=await oracle('prepare');if(!fixture.gateways.includes(plan.gateway))throw new Error('commerce_qa_gateway_not_configured');
  await browser.open({width:390,height:844});await browser.protectedPage(async page=>{
   page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
   phase='unavailable';await page.goto(fixture.products[1].url,{waitUntil:'load'});await capture('unavailable');
   const buy=page.locator('.single_add_to_cart_button');if(await buy.count()&&await buy.first().isEnabled())throw new Error('commerce_qa_unavailable_purchasable');
   phase='cart';await page.goto(fixture.products[0].url,{waitUntil:'load'});await page.locator('.single_add_to_cart_button').click();
   await page.goto(origin+'/cart/',{waitUntil:'load'});await capture('cart-added');
   const qty=page.locator('.woocommerce-cart-form input.qty').first();if(await qty.inputValue()!=='1')throw new Error('commerce_qa_cart_add_failed');
   if(plan.quantity!==1){
    await qty.fill(String(plan.quantity));await qty.blur();
    const [updated]=await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/cart/'),page.locator('button[name="update_cart"]').click()]);
    if(updated.status()!==200)throw new Error('commerce_qa_cart_update_http_failure');await updated.finished();await page.reload({waitUntil:'load'});
   }
   if(await qty.inputValue()!==String(plan.quantity))throw new Error('commerce_qa_cart_quantity_failed');await capture('cart-quantity');
   const remove=page.locator('.woocommerce-cart-form a.remove').first();await remove.click();await page.locator('.woocommerce-cart-form').waitFor({state:'hidden'});await capture('cart-removed');
   await page.goto(fixture.products[0].url,{waitUntil:'load'});await page.locator('input.qty').fill(String(plan.quantity));await page.locator('.single_add_to_cart_button').click();
   await page.goto(origin+'/checkout/',{waitUntil:'load'});phase='checkout_validation';
   const rejected=await browser.protectedNetworkResponse(response=>response.method==='POST'&&new URL(response.url).searchParams.get('wc-ajax')==='checkout',()=>page.locator('#place_order').click());
   if(rejected.status!==200||JSON.parse(rejected.body.toString()).result!=='failure')throw new Error('commerce_qa_invalid_checkout_not_rejected');
   await page.locator('.woocommerce-error,.wc-block-components-notice-banner.is-error').first().waitFor();await capture('checkout-invalid');
   if((await oracle('inspect')).orders.length)throw new Error('commerce_qa_invalid_checkout_created_order');
   phase='checkout';await reachByKeyboard(page,page.locator('#billing_first_name'));await page.locator('#billing_first_name').fill('آزمایش');await reachByKeyboard(page,page.locator('#billing_last_name'));await page.locator('#billing_last_name').fill('کارخانه');
   await reachByKeyboard(page,page.locator('#billing_email'));await page.locator('#billing_email').fill(fixture.email);await reachByKeyboard(page,page.locator('#billing_phone'));await page.locator('#billing_phone').fill('09123456789');
   await page.locator('#billing_state').selectOption('THR');await reachByKeyboard(page,page.locator('#billing_city'));await page.locator('#billing_city').fill('تهران');
   await reachByKeyboard(page,page.locator('#billing_address_1'));await page.locator('#billing_address_1').fill('نشانی آزمایشی، پلاک ۱');await reachByKeyboard(page,page.locator('#billing_postcode'));await page.locator('#billing_postcode').fill('1234567890');
   const [recalculated]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).searchParams.get('wc-ajax')==='update_order_review'),page.locator('#billing_postcode').blur()]);
   if(recalculated.status()!==200)throw new Error('commerce_qa_shipping_update_failed');await recalculated.finished();
   const different=page.locator('#ship-to-different-address-checkbox');if(await different.count())await different.uncheck();
   const terms=page.locator('#terms');if(await terms.count())await terms.check();
   await page.locator('#payment_method_'+plan.gateway).check();await page.waitForFunction("!Array.from(document.querySelectorAll('.blockUI.blockOverlay')).some(element=>getComputedStyle(element).display!=='none'&&element.getClientRects().length)");await capture('checkout-ready');
   const expectedFields={billing_first_name:'آزمایش',billing_last_name:'کارخانه',billing_email:fixture.email,billing_phone:'09123456789',billing_city:'تهران',billing_address_1:'نشانی آزمایشی، پلاک ۱',billing_postcode:'1234567890'};
   for(const [field,value]of Object.entries(expectedFields))if(await page.locator('#'+field).inputValue()!==value)throw new Error('commerce_qa_checkout_fields_lost');
   await reachByKeyboard(page,page.locator('#place_order'));
   const submitted=await browser.protectedNetworkResponse(response=>response.method==='POST'&&new URL(response.url).searchParams.get('wc-ajax')==='checkout',()=>page.locator('#place_order').press('Enter'));
   const receipt=JSON.parse(submitted.body.toString());if(submitted.status!==200||receipt.result!=='success')throw new Error('commerce_qa_valid_checkout_rejected');
   await page.waitForURL(/\/order-received\/\d+\//,{timeout:60000});await capture('order-received');
   const result=await oracle('inspect'),order=result.orders[0];orderId=Number(new URL(page.url()).pathname.match(/order-received\/(\d+)/)?.[1]);
   editOrderUrl=order?.editUrl;
   if(result.orders.length!==1||order.id!==orderId||order.status!==plan.orderStatus||order.payment!==plan.gateway||Number(order.shipping)!==plan.shipping||Number(order.total)!==100000*plan.quantity+plan.shipping||order.email!==fixture.email||order.phone!=='09123456789'||order.city!=='تهران'||order.firstName!=='آزمایش'||order.address!=='نشانی آزمایشی، پلاک ۱'||order.postcode!=='1234567890'||order.items.length!==1||order.items[0].productId!==fixture.products[0].id||order.items[0].quantity!==plan.quantity||result.products[0].stock!==9-plan.quantity)throw new Error('commerce_qa_order_persistence_mismatch');
  });
  await browser.close();browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal,undefined,plan.engine);await browser.open();
  const credentials=await environments.credentials(owner,environmentId);
  await browser.protectedPage(async page=>{
   page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);phase='admin_order';
   await loginClientAdmin(page,origin,credentials,editOrderUrl);
   // Legacy storage redirects or uses post.php; both editors expose the same order_status control.
   await page.locator('#order_status').selectOption('wc-completed');await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('button.save_order').click()]);await capture('admin-order-completed');
   if((await oracle('inspect')).orders[0]?.status!=='completed')throw new Error('commerce_qa_order_management_failed');
  });
  await stable();passed=true;
 }catch(error){reason=error instanceof Error&&['browser_engine_unavailable','browser_engine_launch_failed'].includes(error.message)?'commerce_qa_'+error.message:error instanceof Error&&/^commerce_qa_[a-z_]+$/.test(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'commerce_qa_timeout_'+phase:'commerce_qa_interaction_failed';await capture('failure').catch(()=>{});
  let message=error instanceof Error?error.message.split('\n')[0]!.slice(0,600):'Unknown interaction error';for(const key of ['previewToken','adminPassword','dbPassword'])if(secret[key])message=message.replaceAll(secret[key],'[redacted]');
  await artifacts.save('commerce_qa_diagnostics','application/json',JSON.stringify({phase,reason,message,...(error instanceof Error&&error.message==='functional_keyboard_target_unreachable'?{keyboard:error.cause}:{})}));
 }
 finally{await browser.close();try{cleanupVerified=(await oracle('cleanup')).removed===true;}catch{cleanupVerified=false;}}
 await stable();const report={keyboardVerified:passed,blocked:reason==='commerce_qa_gateway_not_configured'||['commerce_qa_browser_engine_unavailable','commerce_qa_browser_engine_launch_failed'].includes(reason??''),candidateRevision:candidate.revision,sourceDigest:candidate.sourceDigest,environmentId,requirementId:'commerce:checkout-orders',passed:passed&&cleanupVerified,reason:reason??(!cleanupVerified?'commerce_qa_cleanup_failed':null),cleanupVerified,plan,evidence,releaseEligible:false};
 await artifacts.save('commerce_qa_report','application/json',JSON.stringify(report));return report;
}
