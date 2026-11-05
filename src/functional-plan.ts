import {z} from 'zod';
const Path=z.string().min(1).max(500).refine(p=>p.startsWith('/')&&!p.startsWith('//')&&!/[\\?#\s]/.test(p));
const Selector=z.string().min(1).max(500),Text=z.string().min(1).max(2000);
const Viewport=z.object({width:z.number().int().min(320).max(3440),height:z.number().int().min(320).max(1440)}).strict();
const Common={viewport:Viewport.optional(),id:z.string().regex(/^[a-z0-9:-]{1,100}$/),requirementId:Text,path:Path,expectedText:Text};
// This plan is operator-owned. Builders have neither its API credentials nor file write access.
export const FunctionalCheckSchema=z.discriminatedUnion('kind',[
 z.object({...Common,kind:z.literal('navigation'),linkText:Text,expectedPath:Path,menuToggle:Selector.optional()}).strict(),
 z.object({...Common,kind:z.literal('search'),query:Text,expectedPath:Path.optional()}).strict(),
 z.object({...Common,kind:z.literal('filter'),selector:Selector,value:Text,excludedText:Text}).strict(),
 z.object({...Common,kind:z.literal('keyboard'),target:Selector,expectedPath:Path,maxTabs:z.number().int().min(1).max(80).optional()}).strict(),
]);
export const FunctionalPlan=z.object({
 dashboard:z.boolean().default(false),
 integrations:z.array(z.object({id:Text,type:z.literal('payment-gateway'),gatewayId:z.string().regex(/^[a-z0-9_-]{1,80}$/).refine(id=>!['cod','bacs'].includes(id),'Use the commerce module for built-in offline gateways')}).strict()).max(8).default([]),
 engines:z.array(z.enum(['chromium','firefox','webkit'])).min(1).max(3).default(['chromium']),
 forms:z.array(z.object({...Common,fields:z.array(z.object({selector:Selector,value:Text}).strict()).min(1).max(16),submit:Selector,expectedPath:Path,mail:z.object({to:z.email(),subjectIncludes:Text.optional(),messageIncludes:Text}).strict()}).strict()).max(6).default([]),
 accounts:z.object({path:Path}).strict().optional(),
 journeys:z.array(FunctionalCheckSchema).max(24).default([]),
 admin:z.object({categories:z.boolean().default(true),media:z.boolean().default(true),variations:z.boolean().default(true)}).strict().optional(),
 commerce:z.object({gateway:z.enum(['cod','bacs']),shipping:z.number().min(0).max(1e12),orderStatus:z.enum(['processing','on-hold']),quantity:z.number().int().min(1).max(5)}).strict().optional(),
 accessibility:z.array(Path).max(24).default([]),
 requiredChecks:z.array(z.string().min(1).max(100)).min(1).max(60),
}).strict().superRefine((plan,ctx)=>{
 const ids=[...(plan.dashboard?['baseline:wp-admin-access']:[]),...plan.integrations.map(c=>c.id),...plan.forms.map(c=>c.id),...(plan.accounts?['accounts:customer']:[]),...plan.journeys.map(c=>c.id),...(plan.admin?['admin:product-management']:[]),...(plan.commerce?['commerce:checkout-orders']:[]),...(plan.accessibility.length?['accessibility:automated']:[])];
 if(new Set(plan.engines).size!==plan.engines.length)ctx.addIssue({code:'custom',message:'Duplicate browser engines'});
 for(const form of plan.forms)if(!form.fields.some(field=>field.value.includes('{{qaToken}}'))||![form.mail.messageIncludes,form.mail.subjectIncludes??''].some(value=>value.includes('{{qaToken}}')))ctx.addIssue({code:'custom',message:'Mail forms require an isolated correlation token in input and persistence expectations'});
 if(new Set(ids).size!==ids.length||new Set(plan.requiredChecks).size!==plan.requiredChecks.length||plan.requiredChecks.some(id=>!ids.includes(id)))ctx.addIssue({code:'custom',message:'Every required check must have a unique executable assignment'});
});
