import type {Page,Locator} from '@playwright/test';

/** Reach the actual control using Tab; direct DOM focus would conceal a keyboard trap. */
export async function reachByKeyboard(page:Page,target:Locator,maxTabs=80){
 if(await target.count()!==1)throw new Error('functional_keyboard_target_ambiguous');
 // Prefer the direction toward the target. Forward-only wrapping crosses browser chrome in Firefox.
 const key=await target.evaluate(element=>{const active=document.activeElement;return active&&active!==document.body&&(active.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_PRECEDING)?'Shift+Tab':'Tab';});
 const visited:Array<{tag:string;id:string}> = [];
 for(let i=0;i<=maxTabs;i++){
  if(await target.evaluate(element=>element===document.activeElement))return;
  visited.push(await page.evaluate(()=>({tag:document.activeElement?.tagName??'',id:document.activeElement?.id??''})));
  if(i<maxTabs)await page.keyboard.press(key);
 }
 throw new Error('functional_keyboard_target_unreachable',{cause:{target:target.toString(),visited}});
}
