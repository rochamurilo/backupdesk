export const cadenceLabels=Object.freeze({daily:'Todos os dias',weekdays:'Segunda a sexta',saturday:'Somente sábado',sunday:'Somente domingo',weekly:'Semanal · segunda-feira',monthly:'Mensal · dia 1'});
export function isScheduledDay(cadence,date=new Date()){
 const day=date.getDay();
 if(!Number.isFinite(day))return false;
 switch(cadence){case 'daily':return true;case 'weekdays':return day>=1&&day<=5;case 'saturday':return day===6;case 'sunday':return day===0;case 'weekly':return day===1;case 'monthly':return date.getDate()===1;default:return false}
}
