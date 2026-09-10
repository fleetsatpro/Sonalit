const crypto=require('crypto');
const aiClient=require('./aiClient');
const logger=require('./logger');
const CACHE_TTL_MS=60*60*1000;
const MAX_ITEMS=24;
const MAX_CHARS=4200;
const cache=new Map();
function hash(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function clean(value,max=MAX_CHARS){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max);}
function looksEnglish(language){const l=String(language||'').trim().toLowerCase();return l==='en'||l.startsWith('en-');}
function extractText(response){return Array.isArray(response?.content)?response.content.filter(x=>x?.type==='text').map(x=>x.text).join('\n').trim():'';}
function parseJson(text){try{return JSON.parse(text)}catch{}const m=String(text||'').match(/\[[\s\S]*\]/);if(!m)return[];try{return JSON.parse(m[0])}catch{return[]}}
async function translateItems(items){
 const candidates=(Array.isArray(items)?items:[]).filter(x=>x&&x.id&&!looksEnglish(x.language)).slice(0,MAX_ITEMS);if(!candidates.length)return new Map();
 const out=new Map(),uncached=[];
 for(const item of candidates){const key=hash(`${item.language||''}|${item.title||''}|${item.body||''}`);const hit=cache.get(key);if(hit&&hit.expires>Date.now()){out.set(String(item.id),hit.value);continue}uncached.push({item,key});}
 if(!uncached.length)return out;if(!(aiClient.hasAnthropic()||aiClient.hasGroqFallback()))return out;
 const payload=uncached.map(({item})=>({id:String(item.id),language:item.language||'unknown',title:clean(item.title,900),body:clean(item.body,MAX_CHARS)}));
 try{const response=await aiClient.createMessage({max_tokens:Math.min(7200,600+payload.length*260),system:'You are Sonalit\'s intelligence translation engine. Translate source material into precise, neutral operational English. Preserve names, places, numbers, dates, units, quotations, uncertainty, and security terminology. Do not add facts. Return ONLY a JSON array with objects {id, translated_title, translated_body}.',messages:[{role:'user',content:JSON.stringify(payload)}]});for(const translated of parseJson(extractText(response))){if(!translated?.id)continue;const value={title:clean(translated.translated_title,900),body:clean(translated.translated_body,MAX_CHARS)};if(!value.title&&!value.body)continue;const key=uncached.find(x=>String(x.item.id)===String(translated.id))?.key;if(key)cache.set(key,{value,expires:Date.now()+CACHE_TTL_MS});out.set(String(translated.id),value)}}catch(err){logger.warn(`Intelligence translation unavailable: ${err.message}`)}return out;
}
async function translatePayload(payload){
 const buckets=[];const add=(items)=>{if(Array.isArray(items))buckets.push(items)};add(payload?.events);add(payload?.observations);add(payload?.warnings);if(payload?.event)add([payload.event]);if(Array.isArray(payload?.event?.evidence))add(payload.event.evidence);
 const all=[];for(const bucket of buckets)for(const item of bucket)all.push({id:item.id||item.event_id||item.observation_id||item.warning_id,title:item.title||item.headline,body:item.body||item.summary||item.description,language:item.language});
 const translations=await translateItems(all);if(!translations.size)return payload;
 const apply=(item)=>{if(!item)return item;const key=String(item.id||item.event_id||item.observation_id||item.warning_id),t=translations.get(key);if(!t)return item;return {...item,title:t.title||item.title,body:t.body||item.body,translated_title:t.title||item.translated_title||null,translated_body:t.body||item.translated_body||null,translation_state:'translated_to_en'}};
 if(Array.isArray(payload?.events))payload.events=payload.events.map(apply);if(Array.isArray(payload?.observations))payload.observations=payload.observations.map(apply);if(Array.isArray(payload?.warnings))payload.warnings=payload.warnings.map(apply);if(payload?.event)payload.event=apply({...payload.event});if(Array.isArray(payload?.event?.evidence))payload.event.evidence=payload.event.evidence.map(apply);return payload;
}
module.exports={translatePayload,translateItems};
