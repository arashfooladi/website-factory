import {randomUUID,randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {reachByKeyboard} from './keyboard-qa.js';
import {AgentBrowser} from './agent-browser.js';
import type {AgentArtifacts} from './agent-artifacts.js';
import type {Environments} from './environments.js';
import {functionalContext,type QaCandidate} from './functional-context.js';
import {mailEvidence,matchesMail} from './mail-evidence.js';

export async function checkCustomerAccount(environments:Environments,owner:string,id:string,candidate:QaCandidate,path:string,artifacts:AgentArtifacts,signal:AbortSignal){
 if(!/^\/[a-zA-Z0-9/_-]+\/$/.test(path)||path.startsWith('//'))throw new Error('customer_qa_path_invalid');
 const context=await functionalContext(environments,owner,id,candidate,signal),scope='factory-qa-'+randomUUID(),password=randomBytes(32).toString('hex'),evidence:any[]=[];
 const oracle=async(action:'prepare'|'inspect'|'cleanup')=>JSON.parse((await environments.runtime('exec',id,['/tools/php','/tools/wp-cli.phar','--path=/site','--skip-themes','eval-file','/tools/customer-qa.php'],{environmentId:id,scope,action,...(action==='prepare'?{password}:{})})).stdout);
 const browser=new AgentBrowser(context.origin,context.secret.previewToken,artifacts,signal);let passed=false,reason:string|null=null,cleanupVerified=false,phase='prepare',resetMailVerified=false;
 const capture=async(step:string)=>{evidence.push({step,...await browser.capture()});};
 try{
  const customer=await oracle('prepare');if(customer.canEditProducts||!customer.roles.includes('customer'))throw new Error('customer_qa_role_mismatch');
  await browser.open({width:390,height:844});await browser.protectedPage(async page=>{
   page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);phase='login_rejected';
   await page.goto(context.origin+path,{waitUntil:'load'});await reachByKeyboard(page,page.locator('#username'));await page.locator('#username').fill(scope);await reachByKeyboard(page,page.locator('#password'));await page.locator('#password').fill(password+'-invalid');await reachByKeyboard(page,page.locator('button[name="login"]'));await page.locator('button[name="login"]').press('Enter');
   await page.locator('.woocommerce-error,.wc-block-components-notice-banner.is-error').first().waitFor();if(await page.locator('.woocommerce-MyAccount-navigation').count())throw new Error('customer_qa_wrong_password_accepted');await capture('customer-login-rejected');
   phase='login';await reachByKeyboard(page,page.locator('#username'));await page.locator('#username').fill(scope);await reachByKeyboard(page,page.locator('#password'));await page.locator('#password').fill(password);await reachByKeyboard(page,page.locator('button[name="login"]'));await page.locator('button[name="login"]').press('Enter');
   await page.locator('.woocommerce-MyAccount-navigation').waitFor();await capture('customer-login');
   phase='edit';await page.locator('.woocommerce-MyAccount-navigation-link--edit-account a').click();await page.locator('#account_first_name').fill('نام فارسی');await page.locator('#account_last_name').fill('ویرایش‌شده');await page.locator('#account_display_name').fill('کاربر آزمایشی');
   await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('button[name="save_account_details"]').click()]);await capture('customer-account-edited');
   const edited=await oracle('inspect');if(edited.firstName!=='نام فارسی'||edited.lastName!=='ویرایش‌شده'||edited.displayName!=='کاربر آزمایشی'||edited.canEditProducts)throw new Error('customer_qa_account_persistence_failed');
   phase='permission';const response=await page.goto(context.origin+'/wp-admin/edit.php?post_type=product',{waitUntil:'load'});await capture('customer-admin-denied');
   if(response?.status()!==403&&new URL(page.url()).pathname==='/wp-admin/edit.php')throw new Error('customer_qa_admin_access_leaked');
   phase='logout';await page.goto(context.origin+path,{waitUntil:'load'});await page.locator('.woocommerce-MyAccount-navigation-link--customer-logout a').click();await page.locator('#username').waitFor();await capture('customer-logout');
  });
  // A fresh anonymous session keeps the reset journey independent of authenticated cookies and request limits.
  await browser.close();const resetBrowser=new AgentBrowser(context.origin,context.secret.previewToken,artifacts,signal);
  try{
   await resetBrowser.open({width:390,height:844});await resetBrowser.protectedPage(async page=>{
    page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);phase='password_reset';
    await page.goto(context.origin+path+'lost-password/',{waitUntil:'load'});await page.locator('input[name="user_login"]').fill(customer.email);
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('.woocommerce-ResetPassword button[type="submit"]').first().click()]);
    evidence.push({step:'customer-reset-requested',...await resetBrowser.capture()});
    resetMailVerified=matchesMail(await mailEvidence(join(environments.controller.config.environmentRoot,'instances',id,'logs','mail.jsonl')),{to:customer.email,messageIncludes:'key='});
    if(!resetMailVerified)throw new Error('customer_qa_reset_mail_missing');
   });
  }catch(error){const failure=await resetBrowser.capture().catch(()=>null);if(failure)evidence.push({step:'failure',...failure});throw error;}finally{await resetBrowser.close();}
  await context.stable();passed=true;
 }catch(error){reason=error instanceof Error&&/^customer_qa_[a-z_]+$/.test(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'customer_qa_timeout_'+phase:'customer_qa_interaction_failed';await capture('failure').catch(()=>{});
  let message=error instanceof Error?error.message.split('\n')[0]!.slice(0,600):'Unknown interaction error';for(const secret of [password,context.secret.previewToken,context.secret.adminPassword,context.secret.dbPassword])if(secret)message=message.replaceAll(secret,'[redacted]');
  await artifacts.save('customer_qa_diagnostics','application/json',JSON.stringify({phase,reason,message}));
 }
 finally{await browser.close();try{cleanupVerified=(await oracle('cleanup')).removed===true;}catch{cleanupVerified=false;}}
 await context.stable();const report={candidateRevision:candidate.revision,sourceDigest:candidate.sourceDigest,requirementId:'accounts:customer',keyboardVerified:passed,passed:passed&&cleanupVerified,reason:reason??(!cleanupVerified?'customer_qa_cleanup_failed':null),resetMailVerified,cleanupVerified,evidence,releaseEligible:false};
 await artifacts.save('customer_account_report','application/json',JSON.stringify(report));return report;
}
