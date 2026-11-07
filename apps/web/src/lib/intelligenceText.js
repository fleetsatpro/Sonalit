const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“'};
function decode(value){return String(value||'').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,(whole,token)=>{const key=String(token).toLowerCase();if(key[0]!=='#')return Object.prototype.hasOwnProperty.call(ENTITIES,key)?ENTITIES[key]:whole;const cp=key[1]==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);try{return Number.isInteger(cp)&&cp>=0&&cp<=0x10ffff?String.fromCodePoint(cp):whole}catch{return whole}})}
export function displayText(value,maxLength=6000){let text=String(value==null?'':value);for(let i=0;i<3;i++){text=decode(text).replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,' ').replace(/<\s*br\b[^>]*\/?>/gi,' ').replace(/<\/\s*(p|div|li|article|section|tr|h[1-6])\s*>/gi,' ').replace(/<[^>]*>/g,' ')}return decode(text).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,maxLength)}

export function safeExternalUrl(value){
  if(typeof value!=='string')return null;
  const candidate=value.trim();
  if(!candidate||candidate.length>2048||/[\u0000-\u001f\u007f]/.test(candidate))return null;
  try{
    const url=new URL(candidate);
    if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)return null;
    return url.toString();
  }catch{return null}
}
