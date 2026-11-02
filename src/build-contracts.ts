import {z} from 'zod';
import {Id} from './contracts.js';
import {AgentLimits} from './agent-contracts.js';

const Slug=z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const Path=z.string().max(300).refine(value=>value.startsWith('/')&&!value.startsWith('//')&&!/[\\?#%\s]/.test(value)&&value.split('/').every(part=>!['.','..'].includes(part))&&!/^\/(?:wp-admin|wp-content|wp-includes|wp-json|wp-login\.php)(?:\/|$)/.test(value));
const Price=z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
export const BuildContent=z.object({siteTitle:z.string().trim().min(1).max(160),description:z.string().max(300).default(''),
  synthetic:z.boolean().default(false),
  pages:z.array(z.object({path:Path,title:z.string().trim().min(1).max(160),kind:z.enum(['home','shop','cart','checkout','account','content']),
    content:z.string().max(30000).default('')}).strict()).min(1).max(24),
  products:z.array(z.object({key:Slug,name:z.string().trim().min(1).max(200),description:z.string().max(20000).default(''),summary:z.string().max(4000).default(''),
    price:Price,stock:z.number().int().min(0).max(1000000).default(10),imageAssetId:Id.optional(),
    variations:z.object({attribute:z.string().trim().min(1).max(80),options:z.array(z.string().trim().min(1).max(100)).min(2).max(12).refine(options=>new Set(options).size===options.length,'unique_variation_options_required')}).strict().optional()}).strict()).max(100).default([]),
  heroAssetId:Id.optional(),logoAssetId:Id.optional(),additionalAssetIds:z.array(Id).max(40).default([]),currency:z.enum(['IRR','USD','EUR','GBP']).default('IRR'),
}).strict().superRefine((content,context)=>{
  if(new Set(content.pages.map(page=>page.path)).size!==content.pages.length)context.addIssue({code:'custom',message:'duplicate_page_path'});
  if(content.pages.filter(page=>page.kind==='home').length!==1)context.addIssue({code:'custom',message:'one_home_page_required'});
  if(content.pages.some(page=>page.kind==='home'&&page.path!=='/'))context.addIssue({code:'custom',message:'home_path_must_be_root'});
  for(const kind of ['shop','cart','checkout','account'])if(content.pages.filter(page=>page.kind===kind).length>1)context.addIssue({code:'custom',message:'duplicate_commerce_page_kind'});
  if(new Set(content.products.map(product=>product.key)).size!==content.products.length)context.addIssue({code:'custom',message:'duplicate_product_key'});
});
export const BuildInput=z.object({intakeId:Id,designId:Id.optional(),content:BuildContent,
  agentLimits:AgentLimits.prefault({maxRuntimeMs:600000,maxObservedTokens:600000,maxToolCalls:50,maxArtifactBytes:67108864}),
  maxRuntimeMs:z.number().int().min(60000).max(86400000).default(3600000),
  maxObservedTokens:z.number().int().min(10000).max(10000000).default(1500000),
}).strict();
export type BuildRequest=z.infer<typeof BuildInput>;
