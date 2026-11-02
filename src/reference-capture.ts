import type {IntakeBrief} from './intake-contracts.js';
import type {ExperienceObservation,BrowserCommand} from './agent-contracts.js';
import {AgentBrowser} from './agent-browser.js';
import {AgentArtifacts} from './agent-artifacts.js';
import {PublicReferenceNetwork,referenceUrl} from './reference-network.js';
import {resolveDesignPolicy} from './design-policy.js';

const viewports=[{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}];
const unsafeJourney=/logout|sign.?out|delete|remove|add.to.cart|\baction=|wp-admin|wp-login/i;
export interface ReferenceInventory {
  version:1;viewports:typeof viewports;routes:Array<{url:string;explicit:boolean;states:string[]}>;
  states:Array<ExperienceObservation&{purpose:string;requestedUrl?:string}>;
  transitions:Array<{artifactId:string;beforeStateId:string|null;afterStateId:string;observed:true;kind:string}>;
  links:Array<{from:string;url:string;label:string;status:'captured'|'unvisited'|'excluded'}>;
  journeys:Array<{key:string;status:'observed'|'partial'|'unobserved';transitions:string[];reason?:string}>;
  failures:Array<{url:string;viewport:string;step:string;reason:string}>;
  coverage:{completeRequiredCaptures:boolean;stateLimitReached:boolean;allDiscoveredFlowsTested:false};
  network:PublicReferenceNetwork['events'];
  resources?:Array<{url:string;artifact:import('./agent-contracts.js').EvidenceArtifact}>;
}
export async function captureReferences(brief:IntakeBrief,artifacts:AgentArtifacts,signal:AbortSignal,network:PublicReferenceNetwork,
  onBrowser:(id:string)=>Promise<void>=async()=>{}):Promise<ReferenceInventory>{
  const explicit=[...new Set([...brief.referenceUrls,...brief.pages.flatMap(page=>page.referenceUrl?[page.referenceUrl]:[]),...brief.journeys.map(journey=>journey.referenceUrl)])];
  const routes=explicit.map(url=>({url,explicit:true,states:[]as string[]}));
  const inventory:ReferenceInventory={version:1,viewports,routes,states:[],transitions:[],links:[],journeys:[],failures:[],
    coverage:{completeRequiredCaptures:false,stateLimitReached:false,allDiscoveredFlowsTested:false},network:network.events};
  if(!explicit.length){inventory.coverage.completeRequiredCaptures=brief.mode==='custom';return inventory;}
  const states=new Set<string>();
  const record=(observation:ExperienceObservation,purpose:string,requestedUrl?:string)=>{
    if(!states.has(observation.stateId)){states.add(observation.stateId);inventory.states.push({...observation,purpose,...(requestedUrl?{requestedUrl}:{})});}
    const route=routes.find(route=>route.url===(requestedUrl??observation.path));
    if(route&&!route.states.includes(observation.stateId))route.states.push(observation.stateId);
  };
  const failure=(url:string,viewport:string,step:string,error:unknown)=>inventory.failures.push({url,viewport,step,
    reason:error instanceof Error&&/^[a-z_]{3,100}$/.test(error.message)?error.message:'reference_interaction_failed'});
  const canCapture=()=>{
    if(states.size+2>brief.capture.maxStates){inventory.coverage.stateLimitReached=true;return false;}
    if(signal.aborted)throw new Error('reference_cancelled');return true;
  };
  for(const viewport of viewports){
    let browser:AgentBrowser|undefined;
    try{
      browser=new AgentBrowser(new URL(explicit[0]!).origin,'',artifacts,signal,network);
      await onBrowser(browser.id);await browser.open({width:viewport.width,height:viewport.height});
      const act=async(command:BrowserCommand,kind:string)=>{
        if(!canCapture())throw new Error('reference_state_limit');
        const networkStart=network.events.length;
        const result=await browser!.act(command);
        if(result.before)record(result.before,'interaction-before');record(result.after,kind,kind==='route-initial'&&command.action==='navigate'?command.path:undefined);
        inventory.transitions.push({artifactId:result.transitionId,beforeStateId:result.before?.stateId??null,afterStateId:result.after.stateId,observed:true,kind});
        if(result.restrictedEffect||network.events.slice(networkStart).some(event=>event.reason==='reference_write_request_denied'&&new URL(event.url).origin===new URL(result.after.path).origin))throw new Error('reference_write_flow_unverified');
        return result.after;
      };
      // Desktop discovery extends this list; mobile then visits the same routes.
      for(let index=0;index<routes.length;index++){
        const route=routes[index]!;
        if(!canCapture())break;
        let initial:ExperienceObservation;
        try{
          initial=await act({action:'navigate',path:route.url},'route-initial');
          if(browser.httpStatus!==200)throw new Error('reference_page_http_failed');
        }catch(error){failure(route.url,viewport.name,'navigate',error);continue;}
        for(const element of initial.summary.elements as any[]){
          if(element.tag!=='a'||!element.href||element.href.startsWith('#'))continue;
          let url:URL;let status:'unvisited'|'excluded'='unvisited';
          try{url=referenceUrl(new URL(element.href,initial.path).href);}
          catch{inventory.links.push({from:initial.path,url:String(element.href).slice(0,2000),label:element.text,status:'excluded'});continue;}
          if(unsafeJourney.test(url.href)||url.origin!==new URL(initial.path).origin||/\.(?:pdf|zip|jpg|png|svg|webp|mp4)$/i.test(url.pathname))status='excluded';
          if(!inventory.links.some(link=>link.from===initial.path&&link.url===url.href))inventory.links.push({from:initial.path,url:url.href,label:element.text,status});
          if(viewport.name==='desktop'&&brief.capture.discoverLinks&&status==='unvisited'&&!url.search&&routes.length<brief.capture.maxPages&&!routes.some(item=>item.url===url.href))routes.push({url:url.href,explicit:false,states:[]});
        }
        // Keep room for required route/device captures before optional exploration.
        const reserved=explicit.length*2+2;
        if(brief.capture.exploreMenus&&states.size+reserved+6<=brief.capture.maxStates){
          const menus=(initial.summary.elements as any[]).filter(item=>item.tag==='button'&&item.expanded==='false').slice(0,2);
          for(const menu of menus){
            try{
              await act({action:'click',selector:menu.selector},'menu-result');
              await act({action:'navigate',path:route.url},'route-reset');
            }catch(error){failure(route.url,viewport.name,'menu',error);}
          }
        }
        if(brief.capture.captureScroll&&states.size+reserved+2<=brief.capture.maxStates&&Number((initial.summary.page as any)?.height)>viewport.height){
          try{await act({action:'scroll',x:0,y:Math.min(8000,Number((initial.summary.page as any).height)-viewport.height)},'scroll-lower');}
          catch(error){failure(route.url,viewport.name,'scroll',error);}
        }
      }
      if(viewport.name==='desktop')for(const journey of brief.journeys){
        const observed:string[]=[];let reason:string|undefined;
        try{
          await act({action:'navigate',path:journey.referenceUrl},'journey-start');
          for(const step of journey.steps){
            if(step.action==='navigate'&&unsafeJourney.test(step.path))throw new Error('reference_destructive_navigation_excluded');
            await act(step,'journey-step');observed.push(inventory.transitions.at(-1)!.artifactId);
          }
        }catch(error){reason=error instanceof Error&&/^[a-z_]{3,100}$/.test(error.message)?error.message:'reference_journey_unverified';}
        inventory.journeys.push({key:journey.key,status:observed.length===journey.steps.length?'observed':observed.length?'partial':'unobserved',transitions:observed,...(reason?{reason}:{})});
      }
    }finally{await browser?.close();}
  }
  for(const link of inventory.links)if(link.status!=='excluded'&&inventory.states.some(state=>state.requestedUrl===link.url&&state.purpose==='route-initial'&&state.summary.httpStatus===200))link.status='captured';
  inventory.coverage.completeRequiredCaptures=explicit.every(url=>viewports.every(viewport=>inventory.states.some(state=>state.purpose==='route-initial'&&
    state.requestedUrl===url&&
    state.viewport.width===viewport.width&&state.summary.httpStatus===200)))&&
    !inventory.failures.some(failure=>explicit.includes(failure.url)&&failure.step==='navigate');
  return inventory;
}

export function createBuildSpecification(brief:IntakeBrief,inventory:ReferenceInventory,baseline:{version:string;cases:any[]},baselineHash:string,revision:number,
  assets:Array<Record<string,unknown>>){
  const requirements=baseline.cases.filter(item=>item.profile==='wordpress'||brief.features.includes('commerce')&&item.profile==='commerce')
    .map(item=>({...item,id:`baseline:${item.key}`,required:true,source:'protected-baseline'}));
  for(const page of brief.pages)requirements.push({id:`page:${page.path}`,key:`page:${page.path}`,profile:'project',required:page.required,source:'client-brief',
    description:`${page.label} must render at ${page.path}, with client content and working required controls.`,method:'route-and-responsive-browser'});
  for(const feature of brief.features)requirements.push({id:`feature:${feature}`,key:`feature:${feature}`,profile:'project',required:true,source:'client-brief',
    description:`Implement and verify the requested ${feature} capability.`,method:'functional-browser'});
  const policy=resolveDesignPolicy(brief.mode,brief.design);
  requirements.push({id:'reference-design',key:'reference-design',profile:'project',required:true,source:'client-brief',
    description:brief.mode==='replica'?'Compare the specified pages to matching reference viewport/state captures; document all permitted differences.':
      brief.mode==='semi-replica'?'Preserve the resolved reference structure/interaction constraints and verify the explicitly permitted adaptations.':
      brief.mode==='custom'?'Evaluate the rendered site against the custom direction, explicit brand preferences and resolved per-page constraints.':
      'Follow recorded client art direction and selected reference patterns; document deliberate departures.',method:'independent-visual-review'});
  const assumptions=[
    {key:'private-backend-unknown',description:'Public capture does not establish private WordPress/admin, payment, shipping or order behavior. Implement these from the client brief and protected acceptance cases.'},
    {key:'coverage-bounded',description:'Only recorded routes, viewports and interaction transitions were observed. Unvisited links, hover states, private routes and untested form submissions remain unknown.'},
    ...(!inventory.routes.length?[{key:'reference-not-provided',description:'This custom-direction brief has no reference URL. No reference appearance or behavior was observed; judge the result against the client brief and recorded design.'}]:[]),
    ...(!assets.length?[{key:'client-assets-missing',description:'No client assets were supplied. Draft imagery/content can be used during construction; unresolved client placeholders block delivery.'}]:[]),
    ...inventory.journeys.filter(journey=>journey.status!=='observed').map(journey=>({key:`journey:${journey.key}`,description:`Reference journey remains ${journey.status}: ${journey.reason??'not observed'}. Its expected behavior needs an explicit implementation and test.`})),
  ];
  return{version:1,revision,brief,assets,designPolicy:policy,reference:{version:inventory.version,coverage:inventory.coverage,
      routes:inventory.routes,states:inventory.states.map(state=>({stateId:state.stateId,url:state.path,viewport:state.viewport,purpose:state.purpose,screenshot:state.screenshot,html:state.html,structure:state.structure})),
      journeys:inventory.journeys,transitions:inventory.transitions,resources:inventory.resources??[],
      inferredLinks:inventory.links.map(link=>({...link,observedTransition:false})),unvisitedLinks:inventory.links.filter(link=>link.status==='unvisited')},
    observedFacts:inventory.states.filter(state=>state.purpose==='route-initial').map(state=>({stateId:state.stateId,url:state.path,title:state.title,language:state.summary.language,direction:state.summary.direction,
      evidence:[state.screenshot.id,state.html.id,state.structure.id]})),assumptions,
    acceptance:{version:1,revision,baselineVersion:baseline.version,baselineHash,requiredViewports:viewports,requirements,
      designPolicy:{...policy,pages:brief.pages.map(page=>({path:page.path,...resolveDesignPolicy(brief.mode,brief.design,page.path)}))}},
    releaseEligible:false};
}
