export const cadenceLabels=Object.freeze({daily:'Todos os dias',weekdays:'Segunda a sexta',saturday:'Somente sábado',sunday:'Somente domingo',weekly:'Semanal · segunda-feira',monthly:'Mensal · dia 1'});
export const isScheduleHour=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const isScheduleDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const scheduleDate=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
export const scheduleTime=date=>String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0');
export function isScheduledDay(cadence,date=new Date()){
 const day=date.getDay();
 if(!Number.isFinite(day))return false;
 switch(cadence){case 'daily':return true;case 'weekdays':return day>=1&&day<=5;case 'saturday':return day===6;case 'sunday':return day===0;case 'weekly':return day===1;case 'monthly':return date.getDate()===1;default:return false}
}

// Persist the attempt before copying: a failure must not retry every minute or after restart.
export async function runScheduledRoutine(routine,now,state,persist,backup){
 if(!isScheduleHour(routine.hour))throw Error('Horário de agendamento inválido.');
 const date=scheduleDate(now),time=scheduleTime(now),previous=state[routine.id],sameDay=(typeof previous==='string'?previous:previous?.date)===date;
 if(!isScheduledDay(routine.cadence,now)||time<routine.hour||sameDay&&(typeof previous==='string'||previous.hours.includes(routine.hour)||previous.legacyUntil>=routine.hour))return false;
 state[routine.id]={date,hours:[...(sameDay?previous.hours:[]),routine.hour],...(sameDay&&previous.legacyUntil?{legacyUntil:previous.legacyUntil}:{})};
 try{await persist(state)}catch(e){if(previous===undefined)delete state[routine.id];else state[routine.id]=previous;throw e}
 await backup(routine,{date,hour:routine.hour});return true;
}
