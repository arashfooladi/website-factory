import {randomUUID} from 'node:crypto';
import {readFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import type {Environments} from './environments.js';
import type {AgentArtifacts} from './agent-artifacts.js';
import {AgentWorkspace} from './agent-workspace.js';
import {AgentBrowser} from './agent-browser.js';

/** Runs real wp-admin writes only after verifying a private, controller-created clone. */
export async function checkAdminProduct(environments:Environments,owner:string,environmentId:string,
 candidate:{revision:string;sourceDigest:string;sourceEnvironmentId:string},artifacts:AgentArtifacts,signal:AbortSignal){
 const state=await environments.inspect(owner,environmentId);
 if(state.status!=='running'||state.current_operation_id)throw new Error('admin_qa_environment_unavailable');
 const secret=JSON.parse(await readFile(join(environments.controller.config.environmentRoot,'instances',environmentId,'private.json'),'utf8'));
 if(!secret.visualClone||secret.visualClone.sourceEnvironmentId===environmentId||secret.visualClone.sourceEnvironmentId!==candidate.sourceEnvironmentId||secret.visualClone.sourceDigest!==candidate.sourceDigest)throw new Error('admin_qa_isolated_clone_required');
 if(!/^[a-f0-9]{40}$/.test(candidate.revision)||!/^[a-f0-9]{64}$/.test(candidate.sourceDigest))throw new Error('admin_qa_candidate_required');
 const workspace=new AgentWorkspace(environments,environmentId),stable=async()=>{signal.throwIfAborted();if((await workspace.export()).sha256!==candidate.sourceDigest)throw new Error('admin_qa_candidate_changed');};
 await stable();
 const sku='factory-qa-'+randomUUID(),title='محصول آزمایشی سطر '+sku.slice(-8),updated=title+' ویرایش‌شده',evidence:any[]=[];
 const origin=`http://127.0.0.1:${state.preview_port}`,credentials=await environments.credentials(owner,environmentId);
 const browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal);
 const oracle=async(action:'inspect'|'cleanup')=>JSON.parse((await environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','eval-file','/tools/admin-product-oracle.php'],{environmentId,sku,action})).stdout);
 const capture=async(step:string)=>{evidence.push({step,...await browser.capture()});};
 let reason:string|null=null,passed=false,cleanupVerified=false,phase='login';
 try{
  await browser.open({width:1280,height:900});
  await browser.protectedPage(async page=>{
   page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
   await page.goto(origin+'/wp-login.php',{waitUntil:'networkidle'});
   await page.locator('#user_login').fill(credentials.username);await page.locator('#user_pass').fill(credentials.password);
   await page.locator('#wp-submit').click();await page.waitForURL(url=>url.pathname.startsWith('/wp-admin/'));await page.waitForLoadState('networkidle');
   phase='create';await page.goto(origin+'/wp-admin/post-new.php?post_type=product',{waitUntil:'networkidle'});await capture('create-form');
   await page.locator('#title').fill(title);await page.locator('#_regular_price').fill('123450');
   await page.locator('a[href="#inventory_product_data"]').click();await page.locator('#_sku').fill(sku);await page.locator('#_manage_stock').check();await page.locator('#_stock').fill('8');
   await page.locator('#_stock').blur();await page.waitForLoadState('networkidle');await page.locator('#publish:not(.disabled):not([disabled])').click();await page.waitForURL(url=>url.pathname==='/wp-admin/post.php'&&url.searchParams.has('post'));await page.waitForLoadState('networkidle');await capture('published');
   const initial=await oracle('inspect');
   if(!initial.canEdit||!initial.canPublish||initial.product?.name!==title||initial.product.status!=='publish'||Number(initial.product.price)!==123450||initial.product.stock!==8||!initial.product.managed)throw new Error('admin_qa_created_product_mismatch');
   phase='catalog';const editUrl=page.url();await page.goto(origin+'/shop/',{waitUntil:'networkidle'});await capture('catalog-after-create');
   if(!(await page.locator('main').innerText()).includes(title))throw new Error('admin_qa_new_product_missing_from_catalog');
   phase='edit';await page.goto(editUrl,{waitUntil:'networkidle'});await page.locator('#title').fill(updated);
   await page.locator('a[href="#general_product_data"]').click();await page.locator('#_regular_price').fill('456700');
   await page.locator('a[href="#inventory_product_data"]').click();await page.locator('#_stock').fill('0');
   await page.locator('#_stock').blur();await page.waitForLoadState('networkidle');await page.locator('#publish:not(.disabled):not([disabled])').click();await page.waitForLoadState('networkidle');await capture('updated');
   const final=await oracle('inspect');
   if(final.product?.name!==updated||Number(final.product.price)!==456700||final.product.stock!==0||final.product.inStock!==false)throw new Error('admin_qa_updated_product_mismatch');
   phase='storefront';const url=new URL(final.product.url);if(url.origin!==origin)throw new Error('admin_qa_product_origin_mismatch');
   await page.goto(url.href,{waitUntil:'networkidle'});await capture('unavailable-storefront');
   if(!(await page.locator('main').innerText()).includes(updated))throw new Error('admin_qa_storefront_title_stale');
   const digits=(value:string)=>value.replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[^0-9]/g,'');
   const price=digits(await page.locator('main .price').first().innerText()),expectedPrice=digits(String(final.product.formattedPrice));
   if(!expectedPrice||!price.includes(expectedPrice))throw new Error('admin_qa_storefront_price_stale');
   const buy=page.locator('.single_add_to_cart_button');if(await buy.count()&&await buy.first().isEnabled())throw new Error('admin_qa_unavailable_product_purchasable');
  });
  await stable();passed=true;
 }catch(error){
  reason=error instanceof Error&&/^admin_qa_[a-z_]+$/.test(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'admin_qa_timeout_'+phase:'admin_qa_browser_interaction_failed';
  await capture('failure').catch(()=>{});
  const logs:Record<string,string>={};
  for(const name of ['wp-debug.log','web.log']){
   const handle=await open(join(environments.controller.config.environmentRoot,'instances',environmentId,'logs',name),constants.O_RDONLY|constants.O_NOFOLLOW).catch(()=>null);
   if(!handle)continue;
   try{const stat=await handle.stat();if(!stat.isFile())continue;const bytes=Buffer.alloc(Math.min(stat.size,32768));await handle.read(bytes,0,bytes.length,Math.max(0,stat.size-bytes.length));let text=bytes.toString();for(const key of ['previewToken','adminPassword','dbPassword'])if(secret[key])text=text.replaceAll(secret[key],'[redacted]');logs[name]=text;}finally{await handle.close();}
  }
  await artifacts.save('admin_qa_diagnostics','application/json',JSON.stringify({phase,reason,logs}));
 }
 finally{
  await browser.close();
  try{cleanupVerified=(await oracle('cleanup')).removed===true;}catch{cleanupVerified=false;}
  if(!cleanupVerified)reason??='admin_qa_cleanup_failed';
 }
 await stable();
 const report={candidateRevision:candidate.revision,sourceDigest:candidate.sourceDigest,environmentId,passed:passed&&cleanupVerified,reason,cleanupVerified,evidence,
  requirementId:'admin:product-management',releaseEligible:false,scope:'Real client-admin simple-product creation/editing, catalog visibility, price/stock persistence and unavailable storefront. Variations, media, orders and checkout remain separate.'};
 await artifacts.save('admin_product_report','application/json',JSON.stringify(report));return report;
}
