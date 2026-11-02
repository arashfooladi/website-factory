import {z} from 'zod';

export const DesignMode=z.enum(['replica','semi-replica','inspiration','custom']);
const Treatment=z.enum(['match','adapt','free']);
const Axes=z.object({layout:Treatment.optional(),typography:Treatment.optional(),palette:Treatment.optional(),imagery:Treatment.optional(),interactions:Treatment.optional()}).strict();
export const DesignPreferences=z.object({
  quality:z.enum(['strict','balanced','custom']).default('strict'),
  instructions:z.string().trim().max(8000).default(''),
  axes:Axes.prefault({}),
  mustKeep:z.array(z.string().trim().min(1).max(400)).max(30).default([]),
  mustAvoid:z.array(z.string().trim().min(1).max(400)).max(30).default([]),
  density:z.enum(['compact','balanced','spacious']).default('balanced'),
  motion:z.enum(['none','subtle','expressive']).default('subtle'),
  fonts:z.array(z.string().trim().min(1).max(120)).max(4).default([]),
  palette:z.record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),z.string().regex(/^#[a-fA-F0-9]{6}$/)).default({}),
  skillPacks:z.array(z.enum(['factory-design','impeccable','frontend-design','unslop','unslop-calibration'])).min(1).max(5).default(['factory-design','impeccable','frontend-design','unslop']),
  domain:z.string().trim().min(1).max(160).default('WordPress small-business commerce'),
  unslopProfileId:z.uuid().optional(),
  pages:z.array(z.object({path:z.string().min(1).max(300).refine(value=>value.startsWith('/')&&!value.startsWith('//')&&!/[\\?#\s]/.test(value)&&value.split('/').every(part=>!['.','..'].includes(part))&&(!value.includes('*')||value.endsWith('/*')&&value.indexOf('*')===value.length-1)),
    mode:DesignMode.optional(),instructions:z.string().trim().max(2000).default(''),axes:Axes.prefault({})}).strict()).max(24).default([]),
}).strict().superRefine((value,context)=>{
  if(new Set(value.pages.map(page=>page.path)).size!==value.pages.length)context.addIssue({code:'custom',message:'duplicate_design_page_override'});
  if(new Set(value.skillPacks).size!==value.skillPacks.length)context.addIssue({code:'custom',message:'duplicate_design_skill_pack'});
  for(const [first,second]of [['surface','background'],['text','foreground']])if(value.palette[first!]&&value.palette[second!]&&value.palette[first!]!.toLowerCase()!==value.palette[second!]!.toLowerCase())
    context.addIssue({code:'custom',path:['palette'],message:'conflicting_palette_role_aliases'});
});
export const DESIGN_PRESETS={
  replica:{label:'Strict copy',description:'Match the agreed reference layout, typography, palette, imagery treatment and observed interactions.',axes:{layout:'match',typography:'match',palette:'match',imagery:'match',interactions:'match'}},
  'semi-replica':{label:'Semi-strict copy',description:'Keep the reference structure and interaction patterns; adapt typography, colors and imagery to the client.',axes:{layout:'match',typography:'adapt',palette:'adapt',imagery:'adapt',interactions:'match'}},
  inspiration:{label:'Inspiration',description:'Use selected reference ideas while creating a client-specific composition and identity.',axes:{layout:'free',typography:'free',palette:'adapt',imagery:'adapt',interactions:'adapt'}},
  custom:{label:'Custom direction',description:'Follow the custom prompt, brand preferences and functional brief; references are optional.',axes:{layout:'free',typography:'free',palette:'free',imagery:'free',interactions:'free'}},
}as const;
export function resolveDesignPolicy(mode:z.infer<typeof DesignMode>,raw:unknown={},path?:string){
  const preferences=DesignPreferences.parse(raw),page=path?(preferences.pages.find(item=>item.path===path)??
    preferences.pages.filter(item=>item.path.endsWith('/*')&&path.startsWith(item.path.slice(0,-1))).sort((a,b)=>b.path.length-a.path.length)[0]):undefined;
  const selected=page?.mode??mode,preset=DESIGN_PRESETS[selected];
  return{version:1,mode:selected,label:preset.label,quality:preferences.quality,
    axes:{...preset.axes,...preferences.axes,...page?.axes},
    instructions:[preferences.instructions,page?.instructions].filter(Boolean).join('\n\n'),
    mustKeep:preferences.mustKeep,mustAvoid:preferences.mustAvoid,density:preferences.density,motion:preferences.motion,
    fonts:preferences.fonts,palette:preferences.palette,skillPacks:preferences.skillPacks,domain:preferences.domain,unslopProfileId:preferences.unslopProfileId??null,
    notice:'Explicit client constraints and resolved fidelity axes take precedence over a skill pack’s default aesthetic. Protected functional/admin/commerce requirements remain required.'};
}
