export const cadenceLabels=Object.freeze({daily:'Todos os dias',weekdays:'Segunda a sexta',saturday:'Somente sábado',sunday:'Somente domingo',weekly:'Semanal · segunda-feira',monthly:'Mensal · dia 1'});
export function isScheduledDay(cadence,date=new Date()){
 const day=date.getDay();
 if(!Number.isFinite(day))return false;
 switch(cadence){case 'daily':return true;case 'weekdays':return day>=1&&day<=5;case 'saturday':return day===6;case 'sunday':return day===0;case 'weekly':return day===1;case 'monthly':return date.getDate()===1;default:return false}
}

// Persist the attempt before copying: a failure must not retry every minute or after restart.
export async function runScheduledRoutine(routine,now,state,persist,backup){
 const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
 if(!isScheduledDay(routine.cadence,now)||time<routine.hour||state[routine.id]===date)return false;
 const previous=state[routine.id];state[routine.id]=date;
 try{await persist(state)}catch(e){if(previous===undefined)delete state[routine.id];else state[routine.id]=previous;throw e}
 await backup(routine);return true;
}
