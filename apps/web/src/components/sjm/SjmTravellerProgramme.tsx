import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { localDateTimeInputInTimezone } from '../../lib/sjmJourneyTime.js';
import { AlertCircle, CalendarDays, Check, CheckCircle2, Clock3, Download, FileText, Plane, Plus, RefreshCw, ShieldCheck, Upload, Users } from 'lucide-react';

type Traveller = {
  id: string; traveller_reference: string; traveller_type: string; display_name: string;
  title?: string | null; given_name?: string; middle_name?: string | null; family_name?: string;
  preferred_name?: string | null; nationality?: string | null; date_of_birth?: string | null;
  email?: string | null; phone?: string | null; emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null; internal_notes?: string | null;
};
type TravelDocument = {
  id: string; traveller_id: string; document_type: string; holder_name: string;
  issuing_country?: string | null; issue_date?: string | null; expiry_date?: string | null;
  review_status: string; review_note?: string | null; evidence_id: string;
  file_name: string; mime_type: string; size_bytes: number; sha256?: string | null;
};
type Flight = {
  id: string; sequence: number; traveller_id?: string | null; carrier: string; flight_number: string;
  departure_airport: string; departure_airport_name?: string | null; departure_terminal?: string | null;
  departure_gate?: string | null; departure_at: string; departure_timezone: string;
  arrival_airport: string; arrival_airport_name?: string | null; arrival_terminal?: string | null;
  arrival_gate?: string | null; arrival_at: string; arrival_timezone: string;
  booking_reference?: string | null; status: string; status_source: string; status_note?: string | null;
};
type Item = {
  id: string; sequence: number; item_type: string; title: string; description?: string | null;
  location_label?: string | null; planned_start_at: string; planned_end_at: string;
  responsible_name?: string | null; responsible_role?: string | null;
  execution_status: string; actual_start_at?: string | null; actual_end_at?: string | null;
  execution_note?: string | null; flight_segment_id?: string | null;
};
type Day = {
  id: string; journey_date: string; timezone: string; day_title: string;
  briefing?: string | null; operational_notes?: string | null; items: Item[];
};
type Workspace = {
  travellers: Traveller[]; documents: TravelDocument[]; flights: Flight[]; days: Day[];
  access?: { manager: boolean; duty_roles: string[] };
  provenance?: Record<string, string>;
};
type Props = { journeyId: string; timezone: string; canManage: boolean; readOnly: boolean };
type TravellerDraft = {
  traveller_reference: string; traveller_type: string; title: string; given_name: string;
  middle_name: string; family_name: string; preferred_name: string; nationality: string;
  date_of_birth: string; email: string; phone: string; emergency_contact_name: string;
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
  planned_start_at: string; planned_end_at: string; responsible_role: string;
  flight_segment_id: string;
};
const EMPTY_TRAVELLER: TravellerDraft = {
  traveller_reference: '', traveller_type: 'principal', title: '', given_name: '',
  middle_name: '', family_name: '', preferred_name: '', nationality: '',
  date_of_birth: '', email: '', phone: '', emergency_contact_name: '',
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
  planned_start_at: '', planned_end_at: '', responsible_role: '',
  flight_segment_id: '',
};
const field = 'mt-1 w-full rounded-md border border-white/10 bg-[#080e15] px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-300/40 focus:outline-none';
const label = 'block min-w-0 text-[11px] font-medium text-slate-400';
const panel = 'rounded-md border border-white/[0.08] bg-[#0b131c]';
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40';
const buttonGreen = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-40';
const input = (name: string, value: string, onChange: (value: string) => void, placeholder = '', type = 'text') =>
  <label className={label}>{name}<input type={type} className={field} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}/></label>;
const dateLabel = (value?: string | null, timezone?: string) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], { timeZone: timezone || undefined, dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
};
const dateOnlyLocal = (timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (name: string) => parts.find(part => part.type === name)?.value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
};
const sizeLabel = (value: number) => value < 1024 * 1024 ? Math.max(1, Math.round(value / 1024)) + ' KB' : (value / 1024 / 1024).toFixed(1) + ' MB';
function localDateTimeToIso(value: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let candidate = target;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const get = (name: string) => Number(parts.find(part => part.type === name)?.value);
    const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const difference = target - represented;
    if (difference === 0) break;
    candidate += difference;
  }
  const verified = formatter.formatToParts(new Date(candidate));
  const get = (name: string) => verified.find(part => part.type === name)?.value;
  if (get('year') !== year || get('month') !== month || get('day') !== day || get('hour') !== hour || get('minute') !== minute) return null;
  return new Date(candidate).toISOString();
}
function errorMessage(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return candidate?.response?.data?.message || candidate?.response?.data?.error || candidate?.message || fallback;
}
function statusLabel(value: string) { return value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase()); }

export default function SjmTravellerProgramme({ journeyId, timezone, canManage, readOnly }: Props) {
  const queryClient = useQueryClient();
  const base = '/sjm/journeys/' + journeyId + '/travel-workspace';
  const evidenceBase = '/sjm/journeys/' + journeyId + '/evidence';
  const query = useQuery<Workspace>({
    queryKey: ['sjm-travel-workspace', journeyId],
    queryFn: async () => (await api.get(base)).data.data as Workspace,
    enabled: Boolean(journeyId),
    staleTime: 15000,
  });
  const data = query.data;
  const travellers = data?.travellers || [];
  const documents = data?.documents || [];
  const flights = data?.flights || [];
  const days = data?.days || [];
  const [travellerDraft, setTravellerDraft] = useState<TravellerDraft>({ ...EMPTY_TRAVELLER });
  const [editingTravellerId, setEditingTravellerId] = useState('');
  const [flightDraft, setFlightDraft] = useState<FlightDraft>({ ...EMPTY_FLIGHT, departure_timezone: timezone, arrival_timezone: timezone });
  const [editingFlightId, setEditingFlightId] = useState('');
  const [dayDate, setDayDate] = useState(dateOnlyLocal(timezone));
  const [dayTitle, setDayTitle] = useState('Daily movement programme');
  const [dayBriefing, setDayBriefing] = useState('');
  const [dayNotes, setDayNotes] = useState('');
  const [activeDayId, setActiveDayId] = useState('');
  const [itemDraft, setItemDraft] = useState<ItemDraft>({ ...EMPTY_ITEM });
  const [executionNotes, setExecutionNotes] = useState<Record<string, string>>({});
  const [documentTravellerId, setDocumentTravellerId] = useState('');
  const [documentType, setDocumentType] = useState('passport');
  const [documentHolder, setDocumentHolder] = useState('');
  const [documentCountry, setDocumentCountry] = useState('');
  const [documentIssueDate, setDocumentIssueDate] = useState('');
  const [documentExpiryDate, setDocumentExpiryDate] = useState('');
  const [historyItemId, setHistoryItemId] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const activeDay = days.find(day => day.id === activeDayId) || days[0] || null;
  const docsByTraveller = useMemo(() => {
    const result = new Map<string, TravelDocument[]>();
    for (const document of documents) {
      const current = result.get(document.traveller_id) || [];
      current.push(document);
      result.set(document.traveller_id, current);
    }
    return result;
  }, [documents]);
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['sjm-travel-workspace', journeyId] });
  const createTraveller = useMutation({
    mutationFn: async () => (await api.post(base + '/travellers', travellerDraft)).data.data,
    onSuccess: async () => {
      setTravellerDraft({ ...EMPTY_TRAVELLER });
      setNotice({ kind: 'success', text: 'Traveller profile registered to this journey.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Traveller registration failed.') }),
  });
  const updateTraveller = useMutation({
    mutationFn: async () => (await api.patch(base + '/travellers/' + editingTravellerId, travellerDraft)).data.data,
    onSuccess: async () => {
      setEditingTravellerId('');
      setTravellerDraft({ ...EMPTY_TRAVELLER });
      setNotice({ kind: 'success', text: 'Traveller profile updated.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Traveller profile could not be updated.') }),
  });
  const createFlight = useMutation({
    mutationFn: async () => {
      const departure = localDateTimeToIso(flightDraft.departure_at, flightDraft.departure_timezone);
      const arrival = localDateTimeToIso(flightDraft.arrival_at, flightDraft.arrival_timezone);
      if (!departure || !arrival) throw new Error('Enter valid local departure and arrival times for the selected airport time zones.');
      const payload = {
        ...flightDraft, departure_airport: flightDraft.departure_airport.toUpperCase(),
        arrival_airport: flightDraft.arrival_airport.toUpperCase(),
        departure_at: departure, arrival_at: arrival,
        traveller_id: flightDraft.traveller_id || null,
      };
      return (editingFlightId ? await api.patch(base + '/flights/' + editingFlightId, payload) : await api.post(base + '/flights', payload)).data.data;
    },
    onSuccess: async () => {
      setEditingFlightId('');
      setFlightDraft({ ...EMPTY_FLIGHT, departure_timezone: timezone, arrival_timezone: timezone });
      setNotice({ kind: 'success', text: 'Flight segment saved to the journey.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Flight segment could not be saved.') }),
  });
  const createDay = useMutation({
    mutationFn: async () => (await api.post(base + '/days', {
      journey_date: dayDate, day_title: dayTitle, briefing: dayBriefing, operational_notes: dayNotes,
    })).data.data,
    onSuccess: async result => {
      setActiveDayId(result.id);
      setDayBriefing('');
      setDayNotes('');
      setNotice({ kind: 'success', text: 'Programme day created.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Programme day could not be created.') }),
  });
  const createItem = useMutation({
    mutationFn: async () => {
      if (!activeDay) throw new Error('Create or select a programme day first.');
      const start = localDateTimeToIso(itemDraft.planned_start_at, activeDay.timezone);
      const end = localDateTimeToIso(itemDraft.planned_end_at, activeDay.timezone);
      if (!start || !end) throw new Error('Enter valid activity start and end times in the programme timezone.');
      return (await api.post(base + '/days/' + activeDay.id + '/items', {
        ...itemDraft, planned_start_at: start, planned_end_at: end,
        flight_segment_id: itemDraft.flight_segment_id || null,
      })).data.data;
    },
    onSuccess: async () => {
      setItemDraft({ ...EMPTY_ITEM });
      setNotice({ kind: 'success', text: 'Timed activity added to the daily programme.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Programme activity could not be saved.') }),
  });
  const executeItem = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => (await api.patch(base + '/items/' + id + '/execution', {
      execution_status: status, execution_note: executionNotes[id] || '',
    })).data.data,
    onSuccess: async () => {
      setNotice({ kind: 'success', text: 'Execution update recorded in the activity history.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Execution update was not accepted.') }),
  });
  const updateFlightStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const note = window.prompt('Record the source and context for this operator-entered flight status.');
      if (!note?.trim()) throw new Error('A status note is required; no flight update was saved.');
      return (await api.patch(base + '/flights/' + id + '/status', { status, note })).data.data;
    },
    onSuccess: async () => { setNotice({ kind: 'success', text: 'Operator-supplied flight status recorded.' }); await refresh(); },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Flight status was not updated.') }),
  });
  const reviewDocument = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'VERIFIED' | 'REJECTED' }) => {
      const note = window.prompt('Record the document review rationale (minimum 10 characters).');
      if (!note?.trim() || note.trim().length < 10) throw new Error('A meaningful review note is required.');
      return (await api.patch(base + '/documents/' + id + '/review', { review_status: status, review_note: note.trim() })).data.data;
    },
    onSuccess: async () => { setNotice({ kind: 'success', text: 'Travel document review decision recorded.' }); await refresh(); },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Document review was not saved.') }),
  });

  const uploadDocument = async (traveller: Traveller, file?: File) => {
    if (!file || !canManage || readOnly) return;
    setNotice(null);
    try {
      const response = await api.post(base + '/travellers/' + traveller.id + '/documents/upload-url', {
        document_type: documentType, holder_name: documentHolder.trim() || traveller.display_name,
        issuing_country: documentCountry || null, issue_date: documentIssueDate || null,
        expiry_date: documentExpiryDate || null, file_name: file.name, mime_type: file.type.toLowerCase(),
        size_bytes: file.size,
      });
      const signed = response.data?.data;
      if (!signed?.evidence_id || !signed?.upload_url || !signed?.required_headers) throw new Error('Private SJM storage did not return a valid upload capability.');
      const uploaded = await fetch(signed.upload_url, {
        method: 'PUT', headers: signed.required_headers, body: file, credentials: 'omit', cache: 'no-store',
      });
      if (!uploaded.ok) throw new Error('Private document storage rejected the upload (HTTP ' + uploaded.status + ').');
      const committed = await api.post(evidenceBase + '/' + signed.evidence_id + '/commit');
      if (committed.data?.data?.status !== 'VERIFIED') throw new Error('Sonalit did not confirm private document integrity verification.');
      setDocumentTravellerId('');
      setDocumentHolder('');
      setDocumentCountry('');
      setDocumentIssueDate('');
      setDocumentExpiryDate('');
      setNotice({ kind: 'success', text: 'Document stored privately and integrity-checked. It is now awaiting an authorised review.' });
      await refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'Travel document upload failed.') });
    }
  };
  const downloadDocument = async (document: TravelDocument) => {
    try {
      const response = await api.post(evidenceBase + '/' + document.evidence_id + '/download-url');
      const url = response.data?.data?.download_url;
      if (!url) throw new Error('Sonalit did not return a private download URL.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'The private document could not be opened.') });
    }
  };
  const openHistory = async (item: Item) => {
    setHistoryItemId(current => current === item.id ? '' : item.id);
  };
  const historyQuery = useQuery<Array<{ id: string; actor_name?: string | null; action: string; previous_status?: string | null; new_status?: string | null; detail?: { note?: string }; observed_at: string }>>({
    queryKey: ['sjm-itinerary-item-history', journeyId, historyItemId],
    queryFn: async () => (await api.get(base + '/items/' + historyItemId + '/history')).data.data,
    enabled: Boolean(historyItemId),
  });

  if (query.isLoading) return <section className={panel + ' p-6'}><RefreshCw size={16} className="animate-spin text-slate-400"/><p className="mt-3 text-xs text-slate-500">Loading traveller register and travel programme…</p></section>;
  if (query.isError) return <section className={panel + ' p-5'} role="alert"><AlertCircle size={17} className="text-amber-200"/><h3 className="mt-2 text-sm font-semibold text-white">Travel workspace unavailable</h3><p className="mt-2 text-xs leading-5 text-slate-400">{errorMessage(query.error, 'The travel register could not be loaded.')}</p><button className={button + ' mt-3'} onClick={() => void query.refetch()}><RefreshCw size={12}/>Retry</button></section>;

  return <section className="space-y-4" data-testid="sjm-travel-workspace">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] pb-4">
      <div><p className="font-mono text-[10px] font-semibold tracking-[.16em] text-emerald-200">TRAVELLER & MOVEMENT DOSSIER</p><h3 className="mt-1 text-base font-semibold text-white">Travel & programme</h3><p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-400">One operational record for each traveller, every flight leg, and each dated day of movement. Assigned staff remain separate from traveller identities.</p></div>
      <button className={button} onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={12} className={query.isFetching ? 'animate-spin' : ''}/>Refresh dossier</button>
    </header>

    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={'rounded-md border px-3 py-2.5 text-[11px] leading-5 ' + (notice.kind === 'error' ? 'border-red-300/20 bg-red-400/[0.04] text-red-100' : notice.kind === 'success' ? 'border-emerald-300/20 bg-emerald-300/[0.04] text-emerald-100' : 'border-white/10 text-slate-300')}>{notice.text}</div>}

    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className={panel + ' overflow-hidden'}>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] p-4"><div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">01 / PEOPLE TRAVELLING</p><h4 className="mt-1 text-sm font-semibold text-white">Traveller register</h4></div><span className="font-mono text-[10px] text-slate-500">{travellers.length} registered</span></div>
        <div className="space-y-3 p-4">
          {travellers.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-[11px] leading-5 text-slate-500">No traveller profiles are registered against this journey. Add the principal traveller and each accompanying person separately.</p> :
            <div className="space-y-2">{travellers.map(traveller => <article key={traveller.id} className="rounded-md border border-white/[0.07] bg-black/15 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-slate-100">{traveller.display_name}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{traveller.traveller_reference} · {statusLabel(traveller.traveller_type)}</p></div><span className="rounded border border-white/[0.08] px-2 py-1 text-[9px] font-semibold tracking-wide text-slate-400">{traveller.nationality || 'Nationality not recorded'}</span></div>
              {canManage && <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.05] pt-3 text-[10px]"><div><dt className="text-slate-600">Date of birth</dt><dd className="mt-1 text-slate-300">{traveller.date_of_birth || 'Not recorded'}</dd></div><div><dt className="text-slate-600">Contact</dt><dd className="mt-1 break-all text-slate-300">{traveller.email || traveller.phone || 'Not recorded'}</dd></div><div><dt className="text-slate-600">Emergency contact</dt><dd className="mt-1 text-slate-300">{traveller.emergency_contact_name || 'Not recorded'}</dd></div><div><dt className="text-slate-600">Emergency number</dt><dd className="mt-1 text-slate-300">{traveller.emergency_contact_phone || 'Not recorded'}</dd></div></dl>}
              {canManage && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3"><span className="text-[10px] text-slate-500">{(docsByTraveller.get(traveller.id) || []).length} travel document(s)</span><button type="button" className={button} onClick={() => { setEditingTravellerId(traveller.id); setTravellerDraft({ traveller_reference: traveller.traveller_reference, traveller_type: traveller.traveller_type, title: traveller.title || '', given_name: traveller.given_name || '', middle_name: traveller.middle_name || '', family_name: traveller.family_name || '', preferred_name: traveller.preferred_name || '', nationality: traveller.nationality || '', date_of_birth: traveller.date_of_birth ? String(traveller.date_of_birth).slice(0,10) : '', email: traveller.email || '', phone: traveller.phone || '', emergency_contact_name: traveller.emergency_contact_name || '', emergency_contact_phone: traveller.emergency_contact_phone || '', internal_notes: traveller.internal_notes || '' }); }} disabled={readOnly}><Users size={11}/>Edit profile</button><button type="button" className={button} onClick={() => { setDocumentTravellerId(documentTravellerId === traveller.id ? '' : traveller.id); setDocumentHolder(traveller.display_name); }} disabled={readOnly}><Upload size={11}/>Attach document</button></div>}
              {canManage && documentTravellerId === traveller.id && <div className="mt-3 space-y-2 rounded-md border border-emerald-300/15 bg-emerald-300/[0.025] p-3">
                <p className="text-[10px] font-semibold tracking-wide text-emerald-100">PRIVATE TRAVEL DOCUMENT</p>
                <div className="grid grid-cols-2 gap-2"><label className={label}>Document type<select className={field} value={documentType} onChange={event => setDocumentType(event.target.value)}>{[['passport','Passport'],['visa','Visa'],['e_ticket','E-ticket'],['booking_confirmation','Booking confirmation'],['travel_insurance','Travel insurance'],['invitation_letter','Invitation letter'],['residence_permit','Residence permit'],['other','Other']].map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></label>{input('Holder name', documentHolder, setDocumentHolder)}</div>
                <div className="grid grid-cols-2 gap-2">{input('Issuing country',documentCountry,setDocumentCountry)}{input('Issue date',documentIssueDate,setDocumentIssueDate,'','date')}{input('Expiry date',documentExpiryDate,setDocumentExpiryDate,'','date')}</div>
                <label className={label}>PDF or image file<input className={field} type="file" accept="application/pdf,image/jpeg,image/png" disabled={readOnly} onChange={event => { const file = event.target.files?.[0]; void uploadDocument(traveller, file); event.currentTarget.value = ''; }}/></label>
                <p className="text-[10px] leading-4 text-slate-500">Uploads use a dedicated private SJM storage bucket, short-lived upload capability and server-side integrity verification. No public/shared media bucket fallback is allowed.</p>
              </div>}
              {canManage && (docsByTraveller.get(traveller.id) || []).length > 0 && <div className="mt-3 space-y-2">{(docsByTraveller.get(traveller.id) || []).map(document => <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/[0.06] bg-black/20 p-2.5"><div className="min-w-0"><p className="text-[11px] font-medium text-slate-200">{statusLabel(document.document_type)} · {document.file_name}</p><p className="mt-1 text-[10px] text-slate-500">{document.review_status.replaceAll('_',' ')} · expires {document.expiry_date || 'not recorded'} · {sizeLabel(document.size_bytes)}</p></div><div className="flex flex-wrap gap-1.5"><button type="button" className={button} onClick={() => void downloadDocument(document)} disabled={document.review_status === 'UPLOAD_PENDING'}><Download size={11}/>Open</button>{document.review_status === 'PENDING_REVIEW' && <><button type="button" className={buttonGreen} onClick={() => reviewDocument.mutate({ id: document.id, status: 'VERIFIED' })} disabled={reviewDocument.isPending}><Check size={11}/>Verify</button><button type="button" className={button} onClick={() => reviewDocument.mutate({ id: document.id, status: 'REJECTED' })} disabled={reviewDocument.isPending}>Reject</button></>}</div></div>)}</div>}
            </article>)}</div>}
        </div>
        {canManage && !readOnly && <form className="space-y-3 border-t border-white/[0.07] bg-black/10 p-4" onSubmit={event => { event.preventDefault(); if (editingTravellerId) updateTraveller.mutate(); else createTraveller.mutate(); }}>
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Users size={14} className="text-emerald-200"/><p className="text-xs font-semibold text-slate-200">{editingTravellerId ? 'Edit traveller profile' : 'Register a traveller'}</p></div>{editingTravellerId && <button type="button" className={button} onClick={() => { setEditingTravellerId(''); setTravellerDraft({ ...EMPTY_TRAVELLER }); }}>Cancel edit</button>}</div>
          <div className="grid grid-cols-2 gap-2">{input('Traveller reference *',travellerDraft.traveller_reference,value => setTravellerDraft({...travellerDraft,traveller_reference:value}),'TRV-001')}<label className={label}>Traveller role<select className={field} value={travellerDraft.traveller_type} onChange={event => setTravellerDraft({...travellerDraft,traveller_type:event.target.value})}>{[['principal','Principal traveller'],['accompanying','Accompanying traveller'],['assistant','Personal assistant'],['dependent','Dependent'],['other','Other']].map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label></div>
          <div className="grid grid-cols-3 gap-2">{input('Title',travellerDraft.title,value=>setTravellerDraft({...travellerDraft,title:value}),'Mr / Ms / Dr')}{input('Given name *',travellerDraft.given_name,value=>setTravellerDraft({...travellerDraft,given_name:value}))}{input('Family name *',travellerDraft.family_name,value=>setTravellerDraft({...travellerDraft,family_name:value}))}</div>
          <div className="grid grid-cols-2 gap-2">{input('Middle name',travellerDraft.middle_name,value=>setTravellerDraft({...travellerDraft,middle_name:value}))}{input('Preferred name',travellerDraft.preferred_name,value=>setTravellerDraft({...travellerDraft,preferred_name:value}))}</div>
          <div className="grid grid-cols-2 gap-2">{input('Nationality',travellerDraft.nationality,value=>setTravellerDraft({...travellerDraft,nationality:value}))}{input('Date of birth',travellerDraft.date_of_birth,value=>setTravellerDraft({...travellerDraft,date_of_birth:value}),'','date')}</div>
          <div className="grid grid-cols-2 gap-2">{input('Email',travellerDraft.email,value=>setTravellerDraft({...travellerDraft,email:value}),'name@example.com','email')}{input('Phone',travellerDraft.phone,value=>setTravellerDraft({...travellerDraft,phone:value}),'International format','tel')}</div>
          <div className="grid grid-cols-2 gap-2">{input('Emergency contact',travellerDraft.emergency_contact_name,value=>setTravellerDraft({...travellerDraft,emergency_contact_name:value}))}{input('Emergency phone',travellerDraft.emergency_contact_phone,value=>setTravellerDraft({...travellerDraft,emergency_contact_phone:value}))}</div>
          <label className={label}>Restricted internal notes<textarea className={field} rows={2} maxLength={1200} value={travellerDraft.internal_notes} onChange={event=>setTravellerDraft({...travellerDraft,internal_notes:event.target.value})}/></label>
          <button type="submit" className={buttonGreen} disabled={createTraveller.isPending || updateTraveller.isPending || !travellerDraft.traveller_reference.trim() || !travellerDraft.given_name.trim() || !travellerDraft.family_name.trim()}><Plus size={12}/>{editingTravellerId ? (updateTraveller.isPending ? 'Saving…' : 'Save traveller changes') : (createTraveller.isPending ? 'Registering…' : 'Register traveller')}</button>
        </form>}
      </section>

      <section className={panel + ' overflow-hidden'}>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] p-4"><div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">02 / AIR MOVEMENTS</p><h4 className="mt-1 text-sm font-semibold text-white">Flight segments</h4></div><span className="font-mono text-[10px] text-slate-500">{flights.length} leg(s)</span></div>
        <div className="space-y-3 p-4">
          {flights.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-[11px] leading-5 text-slate-500">No flight legs have been registered. Record every connection separately; the aircraft surveillance feed is not a substitute for a confirmed booking or itinerary.</p> :
            <div className="space-y-2">{flights.map(flight => <article key={flight.id} className="rounded-md border border-white/[0.07] bg-black/15 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-white">{flight.carrier} · {flight.flight_number}</p><p className="mt-1 font-mono text-[10px] text-slate-500">LEG {String(flight.sequence).padStart(2,'0')} · {flight.status.toUpperCase()} · {flight.status_source.replaceAll('_',' ')}</p></div><Plane size={14} className="text-slate-500"/></div><div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><div><p className="font-mono text-lg font-semibold text-white">{flight.departure_airport}</p><p className="text-[10px] text-slate-500">{flight.departure_airport_name || 'Departure airport'}</p><p className="mt-2 text-[10px] text-slate-300">{dateLabel(flight.departure_at,flight.departure_timezone)}</p><p className="mt-1 text-[10px] text-slate-600">{[flight.departure_terminal,flight.departure_gate].filter(Boolean).join(' · ')}</p></div><Plane size={14} className="text-emerald-200"/><div className="text-right"><p className="font-mono text-lg font-semibold text-white">{flight.arrival_airport}</p><p className="text-[10px] text-slate-500">{flight.arrival_airport_name || 'Arrival airport'}</p><p className="mt-2 text-[10px] text-slate-300">{dateLabel(flight.arrival_at,flight.arrival_timezone)}</p><p className="mt-1 text-[10px] text-slate-600">{[flight.arrival_terminal,flight.arrival_gate].filter(Boolean).join(' · ')}</p></div></div>{flight.status_note&&<p className="mt-2 border-t border-white/[0.05] pt-2 text-[10px] leading-4 text-slate-500">{flight.status_note}</p>}<div className="mt-3 flex flex-wrap items-center gap-2">{canManage && !readOnly && <button type="button" className={button} onClick={() => { setEditingFlightId(flight.id); setFlightDraft({ traveller_id: flight.traveller_id || '', carrier: flight.carrier, flight_number: flight.flight_number, departure_airport: flight.departure_airport, departure_airport_name: flight.departure_airport_name || '', departure_terminal: flight.departure_terminal || '', departure_gate: flight.departure_gate || '', departure_at: localDateTimeInputInTimezone(flight.departure_at,flight.departure_timezone), departure_timezone: flight.departure_timezone, arrival_airport: flight.arrival_airport, arrival_airport_name: flight.arrival_airport_name || '', arrival_terminal: flight.arrival_terminal || '', arrival_gate: flight.arrival_gate || '', arrival_at: localDateTimeInputInTimezone(flight.arrival_at,flight.arrival_timezone), arrival_timezone: flight.arrival_timezone, booking_reference: flight.booking_reference || '' }); }}>Edit flight</button>}<label className={label + ' max-w-[190px]'}>Operational status<select className={field} value={flight.status} disabled={readOnly} onChange={event=>updateFlightStatus.mutate({id:flight.id,status:event.target.value})}>{['scheduled','boarding','departed','delayed','landed','cancelled','diverted','unknown'].map(status=><option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>{flight.booking_reference&&canManage&&<span className="self-end text-[10px] text-slate-500">Booking ref: {flight.booking_reference}</span>}</div></article>)}</div>}
        </div>
        {canManage && !readOnly && <form className="space-y-3 border-t border-white/[0.07] bg-black/10 p-4" onSubmit={event=>{event.preventDefault();createFlight.mutate();}}>
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Plane size={14} className="text-emerald-200"/><p className="text-xs font-semibold text-slate-200">{editingFlightId ? 'Edit flight segment' : 'Add a flight leg'}</p></div>{editingFlightId && <button type="button" className={button} onClick={() => { setEditingFlightId(''); setFlightDraft({ ...EMPTY_FLIGHT, departure_timezone: timezone, arrival_timezone: timezone }); }}>Cancel edit</button>}</div>
          <div className="grid grid-cols-2 gap-2"><label className={label}>Traveller<select className={field} value={flightDraft.traveller_id} onChange={event=>setFlightDraft({...flightDraft,traveller_id:event.target.value})}><option value="">Shared / all travellers</option>{travellers.map(traveller=><option key={traveller.id} value={traveller.id}>{traveller.display_name}</option>)}</select></label>{input('Airline / carrier *',flightDraft.carrier,value=>setFlightDraft({...flightDraft,carrier:value}))}</div>
          <div className="grid grid-cols-2 gap-2">{input('Flight number *',flightDraft.flight_number,value=>setFlightDraft({...flightDraft,flight_number:value}),'KQ 100')}{input('Booking reference',flightDraft.booking_reference,value=>setFlightDraft({...flightDraft,booking_reference:value}))}</div>
          <div className="rounded border border-white/[0.06] p-3"><p className="text-[10px] font-semibold text-slate-400">DEPARTURE</p><div className="mt-2 grid grid-cols-2 gap-2">{input('Airport code *',flightDraft.departure_airport,value=>setFlightDraft({...flightDraft,departure_airport:value}),'NBO')}{input('Airport name',flightDraft.departure_airport_name,value=>setFlightDraft({...flightDraft,departure_airport_name:value}))}{input('Departure local time *',flightDraft.departure_at,value=>setFlightDraft({...flightDraft,departure_at:value}),'','datetime-local')}{input('IANA time zone *',flightDraft.departure_timezone,value=>setFlightDraft({...flightDraft,departure_timezone:value}),'Africa/Nairobi')}{input('Terminal',flightDraft.departure_terminal,value=>setFlightDraft({...flightDraft,departure_terminal:value}))}{input('Gate',flightDraft.departure_gate,value=>setFlightDraft({...flightDraft,departure_gate:value}))}</div></div>
          <div className="rounded border border-white/[0.06] p-3"><p className="text-[10px] font-semibold text-slate-400">ARRIVAL</p><div className="mt-2 grid grid-cols-2 gap-2">{input('Airport code *',flightDraft.arrival_airport,value=>setFlightDraft({...flightDraft,arrival_airport:value}),'CDG')}{input('Airport name',flightDraft.arrival_airport_name,value=>setFlightDraft({...flightDraft,arrival_airport_name:value}))}{input('Arrival local time *',flightDraft.arrival_at,value=>setFlightDraft({...flightDraft,arrival_at:value}),'','datetime-local')}{input('IANA time zone *',flightDraft.arrival_timezone,value=>setFlightDraft({...flightDraft,arrival_timezone:value}),'Europe/Paris')}{input('Terminal',flightDraft.arrival_terminal,value=>setFlightDraft({...flightDraft,arrival_terminal:value}))}{input('Gate',flightDraft.arrival_gate,value=>setFlightDraft({...flightDraft,arrival_gate:value}))}</div></div>
          <button type="submit" className={buttonGreen} disabled={createFlight.isPending || !flightDraft.carrier.trim() || !flightDraft.flight_number.trim() || !flightDraft.departure_airport.trim() || !flightDraft.arrival_airport.trim() || !flightDraft.departure_at || !flightDraft.arrival_at}><Plus size={12}/>{createFlight.isPending?'Saving…':'Add flight segment'}</button>
        </form>}
      </section>
    </div>

    <section className={panel + ' overflow-hidden'}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] p-4"><div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">03 / DAY-BY-DAY DELIVERY</p><h4 className="mt-1 text-sm font-semibold text-white">Daily travel programme & execution</h4><p className="mt-1 text-[11px] text-slate-500">Each day has its own timed activities, assignments and execution record.</p></div><span className="font-mono text-[10px] text-slate-500">{days.length} programme day(s)</span></div>
      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          {days.length === 0 ? <p className="rounded border border-dashed border-white/10 p-3 text-[11px] leading-5 text-slate-500">No daily programme has been created for this journey.</p> : <div className="space-y-1">{days.map(day=><button key={day.id} type="button" onClick={()=>setActiveDayId(day.id)} className={'w-full rounded-md border p-3 text-left transition '+((activeDay?.id===day.id)?'border-emerald-300/25 bg-emerald-300/[0.06]':'border-white/[0.06] bg-black/15 hover:bg-white/[0.03]')}><p className="text-[11px] font-semibold text-slate-100">{day.day_title}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{day.journey_date}</p><p className="mt-2 text-[10px] text-slate-500">{day.items.length} activity/activities · {day.items.filter(item=>item.execution_status==='completed').length} completed</p></button>)}</div>}
          {canManage && !readOnly && <form className="space-y-2 rounded-md border border-white/[0.07] bg-black/15 p-3" onSubmit={event=>{event.preventDefault();createDay.mutate();}}><p className="text-[11px] font-semibold text-slate-200">Create programme day</p>{input('Local date',dayDate,setDayDate,'','date')}{input('Day title',dayTitle,setDayTitle,'Day 1 · Arrival & transfer')}<label className={label}>Day briefing<textarea className={field} rows={2} value={dayBriefing} onChange={event=>setDayBriefing(event.target.value)}/></label><label className={label}>Operational notes<textarea className={field} rows={2} value={dayNotes} onChange={event=>setDayNotes(event.target.value)}/></label><button type="submit" className={buttonGreen} disabled={createDay.isPending || !dayDate || !dayTitle.trim()}><Plus size={12}/>{createDay.isPending?'Creating…':'Add day'}</button></form>}
        </div>
        <div className="min-w-0">
          {!activeDay ? <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-white/10 p-6 text-center"><CalendarDays size={22} className="text-slate-600"/><p className="mt-3 text-xs font-medium text-slate-300">Build the first day’s programme</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-slate-500">Add the relevant dates, then sequence flights, airport reception, meet-and-greet, transfers, security briefs, meetings, hotel movements and onward travel.</p></div> : <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-[10px] text-emerald-200">{activeDay.journey_date} · {activeDay.timezone}</p><h5 className="mt-1 text-sm font-semibold text-white">{activeDay.day_title}</h5>{activeDay.briefing&&<p className="mt-1 max-w-3xl whitespace-pre-wrap text-[11px] leading-5 text-slate-400">{activeDay.briefing}</p>}{activeDay.operational_notes&&<p className="mt-1 text-[10px] leading-4 text-slate-500">{activeDay.operational_notes}</p>}</div><span className="text-[10px] text-slate-500">{activeDay.items.filter(item=>item.execution_status==='completed').length}/{activeDay.items.length} completed</span></div>
            {activeDay.items.length === 0 ? <p className="rounded border border-dashed border-white/10 p-4 text-[11px] text-slate-500">This day has no timed activities yet.</p> : <ol className="space-y-2">{activeDay.items.map(item=><li key={item.id} className="rounded-md border border-white/[0.07] bg-black/15 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="flex min-w-0 gap-3"><span className="font-mono text-[10px] text-slate-500">{String(item.sequence).padStart(2,'0')}</span><div className="min-w-0"><p className="text-xs font-semibold text-slate-100">{item.title}</p><p className="mt-1 text-[10px] text-slate-500">{statusLabel(item.item_type)} · {dateLabel(item.planned_start_at,activeDay.timezone)} – {dateLabel(item.planned_end_at,activeDay.timezone)}</p><p className="mt-1 text-[10px] text-slate-500">{item.location_label || 'Location not recorded'}{item.responsible_name ? ' · ' + item.responsible_name : item.responsible_role ? ' · ' + item.responsible_role : ''}</p>{item.description&&<p className="mt-2 whitespace-pre-wrap text-[10px] leading-4 text-slate-400">{item.description}</p>}</div></div><span className={'rounded border px-2 py-1 text-[9px] font-semibold '+(item.execution_status==='completed'?'border-emerald-300/20 text-emerald-100':item.execution_status==='exception'?'border-red-300/20 text-red-100':item.execution_status==='delayed'?'border-amber-300/20 text-amber-100':'border-white/10 text-slate-400')}>{statusLabel(item.execution_status)}</span></div>
              {!readOnly && <div className="mt-3 space-y-2 border-t border-white/[0.05] pt-3"><label className={label}>Execution note<textarea className={field} rows={2} value={executionNotes[item.id] || ''} onChange={event=>setExecutionNotes({...executionNotes,[item.id]:event.target.value})} placeholder="Record actual outcome, delay, deviation or handover."/></label><div className="flex flex-wrap gap-1.5">{item.execution_status==='planned'&&<button type="button" className={buttonGreen} onClick={()=>executeItem.mutate({id:item.id,status:'in_progress'})} disabled={executeItem.isPending}><Clock3 size={11}/>Start</button>}{['in_progress','delayed','exception'].includes(item.execution_status)&&<button type="button" className={buttonGreen} onClick={()=>executeItem.mutate({id:item.id,status:'completed'})} disabled={executeItem.isPending}><CheckCircle2 size={11}/>Complete</button>}{['planned','in_progress'].includes(item.execution_status)&&<button type="button" className={button} onClick={()=>executeItem.mutate({id:item.id,status:'delayed'})} disabled={executeItem.isPending}>Delayed</button>}{['planned','in_progress','delayed'].includes(item.execution_status)&&<button type="button" className={button} onClick={()=>executeItem.mutate({id:item.id,status:'exception'})} disabled={executeItem.isPending}>Raise exception</button>}{['planned','delayed'].includes(item.execution_status)&&<button type="button" className={button} onClick={()=>executeItem.mutate({id:item.id,status:'skipped'})} disabled={executeItem.isPending}>Skip</button>}<button type="button" className={button} onClick={()=>void openHistory(item)}>History</button></div></div>}
              {historyItemId===item.id&&<div className="mt-3 rounded border border-white/[0.06] bg-black/25 p-3"><p className="text-[10px] font-semibold text-slate-300">Append-only execution history</p>{historyQuery.isLoading?<p className="mt-2 text-[10px] text-slate-500">Loading history…</p>:historyQuery.isError?<p className="mt-2 text-[10px] text-red-200">History is unavailable.</p>:<ol className="mt-2 space-y-2">{(historyQuery.data||[]).map(event=><li key={event.id} className="border-l border-white/10 pl-2"><p className="text-[10px] font-medium text-slate-300">{statusLabel(event.action)}{event.new_status?' · '+statusLabel(event.new_status):''}</p><p className="mt-1 text-[9px] text-slate-500">{dateLabel(event.observed_at,activeDay.timezone)} · {event.actor_name||'Team member'}</p>{event.detail?.note&&<p className="mt-1 text-[10px] text-slate-400">{event.detail.note}</p>}</li>)}</ol>}</div>}
            </li>)}</ol>}
            {canManage && !readOnly && <form className="space-y-3 rounded-md border border-emerald-300/15 bg-emerald-300/[0.025] p-3" onSubmit={event=>{event.preventDefault();createItem.mutate();}}>
              <div className="flex items-center gap-2"><Plus size={13} className="text-emerald-200"/><p className="text-xs font-semibold text-slate-200">Add timed programme activity</p></div>
              <div className="grid grid-cols-2 gap-2"><label className={label}>Activity type<select className={field} value={itemDraft.item_type} onChange={event=>setItemDraft({...itemDraft,item_type:event.target.value})}>{[['flight','Flight'],['transfer','Transfer'],['meeting','Meeting'],['security_briefing','Security briefing'],['hotel','Hotel / accommodation'],['checkpoint','Checkpoint'],['rest','Rest'],['event','Event'],['other','Other']].map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>{input('Activity title *',itemDraft.title,value=>setItemDraft({...itemDraft,title:value}))}</div>
              <div className="grid grid-cols-2 gap-2">{input('Planned start · '+activeDay.timezone,itemDraft.planned_start_at,value=>setItemDraft({...itemDraft,planned_start_at:value}),'','datetime-local')}{input('Planned end · '+activeDay.timezone,itemDraft.planned_end_at,value=>setItemDraft({...itemDraft,planned_end_at:value}),'','datetime-local')}</div>
              <div className="grid grid-cols-2 gap-2">{input('Location / venue',itemDraft.location_label,value=>setItemDraft({...itemDraft,location_label:value}))}<label className={label}>Responsible role<select className={field} value={itemDraft.responsible_role} onChange={event=>setItemDraft({...itemDraft,responsible_role:event.target.value})}><option value="">Not assigned</option>{['driver','backup_driver','cpo','meet_greet','security_escort','dispatcher'].map(role=><option key={role} value={role}>{statusLabel(role)}</option>)}</select></label></div>
              <label className={label}>Activity instructions<textarea className={field} rows={2} value={itemDraft.description} onChange={event=>setItemDraft({...itemDraft,description:event.target.value})}/></label>
              <label className={label}>Related flight leg<select className={field} value={itemDraft.flight_segment_id} onChange={event=>setItemDraft({...itemDraft,flight_segment_id:event.target.value})}><option value="">No linked flight</option>{flights.map(flight=><option key={flight.id} value={flight.id}>{flight.carrier} {flight.flight_number} · {flight.departure_airport} to {flight.arrival_airport}</option>)}</select></label>
              <button type="submit" className={buttonGreen} disabled={createItem.isPending || !itemDraft.title.trim() || !itemDraft.planned_start_at || !itemDraft.planned_end_at}><Plus size={12}/>{createItem.isPending?'Adding…':'Add activity to day'}</button>
            </form>}
          </div>}
        </div>
      </div>
    </section>

    <div className="grid grid-cols-1 gap-2 md:grid-cols-3"><div className="rounded border border-white/[0.06] bg-black/10 p-3"><p className="text-[10px] text-slate-500">Traveller records</p><p className="mt-1 text-sm font-semibold text-white">{travellers.length}</p><p className="mt-1 text-[10px] text-slate-600">Distinct from duty staff roster</p></div><div className="rounded border border-white/[0.06] bg-black/10 p-3"><p className="text-[10px] text-slate-500">Flight segments</p><p className="mt-1 text-sm font-semibold text-white">{flights.length}</p><p className="mt-1 text-[10px] text-slate-600">Each leg retains local airport time zones</p></div><div className="rounded border border-white/[0.06] bg-black/10 p-3"><p className="text-[10px] text-slate-500">Daily activities</p><p className="mt-1 text-sm font-semibold text-white">{days.reduce((total, day) => total + day.items.length, 0)}</p><p className="mt-1 text-[10px] text-slate-600">Execution states have timestamped history</p></div></div>
    <footer className="flex flex-wrap items-start gap-2 border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-slate-500"><ShieldCheck size={13} className="shrink-0 text-emerald-200/70"/><span>Personal traveller data and identity documents are restricted to mobility managers. Field teams receive only operational traveller names and movement details. Flight status and activity execution are operator-entered unless separately marked with a trusted provider source; neither is presented as GPS proof.</span></footer>
  </section>;
}
