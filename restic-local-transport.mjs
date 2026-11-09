// Restic's local backend bypasses its HTTP bandwidth limiter. Use its official
// REST protocol over an authenticated loopback connection to pace actual disk
// writes/reads, preserving the standard local repository layout and encryption.
import {createServer} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,lstat,realpath,readdir,open,link,unlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
const types=new Set(['data','index','keys','locks','snapshots']),v2='application/vnd.x.restic.rest.v2';
export async function localResticTransport(repository,{throttle=async()=>{},onTransfer=()=>{}}={}){
 const root=await realpath(repository),secret=randomBytes(32).toString('hex'),auth=Buffer.from('Basic '+Buffer.from('backupdesk:'+secret).toString('base64'));
 async function safe(file){let current=root;for(const part of path.relative(root,file).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if((await lstat(current)).isSymbolicLink())throw Error('Repositório redirecionado.')}catch(e){if(e.code!=='ENOENT')throw e}}}
 const server=createServer(async(req,res)=>{
  let temporary;const abort=new AbortController();req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableFinished)abort.abort()});
  try{
   const supplied=Buffer.from(req.headers.authorization||'');if(supplied.length!==auth.length||!timingSafeEqual(supplied,auth)){res.writeHead(401).end();return}
   // Inspect raw paths before URL normalization; no user-selected filesystem path
   // or arbitrary command is ever accepted through this private endpoint.
   const [pathname,query='']=req.url.split('?');
   if(pathname==='/'&&query==='create=true'&&req.method==='POST'){for(const type of types){await safe(path.join(root,type));await mkdir(path.join(root,type),{recursive:true})}res.writeHead(200).end();return}
   const match=/^\/(config|data|index|keys|locks|snapshots)(?:\/([a-f0-9]{64}))?\/?$/.exec(pathname);
   if(!match||query||match[1]==='config'&&match[2]){res.writeHead(400).end();return}
   const [,type,name]=match,folder=path.join(root,type);
   if(!name&&type!=='config'){
    if(req.method!=='GET'){res.writeHead(405).end();return}
    await safe(folder);let entries=[];try{for(const item of await readdir(folder,{withFileTypes:true})){
     if(type==='data'&&item.isDirectory()&&/^[a-f0-9]{2}$/.test(item.name)){const sub=path.join(folder,item.name);await safe(sub);for(const id of await readdir(sub))if(/^[a-f0-9]{64}$/.test(id)){const file=path.join(sub,id);await safe(file);const info=await lstat(file);if(info.isFile())entries.push({name:id,size:info.size})}}
     else if(item.isFile()&&/^[a-f0-9]{64}$/.test(item.name)){const info=await lstat(path.join(folder,item.name));entries.push({name:item.name,size:info.size})}
    }}catch(e){if(e.code!=='ENOENT')throw e}res.writeHead(200,{'Content-Type':v2}).end(JSON.stringify(entries));return;
   }
   const file=type==='config'?folder:type==='data'?path.join(folder,name.slice(0,2),name):path.join(folder,name);await safe(file);
   if(req.method==='POST'){
    await mkdir(path.dirname(file),{recursive:true});temporary=file+'.'+randomUUID()+'.tmp';let size=0;
    const tap=new Transform({transform(chunk,_encoding,callback){Promise.resolve().then(()=>throttle(chunk.length,'upload',abort.signal)).then(()=>{size+=chunk.length;onTransfer('upload',chunk.length);callback(null,chunk)}).catch(callback)}});
    await pipeline(req,tap,createWriteStream(temporary,{flags:'wx',mode:0o600,flush:true}),{signal:abort.signal});
    if(Number(req.headers['content-length'])!==size)throw Error('Gravação incompleta.');
    await safe(file);await link(temporary,file);await unlink(temporary);temporary=null;res.writeHead(200).end();return;
   }
   if(req.method==='DELETE'){
    // Backup/check only remove their own locks. This transport cannot prune data.
    if(type!=='locks'){res.writeHead(405).end();return}await unlink(file);res.writeHead(200).end();return;
   }
   if(!['HEAD','GET'].includes(req.method)){res.writeHead(405).end();return}
   const handle=await open(file,'r');try{
    const info=await handle.stat();if(!info.isFile())throw Error('Objeto inválido.');let start=0,end=info.size-1,status=200;
    if(req.headers.range){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!range){res.writeHead(416).end();return}start=Number(range[1]);if(range[2])end=Number(range[2]);if(start<0||start>=info.size||end<start||end>=info.size){res.writeHead(416).end();return}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`)}
    res.writeHead(status,{'Content-Length':info.size?end-start+1:0,'Content-Type':'application/octet-stream'});if(req.method==='HEAD'||!info.size){res.end();return}
    const tap=new Transform({transform(chunk,_encoding,callback){Promise.resolve().then(()=>throttle(chunk.length,'download',abort.signal)).then(()=>{onTransfer('download',chunk.length);callback(null,chunk)}).catch(callback)}});
    await pipeline(handle.createReadStream({start,end,autoClose:false}),tap,res,{signal:abort.signal});
   }finally{await handle.close()}
  }catch(e){if(!res.headersSent)res.writeHead(e.code==='ENOENT'?404:e.code==='EEXIST'?409:500).end();else res.destroy()}
  finally{if(temporary)await unlink(temporary).catch(()=>{})}
 });
 server.requestTimeout=0;server.timeout=0;server.headersTimeout=30000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 return {url:'rest:http://backupdesk:'+secret+'@127.0.0.1:'+server.address().port+'/',async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}};
}
