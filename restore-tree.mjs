const normalizedSource=value=>{const input=String(value||'').replace(/[\\/]+$/,'');return /^(?:[a-z]:|\\)/i.test(input)?input.replaceAll('/',String.fromCharCode(92)).toLowerCase():input};
export function restoreSourceKey(run){const origin=run.original_device||run.device;try{const sources=JSON.parse(run.scope_sources);if(!sources.length)throw Error();return JSON.stringify([origin,sources.map(normalizedSource).sort()])}catch{return origin+':'+(run.scope_key||'legacy:'+run.routine_id)}}
// Used by the restore calendar and by the dashboard's complete-restoration simulation.
export function selectRestorePoints(runs,asOf=Date.now()){
 const points=new Map();
 for(const run of runs.filter(r=>r.status==='success'&&Number.isFinite(Date.parse(r.finished))&&Date.parse(r.finished)<=Number(asOf)).sort((a,b)=>Date.parse(b.finished)-Date.parse(a.finished))){const key=restoreSourceKey(run);if(!points.has(key))points.set(key,run)}
 return [...points.values()];
}
export function restoreVolumeAt(runs,asOf=new Date()){
 const points=selectRestorePoints(runs,asOf);if(!points.length)return null;
 const metadata={basis:'restore',measured_at:new Date(asOf).toISOString(),latest_backup_at:points[0].finished};let bytes=0n;
 for(const run of points){if(!Number.isSafeInteger(run.logical_bytes)||run.logical_bytes<0)return {...metadata,status:'unavailable',bytes:null};bytes+=BigInt(run.logical_bytes)}
 return bytes>BigInt(Number.MAX_SAFE_INTEGER)?{...metadata,status:'unavailable',bytes:null}:{...metadata,status:'ready',bytes:Number(bytes)};
}
// A separate root for every restore point prevents same-named files being merged.
export function buildRestoreTree(sets){
 const nodes=new Map(),rows=[],roots=[],compareNames=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'}).compare;let next=0;
 function folder(name){const node={id:String(next++),type:'folder',name,children:[],indices:[],folders:new Map()};nodes.set(node.id,node);return node}
 for(const {run,files,label} of sets){const root=folder(label||run.routine_name||run.source_device_name||'Backup');roots.push(root);
  for(const file of files){const index=rows.length;rows.push({run,file});const parts=file.path.split('/');let parent=root;parent.indices.push(index);
   for(const part of parts.slice(0,-1)){if(!parent.folders.has(part)){const child=folder(part);parent.folders.set(part,child);parent.children.push(child)}parent=parent.folders.get(part);parent.indices.push(index)}
   const leaf={id:String(next++),type:'file',name:parts.at(-1),indices:[index],index};nodes.set(leaf.id,leaf);parent.children.push(leaf);
  }
 }
 for(const node of nodes.values())if(node.type==='folder')node.children.sort((a,b)=>(a.type==='folder'?0:1)-(b.type==='folder'?0:1)||compareNames(a.name,b.name));
 return {roots,nodes,rows};
}
export function selectionState(node,selected){let count=0;for(const index of node.indices)if(selected.has(index))count++;return {checked:count>0&&count===node.indices.length,indeterminate:count>0&&count<node.indices.length}}
export function selectRestoreNode(node,selected,checked){for(const index of node.indices)if(checked)selected.add(index);else selected.delete(index)}
export function selectedCatalogFiles(rows,paths){if(!Array.isArray(paths)||!paths.length||paths.length>200000||paths.some(p=>typeof p!=='string'||!p||p.length>4096))throw Error('Selecione pelo menos um arquivo válido para restaurar.');const wanted=new Set(paths),selected=rows.filter(file=>wanted.has(file.path));if(selected.length!==wanted.size)throw Error('A seleção contém arquivos que não pertencem a esta versão.');return selected}
