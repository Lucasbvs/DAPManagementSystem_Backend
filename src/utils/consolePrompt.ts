import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import type { Readable } from 'node:stream';

export function createPrompter(input:Readable=process.stdin, target:Writable=process.stdout){
 let hidden=false;
 const output=new Writable({
  write(chunk,_encoding,callback){if(!hidden)target.write(chunk);callback();},
 });
 const rl=createInterface({input,output,terminal:true});
 const abort=new AbortController();
 rl.on('SIGINT',()=>{hidden=false;target.write('\n');abort.abort();rl.close();});
 return {
  async ask(prompt:string,secret=false):Promise<string>{
   hidden=false;
   const answer=rl.question(prompt,{signal:abort.signal});
   hidden=secret;
   try{return await answer;}
   finally{hidden=false;if(secret)target.write('\n');}
  },
  close(){hidden=false;rl.close();},
 };
}
