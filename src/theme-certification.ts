import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from '@playwright/test';
import type {Environments} from './environments.js';
import type {ThemeManifest} from './themes.js';
import {AgentArtifacts} from './agent-artifacts.js';
import {AgentBrowser} from './agent-browser.js';
import {readRuntimeLog} from './runtime-files.js';

export async function certifyThemeRuntime(environments:Environments,id:string,manifest:ThemeManifest,artifacts:AgentArtifacts,signal:AbortSignal,
  report:{checks:any[]},onBrowser:(id:string)=>Promise<void>){
  const wp=async(code:string)=>JSON.parse((await environments.runtime('exec',id,['/tools/php','/tools/wp-cli.phar','--path=/site','eval',code])).stdout.trim());
  const runtime=await wp(`echo wp_json_encode(array('template'=>get_template(),'child'=>get_stylesheet(),'rtl'=>is_rtl(),
    'parentVersion'=>wp_get_theme(get_template())->get('Version'),'commerce'=>defined('MAINTHEME_IR_COMMERCE_VERSION'),
    'simple'=>wc_get_product(get_option('factory_baseline_fixture')['products']['factory-simple'])->get_type(),
    'variable'=>wc_get_product(get_option('factory_baseline_fixture')['products']['factory-variable'])->get_type(),
    'outOfStock'=>wc_get_product(get_option('factory_baseline_fixture')['products']['factory-out-of-stock'])->is_in_stock()));`);
  expect(runtime).toMatchObject({template:'maintheme',child:'client-child',rtl:true,parentVersion:manifest.versions.parent,commerce:true,
    simple:'simple',variable:'variable',outOfStock:false});report.checks.push({key:'theme-plugin-product-runtime',status:'passed',runtime});
  const state=await environments.inspect(environments.controller.config.ownerId,id),secret=JSON.parse(await readFile(join(environments.controller.config.environmentRoot,'instances',id,'private.json'),'utf8'));
  const browser=new AgentBrowser(`http://127.0.0.1:${state.preview_port}`,secret.previewToken,artifacts,signal);let phase='open-browser';const scriptErrors:string[]=[];
  await onBrowser(browser.id);
  try{
    await browser.open();
    await browser.protectedPage(async page=>{
      page.setDefaultTimeout(15000);
      const errors=scriptErrors;page.on('pageerror',error=>errors.push((error.stack??error.message).slice(0,3000)));
      for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
        await page.setViewportSize(viewport);
        for(const path of ['/','/shop/','/product/factory-simple/']){
          phase=`responsive ${viewport.width}x${viewport.height} ${path}`;
          signal.throwIfAborted();const response=await page.goto(browser.origin+path,{waitUntil:'networkidle'});
          expect(response?.status()).toBe(200);await expect(page.locator('html')).toHaveAttribute('dir','rtl');
          await expect(page.locator('main').first()).toBeVisible();
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
          if(path.includes('/product/'))await expect(page.locator('.single_add_to_cart_button')).toBeVisible();
          const observation=await browser.capture();report.checks.push({key:'responsive-route',status:'passed',path,viewport,screenshotId:observation.screenshot.id,htmlId:observation.html.id,structureId:observation.structure.id});
        }
      }
      expect(errors).toEqual([]);
      phase='variable-product';
      await page.goto(browser.origin+'/product/factory-variable/');
      await page.locator('form.variations_form select').selectOption({label:'کوچک'});
      await expect(page.locator('input[name="variation_id"]')).toHaveValue(/^[1-9]\d*$/,{timeout:15000});
      await expect(page.locator('.single_add_to_cart_button')).toBeEnabled();
      await page.goto(browser.origin+'/product/factory-out-of-stock/');
      await expect(page.locator('.stock.out-of-stock')).toBeVisible();await expect(page.locator('.single_add_to_cart_button')).toHaveCount(0);
      report.checks.push({key:'variable-and-unavailable-products',status:'passed'});
      phase='checkout';
      await page.setViewportSize({width:1280,height:900});
      await page.goto(browser.origin+'/product/factory-simple/');await page.locator('.single_add_to_cart_button').click();
      await page.goto(browser.origin+'/checkout/');await expect(page.locator('form.checkout')).toBeVisible();
      const email=`theme-${id.slice(0,8)}@example.test`;
      for(const [selector,value]of Object.entries({'#billing_first_name':'آزمایش','#billing_last_name':'پوسته','#billing_email':email,
        '#billing_phone':'09123456789','#billing_city':'تهران','#billing_address_1':'نشانی آزمایشی، پلاک ۱','#billing_postcode':'1234567890'}))await page.locator(selector).fill(value);
      await page.locator('#billing_state').selectOption('THR');
      if(await page.locator('#ship-to-different-address-checkbox').count())await page.locator('#ship-to-different-address-checkbox').uncheck();
      if(await page.locator('#terms').count())await page.locator('#terms').check();
      await expect(page.locator('#payment_method_cod')).toBeChecked();await expect(page.locator('.blockUI.blockOverlay')).toHaveCount(0);
      await page.locator('#place_order').click();await page.waitForURL(/order-received/, {timeout:60000});
      const orderId=Number(page.url().match(/order-received\/(\d+)/)?.[1]);if(!orderId)throw new Error('theme_checkout_order_missing');
      const order=await wp(`$o=wc_get_order(${orderId});echo wp_json_encode(array('status'=>$o->get_status(),'payment'=>$o->get_payment_method(),
        'total'=>$o->get_total(),'shipping'=>$o->get_shipping_total(),'email'=>$o->get_billing_email(),'items'=>count($o->get_items())));`);
      expect(order).toMatchObject({status:'processing',payment:'cod',total:'300000',shipping:'50000',email,items:1});
      const checkout=await browser.capture();report.checks.push({key:'controlled-persian-checkout',status:'passed',orderId,screenshotId:checkout.screenshot.id});
      phase='admin-products';
      await page.goto(browser.origin+'/wp-login.php');await page.locator('#user_login').fill('client_admin');await page.locator('#user_pass').fill(secret.adminPassword);
      // Authenticate through the real form, then wait for the admin document.
      // Dashboard background navigation/assets are not the login condition.
      await page.locator('#wp-submit').click({noWaitAfter:true});
      await page.waitForURL('**/wp-admin/**',{waitUntil:'domcontentloaded',timeout:60000});
      await page.goto(browser.origin+'/wp-admin/edit.php?post_type=product',{waitUntil:'domcontentloaded'});
      await expect(page.locator('#wpbody-content')).toContainText('محصول ساده آزمایشی');await expect(page.locator('#wpbody-content')).toContainText('محصول متغیر آزمایشی');
      const admin=await browser.capture();report.checks.push({key:'wordpress-product-administration',status:'passed',screenshotId:admin.screenshot.id});
      expect(errors).toEqual([]);
    });
  }catch(error){
    await artifacts.save('theme_runtime_failure','application/json',JSON.stringify({phase,name:error instanceof Error?error.name:'unknown',message:error instanceof Error?error.message.slice(0,6000):'runtime_check_failed',scriptErrors}));
    await browser.capture().catch(()=>{});throw error;
  }finally{await browser.close();}
  const debug=await readRuntimeLog(join(environments.controller.config.environmentRoot,'instances',id,'logs/wp-debug.log'));
  if(debug.body.trim()||debug.truncated){
    await artifacts.save('wordpress_debug_log','text/plain',debug.body);
    await artifacts.save('wordpress_debug_log_metadata','application/json',JSON.stringify({size:debug.size,truncated:debug.truncated}));
    const diagnostic=await readRuntimeLog(join(environments.controller.config.environmentRoot,'instances',id,'logs/wordpress-diagnostics.jsonl'));
    if(diagnostic.body)await artifacts.save('wordpress_diagnostics','application/x-ndjson',diagnostic.body);
    throw new Error('theme_wordpress_debug_log_present');
  }
  report.checks.push({key:'wordpress-debug-log',status:'passed'});
}
