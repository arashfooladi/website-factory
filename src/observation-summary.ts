/** Compact model context; complete observations remain in immutable artifacts. */
export function observationSummary(summary:Record<string,any>):Record<string,any>{
  const short=(value:unknown,max=200)=>typeof value==='string'?value.slice(0,max):value;
  return {...summary,
    elements:(summary.elements??[]).slice(0,20).map((element:any)=>({...element,text:short(element.text),
      styles:element.styles?Object.fromEntries(Object.entries(element.styles).map(([key,value])=>[key,short(value,120)])):element.styles})),
    forms:(summary.forms??[]).slice(0,8),images:(summary.images??[]).slice(0,12),stylesheets:(summary.stylesheets??[]).slice(0,12),
  };
}
