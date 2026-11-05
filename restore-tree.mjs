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
