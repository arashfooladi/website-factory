import {createHash} from 'node:crypto';
export function canonicalJson(value:unknown):string{
  const ordered=(item:any):any=>Array.isArray(item)?item.map(ordered):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,ordered(item[key])])):item;
  return JSON.stringify(ordered(value));
}
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
