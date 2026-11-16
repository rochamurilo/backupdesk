import {test} from 'node:test';import assert from 'node:assert/strict';import {mapSnapshotPaths,withVssSources,powershellErrorText} from '../vss.mjs';
const shadow={id:'{11111111-1111-1111-1111-111111111111}',volume:'C:\\',device:'\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy42'};
test('VSS mapeia pastas locais para snapshot e nunca para o arquivo vivo',()=>{assert.deepEqual(mapSnapshotPaths(['C:\\Users\\Murilo\\Outlook'],[shadow]),['\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy42\\Users\\Murilo\\Outlook']);assert.throws(()=>mapSnapshotPaths(['\\\\server\\share\\Outlook'],[shadow]),/VSS/)});
test('VSS remove apenas o snapshot criado, inclusive se a cópia falhar',async()=>{const calls=[];const backend=async r=>{calls.push(r);if(r.action==='create')return {...shadow}};await assert.rejects(withVssSources(['C:\\Outlook'],async(mapped)=>{assert.ok(mapped[0].includes('HarddiskVolumeShadowCopy42'));throw Error('falha na cópia')},backend),/falha na cópia/);assert.deepEqual(calls.map(c=>c.action),['create','delete']);assert.equal(calls[1].id,shadow.id)});
test('falha de privilégio não usa cópia comum como fallback',async()=>{let invoked=false;await assert.rejects(withVssSources(['C:\\Outlook'],async()=>{invoked=true},async()=>{throw Error('Administrador necessário')}),/Administrador/);assert.equal(invoked,false)});
test('VSS rejeita origem de rede antes de criar snapshots',async()=>{let invoked=false;await assert.rejects(withVssSources(['\\\\server\\share'],async()=>{},async()=>{invoked=true}),/local/);assert.equal(invoked,false)});
test('falha na criação do segundo volume remove o primeiro snapshot',async()=>{const calls=[];await assert.rejects(withVssSources(['C:\\Outlook','D:\\Dados'],async()=>{},async r=>{calls.push(r);if(r.action==='create'&&r.volume==='D:\\')throw Error('volume indisponível');return {...shadow}}),/volume indisponível/);assert.equal(calls.at(-1).action,'delete');assert.equal(calls.at(-1).id,shadow.id)});

test('origem pode ser liberada antes da conferência do repositório, com uma única limpeza',async()=>{
 const calls=[];const value=await withVssSources(['C:\\Outlook'],async(_mapped,_snapshots,release)=>{calls.push('copy');await release();calls.push('check');await release();return 'ok'},async r=>{calls.push(r.action);if(r.action==='create')return {...shadow}});
 assert.equal(value,'ok');assert.deepEqual(calls,['create','copy','delete','check']);
});
test('falha ao liberar a origem continua sendo erro e não inicia a conferência',async()=>{
 let removed=0,checked=false;await assert.rejects(withVssSources(['C:\\Outlook'],async(_mapped,_snapshots,release)=>{await release();checked=true},async r=>{if(r.action==='create')return {...shadow};if(r.action==='delete'){removed++;throw Error('VSS ocupado')}}),/VSS ocupado/);
 assert.equal(checked,false);assert.equal(removed,1);
});

test('erro VSS mantém a mensagem legível e remove CLIXML/progresso do PowerShell',()=>{const message='VSS client [connect]: Componente indisponível.';assert.equal(powershellErrorText('#< CLIXML\n'+message+'<Objs Version="1.1.0.1"><Obj S="progress"><PR>Preparing modules for first use.</PR></Obj></Objs>'),message);assert.equal(powershellErrorText('#< CLIXML\n<Objs><S S="Error">Acesso &lt;negado&gt;_x000D__x000A_Repare o componente.</S></Objs>'),'Acesso <negado>\r\nRepare o componente.');assert.equal(powershellErrorText(message+'<Objs incomplete'),message);assert.equal(powershellErrorText(''),'' )});
