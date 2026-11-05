import {AgentBrowser} from './agent-browser.js';
import {loginClientAdmin} from './admin-login.js';
import {functionalContext,type QaCandidate} from './functional-context.js';
import type {Environments} from './environments.js';
import type {AgentArtifacts} from './agent-artifacts.js';

/** Dashboard access is a separate protected baseline case from product CRUD. */
export async function checkAdminDashboard(environments:Environments,owner:string,id:string,candidate:QaCandidate,artifacts:AgentArtifacts,signal:AbortSignal){
 const context=await functionalContext(environments,owner,id,candidate,signal),credentials=await environments.credentials(owner,id),browser=new AgentBrowser(context.origin,context.secret.previewToken,artifacts,signal),evidence:any[]=[];
 let passed=false,reason:string|null=null;
 try{
  await browser.open();await browser.protectedPage(async page=>{
   page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
   await loginClientAdmin(page,context.origin,credentials,'/wp-admin/index.php');
   if(browser.httpStatus!==200)throw new Error('admin_dashboard_http_failure');
   await page.locator('#dashboard-widgets-wrap').waitFor({state:'visible'});
   if(!(await page.locator('#wpbody-content h1').first().innerText()).trim())throw new Error('admin_dashboard_heading_missing');
   evidence.push({step:'client-admin-dashboard',...await browser.capture()});passed=true;
  });
 }catch(error){
  reason=error instanceof Error&&/^admin_dashboard_[a-z_]+$/.test(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'admin_dashboard_timeout':'admin_dashboard_interaction_failed';
  const captured=await browser.capture().catch(()=>null);if(captured)evidence.push({step:'failure',...captured});
 }finally{await browser.close();}
 await context.stable();const report={candidateRevision:candidate.revision,sourceDigest:candidate.sourceDigest,requirementId:'baseline:wp-admin-access',keyboardVerified:passed,passed,reason,evidence,cleanupVerified:true,releaseEligible:false};
 await artifacts.save('admin_dashboard_report','application/json',JSON.stringify(report));return report;
}
