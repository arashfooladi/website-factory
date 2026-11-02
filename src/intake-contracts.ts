import {z} from 'zod';
import {Id} from './contracts.js';
import {BrowserAction} from './agent-contracts.js';
import {referenceUrl} from './reference-network.js';
import {DesignMode,DesignPreferences,resolveDesignPolicy} from './design-policy.js';

export const ReferenceUrl=z.string().max(2000).superRefine((value,context)=>{
  try{referenceUrl(value);}catch{context.addIssue({code:'custom',message:'public_http_reference_required'});}
}).transform(value=>referenceUrl(value).href);
const Page=z.object({path:z.string().min(1).max(300).refine(path=>path.startsWith('/')&&!path.startsWith('//')&&!/[\s?#\\]/.test(path)),
  label:z.string().trim().min(1).max(100),referenceUrl:ReferenceUrl.optional(),required:z.boolean().default(true)}).strict();
const Journey=z.object({key:z.string().regex(/^[a-z0-9-]{1,60}$/),label:z.string().trim().min(1).max(160),
  referenceUrl:ReferenceUrl,steps:z.array(BrowserAction).min(1).max(12)}).strict();
const CaptureLimits=z.object({maxRuntimeMs:z.number().int().min(10000).max(600000).default(300000),
  maxPages:z.number().int().min(1).max(12).default(4),maxStates:z.number().int().min(8).max(160).default(60),
  maxArtifactBytes:z.number().int().min(8388608).max(536870912).default(134217728),
  discoverLinks:z.boolean().default(true),exploreMenus:z.boolean().default(true),captureScroll:z.boolean().default(true)}).strict();
export const IntakeInput=z.object({projectId:Id,prompt:z.string().trim().min(1).max(16000),
  themeBundleId:Id.optional(),
  referenceUrls:z.array(ReferenceUrl).max(4).default([]),mode:DesignMode.default('inspiration'),
  design:DesignPreferences.prefault({}),
  language:z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).default('fa-IR'),direction:z.enum(['rtl','ltr']).optional(),
  businessName:z.string().trim().min(1).max(160).optional(),
  pages:z.array(Page).min(1).max(12).prefault([{path:'/',label:'Home'}]),
  features:z.array(z.enum(['commerce','search','contact-form','accounts','filters','blog'])).max(6).default(['commerce','search']),
  assetIds:z.array(Id).max(40).default([]),journeys:z.array(Journey).max(12).default([]),
  budget:z.object({maxObservedTokens:z.number().int().min(1000).max(50000000).default(1000000),
    maxRuntimeMs:z.number().int().min(60000).max(86400000).default(3600000),maxRepairRounds:z.number().int().min(0).max(10).default(3)}).strict().prefault({}),
  capture:CaptureLimits.prefault({}),
}).strict().superRefine((brief,context)=>{
  if(new Set(brief.pages.map(page=>page.path)).size!==brief.pages.length)context.addIssue({code:'custom',message:'duplicate_target_page'});
  if(new Set(brief.journeys.map(journey=>journey.key)).size!==brief.journeys.length)context.addIssue({code:'custom',message:'duplicate_journey_key'});
  const urls=new Set([...brief.referenceUrls,...brief.pages.filter(page=>page.referenceUrl).map(page=>page.referenceUrl!),...brief.journeys.map(journey=>journey.referenceUrl)]);
  if(brief.mode!=='custom'&&!urls.size)context.addIssue({code:'custom',message:'reference_required_for_copy_or_inspiration'});
  if(!urls.size&&brief.pages.some(page=>resolveDesignPolicy(brief.mode,brief.design,page.path).mode!=='custom'))context.addIssue({code:'custom',message:'reference_required_for_page_copy_or_inspiration'});
  if(urls.size>brief.capture.maxPages)context.addIssue({code:'custom',message:'capture_page_limit_below_explicit_urls'});
}).transform(brief=>({...brief,direction:brief.direction??(/^(fa|ar|he|ur)(-|$)/.test(brief.language)?'rtl':'ltr')}));
export type IntakeBrief=z.infer<typeof IntakeInput>;
