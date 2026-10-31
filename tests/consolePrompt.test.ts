import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough,Writable } from 'node:stream';
import { createPrompter } from '../src/utils/consolePrompt.js';

test('prompts visibles al escribir y confirmar; contraseña sin eco',async()=>{
 const input=new PassThrough();let transcript='';
 const output=new Writable({write(chunk,_encoding,cb){transcript+=chunk.toString();cb();}});
 const prompts=createPrompter(input,output);
 try{
  const email=prompts.ask('Correo de la cuenta a desactivar: ');
  assert.ok(transcript.includes('Correo de la cuenta a desactivar: '));
  input.write('test@dap.local');
  assert.ok(transcript.includes('Correo de la cuenta a desactivar: test@dap.local'));
  input.write('\r');assert.equal(await email,'test@dap.local');
  const confirm=prompts.ask('Escribe SI para confirmar: ');
  input.write('SI\r');assert.equal(await confirm,'SI');
  assert.ok(transcript.includes('Escribe SI para confirmar: SI'));
  const password=prompts.ask('Contraseña (entrada oculta): ',true);
  assert.ok(transcript.includes('Contraseña (entrada oculta): '));
  input.write('hidden-password-123\r');assert.equal(await password,'hidden-password-123');
  assert.ok(!transcript.includes('hidden-password-123'));
  const repeat=prompts.ask('Repite la contraseña: ',true);
  input.write('hidden-password-123\r');assert.equal(await repeat,'hidden-password-123');
  const name=prompts.ask('Nombre: ');input.write('Ana\r');assert.equal(await name,'Ana');
  assert.ok(transcript.includes('Nombre: Ana'));assert.ok(!transcript.includes('hidden-password-123'));
 }finally{prompts.close();input.destroy();}
});
