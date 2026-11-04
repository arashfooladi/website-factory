import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from '@playwright/test';
import type {Environments} from './environments.js';
import type {BuildRequest} from './build-contracts.js';
import {AgentBrowser} from './agent-browser.js';
import {AgentArtifacts} from './agent-artifacts.js';
import {AgentWorkspace} from './agent-workspace.js';

export const BUILD_RUNTIME_PROBE=`require_once ABSPATH.'wp-admin/includes/plugin.php';$m=get_option('factory_build_manifest');$products=array();
    foreach($m['products'] as $item){$p=wc_get_product($item['id']);$products[]=array('id'=>$p->get_id(),'name'=>$p->get_name(),'type'=>$p->get_type(),'price'=>$p->get_price(),'stock'=>$p->get_stock_quantity(),'imageId'=>(int)$p->get_image_id());}
    echo wp_json_encode(array('buildId'=>get_option('factory_build_id'),'title'=>get_option('blogname'),'products'=>$products,
      'admin'=>user_can(get_user_by('login','client_admin'),'manage_woocommerce'),'editorOverrides'=>count(get_posts(array('post_type'=>array('wp_template','wp_template_part'),'post_status'=>'any','numberposts'=>-1))),
      'template'=>get_template(),'child'=>get_stylesheet(),'woocommerce'=>is_plugin_active('woocommerce/woocommerce.php')));`;

export async function verifyBuild(environments:Environments,environmentId:string,input:BuildRequest,manifest:any,sourceDigest:string,artifacts:AgentArtifacts,
  signal:AbortSignal,features:string[],onBrowser:(id:string)=>Promise<void>){
  const exported=await new AgentWorkspace(environments,environmentId).export();if(exported.sha256!==sourceDigest)throw new Error('build_source_changed');
  const result=await environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','eval',BUILD_RUNTIME_PROBE]);
  const runtime=JSON.parse(result.stdout);
  expect(runtime).toMatchObject({buildId:manifest.buildId,title:input.content.siteTitle,admin:true,editorOverrides:0,template:'maintheme',child:'client-child',woocommerce:true});
  expect(runtime.products).toHaveLength(input.content.products.length);
  for(const supplied of input.content.products){
    const created=manifest.products.find((item:any)=>item.key===supplied.key),actual=runtime.products.find((item:any)=>item.id===created?.id);
    expect(actual).toMatchObject({name:supplied.name,type:supplied.variations?'variable':'simple',stock:supplied.stock});
    expect(Number(actual.price)).toBe(Number(supplied.price));if(supplied.imageAssetId)expect(actual.imageId).toBeGreaterThan(0);
  }
  const state=await environments.inspect(environments.controller.config.ownerId,environmentId),secret=JSON.parse(await readFile(join(environments.controller.config.environmentRoot,'instances',environmentId,'private.json'),'utf8'));
  const browser=new AgentBrowser(`http://127.0.0.1:${state.preview_port}`,secret.previewToken,artifacts,signal);await onBrowser(browser.id);
  const checks:any[]=[{key:'source-and-content-runtime',status:'passed',runtime}];
  try{
    await browser.open();await browser.protectedPage(async page=>{
      page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message.slice(0,300)));
      const paths=[...new Set([...manifest.pages.map((item:any)=>item.path),...manifest.products.slice(0,2).map((item:any)=>item.path)])]as string[];
      for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
        await page.setViewportSize(viewport);
        for(const path of paths){
          signal.throwIfAborted();const response=await page.goto(browser.origin+path,{waitUntil:'networkidle'});expect(response?.status()).toBe(200);
          await expect(page.locator('main').first()).toBeVisible();
          const text=await page.locator('body').innerText();expect(text.length).toBeGreaterThan(30);
          expect(text).not.toMatch(/Lorem ipsum|Hello world!|محصول ساده آزمایشی|محصول متغیر آزمایشی|\bTODO\b/i);
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
          const observation=await browser.capture();checks.push({key:'initial-route',status:'passed',path,viewport,screenshotId:observation.screenshot.id,htmlId:observation.html.id,structureId:observation.structure.id});
        }
      }
      const simple=manifest.products.find((item:any)=>item.type==='simple'&&input.content.products.find(supplied=>supplied.key===item.key)!.stock>0);
      if(simple){
        await page.goto(browser.origin+simple.path,{waitUntil:'networkidle'});await expect(page.locator('.single_add_to_cart_button')).toBeVisible();await page.locator('.single_add_to_cart_button').click();
        const cart=manifest.pages.find((item:any)=>item.kind==='cart');if(!cart)throw new Error('build_cart_page_missing');
        await page.goto(browser.origin+cart.path,{waitUntil:'networkidle'});await expect(page.locator('main').first()).toContainText(simple.name);
        const observation=await browser.capture();checks.push({key:'initial-product-cart',status:'passed',productId:simple.id,screenshotId:observation.screenshot.id});
      }
      if(features.includes('search')){
        await page.goto(browser.origin+'/',{waitUntil:'networkidle'});
        const search=page.locator('input[name="s"]');if(!await search.count())throw new Error('build_search_control_missing');
        const query=input.content.products[0]?.name.split(/\s+/)[0]??input.content.siteTitle;
        await search.first().fill(query);await search.first().press('Enter');await page.waitForURL(url=>url.searchParams.get('s')===query);
        if(input.content.products.length)await expect(page.locator('main').first()).toContainText(input.content.products[0]!.name);
        checks.push({key:'initial-search',status:'passed',query});
      }
      expect(errors).toEqual([]);
    });
  }catch(error){await artifacts.save('initial_build_failure','application/json',JSON.stringify({name:error instanceof Error?error.name:'unknown',message:error instanceof Error?error.message.slice(0,6000):'build_check_failed'}));await browser.capture().catch(()=>{});throw error;}
  finally{await browser.close();}
  if((await new AgentWorkspace(environments,environmentId).export()).sha256!==sourceDigest)throw new Error('build_source_changed');
  return{version:1,checks,scope:'Initial prototype smoke only. Independent responsive, visual, functional, admin/commerce and restore release suites are not yet complete.',releaseEligible:false};
}
