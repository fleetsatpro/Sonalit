export function localDateTimeInputInTimezone(value:string|null|undefined,timezone:string):string {
 if(!value)return '';
 const instant=new Date(value);
 if(!Number.isFinite(instant.getTime()))return '';
 try{
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const parts=fmt.formatToParts(instant);
  const valueOf=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  const year=valueOf('year'),month=valueOf('month'),day=valueOf('day'),hour=valueOf('hour'),minute=valueOf('minute');
  return year&&month&&day&&hour&&minute?year+'-'+month+'-'+day+'T'+hour+':'+minute:'';
 }catch{return ''}
}
