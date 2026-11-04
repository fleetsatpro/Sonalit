import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { localDateTimeInputInTimezone } from '../../lib/sjmJourneyTime.js';
import { COUNTRIES, countryCodeFromName, countryFlagUrl, countryNameFromCode } from '../../lib/countries.js';
import { airlineIataCodeFromFlightNumber } from '../../lib/airline.js';
import { AlertCircle, CalendarDays, Check, CheckCircle2, Clock3, Download, Plane, Plus, RefreshCw, ShieldCheck, Upload, Users } from 'lucide-react';

type Traveller = {
  id: string; traveller_reference: string; traveller_type: string; display_name: string;
  title?: string | null; given_name?: string; middle_name?: string | null; family_name?: string;
  preferred_name?: string | null; nationality?: string | null; date_of_birth?: string | null;
  email?: string | null; phone?: string | null; emergency_contact_name?: string | null;
  relationship_to_principal?: string | null; emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null; internal_notes?: string | null;
};
type TravelDocument = {
  id: string; traveller_id: string; document_type: string; holder_name: string;
  issuing_country?: string | null; issue_date?: string | null; expiry_date?: string | null; expiry_state?: 'not_recorded' | 'expired' | 'expiring_soon' | 'current';
  review_status: string; review_note?: string | null; evidence_id: string;
  file_name: string; mime_type: string; size_bytes: number; sha256?: string | null;
};
type Flight = {
  id: string; sequence: number; traveller_id?: string | null; traveller_display_name?: string | null; carrier: string; flight_number: string;
  departure_airport: string; departure_airport_name?: string | null; departure_terminal?: string | null;
  departure_gate?: string | null; departure_at: string; departure_timezone: string;
  arrival_airport: string; arrival_airport_name?: string | null; arrival_terminal?: string | null;
  arrival_gate?: string | null; arrival_at: string; arrival_timezone: string;
  booking_reference?: string | null; status: string; allowed_next_statuses: string[]; status_source: string; status_note?: string | null;
};
type Participant = { user_id: string; duty_role: string; user_name: string; is_primary?: boolean; removed_at?: string | null; account_status?: string | null };
type Item = {
  id: string; sequence: number; item_type: string; title: string; description?: string | null;
  traveller_id?: string | null; traveller_display_name?: string | null;
  location_label?: string | null; location_lat?: string | number | null; location_lng?: string | number | null;
  planned_start_at: string; planned_end_at: string;
  responsible_user_id?: string | null; responsible_name?: string | null; responsible_role?: string | null;
  execution_status: string; actual_start_at?: string | null; actual_end_at?: string | null;
  execution_note?: string | null; flight_segment_id?: string | null;
};
type Day = {
  id: string; journey_date: string; timezone: string; day_title: string;
  briefing?: string | null; operational_notes?: string | null; items: Item[];
};
type ReadinessBlocker = { code: string; message: string; missing_dates?: string[]; document_count?: number; uncovered_traveller_count?: number; conflict_count?: number };
type TravelReadiness = {
  phase: 'approval' | 'departure';
  ready: boolean;
  blockers: ReadinessBlocker[];
  warnings: Array<{ code: string; message: string; document_count?: number; connection_count?: number }>;
  counts: {
    traveller_count: number; principal_traveller_count: number; flight_segment_count: number;
    programme_day_count: number; timed_activity_count: number; unassigned_activity_count: number; required_programme_day_count: number;
    cleared_document_count: number; document_blocker_count: number; expiring_document_count: number; schedule_conflict_count?: number; flight_schedule_conflict_count?: number; flight_airport_change_count?: number;
  };
};
type Workspace = {
  travellers: Traveller[]; documents: TravelDocument[]; flights: Flight[]; days: Day[];
  legacy_flight_reference?: { airport_code?: string | null; terminal?: string | null; airline?: string | null; flight_number?: string | null; scheduled_at?: string | null };
  readiness?: TravelReadiness;
  access?: { manager: boolean; user_id?: string; duty_roles: string[] };
  provenance?: Record<string, string>;
};
type Props = { journeyId: string; timezone: string; canManage: boolean; planEditable: boolean; executionAllowed: boolean; readOnly: boolean };
type TravellerDraft = {
  traveller_reference: string; traveller_type: string; title: string; given_name: string;
  middle_name: string; family_name: string; preferred_name: string; nationality: string;
  date_of_birth: string; email: string; phone: string; relationship_to_principal: string;
  emergency_contact_name: string; emergency_contact_relationship: string;
  emergency_contact_phone: string; internal_notes: string;
};
type FlightDraft = {
  traveller_id: string; carrier: string; flight_number: string; departure_airport: string;
  departure_airport_name: string; departure_terminal: string; departure_gate: string;
  departure_at: string; departure_timezone: string; arrival_airport: string;
  arrival_airport_name: string; arrival_terminal: string; arrival_gate: string;
  arrival_at: string; arrival_timezone: string; booking_reference: string;
};
type ItemDraft = {
  item_type: string; title: string; description: string; location_label: string;
  location_lat: string; location_lng: string; traveller_id: string;
  planned_start_at: string; planned_end_at: string; responsible_user_id: string;
  responsible_role: string; flight_segment_id: string;
};
const EMPTY_TRAVELLER: TravellerDraft = {
  traveller_reference: '', traveller_type: 'principal', title: '', given_name: '',
  middle_name: '', family_name: '', preferred_name: '', nationality: '',
  date_of_birth: '', email: '', phone: '', relationship_to_principal: '',
  emergency_contact_name: '', emergency_contact_relationship: '',
  emergency_contact_phone: '', internal_notes: '',
};
const EMPTY_FLIGHT: FlightDraft = {
  traveller_id: '', carrier: '', flight_number: '', departure_airport: '',
  departure_airport_name: '', departure_terminal: '', departure_gate: '',
  departure_at: '', departure_timezone: 'Africa/Nairobi', arrival_airport: '',
  arrival_airport_name: '', arrival_terminal: '', arrival_gate: '', arrival_at: '',
  arrival_timezone: 'Africa/Nairobi', booking_reference: '',
};
const EMPTY_ITEM: ItemDraft = {
  item_type: 'transfer', title: '', description: '', location_label: '',
  location_lat: '', location_lng: '', traveller_id: '',
  planned_start_at: '', planned_end_at: '', responsible_user_id: '', responsible_role: '',
  flight_segment_id: '',
};
const field = 'mt-1 w-full rounded-md border border-white/10 bg-[#080e15] px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-300/55 focus:outline-none';
const label = 'block min-w-0 text-[11px] font-medium text-slate-400';
const panel = 'rounded-md border border-white/[0.08] bg-[#0b131c]';
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40';
const buttonPrimary = 'sjm-travel-primary-action inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-sky-300/35 bg-sky-400/10 px-3 py-2.5 text-[12px] font-semibold text-sky-100 transition hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-40';
const input = (name: string, value: string, onChange: (value: string) => void, placeholder = '', type = 'text', disabled = false) =>
  <label className={label}>{name}<input type={type} step={type==='number'?'any':undefined} className={field} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} placeholder={placeholder}/></label>;
const countrySelect = (name: string, value: string, onChange: (value: string) => void) => {
  const flagUrl = countryFlagUrl(countryCodeFromName(value));
  return <label className={label}>{name}<span className="sjm-country-select mt-1 flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-[#080e15] px-2.5 focus-within:border-sky-300/55">{flagUrl ? <img src={flagUrl} alt="" aria-hidden="true" className="sjm-country-flag h-4 w-6 shrink-0" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/> : <span className="sjm-country-flag-placeholder h-4 w-6 shrink-0" aria-hidden="true"/>}<select className="min-w-0 flex-1 bg-transparent py-2.5 text-xs text-slate-100 outline-none" value={value} onChange={event=>onChange(event.target.value)}><option value="">Select country</option>{COUNTRIES.map(country=><option key={country.code} value={country.name}>{country.name}</option>)}</select></span></label>;
};
const displayTravellerName = (draft: TravellerDraft) => [draft.title,draft.given_name,draft.middle_name,draft.family_name].map(value=>value.trim()).filter(Boolean).join(' ');
const nextTravellerReference = (travellers: Traveller[]) => {
  const used = new Set(travellers.map(person=>person.traveller_reference.toUpperCase()));
  for (let index=1; index<10000; index+=1) {
    const candidate = 'TRV-'+String(index).padStart(3,'0');
    if (!used.has(candidate)) return candidate;
  }
  return 'TRV-'+Math.random().toString(36).slice(2,9).toUpperCase();
};
function AirlineMark({ code, workspaceBase }: { code: string | null; workspaceBase: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setImageUrl(null);
    if (!code) return () => { active = false; };
    api.get(workspaceBase + '/airline-logo/' + code, { responseType: 'blob' })
      .then(response => {
        const blob = response.data as Blob;
        if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) throw new Error('Airline mark is not configured.');
        objectUrl = URL.createObjectURL(blob);
        if (active) setImageUrl(objectUrl);
      })
      .catch(() => { if (active) setImageUrl(null); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [code, workspaceBase]);
  return <AirlineMark code={airlineIataCodeFromFlightNumber(flight.flight_number)} workspaceBase={base}/></div><div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><div><p className="font-mono text-lg font-semibold text-white">{flight.departure_airport}</p><p className="text-[10px] text-slate-500">{flight.departure_airport_name || 'Departure airport'}</p><p className="mt-2 text-[10px] text-slate-300">{dateLabel(flight.departure_at,flight.departure_timezone)}</p><p className="mt-1 text-[10px] text-slate-600">{[flight.departure_terminal,flight.departure_gate].filter(Boolean).join(' · ')}</p></div><Plane size={14} className="text-sky-200"/><div className="text-right"><p className="font-mono text-lg font-semibold text-white">{flight.arrival_airport}</p><p className="text-[10px] text-slate-500">{flight.arrival_airport_name || 'Arrival airport'}</p><p className="mt-2 text-[10px] text-slate-300">{dateLabel(flight.arrival_at,flight.arrival_timezone)}</p><p className="mt-1 text-[10px] text-slate-600">{[flight.arrival_terminal,flight.arrival_gate].filter(Boolean).join(' · ')}</p></div></div>{flight.status_note&&<p className="mt-2 border-t border-white/[0.05] pt-2 text-[10px] leading-4 text-slate-500">{flight.status_note}</p>}<div className="mt-3 flex flex-wrap items-center gap-2">{canManage && planEditable && !['boarding','departed','landed','cancelled','diverted'].includes(flight.status) && <button type="button" className={button} onClick={() => { setEditingFlightId(flight.id); setShowFlightForm(true); setFlightDraft({ traveller_id: flight.traveller_id || '', carrier: flight.carrier, flight_number: flight.flight_number, departure_airport: flight.departure_airport, departure_airport_name: flight.departure_airport_name || '', departure_terminal: flight.departure_terminal || '', departure_gate: flight.departure_gate || '', departure_at: localDateTimeInputInTimezone(flight.departure_at,flight.departure_timezone), departure_timezone: flight.departure_timezone, arrival_airport: flight.arrival_airport, arrival_airport_name: flight.arrival_airport_name || '', arrival_terminal: flight.arrival_terminal || '', arrival_gate: flight.arrival_gate || '', arrival_at: localDateTimeInputInTimezone(flight.arrival_at,flight.arrival_timezone), arrival_timezone: flight.arrival_timezone, booking_reference: flight.booking_reference || '' }); }}>Edit flight</button>}{canManage || !readOnly ? <div className="min-w-[210px] flex-1"><label className={label}>Observed flight status<select className={field} value={flightStatusSelections[flight.id] || flight.status} disabled={readOnly} onChange={event=>setFlightStatusSelections(current=>({...current,[flight.id]:event.target.value}))}>{flight.allowed_next_statuses.map(status=><option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label className={label + ' mt-2'}>Operator observation note<textarea className={field} rows={2} value={flightStatusNotes[flight.id] || ''} disabled={readOnly} onChange={event=>setFlightStatusNotes(current=>({...current,[flight.id]:event.target.value}))} placeholder="Source, time observed and context for this status."/></label><button type="button" className={button + ' mt-2'} onClick={()=>updateFlightStatus.mutate({id:flight.id,status:flightStatusSelections[flight.id] || flight.status,note:flightStatusNotes[flight.id] || ''})} disabled={readOnly || updateFlightStatus.isPending || (flightStatusNotes[flight.id] || '').trim().length<10}>Record status</button></div> : <span className="text-[10px] text-slate-500">Status: {statusLabel(flight.status)}</span>}{flight.booking_reference&&canManage&&<span className="self-end text-[10px] text-slate-500">Booking ref: {flight.booking_reference}</span>}</div></article>)}</div>}
        </div>
        {canManage && planEditable && showFlightForm && <form className="space-y-3 border-t border-white/[0.07] bg-black/10 p-4" onSubmit={event=>{event.preventDefault();createFlight.mutate();}}>
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Plane size={14} className="text-sky-200"/><p className="text-xs font-semibold text-slate-200">{editingFlightId ? 'Edit flight segment' : 'Add a flight leg'}</p></div>{editingFlightId && <button type="button" className={button} onClick={() => { setEditingFlightId(''); setShowFlightForm(false); setFlightDraft({ ...EMPTY_FLIGHT, departure_timezone: timezone, arrival_timezone: timezone }); }}>Cancel edit</button>}</div>
          <div className="grid grid-cols-2 gap-2"><label className={label}>Traveller<select className={field} value={flightDraft.traveller_id} onChange={event=>setFlightDraft({...flightDraft,traveller_id:event.target.value})}><option value="">Shared / all travellers</option>{travellers.map(traveller=><option key={traveller.id} value={traveller.id}>{traveller.display_name}</option>)}</select></label>{input('Airline / carrier *',flightDraft.carrier,value=>setFlightDraft({...flightDraft,carrier:value}))}</div>
          <div className="grid grid-cols-2 gap-2">{input('Flight number *',flightDraft.flight_number,value=>setFlightDraft({...flightDraft,flight_number:value}),'KQ 100')}{input('Booking reference',flightDraft.booking_reference,value=>setFlightDraft({...flightDraft,booking_reference:value}))}</div>{airlineIataCodeFromFlightNumber(flightDraft.flight_number) && <div className="sjm-airline-preview"><img src={'/api/v1'+base+'/airline-logo/'+airlineIataCodeFromFlightNumber(flightDraft.flight_number)} alt="" aria-hidden="true" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/><span>Carrier mark · IATA {airlineIataCodeFromFlightNumber(flightDraft.flight_number)}</span></div>}
          <div className="rounded border border-white/[0.06] p-3"><p className="text-[10px] font-semibold text-slate-400">DEPARTURE</p><div className="mt-2 grid grid-cols-2 gap-2">{input('Departure airport code *',flightDraft.departure_airport,value=>setFlightDraft({...flightDraft,departure_airport:value}),'NBO')}{input('Departure airport name',flightDraft.departure_airport_name,value=>setFlightDraft({...flightDraft,departure_airport_name:value}))}{input('Departure local time *',flightDraft.departure_at,value=>setFlightDraft({...flightDraft,departure_at:value}),'','datetime-local')}{input('Departure IANA time zone *',flightDraft.departure_timezone,value=>setFlightDraft({...flightDraft,departure_timezone:value}),'Africa/Nairobi')}{input('Departure terminal',flightDraft.departure_terminal,value=>setFlightDraft({...flightDraft,departure_terminal:value}))}{input('Departure gate',flightDraft.departure_gate,value=>setFlightDraft({...flightDraft,departure_gate:value}))}</div></div>
          <div className="rounded border border-white/[0.06] p-3"><p className="text-[10px] font-semibold text-slate-400">ARRIVAL</p><div className="mt-2 grid grid-cols-2 gap-2">{input('Arrival airport code *',flightDraft.arrival_airport,value=>setFlightDraft({...flightDraft,arrival_airport:value}),'CDG')}{input('Arrival airport name',flightDraft.arrival_airport_name,value=>setFlightDraft({...flightDraft,arrival_airport_name:value}))}{input('Arrival local time *',flightDraft.arrival_at,value=>setFlightDraft({...flightDraft,arrival_at:value}),'','datetime-local')}{input('Arrival IANA time zone *',flightDraft.arrival_timezone,value=>setFlightDraft({...flightDraft,arrival_timezone:value}),'Europe/Paris')}{input('Arrival terminal',flightDraft.arrival_terminal,value=>setFlightDraft({...flightDraft,arrival_terminal:value}))}{input('Arrival gate',flightDraft.arrival_gate,value=>setFlightDraft({...flightDraft,arrival_gate:value}))}</div></div>
          <button type="submit" className={buttonPrimary} disabled={createFlight.isPending || !flightDraft.carrier.trim() || !flightDraft.flight_number.trim() || !flightDraft.departure_airport.trim() || !flightDraft.arrival_airport.trim() || !flightDraft.departure_at || !flightDraft.arrival_at}><Plus size={12}/>{createFlight.isPending?'Saving…':'Add flight segment'}</button>
        </form>}
      </section>
    </div>

    <section className={panel + ' sjm-travel-section sjm-travel-section--programme overflow-hidden'}>
      <div className="sjm-travel-section__header flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] p-4"><div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">03 / DAY-BY-DAY DELIVERY</p><h4 className="mt-1 text-sm font-semibold text-white">Daily travel programme & execution</h4><p className="mt-1 text-[11px] text-slate-500">Date-by-date movement, ownership and accountable execution. Generate date containers from the journey schedule or add a day manually; activities remain operator-defined.</p></div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-slate-500">{days.length} programme day(s)</span>{canManage&&planEditable&&<><button type="button" className={button} onClick={()=>generateDays.mutate()} disabled={generateDays.isPending}><CalendarDays size={12}/>{generateDays.isPending?'Generating…':'Generate scheduled days'}</button><button type="button" className={buttonPrimary} onClick={()=>{setShowDayForm(value=>!value);setEditingDayId('');setDayTitle('Daily movement programme');setDayTimezone(timezone);}}><Plus size={12}/>Add programme day</button></>}</div></div>
      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          {days.length === 0 ? <p className="rounded border border-dashed border-white/10 p-3 text-[11px] leading-5 text-slate-500">No daily programme has been created for this journey.</p> : <div className="space-y-1">{days.map(day=><button key={day.id} type="button" aria-pressed={activeDay?.id===day.id} onClick={()=>setActiveDayId(day.id)} className={'sjm-travel-day w-full rounded-md border p-3 text-left transition '+((activeDay?.id===day.id)?'is-active':'')}><p className="text-[11px] font-semibold text-slate-100">{day.day_title}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{day.journey_date}</p><p className="mt-2 text-[10px] text-slate-500">{day.items.length} activity/activities · {day.items.filter(item=>item.execution_status==='completed').length} completed</p></button>)}</div>}
          {canManage && planEditable && showDayForm && <form className="space-y-2 rounded-md border border-white/[0.07] bg-black/15 p-3" onSubmit={event=>{event.preventDefault();if(editingDayId)updateDay.mutate();else createDay.mutate();}}><p className="text-[11px] font-semibold text-slate-200">{editingDayId ? 'Edit programme day' : 'Create programme day'}</p>{!editingDayId&&input('Programme date · local calendar',dayDate,setDayDate,'','date')}{input('Day title',dayTitle,setDayTitle,'Day 1 · Arrival & transfer')}{input('IANA timezone for activity times',dayTimezone,setDayTimezone,'Africa/Nairobi','text',Boolean(editingDayId && activeDay && activeDay.items.length>0))}<p className="text-[10px] leading-4 text-slate-500">Use the local zone for this day (for example, Europe/Paris). Once activities are added, the day’s time zone is locked to preserve their original meaning.</p><label className={label}>Day briefing<textarea className={field} rows={2} value={dayBriefing} onChange={event=>setDayBriefing(event.target.value)}/></label><label className={label}>Operational notes<textarea className={field} rows={2} value={dayNotes} onChange={event=>setDayNotes(event.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="submit" className={buttonPrimary} disabled={createDay.isPending || updateDay.isPending || (!editingDayId&&!dayDate) || !dayTitle.trim()}><Plus size={12}/>{editingDayId ? (updateDay.isPending?'Saving…':'Save day brief') : (createDay.isPending?'Creating…':'Add day')}</button>{editingDayId&&<button type="button" className={button} onClick={()=>{setEditingDayId('');setShowDayForm(false);setDayTitle('Daily movement programme');setDayBriefing('');setDayNotes('');setDayTimezone(timezone);}}>Cancel edit</button>}</div></form>}
        </div>
        <div className="min-w-0">
          {!activeDay ? <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-white/10 p-6 text-center"><CalendarDays size={22} className="text-slate-600"/><p className="mt-3 text-xs font-medium text-slate-300">Build the first day’s programme</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-slate-500">Add the relevant dates, then sequence flights, airport reception, meet-and-greet, transfers, security briefs, meetings, hotel movements and onward travel.</p></div> : <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-[10px] text-sky-200">{activeDay.journey_date} · {activeDay.timezone}</p><h5 className="mt-1 text-sm font-semibold text-white">{activeDay.day_title}</h5>{activeDay.briefing&&<p className="mt-1 max-w-3xl whitespace-pre-wrap text-[11px] leading-5 text-slate-400">{activeDay.briefing}</p>}{activeDay.operational_notes&&<p className="mt-1 text-[10px] leading-4 text-slate-500">{activeDay.operational_notes}</p>}</div><div className="flex items-center gap-2">{canManage&&planEditable&&!editingItemId&&<button type="button" className={buttonPrimary} onClick={()=>{setShowItemForm(value=>!value);setItemDraft({...EMPTY_ITEM});}}><Plus size={12}/>Add activity</button>}<span className="text-[10px] text-slate-500">{activeDay.items.filter(item=>item.execution_status==='completed').length}/{activeDay.items.length} completed</span>{canManage&&planEditable&&<button type="button" className={button} onClick={()=>{setEditingDayId(activeDay.id);setShowDayForm(true);setDayTitle(activeDay.day_title);setDayTimezone(activeDay.timezone);setDayBriefing(activeDay.briefing||'');setDayNotes(activeDay.operational_notes||'');}}>Edit day brief</button>}</div></div>
            {activeDay.items.length === 0 ? <p className="rounded border border-dashed border-white/10 p-4 text-[11px] text-slate-500">This day has no timed activities yet.</p> : <ol className="space-y-2">{activeDay.items.map((item,itemIndex)=><li key={item.id} className="sjm-travel-activity-card rounded-md border border-white/[0.07] bg-black/15 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="flex min-w-0 gap-3"><span className="font-mono text-[10px] text-slate-500">{String(itemIndex+1).padStart(2,'0')}</span><div className="min-w-0"><p className="text-xs font-semibold text-slate-100">{item.title}</p><p className="mt-1 text-[10px] text-slate-500">{statusLabel(item.item_type)} · {dateLabel(item.planned_start_at,activeDay.timezone)} – {dateLabel(item.planned_end_at,activeDay.timezone)}</p><p className="mt-1 text-[10px] text-slate-500">{item.location_label || 'Location not recorded'}{item.location_lat!=null&&item.location_lng!=null?' · '+Number(item.location_lat).toFixed(5)+', '+Number(item.location_lng).toFixed(5):''}{item.responsible_name ? ' · ' + item.responsible_name : item.responsible_role ? ' · ' + item.responsible_role : ''}</p>{item.traveller_display_name&&<p className="mt-1 text-[10px] text-sky-100/85">For traveller · {item.traveller_display_name}</p>}{(item.actual_start_at||item.actual_end_at)&&<p className="mt-2 text-[10px] text-emerald-100/80">Actual {item.actual_start_at?'started '+dateLabel(item.actual_start_at,activeDay.timezone):'start not recorded'}{item.actual_end_at?' · resolved '+dateLabel(item.actual_end_at,activeDay.timezone):''}</p>}{item.execution_note&&<p className="mt-2 whitespace-pre-wrap rounded border border-white/[0.05] bg-white/[0.02] px-2 py-1.5 text-[10px] leading-4 text-slate-300">Latest execution note: {item.execution_note}</p>}{item.description&&<p className="mt-2 whitespace-pre-wrap text-[10px] leading-4 text-slate-400">{item.description}</p>}</div></div><div className="flex items-center gap-2"><span className={'rounded border px-2 py-1 text-[9px] font-semibold '+(item.execution_status==='completed'?'border-emerald-300/20 text-emerald-100':item.execution_status==='exception'?'border-red-300/20 text-red-100':item.execution_status==='delayed'?'border-amber-300/20 text-amber-100':'border-white/10 text-slate-400')}>{statusLabel(item.execution_status)}</span><button type="button" className={button} onClick={()=>void openHistory(item)}>History</button></div></div>
              {!readOnly && executionAllowed && mayExecuteItem(item) && !['completed','skipped'].includes(item.execution_status) && <div className="mt-3 space-y-2 border-t border-white/[0.05] pt-3"><label className={label}>Execution note<textarea className={field} rows={2} value={executionNotes[item.id] || ''} onChange={event=>setExecutionNotes({...executionNotes,[item.id]:event.target.value})} placeholder="Record actual outcome, delay, deviation or handover."/></label><div className="flex flex-wrap gap-1.5">{item.execution_status==='planned'&&<button type="button" className={buttonPrimary} onClick={()=>executeItem.mutate({id:item.id,status:'in_progress'})} disabled={executeItem.isPending || (executionNotes[item.id] || '').trim().length < 10}><Clock3 size={11}/>Start</button>}{['delayed','exception'].includes(item.execution_status)&&<button type="button" className={buttonPrimary} onClick={()=>executeItem.mutate({id:item.id,status:'in_progress'})} disabled={executeItem.isPending || (executionNotes[item.id] || '').trim().length < 10}><RefreshCw size={11}/>Resume</button>}{['in_progress','delayed','exception'].includes(item.execution_status)&&<button type="button" className={buttonPrimary} onClick={()=>executeItem.mutate({id:item.id,status:'completed'})} disabled={executeItem.isPending || (executionNotes[item.id] || '').trim().length < 10}><CheckCircle2 size={11}/>Complete</button>}{['planned','in_progress'].includes(item.execution_status)&&<button type="button" className={button} onClick={()=>executeItem.mutate({id:item.id,status:'delayed'})} disabled={executeItem.isPending || (executionNotes[item.id] || '').trim().length < 10}>Delayed</button>}{['planned','in_progress','delayed'].includes(item.execution_status)&&<button type="button" className={button} onClick={()=>executeItem.mutate({id:item.id,status:'exception'})} disabled={executeItem.isPending || (executionNotes[item.id] || '').trim().length < 10}>Raise exception</button>}{['planned','delayed'].includes(item.execution_status)&&<button type="button" className={button} onClick={()=>executeItem.mutate({id:item.id,status:'skipped'})} disabled={executeItem.isPending || (executionNotes[item.id] || '').trim().length < 10}>Skip</button>}{canManage&&planEditable&&item.execution_status==='planned'&&<button type="button" className={button} onClick={()=>{setEditingItemId(item.id);setShowItemForm(true);setItemDraft({item_type:item.item_type,title:item.title,description:item.description||'',location_label:item.location_label||'',planned_start_at:localDateTimeInputInTimezone(item.planned_start_at,activeDay.timezone),planned_end_at:localDateTimeInputInTimezone(item.planned_end_at,activeDay.timezone),location_lat:item.location_lat==null?'':String(item.location_lat),location_lng:item.location_lng==null?'':String(item.location_lng),traveller_id:item.traveller_id||'',responsible_user_id:item.responsible_user_id||'',responsible_role:item.responsible_role||'',flight_segment_id:item.flight_segment_id||''});}}>Edit plan</button>}</div></div>}
              {historyItemId===item.id&&<div className="mt-3 rounded border border-white/[0.06] bg-black/25 p-3"><p className="text-[10px] font-semibold text-slate-300">Append-only execution history</p>{historyQuery.isLoading?<p className="mt-2 text-[10px] text-slate-500">Loading history…</p>:historyQuery.isError?<p className="mt-2 text-[10px] text-red-200">History is unavailable.</p>:<ol className="mt-2 space-y-2">{(historyQuery.data||[]).map(event=><li key={event.id} className="border-l border-white/10 pl-2"><p className="text-[10px] font-medium text-slate-300">{statusLabel(event.action)}{event.new_status?' · '+statusLabel(event.new_status):''}</p><p className="mt-1 text-[9px] text-slate-500">{dateLabel(event.observed_at,activeDay.timezone)} · {event.actor_name||'Team member'}</p>{event.detail?.note&&<p className="mt-1 text-[10px] text-slate-400">{event.detail.note}</p>}</li>)}</ol>}</div>}
            </li>)}</ol>}
            {canManage && planEditable && showItemForm && <form className="space-y-3 rounded-md border border-sky-300/20 bg-sky-300/[0.035] p-3" onSubmit={event=>{event.preventDefault();createItem.mutate();}}>
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Plus size={13} className="text-sky-200"/><p className="text-xs font-semibold text-slate-200">{editingItemId ? 'Edit timed programme activity' : 'Add timed programme activity'}</p></div>{editingItemId&&<button type="button" className={button} onClick={()=>{setEditingItemId('');setShowItemForm(false);setItemDraft({...EMPTY_ITEM});}}>Cancel edit</button>}</div>
              <div className="grid grid-cols-2 gap-2"><label className={label}>Activity type<select className={field} value={itemDraft.item_type} onChange={event=>setItemDraft({...itemDraft,item_type:event.target.value})}>{[['flight','Flight'],['airport_arrival','Airport arrival'],['meet_and_greet','Meet and greet'],['transfer','Ground transfer'],['vehicle_handover','Vehicle handover'],['meeting','Meeting'],['close_protection','Close protection'],['security_escort','Security escort'],['security_briefing','Security briefing'],['hotel','Hotel / accommodation'],['hotel_check_in','Hotel check-in'],['departure_check_in','Departure check-in'],['border_control','Border control'],['customs','Customs'],['airport_departure','Airport departure'],['checkpoint','Checkpoint'],['rest','Rest / standby'],['event','Event'],['other','Other']].map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>{input('Activity title *',itemDraft.title,value=>setItemDraft({...itemDraft,title:value}))}</div>
              <div className="grid grid-cols-2 gap-2">{input('Planned start · '+activeDay.timezone,itemDraft.planned_start_at,value=>setItemDraft({...itemDraft,planned_start_at:value}),'','datetime-local')}{input('Planned end · '+activeDay.timezone,itemDraft.planned_end_at,value=>setItemDraft({...itemDraft,planned_end_at:value}),'','datetime-local')}</div>
              <div className="grid grid-cols-2 gap-2">{input('Location / venue',itemDraft.location_label,value=>setItemDraft({...itemDraft,location_label:value}))}<label className={label}>Traveller<select className={field} value={itemDraft.traveller_id} onChange={event=>setItemDraft({...itemDraft,traveller_id:event.target.value})}><option value="">Shared / whole party</option>{travellers.map(person=><option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label>{input('Latitude',itemDraft.location_lat,value=>setItemDraft({...itemDraft,location_lat:value}),'Optional · -90 to 90','number')}{input('Longitude',itemDraft.location_lng,value=>setItemDraft({...itemDraft,location_lng:value}),'Optional · -180 to 180','number')}<label className={label}>Responsible team member<select className={field} value={itemDraft.responsible_user_id} onChange={event=>setItemDraft({...itemDraft,responsible_user_id:event.target.value})}><option value="">Unassigned</option>{team.map(person=><option key={person.user_id} value={person.user_id}>{person.user_name} · {statusLabel(person.duty_role)}{person.is_primary?' · Primary':''}</option>)}</select></label><label className={label}>Responsible role<select className={field} value={itemDraft.responsible_role} onChange={event=>setItemDraft({...itemDraft,responsible_role:event.target.value})}><option value="">Not assigned</option>{['driver','backup_driver','cpo','meet_greet','security_escort','dispatcher'].map(role=><option key={role} value={role}>{statusLabel(role)}</option>)}</select></label></div>
              <label className={label}>Activity instructions<textarea className={field} rows={2} value={itemDraft.description} onChange={event=>setItemDraft({...itemDraft,description:event.target.value})}/></label>
              <label className={label}>Related flight leg<select className={field} value={itemDraft.flight_segment_id} onChange={event=>setItemDraft({...itemDraft,flight_segment_id:event.target.value})}><option value="">No linked flight</option>{flights.map(flight=><option key={flight.id} value={flight.id}>{flight.carrier} {flight.flight_number} · {flight.departure_airport} to {flight.arrival_airport}</option>)}</select></label>
              <button type="submit" className={buttonPrimary} disabled={createItem.isPending || !itemDraft.title.trim() || !itemDraft.planned_start_at || !itemDraft.planned_end_at}><Plus size={12}/>{createItem.isPending?'Saving…':editingItemId?'Save activity changes':'Add activity to day'}</button>
            </form>}
          </div>}
        </div>
      </div>
    </section>

    <div className="sjm-travel-summary grid grid-cols-1 gap-2 md:grid-cols-3"><div className="sjm-travel-summary-card rounded border border-white/[0.06] bg-black/10 p-3"><p className="text-[10px] text-slate-500">Traveller records</p><p className="mt-1 text-sm font-semibold text-white">{travellers.length}</p><p className="mt-1 text-[10px] text-slate-600">Distinct from duty staff roster</p></div><div className="sjm-travel-summary-card rounded border border-white/[0.06] bg-black/10 p-3"><p className="text-[10px] text-slate-500">Flight segments</p><p className="mt-1 text-sm font-semibold text-white">{flights.length}</p><p className="mt-1 text-[10px] text-slate-600">Each leg retains local airport time zones</p></div><div className="sjm-travel-summary-card rounded border border-white/[0.06] bg-black/10 p-3"><p className="text-[10px] text-slate-500">Daily activities</p><p className="mt-1 text-sm font-semibold text-white">{days.reduce((total, day) => total + day.items.length, 0)}</p><p className="mt-1 text-[10px] text-slate-600">Execution states have timestamped history</p></div></div>
    <footer className="flex flex-wrap items-start gap-2 border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-slate-500"><ShieldCheck size={13} className="shrink-0 text-sky-200/85"/><span>Personal traveller data and identity documents are restricted to mobility managers. Field teams receive only operational traveller names and movement details. Flight status and activity execution are operator-entered unless separately marked with a trusted provider source; neither is presented as GPS proof.</span></footer>
  </section>;
}
