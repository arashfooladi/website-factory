import {z} from 'zod';
import {resolveDesignPolicy} from './design-policy.js';
import type {ToolResponse} from './agent-contracts.js';

export const VisualAxis=z.enum(['layout','typography','palette','imagery']);
export const ReferenceComparison=z.object({captureId:z.uuid(),axis:VisualAxis,referenceStateId:z.uuid().optional(),
 verdict:z.enum(['satisfied','defect','unverified']),detail:z.string().min(30).max(2000)}).strict();
export const FidelityView=z.object({stateIds:z.array(z.uuid()).min(1).max(2)}).strict();
type Capture={path:string;viewport:any;structureId:string;scenario?:string};
export type FidelitySource={brief:{mode:Parameters<typeof resolveDesignPolicy>[0];design?:unknown;referenceUrls:string[];pages:Array<{path:string;referenceUrl?:string}>};states:any[]};

function canonical(value:string){const url=new URL(value);url.hash='';return url.href;}
function referenceMetadata(state:any){return state?{stateId:state.stateId,path:state.path,requestedUrl:state.requestedUrl,viewport:state.viewport,screenshot:state.screenshot,html:state.html,structure:state.structure}:null;}

/** Separates client fidelity constraints from the reviewer's aesthetic preferences. */
export class VisualFidelity{
 readonly policy:ReturnType<typeof resolveDesignPolicy>;
 readonly slots:Array<{captureId:string;viewport:string;axes:Array<z.infer<typeof VisualAxis>>;reference:any|null;reason:string|null}>;
 readonly referenceUrl:string|null;
 readonly mappingBasis:string;
 private seen=new Set<string>();
 constructor(readonly path:string,captures:Capture[],source:FidelitySource,readonly invoke:(args:unknown)=>Promise<ToolResponse>){
  this.policy=resolveDesignPolicy(source.brief.mode,source.brief.design,path);
  const axes=VisualAxis.options.filter(axis=>this.policy.axes[axis]!=='free');
  const explicit=source.brief.pages.find(page=>page.path===path)?.referenceUrl;
  this.referenceUrl=explicit??(source.brief.referenceUrls.length===1?(path==='/'?source.brief.referenceUrls[0]!:new URL(path,source.brief.referenceUrls[0]).href):null);
  this.mappingBasis=explicit?'explicit-page-reference':this.referenceUrl?'single-reference-path-inference':'unmapped';
  this.slots=[];
  if(!axes.length)return;
  for(const viewport of ['desktop','mobile']){
   const candidates=captures.filter(capture=>capture.viewport.name===viewport&&(!capture.scenario||capture.scenario==='actual-candidate'));
   if(candidates.length!==1)throw new Error('fidelity_candidate_matrix_incomplete');
   const matching=this.referenceUrl?source.states.filter(state=>state.purpose==='route-initial'&&state.summary?.httpStatus===200&&
    (viewport==='mobile'?state.viewport.width<=480:state.viewport.width>=1024)&&canonical(state.requestedUrl??state.path)===canonical(this.referenceUrl!)):[];
   this.slots.push({captureId:candidates[0]!.structureId,viewport,axes,reference:matching.length===1?matching[0]:null,
    reason:!this.referenceUrl?'No unambiguous page reference assignment':matching.length===0?'No captured successful reference route at this viewport':matching.length>1?'Multiple reference states require an explicit assignment':null});
  }
 }
 overview(){return{path:this.path,policy:this.policy,referenceUrl:this.referenceUrl,mappingBasis:this.mappingBasis,
  slots:this.slots.map(slot=>({...slot,reference:referenceMetadata(slot.reference)})),
  contract:'Submit exactly one referenceComparisons entry for each captureId/axis slot. View candidate evidence and its assigned reference with factory_fidelity_reference before satisfied/defect claims. Missing, ambiguous or uninspected references must be unverified. Match axes require similarity; adapt axes allow client-specific changes consistent with DESIGN.md and the brief. Free axes require no fidelity comparison. These visual comparisons do not verify interactive behavior.'};}
 async view(raw:unknown):Promise<ToolResponse>{
  const input=FidelityView.parse(raw),items:ToolResponse['contentItems']=[];
  if(new Set(input.stateIds).size!==input.stateIds.length)throw new Error('fidelity_duplicate_reference');
  if(input.stateIds.some(id=>!this.slots.some(slot=>slot.reference?.stateId===id)))throw new Error('fidelity_reference_denied');
  for(const id of input.stateIds){
   const slot=this.slots.find(slot=>slot.reference?.stateId===id);if(!slot)throw new Error('fidelity_reference_denied');
   const response=await this.invoke({action:'state',stateId:id,length:8000});
   if(!response.success||!response.contentItems.some(item=>item.type==='inputImage'))throw new Error('fidelity_reference_unavailable');
   items.push({type:'inputText',text:JSON.stringify({evidenceRole:'protected-reference',stateId:id,candidateCaptureId:slot.captureId})},...response.contentItems);
  }
  for(const id of input.stateIds)this.seen.add(id);
  return{success:true,contentItems:items};
 }
 validate(raw:unknown[],reviewed:Set<string>,candidateSeen:Set<string>,findings:Array<{captureId:string;category:string}>){
  const records=z.array(ReferenceComparison).max(128).parse(raw),keys=new Set<string>();
  for(const record of records){
   const slot=this.slots.find(slot=>slot.captureId===record.captureId),key=record.captureId+':'+record.axis;
   if(!slot||!slot.axes.includes(record.axis)||keys.has(key))throw new Error('fidelity_comparison_slot_invalid');keys.add(key);
   if(record.referenceStateId&&record.referenceStateId!==slot.reference?.stateId)throw new Error('fidelity_reference_mismatch');
   if(record.verdict!=='unverified'){
    if(!reviewed.has(record.captureId)||!candidateSeen.has(record.captureId)||!record.referenceStateId||!this.seen.has(record.referenceStateId))throw new Error('fidelity_evidence_not_viewed');
    if(record.verdict==='defect'&&!findings.some(f=>f.captureId===record.captureId&&f.category==='reference-fidelity'))throw new Error('fidelity_defect_finding_required');
   }
  }
  if(this.slots.some(slot=>slot.axes.some(axis=>!keys.has(slot.captureId+':'+axis))))throw new Error('fidelity_comparison_coverage_invalid');
  if(findings.some(f=>f.category==='reference-fidelity'&&!records.some(r=>r.captureId===f.captureId&&r.verdict==='defect')))throw new Error('fidelity_finding_comparison_required');
  const complete=records.every(record=>record.verdict!=='unverified');
  return{status:this.slots.length?(complete?'compared':'incomplete'):'not-applicable',complete,requiresRepair:records.some(record=>record.verdict==='defect'),
   mode:this.policy.mode,axes:this.policy.axes,mappingBasis:this.mappingBasis,referenceUrl:this.referenceUrl,
   comparisons:records.map(record=>({...record,treatment:this.policy.axes[record.axis],reference:referenceMetadata(this.slots.find(slot=>slot.captureId===record.captureId)?.reference)})),
   interactionsVerified:false,releaseEligible:false};
 }
}
