import {randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import {readFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import type {Environments} from './environments.js';
import type {AgentArtifacts} from './agent-artifacts.js';
import {AgentWorkspace} from './agent-workspace.js';
import {AgentBrowser} from './agent-browser.js';

/** Runs real wp-admin writes only after verifying a private, controller-created clone. */
export async function checkAdminProduct(environments:Environments,owner:string,environmentId:string,
 candidate:{revision:string;sourceDigest:string;sourceEnvironmentId:string;categories?:boolean;media?:boolean;variations?:boolean},artifacts:AgentArtifacts,signal:AbortSignal){
 const state=await environments.inspect(owner,environmentId);
 if(state.status!=='running'||state.current_operation_id)throw new Error('admin_qa_environment_unavailable');
 const secret=JSON.parse(await readFile(join(environments.controller.config.environmentRoot,'instances',environmentId,'private.json'),'utf8'));
 if(!secret.visualClone||secret.visualClone.sourceEnvironmentId===environmentId||secret.visualClone.sourceEnvironmentId!==candidate.sourceEnvironmentId||secret.visualClone.sourceDigest!==candidate.sourceDigest)throw new Error('admin_qa_isolated_clone_required');
 if(candidate.media&&secret.visualClone.purpose!=='functional')throw new Error('admin_qa_media_clone_required');
 if(!/^[a-f0-9]{40}$/.test(candidate.revision)||!/^[a-f0-9]{64}$/.test(candidate.sourceDigest))throw new Error('admin_qa_candidate_required');
 const workspace=new AgentWorkspace(environments,environmentId),stable=async()=>{signal.throwIfAborted();if((await workspace.export()).sha256!==candidate.sourceDigest)throw new Error('admin_qa_candidate_changed');};
 await stable();
 const sku='factory-qa-'+randomUUID(),title='محصول آزمایشی سطر '+sku.slice(-8),updated=title+' ویرایش‌شده',evidence:any[]=[];
 const origin=`http://127.0.0.1:${state.preview_port}`,credentials=await environments.credentials(owner,environmentId);
 let browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal);
 const oracle=async(action:'inspect'|'cleanup')=>JSON.parse((await environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','eval-file','/tools/admin-product-oracle.php'],{environmentId,sku,action})).stdout);
 const capture=async(step:string)=>{evidence.push({step,...await browser.capture()});};
 let reason:string|null=null,passed=false,cleanupVerified=false,phase='login',categoryId:number|undefined,imageId:number|undefined,finalProduct:any,editUrl='';
 try{
  await browser.open({width:1280,height:900});
  await browser.protectedPage(async page=>{
   page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
   await page.goto(origin+'/wp-login.php',{waitUntil:'load'});
   await page.locator('#user_login').fill(credentials.username);await page.locator('#user_pass').fill(credentials.password);
   await page.locator('#wp-submit').click();await page.waitForURL(url=>url.pathname.startsWith('/wp-admin/'));await page.waitForLoadState('load');
   if(candidate.media){
    phase='media';await page.goto(origin+'/wp-admin/media-new.php?browser-uploader',{waitUntil:'load'});
    const fixture=new PNG({width:16,height:16});for(let i=0;i<fixture.data.length;i+=4){fixture.data[i]=32;fixture.data[i+1]=97;fixture.data[i+2]=130;fixture.data[i+3]=255;}const png=PNG.sync.write(fixture);
    await page.locator('#async-upload').setInputFiles({name:sku+'.png',mimeType:'image/png',buffer:png});
    await page.locator('#html-upload').click();await page.waitForLoadState('load');await capture('media-uploaded');
    const media=await oracle('inspect');if(!media.canUpload||media.image?.mime!=='image/png')throw new Error('admin_qa_media_upload_failed');
    const url=new URL(media.image.url);if(url.origin!==origin)throw new Error('admin_qa_media_origin_mismatch');
    const response=await fetch(url,{headers:{Authorization:'Bearer '+secret.previewToken},redirect:'manual',signal});
    if(response.status!==200||!Buffer.from(await response.arrayBuffer()).equals(png))throw new Error('admin_qa_media_bytes_mismatch');imageId=media.image.id;
   }
   if(candidate.categories){
    phase='category';const categoryName='دسته آزمایشی '+sku.slice(-8);
    await page.goto(origin+'/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product',{waitUntil:'load'});
    await page.locator('#tag-name').fill(categoryName);await page.locator('#tag-slug').fill(sku);await page.locator('#submit').click();
    await page.locator('#the-list .row-title').filter({hasText:categoryName}).first().waitFor();await capture('category-created');
    const readback=await oracle('inspect');
    if(!readback.canManageCategories||readback.category?.name!==categoryName)throw new Error('admin_qa_category_creation_failed');
    categoryId=readback.category.id;
   }
   phase='create';await page.goto(origin+'/wp-admin/post-new.php?post_type=product',{waitUntil:'load'});await page.locator('#title').waitFor();await capture('create-form');
   await page.locator('#title').fill(title);await page.locator('#_regular_price').fill('123450');
   if(imageId){
    await page.locator('#set-post-thumbnail').click();const modal=page.locator('.media-modal');await modal.locator('#menu-item-browse').click();
    await modal.locator('input[type="search"]').first().fill(sku);await modal.locator(`.attachment[data-id="${imageId}"]`).click();
    await modal.locator('.media-button-select').click();await page.locator('#set-post-thumbnail img').waitFor();
   }
   if(categoryId){await page.locator('#product_cat-tabs a[href="#product_cat-all"]').click();await page.locator(`input[name="tax_input[product_cat][]"][value="${categoryId}"]`).check();}
   await page.locator('a[href="#inventory_product_data"]').click();await page.locator('#_sku').fill(sku);await page.locator('#_manage_stock').check();await page.locator('#_stock').fill('8');
   await page.locator('#_stock').blur();await page.waitForLoadState('load');await page.locator('#publish:not(.disabled):not([disabled])').click();await page.waitForURL(url=>url.pathname==='/wp-admin/post.php'&&url.searchParams.has('post'));await page.waitForLoadState('load');await capture('published');
   const initial=await oracle('inspect');
   if(!initial.canEdit||!initial.canPublish||initial.product?.name!==title||initial.product.status!=='publish'||Number(initial.product.price)!==123450||initial.product.stock!==8||!initial.product.managed)throw new Error('admin_qa_created_product_mismatch');
   if(categoryId&&!initial.product.categoryIds.includes(categoryId))throw new Error('admin_qa_category_assignment_failed');
   if(imageId&&initial.product.imageId!==imageId)throw new Error('admin_qa_featured_image_assignment_failed');
   phase='catalog';editUrl=page.url();await page.goto(origin+'/shop/',{waitUntil:'load'});await capture('catalog-after-create');
   if(!(await page.locator('main').innerText()).includes(title))throw new Error('admin_qa_new_product_missing_from_catalog');
  });
  await browser.close();browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal);await browser.open({width:1280,height:900});
  await browser.protectedPage(async page=>{
   page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);phase='edit_login';
   await page.goto(origin+'/wp-login.php',{waitUntil:'load'});await page.locator('#user_login').fill(credentials.username);await page.locator('#user_pass').fill(credentials.password);
   await page.locator('#wp-submit').click();await page.waitForURL(url=>url.pathname.startsWith('/wp-admin/'));
   phase='edit';await page.goto(editUrl,{waitUntil:'load'});await page.locator('#title').fill(updated);
   await page.locator('a[href="#general_product_data"]').click();await page.locator('#_regular_price').fill('456700');
   await page.locator('a[href="#inventory_product_data"]').click();await page.locator('#_stock').fill('0');
   await page.locator('#_stock').blur();await page.waitForLoadState('load');await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#publish:not(.disabled):not([disabled])').click()]);await capture('updated');
   const final=await oracle('inspect');
   if(final.product?.name!==updated||Number(final.product.price)!==456700||final.product.stock!==0||final.product.inStock!==false)throw new Error('admin_qa_updated_product_mismatch');
   finalProduct=final.product;
  });
  await browser.close();browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal);await browser.open({width:1280,height:900});
  await browser.protectedPage(async page=>{page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
   phase='storefront';const url=new URL(finalProduct.url);if(url.origin!==origin)throw new Error('admin_qa_product_origin_mismatch');
   await page.goto(url.href,{waitUntil:'load'});await capture('unavailable-storefront');
   if(!(await page.locator('main').innerText()).includes(updated))throw new Error('admin_qa_storefront_title_stale');
   if(imageId)await page.waitForFunction("Array.from(document.querySelectorAll('main img')).some(img=>img.src.includes("+JSON.stringify(sku)+")&&img.complete&&img.naturalWidth>0)");
   const digits=(value:string)=>value.replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[^0-9]/g,'');
   const price=digits(await page.locator('main .price').first().innerText()),expectedPrice=digits(String(finalProduct.formattedPrice));
   if(!expectedPrice||!price.includes(expectedPrice))throw new Error('admin_qa_storefront_price_stale');
   const buy=page.locator('.single_add_to_cart_button');if(await buy.count()&&await buy.first().isEnabled())throw new Error('admin_qa_unavailable_product_purchasable');
  });
  if(candidate.variations){
   await browser.close();browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal);await browser.open({width:1280,height:900});
   await browser.protectedPage(async page=>{
    page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);phase='variation_login';
    await page.goto(origin+'/wp-login.php',{waitUntil:'load'});await page.locator('#user_login').fill(credentials.username);await page.locator('#user_pass').fill(credentials.password);
    await page.locator('#wp-submit').click();await page.waitForURL(url=>url.pathname.startsWith('/wp-admin/'));
    phase='variation_create';await page.goto(editUrl,{waitUntil:'load'});await page.locator('#product-type').selectOption('variable');
    await page.locator('a[href="#inventory_product_data"]').click();await page.locator('#_manage_stock').uncheck();
    await page.locator('a[href="#product_attributes"]').click();await page.locator('.add_custom_attribute').click();
    const attr=page.locator('.woocommerce_attribute').last();await attr.locator('input.attribute_name').fill('اندازه');
    await attr.locator('textarea').fill('کوچک | بزرگ');await attr.locator('input[name^="attribute_variation"]').check();
    await page.locator('.save_attributes:not(.disabled)').click();await page.locator('.product_attributes .blockUI').waitFor({state:'hidden'});
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#publish:not(.disabled):not([disabled])').click()]);
    await page.locator('a[href="#variable_product_options"]').click();await page.locator('.add_variation_manually').click();
    const variation=page.locator('.woocommerce_variation').first();await variation.waitFor();
    await variation.locator('select[name^="attribute_"]').selectOption({label:'کوچک'});
    if(!await variation.locator('input[name^="variable_regular_price"]').isVisible())await variation.locator('h3').click();
    await variation.locator('input[name^="variable_regular_price"]').fill('234500');
    await variation.locator('input[name^="variable_manage_stock"]').check();await variation.locator('input[name^="variable_stock["]').fill('3');
    await page.locator('.save-variation-changes').click();await page.locator('.woocommerce_variations .blockUI').waitFor({state:'hidden'});
    await capture('variation-created');
    const created=await oracle('inspect'),v=created.product?.variations?.[0];
    if(created.product?.type!=='variable'||!v||Number(v.price)!==234500||v.stock!==3||!v.managed||!Object.values(v.attributes).includes('کوچک'))throw new Error('admin_qa_variation_create_mismatch');
    phase='variation_edit';await variation.locator('input[name^="variable_regular_price"]').fill('345600');await variation.locator('input[name^="variable_stock["]').fill('5');
    await page.locator('.save-variation-changes').click();await page.locator('.woocommerce_variations .blockUI').waitFor({state:'hidden'});await capture('variation-edited');
    const edited=await oracle('inspect');finalProduct=edited.product;
    if(Number(finalProduct?.variations?.[0]?.price)!==345600||finalProduct.variations[0].stock!==5)throw new Error('admin_qa_variation_edit_mismatch');
   });
   await browser.close();browser=new AgentBrowser(origin,secret.previewToken,artifacts,signal);await browser.open({width:390,height:844});
   await browser.protectedPage(async page=>{
    phase='variation_storefront';page.setDefaultTimeout(30000);await page.goto(finalProduct.url,{waitUntil:'load'});
    await page.locator('form.variations_form select').first().selectOption({label:'کوچک'});
    await page.waitForFunction("Number(document.querySelector('input[name=variation_id]')?.value)>0");
    if(Number(await page.locator('input[name="variation_id"]').inputValue())!==finalProduct.variations[0].id||!await page.locator('.single_add_to_cart_button').isEnabled())throw new Error('admin_qa_variation_storefront_mismatch');
    await capture('variation-storefront');
   });
  }
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
 const report={candidateRevision:candidate.revision,sourceDigest:candidate.sourceDigest,environmentId,passed:passed&&cleanupVerified,reason,cleanupVerified,categoryChecked:candidate.categories===true,mediaChecked:candidate.media===true,variationsChecked:candidate.variations===true,evidence,
  requirementId:'admin:product-management',releaseEligible:false,scope:'Real client-admin simple-product creation/editing, catalog visibility, price/stock persistence and unavailable storefront. Optional category, media and variation profiles are recorded explicitly. Orders and checkout remain separate.'};
 await artifacts.save('admin_product_report','application/json',JSON.stringify(report));return report;
}
