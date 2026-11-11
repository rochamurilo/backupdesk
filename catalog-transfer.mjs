// Bounded, awaited batches avoid a request and a disk commit for every file.
export function catalogTransfer(send,{maxFiles=100,maxBytes=256*1024,signal}={}){
 let pending=[],bytes=12,failed=false;
 async function flush(){signal?.throwIfAborted();if(failed)throw Error('Envio do catálogo interrompido.');if(!pending.length)return;const files=pending;pending=[];bytes=12;try{await send(files)}catch(e){failed=true;throw e}}
 return {async add(file){signal?.throwIfAborted();if(failed)throw Error('Envio do catálogo interrompido.');const size=Buffer.byteLength(JSON.stringify(file))+1;if(size+12>maxBytes)throw Error('Metadados de arquivo excedem o limite do lote.');if(pending.length&&(pending.length>=maxFiles||bytes+size>maxBytes))await flush();pending.push({...file});bytes+=size;if(pending.length>=maxFiles)await flush()},flush,discard(){pending=[];bytes=12;failed=true}};
}
