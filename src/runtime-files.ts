import {constants} from 'node:fs';
import {open} from 'node:fs/promises';

// Files written by sandboxed PHP are untrusted. Never follow a log symlink or
// block on a pipe, and never allocate based on its potentially huge file size.
export async function readRuntimeLog(path:string,maxBytes=1048576){
  let handle;
  try{handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error:any){if(error.code==='ENOENT')return{body:'',size:0,truncated:false};throw error;}
  try{
    const stat=await handle.stat();if(!stat.isFile())throw new Error('runtime_log_regular_file_required');
    const buffer=Buffer.alloc(maxBytes);const {bytesRead}=await handle.read(buffer,0,maxBytes,0);
    return{body:buffer.subarray(0,bytesRead).toString('utf8'),size:stat.size,truncated:stat.size>bytesRead};
  }finally{await handle.close();}
}
