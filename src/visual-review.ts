import {z} from 'zod';
import type {AgentArtifacts} from './agent-artifacts.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ReferenceComparison,type VisualFidelity} from './visual-fidelity.js';

export const VisualReviewRecord=z.object({candidateRevision:z.string().regex(/^[a-f0-9]{40}$/),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),
  summary:z.string().min(30).max(4000),reviewedCaptureIds:z.array(z.uuid()).max(160),
  unreviewed:z.array(z.object({captureId:z.uuid(),reason:z.string().min(10).max(1000)}).strict()).max(160),
  referenceComparisons:z.array(ReferenceComparison).max(128).optional(),
  findings:z.array(z.object({captureId:z.uuid(),requirementId:z.string().min(1).max(400),
    category:z.enum(['layout','typography','imagery','responsive','accessibility','flow','reference-fidelity','content']),
    severity:z.enum(['blocker','major','minor']),detail:z.string().min(30).max(3000),recommendation:z.string().min(20).max(2000),
    reproduction:z.array(z.string().min(3).max(500)).min(1).max(10)}).strict()).max(100),
}).strict();

/** The independent reviewer receives only this captured candidate's evidence. */
export class VisualReviewEvidence {
  private seen=new Set<string>();
  private submitted=false;
  constructor(readonly report:{candidateRevision:string;sourceDigest:string;coverage?:{complete:boolean};captures:Array<{path:string;viewport:unknown;screenshotId:string;htmlId:string;structureId:string}>},
    readonly artifacts:AgentArtifacts,readonly requiredRequirementIds:Set<string>,readonly fidelity?:VisualFidelity){ }
  private metadata(capture:typeof this.report.captures[number]){return{captureId:capture.structureId,path:capture.path,viewport:capture.viewport,scenario:'scenario'in capture?capture.scenario:'actual-candidate',screenshotId:capture.screenshotId,htmlId:capture.htmlId,structureId:capture.structureId};}
  overview(){return{candidateRevision:this.report.candidateRevision,sourceDigest:this.report.sourceDigest,captures:this.report.captures.map(item=>this.metadata(item)),
    scope:'Visual observations only. Captures do not prove checkout, administration or delivery behavior.'};}
  private async paired(id:string){
    const capture=this.report.captures.find(item=>item.structureId===id);if(!capture)throw new Error('visual_capture_not_found');
    const image=await this.artifacts.image(capture.screenshotId);
    const html=await this.read(capture.htmlId,0,4000),structure=await this.read(capture.structureId,0,4000);
    return{capture:this.metadata(capture),image,html,structure};
  }
  async capture(id:string){const paired=await this.paired(id);this.seen.add(id);return paired;}
  async captureMany(ids:string[]){
    const results=[];for(const id of ids)results.push(await this.paired(id));
    for(const id of ids)this.seen.add(id);
    return results;
  }
  async read(id:string,offset=0,length=8000){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>16000)throw new Error('visual_evidence_range_invalid');
    if(!this.report.captures.some(item=>item.htmlId===id||item.structureId===id))throw new Error('visual_evidence_denied');
    const artifact=this.artifacts.records.find(item=>item.id===id&&['text/html','application/json'].includes(item.mediaType));
    if(!artifact)throw new Error('visual_evidence_not_found');
    const bytes=await readFile(artifact.filename);if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw new Error('visual_evidence_changed');
    const content=bytes.toString('utf8');return{artifactId:id,offset,totalCharacters:content.length,content:content.slice(offset,offset+length)};
  }
  async submit(raw:unknown){
    if(this.submitted)throw new Error('visual_review_already_submitted');
    const record=VisualReviewRecord.parse(raw),available=new Set(this.report.captures.map(item=>item.structureId));
    if(record.candidateRevision!==this.report.candidateRevision||record.sourceDigest!==this.report.sourceDigest)throw new Error('visual_review_candidate_mismatch');
    const reviewed=new Set(record.reviewedCaptureIds),unreviewed=new Set(record.unreviewed.map(item=>item.captureId));
    if(reviewed.size!==record.reviewedCaptureIds.length||unreviewed.size!==record.unreviewed.length)throw new Error('visual_review_duplicate_coverage');
    if([...reviewed].some(id=>!available.has(id)||!this.seen.has(id)||unreviewed.has(id))||[...unreviewed].some(id=>!available.has(id))||[...available].some(id=>!reviewed.has(id)&&!unreviewed.has(id)))throw new Error('visual_review_coverage_invalid');
    for(const finding of record.findings){
      if(!reviewed.has(finding.captureId)||!this.requiredRequirementIds.has(finding.requirementId))throw new Error('visual_finding_evidence_invalid');
    }
    if(!this.fidelity&&(record.referenceComparisons?.length||record.findings.some(finding=>finding.category==='reference-fidelity')))throw new Error('fidelity_context_required');
    const fidelity=this.fidelity?.validate(record.referenceComparisons??[],reviewed,this.seen,record.findings);
    const findings=record.findings.map(finding=>({...finding,candidateRevision:record.candidateRevision,
      capture:this.report.captures.find(item=>item.structureId===finding.captureId)!}));
    const result={...record,findings,fidelity,coverageComplete:unreviewed.size===0&&this.report.coverage?.complete===true&&fidelity?.complete!==false,requiresRepair:fidelity?.requiresRepair===true||findings.some(item=>['blocker','major'].includes(item.severity)),
      releaseEligible:false,scope:'Independent visual assessment only; functional/admin and delivery gates remain separate.'};
    const artifact=await this.artifacts.save('visual_review','application/json',JSON.stringify(result));
    this.submitted=true;return{result,artifact};
  }
}
