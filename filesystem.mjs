import {readdir,stat,lstat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
export async function browseFiles(input='') {
 if(typeof input!=='string')throw Error('Caminho inválido');
 if(!input){
  if(process.platform==='win32'){
   const roots=await Promise.all(Array.from({length:26},(_,i)=>String.fromCharCode(65+i)+':\\').map(async p=>{try{await stat(p);return {name:p,path:p,directory:true}}catch{return null}}));
   return {path:'',parent:null,entries:roots.filter(Boolean),truncated:false};
  }
  input='/';
 }
 if(!path.isAbsolute(input))throw Error('Informe um caminho absoluto, como C:\\Dados ou \\\\servidor\\compartilhamento');
 const current=path.resolve(input), entries=await readdir(current,{withFileTypes:true});
 const sorted=entries.filter(e=>e.isDirectory()||e.isFile()).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
 return {path:current,parent:path.dirname(current)===current?'':path.dirname(current),entries:sorted.slice(0,1000).map(e=>({name:e.name,path:path.join(current,e.name),directory:e.isDirectory()})),truncated:sorted.length>1000};
}
export function parseSources(source){
 const items=Array.isArray(source)?source:typeof source==='string'&&source.startsWith('[')?JSON.parse(source):[source];
 if(!Array.isArray(items)||!items.length||items.length>100||items.some(p=>typeof p!=='string'||!p.trim()||!path.isAbsolute(p)))throw Error('Selecione de 1 a 100 arquivos ou pastas com caminho absoluto');
 return [...new Set(items)];
}
// Count logical source bytes once across active routines, independently of destinations or changed bytes.
export async function measureSelectedVolume(routines,{signal,onProgress=()=>{},now=()=>new Date()}={}){
 const key=value=>process.platform==='win32'?value.toLowerCase():value,roots=new Map();
 for(const routine of routines){
  if(routine.deleted||routine.enabled===0||routine.enabled===false)continue;
  for(const input of parseSources(routine.source)){
   signal?.throwIfAborted();const info=await lstat(input);
   if(info.isSymbolicLink())throw Error('Selecione o destino real da origem.');
   if(!info.isDirectory()&&!info.isFile())throw Error('Origem não suportada.');
   const absolute=await realpath(input);roots.set(key(absolute),{absolute,directory:info.isDirectory()});
  }
 }
 const ordered=[...roots.values()].sort((a,b)=>a.absolute.length-b.absolute.length),selected=[];
 for(const root of ordered){if(!selected.some(parent=>{if(!parent.directory)return key(parent.absolute)===key(root.absolute);const relative=path.relative(key(parent.absolute),key(root.absolute));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)}))selected.push(root)}
 const pending=selected.map(root=>root.absolute);let bytes=0n,files=0;
 while(pending.length){
  signal?.throwIfAborted();const file=pending.pop(),info=await lstat(file,{bigint:true});
  if(info.isSymbolicLink())continue;
  if(info.isDirectory()){for(const entry of await readdir(file,{withFileTypes:true}))if(!entry.isSymbolicLink())pending.push(path.join(file,entry.name))}
  else if(info.isFile()){bytes+=info.size;files++;if(bytes>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Volume selecionado excede o limite suportado.')}
  else throw Error('Origem não suportada.');
  onProgress({stage:'scanning',currentFile:file,processedBytes:0,totalBytes:null,filesDone:0,totalFiles:null,filesFound:files});
 }
 signal?.throwIfAborted();return {status:'ready',bytes:Number(bytes),measured_at:now().toISOString()};
}
export async function collectFiles(source,onFile){
 const roots=parseSources(source);
 for(let i=0;i<roots.length;i++){
  const root=path.resolve(roots[i]),info=await lstat(root);
  if(info.isSymbolicLink())throw Error('Selecione o destino do link simbólico: '+root);
  const prefix=roots.length>1?`${i+1}-${path.basename(root)||'unidade'}/`:'';
  async function visit(file,info){
   if(info.isDirectory()){
    for(const entry of await readdir(file,{withFileTypes:true})){
     if(entry.isSymbolicLink())continue;
     await visit(path.join(file,entry.name),await lstat(path.join(file,entry.name)));
    }
   }else if(info.isFile()){
    if(info.size>16*1024*1024)throw Error('Limite do protótipo: arquivo acima de 16,78 MB: '+file);
    const content=await readFile(file),after=await lstat(file);
    if(info.mtimeMs!==after.mtimeMs||info.size!==after.size)throw Error('Arquivo alterado durante leitura: '+file);
    const relative=path.relative(root,file)||path.basename(root);
    await onFile(prefix+relative.split(path.sep).join('/'),content);
   }else throw Error('Tipo de arquivo não suportado: '+file);
  }
  await visit(root,info);
 }
}

export function excludedLinkNotice(entries=[]){return entries.length?entries.length+' atalho(s) de arquivo/pasta ignorado(s); o conteúdo apontado não foi copiado. Para incluí-lo, selecione a pasta real como outra origem.':null}
