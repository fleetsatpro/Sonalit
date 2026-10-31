import { useCallback,useEffect,useRef,useState } from 'react';
import { AlertCircle,CheckCircle2,Download,FileText,Image,MapPin,RefreshCw,ShieldCheck,Upload,Video } from 'lucide-react';
import { api } from '../../lib/api.js';
import { getDeviceId } from '../../lib/offline/index.js';

type Category='photo'|'video'|'document'|'incident_attachment'|'check_in'|'handover';
type LocationFix={latitude:number;longitude:number;accuracy_m:number};
type Evidence={id:string;category:Category;file_name:string;mime_type:string;size_bytes:number;status:string;sha256?:string|null;created_at:string;location_source?:string};
type Pending={id:string;file:File;transferred:boolean};
const categories:Array<{value:Category;label:string}>=[
 {value:'photo',label:'Photograph'},{value:'video',label:'Video clip'},{value:'document',label:'Document'},
 {value:'incident_attachment',label:'Incident attachment'},{value:'check_in',label:'Check-in evidence'},{value:'handover',label:'Handover evidence'},
];
const accept='image/jpeg,image/png,video/mp4,application/pdf';
const sizeLabel=(n:number)=>n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB';
const timeLabel=(s:string)=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'Time unavailable'};
const iconFor=(c:string)=>c==='photo'||c==='check_in'?Image:c==='video'?Video:FileText;

export default function SjmFieldEvidenceCapture({journeyId}:{journeyId:string}){
 const picker=useRef<HTMLInputElement>(null);
 const [items,setItems]=useState<Evidence[]>([]);
 const [category,setCategory]=useState<Category>('photo');
 const [location,setLocation]=useState<LocationFix|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[geoBusy,setGeoBusy]=useState(false);
 const [notice,setNotice]=useState<{kind:'info'|'success'|'error';text:string}|null>(null);

 const refresh=useCallback(async()=>{
  setLoading(true);
  try{const r=await api.get('/sjm/journeys/'+journeyId+'/evidence');setItems(r.data?.data||[]);}
  catch{setNotice({kind:'error',text:'The evidence register could not be loaded. No local file is treated as server evidence.'});}
  finally{setLoading(false);}
 },[journeyId]);
 useEffect(()=>{setItems([]);setPending(null);void refresh();},[refresh]);

 const commit=async(id:string)=>{
  const r=await api.post('/sjm/journeys/'+journeyId+'/evidence/'+id+'/commit');
  if(r.data?.data?.status!=='VERIFIED')throw new Error('Sonalit did not confirm evidence verification.');
  setPending(null);await refresh();
  setNotice({kind:'success',text:'Sonalit verified the stored object and recorded its SHA-256 integrity hash.'});
 };
 const transfer=async(file:File,existingId?:string)=>{
  setBusy(true);
  try{
   const request=existingId
    ?await api.post('/sjm/journeys/'+journeyId+'/evidence/'+existingId+'/renew-upload-url')
    :await api.post('/sjm/journeys/'+journeyId+'/evidence/upload-url',{
      category,file_name:file.name,mime_type:file.type.toLowerCase(),size_bytes:file.size,
      device_id:getDeviceId(),
      ...(location?{location}:{}),
    });
   const signed=request.data?.data,id=String(signed?.id||existingId||'');
   if(!id||!signed?.upload_url||!signed?.required_headers)throw new Error('Sonalit did not return a valid private upload capability.');
   setPending({id,file,transferred:false});
   setNotice({kind:'info',text:'Transferring to private storage. The file is not yet accepted as evidence.'});
   const response=await fetch(signed.upload_url,{method:'PUT',headers:signed.required_headers,body:file,credentials:'omit',cache:'no-store'});
   if(!response.ok){
    if(response.status===412){
     // A previous PUT may have committed after its response was lost. R2's
     // create-once guard rejects overwrites; verify that exact object instead.
     setPending({id,file,transferred:true});
     await commit(id);
     return;
    }
    throw new Error('Private storage rejected the upload (HTTP '+response.status+'). Check connection and storage access.');
   }
   setPending({id,file,transferred:true});
   setNotice({kind:'info',text:'File transfer completed. Sonalit is verifying the stored object and its integrity.'});
   await commit(id);
  }catch(error){
   setNotice({kind:'error',text:(error instanceof Error?error.message:'Evidence upload failed.')+' The item is not shown as verified.'});
   void refresh();
  }finally{setBusy(false);}
 };
 const chooseFile=(file?:File)=>{
  if(!file)return;
  setNotice(null);
  const match=items.find(x=>x.status==='UPLOAD_PENDING'&&x.file_name===file.name&&x.size_bytes===file.size&&x.mime_type===file.type.toLowerCase());
  void transfer(file,match?.id);
  if(picker.current)picker.current.value='';
 };
 const retry=async()=>{
  if(!pending||busy)return;
  if(pending.transferred){
   setBusy(true);
   try{await commit(pending.id);}
   catch(error){setNotice({kind:'error',text:error instanceof Error?error.message:'Evidence verification remains pending.'});}
   finally{setBusy(false);}
  }else await transfer(pending.file,pending.id);
 };
 const locate=()=>{
  if(!navigator.geolocation){setNotice({kind:'error',text:'This browser does not provide location capture. Evidence can still be uploaded without coordinates.'});return;}
  setGeoBusy(true);
  navigator.geolocation.getCurrentPosition(
   p=>{setLocation({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy_m:p.coords.accuracy});setGeoBusy(false);setNotice({kind:'info',text:'One-time device location attached ('+Math.round(p.coords.accuracy)+' m reported accuracy). It is not independently verified.'});},
   e=>{setGeoBusy(false);setNotice({kind:'error',text:e.code===e.PERMISSION_DENIED?'Location permission was denied. Upload can continue without coordinates.':e.code===e.TIMEOUT?'The one-time location request timed out.':'A usable location fix is unavailable.'});},
   {enableHighAccuracy:true,maximumAge:0,timeout:12000},
  );
 };
 const download=async(item:Evidence)=>{
  try{
   const r=await api.post('/sjm/journeys/'+journeyId+'/evidence/'+item.id+'/download-url');
   const url=r.data?.data?.download_url;
   if(typeof url!=='string')throw new Error('Sonalit did not return a secure download capability.');
   window.open(url,'_blank','noopener,noreferrer');
   setNotice({kind:'info',text:'A short-lived private download capability was issued and logged.'});
  }catch(error){setNotice({kind:'error',text:error instanceof Error?error.message:'Private evidence download is unavailable.'});}
 };
 const verified=items.filter(x=>x.status==='VERIFIED').length;
 const pendingCount=items.filter(x=>x.status==='UPLOAD_PENDING').length;
 return <section aria-label="Mission evidence capture" className="rounded-md border border-white/[0.09] bg-[#0c121a] p-4 sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-slate-300"/><h3 className="text-lg font-semibold text-white">Evidence & custody</h3></div>
   <button type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Refresh evidence register" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw size={13} className={loading?'animate-spin':''}/>Refresh</button>
  </div>
  <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">Capture photographs, clips and documents against this mission. Files remain pending until Sonalit verifies the private stored object and records its integrity hash.</p>
  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
   <div className="rounded-md border border-white/[0.07] bg-black/15 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-slate-500">Verified</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">{verified}</p></div>
   <div className="rounded-md border border-white/[0.07] bg-black/15 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-slate-500">Awaiting verification</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">{pendingCount}</p></div>
   <div className="col-span-2 rounded-md border border-white/[0.07] bg-black/15 p-3 sm:col-span-1"><p className="text-[10px] uppercase tracking-[.12em] text-slate-500">Location capture</p><p className="mt-1 text-xs font-medium text-slate-200">{location?Math.round(location.accuracy_m)+' m reported accuracy':'Not attached'}</p></div>
  </div>
  <div className="mt-4 space-y-3 rounded-md border border-white/[0.08] bg-black/15 p-3 sm:p-4">
   <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-300">Evidence category</span>
    <select value={category} onChange={e=>setCategory(e.target.value as Category)} className="min-h-11 w-full rounded-md border border-white/10 bg-[#08111e] px-3 py-2.5 text-sm text-slate-100">{categories.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select>
   </label>
   <div className="flex flex-col gap-2 sm:flex-row">
    <button type="button" onClick={()=>picker.current?.click()} disabled={busy} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 py-3 text-sm font-semibold text-[#06110c] disabled:opacity-50"><Upload size={15}/>Capture or attach file</button>
    <input ref={picker} type="file" accept={accept} capture="environment" className="sr-only" aria-label="Choose mission evidence file" disabled={busy} onChange={e=>chooseFile(e.target.files?.[0])}/>
    <button type="button" onClick={locate} disabled={geoBusy||busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-white/15 px-4 py-3 text-sm text-slate-200 disabled:opacity-50"><MapPin size={15}/>{geoBusy?'Requesting location…':location?'Refresh location':'Attach one-time location'}</button>
   </div>
   {location&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300/15 bg-amber-300/[0.035] p-3 text-[11px] text-amber-100"><span>Device-reported · {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</span><button type="button" onClick={()=>setLocation(null)} disabled={busy} className="underline underline-offset-2">Remove</button></div>}
   <p className="text-[11px] leading-5 text-slate-500">Location is requested only when you press the button. Browser coordinates are unverified, not proof of presence. Upload requires a network connection; media is not yet included in the offline queue.</p>
  </div>
  {pending&&<div role="status" className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/[0.035] p-3">
   <p className="text-xs font-semibold text-amber-100">{pending.transferred?'File transferred — verification pending':'Evidence transfer pending'}</p>
   <p className="mt-1 break-all text-[11px] text-slate-400">{pending.file.name} · {sizeLabel(pending.file.size)}</p>
   <button type="button" onClick={()=>void retry()} disabled={busy} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-200/20 px-3 py-2 text-xs text-amber-100 disabled:opacity-50"><RefreshCw size={13}/>Retry transfer / verification</button>
   <p className="mt-2 text-[10px] leading-4 text-slate-500">Keep this screen open until the file is verified or reconciled. A pending local transfer is not server acceptance.</p>
  </div>}
  {notice&&<p role={notice.kind==='error'?'alert':'status'} className={'mt-3 rounded-md border p-3 text-xs leading-5 '+(notice.kind==='error'?'border-red-300/20 bg-red-300/[0.04] text-red-200':notice.kind==='success'?'border-emerald-300/20 bg-emerald-300/[0.04] text-emerald-100':'border-white/10 bg-white/[0.025] text-slate-300')}>
   {notice.kind==='error'?<AlertCircle size={13} className="mr-1 inline"/>:notice.kind==='success'?<CheckCircle2 size={13} className="mr-1 inline"/>:null}{notice.text}
  </p>}
  <div className="mt-4 border-t border-white/[0.07] pt-4">
   <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold text-slate-200">Mission evidence register</h4><span className="text-[11px] text-slate-500">{items.length} records</span></div>
   {loading?<p className="text-xs text-slate-500">Loading evidence register…</p>:items.length===0?<p className="rounded-md border border-dashed border-white/10 p-4 text-xs text-slate-500">No evidence has been registered for this mission.</p>
    :<ul className="space-y-2">{items.map(item=>{const Icon=iconFor(item.category);return <li key={item.id} className="flex flex-col gap-3 rounded-md border border-white/[0.07] bg-black/15 p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3"><span className="mt-0.5 text-slate-400"><Icon size={16}/></span><div className="min-w-0">
       <p className="break-all text-xs font-medium text-slate-200">{item.file_name}</p>
       <p className="mt-1 text-[10px] text-slate-500">{item.category.replaceAll('_',' ')} · {sizeLabel(item.size_bytes)} · {timeLabel(item.created_at)}</p>
       <p className="mt-1 text-[10px] text-slate-500">{item.status==='VERIFIED'?'Verified by Sonalit':item.status==='UPLOAD_PENDING'?'Awaiting upload verification':item.status==='REJECTED'?'Rejected — review required':item.status.replaceAll('_',' ').toLowerCase()}{item.sha256?' · SHA-256 '+item.sha256.slice(0,12)+'…':''}</p>
       {item.location_source&&item.location_source!=='NOT_CAPTURED'&&<p className="mt-1 text-[10px] text-amber-200/80">Device-reported location · not independently verified</p>}
      </div></div>
      {item.status==='VERIFIED'&&<button type="button" onClick={()=>void download(item)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-white/15 px-3 py-2 text-xs text-slate-200"><Download size={13}/>Secure download</button>}
     </li>;})}</ul>}
  </div>
 </section>;
}
