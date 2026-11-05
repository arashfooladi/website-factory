import {open} from 'node:fs/promises';
import {constants} from 'node:fs';

/** Read the bounded private sink without following a replacement link or opening a special file. */
export async function mailEvidence(filename:string){
 const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
 if(!file)return[];
 try{
  const stat=await file.stat();if(!stat.isFile()||stat.size>524288)throw new Error('functional_mail_sink_invalid');
  return (await file.readFile('utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 }finally{await file.close();}
}
export function matchesMail(messages:any[],expectation:{to:string;subjectIncludes?:string;messageIncludes:string}){
 return messages.some(message=>{
  let recipients:unknown;try{recipients=JSON.parse(message.to);}catch{return false;}
  const list=Array.isArray(recipients)?recipients:[recipients];
  return list.includes(expectation.to)&&typeof message.message==='string'&&message.message.includes(expectation.messageIncludes)&&(!expectation.subjectIncludes||typeof message.subject==='string'&&message.subject.includes(expectation.subjectIncludes));
 });
}
