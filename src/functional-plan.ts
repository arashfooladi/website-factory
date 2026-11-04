import {z} from 'zod';
const Path=z.string().min(1).max(500).refine(p=>p.startsWith('/')&&!p.startsWith('//')&&!/[\\?#\s]/.test(p));
const Selector=z.string().min(1).max(500),Text=z.string().min(1).max(2000);
const Common={id:z.string().regex(/^[a-z0-9:-]{1,100}$/),requirementId:Text,path:Path,expectedText:Text};
// This plan is operator-owned. Builders have neither its API credentials nor file write access.
export const FunctionalCheckSchema=z.discriminatedUnion('kind',[
 z.object({...Common,kind:z.literal('navigation'),linkText:Text,expectedPath:Path}).strict(),
 z.object({...Common,kind:z.literal('search'),query:Text}).strict(),
 z.object({...Common,kind:z.literal('filter'),selector:Selector,value:Text,excludedText:Text}).strict(),
 z.object({...Common,kind:z.literal('keyboard'),target:Selector,expectedPath:Path,maxTabs:z.number().int().min(1).max(80).optional()}).strict(),
]);
export const FunctionalPlan=z.object({
 journeys:z.array(FunctionalCheckSchema).max(24).default([]),
 admin:z.object({categories:z.boolean().default(true),media:z.boolean().default(true),variations:z.boolean().default(true)}).strict().optional(),
 commerce:z.object({gateway:z.literal('cod'),shipping:z.number().min(0).max(1e12),orderStatus:z.enum(['processing','on-hold']),quantity:z.number().int().min(1).max(5)}).strict().optional(),
 accessibility:z.array(Path).max(24).default([]),
 requiredChecks:z.array(z.string().min(1).max(100)).min(1).max(60),
}).strict().superRefine((plan,ctx)=>{
 const ids=[...plan.journeys.map(c=>c.id),...(plan.admin?['admin:product-management']:[]),...(plan.commerce?['commerce:checkout-orders']:[]),...(plan.accessibility.length?['accessibility:automated']:[])];
 if(new Set(ids).size!==ids.length||new Set(plan.requiredChecks).size!==plan.requiredChecks.length||plan.requiredChecks.some(id=>!ids.includes(id)))ctx.addIssue({code:'custom',message:'Every required check must have a unique executable assignment'});
});
