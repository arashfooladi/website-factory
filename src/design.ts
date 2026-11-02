import {z} from 'zod';
import {resolveDesignPolicy} from './design-policy.js';
import {Id} from './contracts.js';
import {canonicalJson} from './immutable.js';
import type {AgentArtifacts} from './agent-artifacts.js';
import type {AgentReference} from './agent-reference.js';

const Text=z.string().trim().min(1).max(2000),Hex=z.string().regex(/^#[a-fA-F0-9]{6}$/);
const Ordered=z.array(z.number().int().min(0).max(160)).min(4).max(16).refine(values=>values.every((value,index)=>!index||value>values[index-1]!),'ascending_unique_scale_required');
export const DesignRecord=z.object({version:z.literal(1),intakeId:Id,acceptanceHash:z.string().regex(/^[a-f0-9]{64}$/),direction:Text.min(40),
  tokens:z.object({bodyFont:Text.max(120),headingFont:Text.max(120),bodyPx:z.number().min(14).max(24),lineHeight:z.number().min(1.2).max(2.2),
    headingPx:z.array(z.number().min(18).max(120)).min(3).max(6),spacingPx:Ordered,radiiPx:z.array(z.number().min(0).max(64)).min(1).max(6),
    contentMaxPx:z.number().int().min(600).max(1800),colors:z.object({surface:Hex,text:Hex,accent:Hex,onAccent:Hex}).strict()}).strict(),
  pages:z.array(z.object({path:Text.max(300),mode:z.enum(['persuade','operate','read','experience']),layout:Text.min(40),mobile:Text.min(30),
    interactions:z.array(Text).min(1).max(12),referenceStateIds:z.array(Id).max(8)}).strict()).min(1).max(20),
  imagery:z.object({strategy:Text.min(30),assetIds:z.array(Id).max(40),missing:z.array(Text).max(20)}).strict(),
  motion:z.object({strategy:Text,reducedMotion:Text}).strict(),
  departures:z.array(z.object({scope:Text.max(300),description:Text,reason:Text}).strict()).max(30),
  observations:z.array(z.object({statement:Text,evidenceIds:z.array(Id).min(1).max(8)}).strict()).max(30),
  unknowns:z.array(z.object({key:z.string().max(100),detail:Text}).strict()).min(1).max(40),
  implementation:z.object({files:z.array(z.object({path:z.string().max(300).refine(path=>path.startsWith('child/')&&path.split('/').every(part=>part&&!['.','..','.git','.codex'].includes(part))),reason:Text}).strict()).min(1).max(30),
    productData:Text.min(30),admin:Text.min(30),plugins:z.array(z.object({slug:z.string().regex(/^[a-z0-9-]{1,100}$/),status:z.enum(['existing','required']),reason:Text}).strict()).max(20),
    checks:z.array(z.object({requirementId:z.string().max(400),method:Text}).strict()).min(1).max(80)}).strict(),
}).strict();
export type DesignDocument=z.infer<typeof DesignRecord>;
export class DesignValidationError extends Error{
  constructor(code:string,readonly details:Record<string,unknown>){super(code);}
}
function luminance(hex:string){const rgb=hex.slice(1).match(/../g)!.map(value=>parseInt(value,16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);return rgb[0]!*0.2126+rgb[1]!*0.7152+rgb[2]!*0.0722;}
export function contrast(a:string,b:string){const first=luminance(a),second=luminance(b);return(Math.max(first,second)+0.05)/(Math.min(first,second)+0.05);}
export function validateDesign(raw:unknown,context:ReturnType<AgentReference['context']>){
  const design=DesignRecord.parse(raw),spec=context.specification;
  if(design.intakeId!==context.intakeId||design.acceptanceHash!==context.acceptanceHash)throw new Error('design_reference_mismatch');
  const pagePaths=new Set(design.pages.map(page=>page.path));
  if(pagePaths.size!==design.pages.length||spec.brief.pages.some((page:any)=>page.required&&!pagePaths.has(page.path)))throw new DesignValidationError('design_required_page_missing',{
    requiredPaths:spec.brief.pages.filter((page:any)=>page.required).map((page:any)=>page.path)});
  const states=new Set(spec.reference.states.map((state:any)=>state.stateId));
  if(design.pages.some(page=>resolveDesignPolicy(spec.brief.mode,spec.brief.design,page.path).mode!=='custom'&&!page.referenceStateIds.length))throw new Error('design_reference_state_required');
  if(design.pages.some(page=>page.referenceStateIds.some(id=>!states.has(id))))throw new Error('design_unknown_reference_state');
  const evidence=new Set([...context.artifacts.map(item=>item.id),...spec.assets.map((item:any)=>item.id)]);
  if(design.observations.some(item=>item.evidenceIds.some(id=>!evidence.has(id))))throw new DesignValidationError('design_unknown_evidence',{
    unknownIds:design.observations.flatMap(item=>item.evidenceIds).filter(id=>!evidence.has(id)),
    guidance:'Use artifact IDs from screenshot.id, html.id and structure.id or assigned client asset IDs; a stateId is a different identifier.'});
  const used=new Set(design.observations.flatMap(item=>item.evidenceIds));
  if(states.size&&(design.observations.length<2||!spec.reference.states.some((state:any)=>[state.screenshot.id,state.html.id,state.structure.id].every(id=>used.has(id)))))throw new Error('design_paired_evidence_required');
  const supplied=new Set(spec.brief.assetIds);if(design.imagery.assetIds.some(id=>!supplied.has(id)))throw new Error('design_unknown_client_asset');
  const unknowns=new Set(design.unknowns.map(item=>item.key));
  if(spec.assumptions.some((item:any)=>!unknowns.has(item.key)))throw new DesignValidationError('design_reference_unknowns_missing',{
    missing:spec.assumptions.filter((item:any)=>!unknowns.has(item.key))});
  const checks=new Set(design.implementation.checks.map(item=>item.requirementId));
  if(spec.acceptance.requirements.some((item:any)=>item.required&&!checks.has(item.id)))throw new DesignValidationError('design_required_checks_missing',{
    missing:spec.acceptance.requirements.filter((item:any)=>item.required&&!checks.has(item.id)).map((item:any)=>({id:item.id,method:item.method}))});
  const policy=resolveDesignPolicy(spec.brief.mode,spec.brief.design);
  const primary=(font:string)=>font.split(',')[0]!.trim().replace(/^['"]|['"]$/g,'').toLowerCase();
  if(policy.fonts.length&&[design.tokens.bodyFont,design.tokens.headingFont].some(font=>!policy.fonts.some(allowed=>primary(allowed)===primary(font))))
    throw new DesignValidationError('design_client_font_mismatch',{allowedFonts:policy.fonts,guidance:'Use a supplied font as each primary family; record unavailable font assets explicitly.'});
  const roles:Record<string,keyof DesignDocument['tokens']['colors']>={surface:'surface',background:'surface',text:'text',foreground:'text',accent:'accent','on-accent':'onAccent'};
  for(const [name,color]of Object.entries(policy.palette)){const role=roles[name];if(role&&design.tokens.colors[role].toLowerCase()!==color.toLowerCase())
    throw new DesignValidationError('design_client_palette_mismatch',{role,expected:color});}
  if(contrast(design.tokens.colors.text,design.tokens.colors.surface)<4.5||contrast(design.tokens.colors.onAccent,design.tokens.colors.accent)<4.5)throw new Error('design_text_contrast_insufficient');
  return design;
}
const escape=(value:string)=>value.replace(/[\\`*_<>#\[\]]/g,'\\$&');
export function renderDesign(design:DesignDocument){
  const lines=['# Client design record','',`Intake: ${design.intakeId}`,`Acceptance SHA-256: ${design.acceptanceHash}`,'',escape(design.direction),'','## Tokens','',
    '```json',JSON.stringify(design.tokens,null,2),'```','','## Pages'];
  for(const page of design.pages)lines.push('',`### ${escape(page.path)} — ${page.mode}`,'',escape(page.layout),'',`Mobile: ${escape(page.mobile)}`,'',...page.interactions.map(item=>`- ${escape(item)}`),'',`Reference states: ${page.referenceStateIds.join(', ')}`);
  lines.push('','## Imagery','',escape(design.imagery.strategy),'',...design.imagery.missing.map(item=>`- Missing: ${escape(item)}`),'','## Motion','',escape(design.motion.strategy),'',`Reduced motion: ${escape(design.motion.reducedMotion)}`,'','## Reference departures');
  for(const item of design.departures)lines.push('',`- ${escape(item.scope)}: ${escape(item.description)} — ${escape(item.reason)}`);
  lines.push('','## Evidence');for(const item of design.observations)lines.push('',`- ${escape(item.statement)} (${item.evidenceIds.join(', ')})`);
  lines.push('','## Unknowns');for(const item of design.unknowns)lines.push('',`- ${escape(item.key)}: ${escape(item.detail)}`);
  lines.push('','## MainTheme implementation','',escape(design.implementation.productData),'',escape(design.implementation.admin),'');
  for(const item of design.implementation.files)lines.push(`- ${escape(item.path)}: ${escape(item.reason)}`);
  lines.push('','## Plugin requirements','');for(const item of design.implementation.plugins)lines.push(`- ${escape(item.slug)} (${item.status}): ${escape(item.reason)}`);
  lines.push('','## Required checks','');for(const item of design.implementation.checks)lines.push(`- ${escape(item.requirementId)}: ${escape(item.method)}`);
  return lines.join('\n')+'\n';
}
export class DesignSubmission {
  value?:{document:DesignDocument;record:Awaited<ReturnType<AgentArtifacts['save']>>;markdown:Awaited<ReturnType<AgentArtifacts['save']>>};
  constructor(readonly reference:AgentReference,readonly artifacts:AgentArtifacts){}
  async submit(raw:unknown){
    if(this.value)throw new Error('design_already_submitted');
    const document=validateDesign(raw,this.reference.context());
    const record=await this.artifacts.save('design_record','application/json',canonicalJson(document));
    const markdown=await this.artifacts.save('design_markdown','text/markdown',renderDesign(document));
    this.value={document,record,markdown};return{recordId:record.id,markdownId:markdown.id,recordSha256:record.sha256,releaseEligible:false};
  }
}
