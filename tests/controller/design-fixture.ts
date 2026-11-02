import type {DesignDocument} from '../../src/design.js';
export function designFixture(overview:any):DesignDocument{
  const state=overview.reference.states[0];
  return{version:1,intakeId:overview.intakeId,acceptanceHash:overview.acceptanceHash,
    direction:'A product-led linen shop with quiet warm surfaces, precise dark typography and generous but task-focused product navigation.',
    tokens:{bodyFont:'Vazirmatn',headingFont:'Vazirmatn',bodyPx:18,lineHeight:1.6,headingPx:[48,32,24],spacingPx:[0,4,8,16,24,40,64],radiiPx:[0,4],contentMaxPx:1200,
      colors:{surface:'#fffdf8',text:'#202820',accent:'#254b36',onAccent:'#ffffff'}},
    pages:overview.brief.pages.map((page:any)=>({path:page.path,mode:page.path==='/'?'persuade':'operate',
      layout:'Use a clear product-led hierarchy, visible category navigation, real product imagery and native WooCommerce product lists rather than decorative card repetition.',
      mobile:'Keep the menu and search reachable at 390px, collapse product columns to the available width, and wrap long names without horizontal scrolling.',
      interactions:['Preserve navigation, GET search, live product selection and the native cart journey.'],referenceStateIds:[state.stateId]})),
    imagery:{strategy:'Use supplied client identity assets with actual WooCommerce product photographs; unresolved product imagery remains a delivery dependency.',assetIds:overview.brief.assetIds,missing:['Client-approved product photography must replace fixture images before delivery.']},
    motion:{strategy:'Use a short opacity transition for navigation feedback, without hiding the page on first render.',reducedMotion:'Disable nonessential transitions when the visitor requests reduced motion.'},departures:[],
    observations:[{statement:'The reference initial state provides a visible heading, navigation and search form.',evidenceIds:[state.screenshot.id,state.html.id]},
      {statement:'The paired structure records the layout and associated form labels at the captured size.',evidenceIds:[state.structure.id]}],
    unknowns:overview.assumptions.map((item:any)=>({key:item.key,detail:item.description})),
    implementation:{files:[{path:'child/theme.json',reason:'Define client palette, spacing and typography without replacing parent behavior.'},{path:'child/style.css',reason:'Implement the responsive composition and focused presentation rules.'}],
      productData:'Render real WooCommerce products and category queries so newly added client products inherit the same site design.',
      admin:'Preserve ordinary WordPress product, category, image, price, stock and order administration through the existing plugins.',
      plugins:[{slug:'woocommerce',status:'existing',reason:'Provide real catalog, cart, checkout, products and orders.'}],
      checks:overview.acceptance.requirements.filter((item:any)=>item.required).map((item:any)=>({requirementId:item.id,method:item.method+' against the published candidate and its recorded evidence.'}))}};
}
