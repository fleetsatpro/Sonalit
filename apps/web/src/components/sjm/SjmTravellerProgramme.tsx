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
    let disposed = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setImageUrl(null);
    if (!code) return () => { disposed = true; controller.abort(); };
    api.get(workspaceBase + '/airline-logo/' + code, { responseType: 'blob', signal: controller.signal })
      .then(response => {
        const blob = response.data as Blob;
        if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) return;
        const nextUrl = URL.createObjectURL(blob);
        if (disposed) { URL.revokeObjectURL(nextUrl); return; }
        objectUrl = nextUrl;
        setImageUrl(nextUrl);
      })
      .catch(() => { if (!disposed) setImageUrl(null); });
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [code, workspaceBase]);
  return <div className="sjm-airline-identity">{imageUrl && <img src={imageUrl} alt="" aria-hidden="true"/>}<span>{code || 'Flight'}</span></div>;
}
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

export default function SjmTravellerProgramme({ journeyId, timezone, canManage, planEditable, executionAllowed, readOnly }: Props) {
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
  const teamQuery = useQuery<{ data: Participant[] }>({
    queryKey: ['sjm-travel-workspace-team', journeyId],
    queryFn: async () => (await api.get('/sjm/journeys/' + journeyId + '/participants')).data,
    enabled: Boolean(journeyId && canManage),
    staleTime: 60000,
  });
  const team = (teamQuery.data?.data || []).filter(person => !person.removed_at && person.account_status === 'active');
  const travellers = data?.travellers || [];
  const documents = data?.documents || [];
  const flights = data?.flights || [];
  const days = data?.days || [];
  const [travellerDraft, setTravellerDraft] = useState<TravellerDraft>({ ...EMPTY_TRAVELLER });
  const [editingTravellerId, setEditingTravellerId] = useState('');
  const [showTravellerForm, setShowTravellerForm] = useState(false);
  const [travellerStep, setTravellerStep] = useState(0);
  const [travellerFormError, setTravellerFormError] = useState('');
  const [travellerDocumentFile, setTravellerDocumentFile] = useState<File | null>(null);
  const [flightDraft, setFlightDraft] = useState<FlightDraft>({ ...EMPTY_FLIGHT, departure_timezone: timezone, arrival_timezone: timezone });
  const [editingFlightId, setEditingFlightId] = useState('');
  const [showFlightForm, setShowFlightForm] = useState(false);
  const [showDayForm, setShowDayForm] = useState(false);
  const [showItemForm, setShowItemForm] = useState(false);
  const [dayDate, setDayDate] = useState(dateOnlyLocal(timezone));
  const [dayTimezone, setDayTimezone] = useState(timezone);
  const [editingDayId, setEditingDayId] = useState('');
  const [editingItemId, setEditingItemId] = useState('');
  const [dayTitle, setDayTitle] = useState('Daily movement programme');
  const [dayBriefing, setDayBriefing] = useState('');
  const [dayNotes, setDayNotes] = useState('');
  const [activeDayId, setActiveDayId] = useState('');
  const [itemDraft, setItemDraft] = useState<ItemDraft>({ ...EMPTY_ITEM });
  const [executionNotes, setExecutionNotes] = useState<Record<string, string>>({});
  const [flightStatusNotes, setFlightStatusNotes] = useState<Record<string, string>>({});
  const [flightStatusSelections, setFlightStatusSelections] = useState<Record<string, string>>({});
  const [documentReviewNotes, setDocumentReviewNotes] = useState<Record<string, string>>({});
  const [documentArchiveNotes, setDocumentArchiveNotes] = useState<Record<string, string>>({});
  const [archivingDocumentId, setArchivingDocumentId] = useState('');
  const [documentTravellerId, setDocumentTravellerId] = useState('');
  const [documentType, setDocumentType] = useState('passport');
  const [documentHolder, setDocumentHolder] = useState('');
  const [documentCountry, setDocumentCountry] = useState('');
  const [documentIssueDate, setDocumentIssueDate] = useState('');
  const [documentExpiryDate, setDocumentExpiryDate] = useState('');
  const [documentUploadState, setDocumentUploadState] = useState<{ travellerId: string; phase: string } | null>(null);
  const [historyItemId, setHistoryItemId] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const activeDay = days.find(day => day.id === activeDayId) || days[0] || null;
  const mayExecuteItem = (item: Item) => {
    if (data?.access?.manager) return true;
    const roles = data?.access?.duty_roles || [];
    return roles.includes('dispatcher') ||
      Boolean(item.responsible_user_id && item.responsible_user_id === data?.access?.user_id) ||
      Boolean(item.responsible_role && roles.includes(item.responsible_role));
  };
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
      setShowTravellerForm(false);
      setTravellerStep(0);
      setTravellerFormError('');
      setTravellerDocumentFile(null);
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
      setShowTravellerForm(false);
      setTravellerStep(0);
      setTravellerFormError('');
      setTravellerDocumentFile(null);
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
      setShowFlightForm(false);
      setNotice({ kind: 'success', text: 'Flight segment saved to the journey.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Flight segment could not be saved.') }),
  });
  const createDay = useMutation({
    mutationFn: async () => (await api.post(base + '/days', {
      journey_date: dayDate, timezone: dayTimezone, day_title: dayTitle, briefing: dayBriefing, operational_notes: dayNotes,
    })).data.data,
    onSuccess: async result => {
      setActiveDayId(result.id);
      setDayBriefing('');
      setDayNotes('');
      setDayTimezone(timezone);
      setShowDayForm(false);
      setNotice({ kind: 'success', text: 'Programme day created.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Programme day could not be created.') }),
  });
  const generateDays = useMutation({
    mutationFn: async () => (await api.post(base + '/days/generate', {})).data.data as { created_count: number; existing_count: number; total_days: number; days: Array<{ id: string; journey_date: string }> },
    onSuccess: async result => {
      if (result.days[0]?.id) setActiveDayId(result.days[0].id);
      setNotice({ kind: 'success', text: result.created_count + ' daily programme day(s) generated; ' + result.existing_count + ' already existed. No activities or assignments were fabricated.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Daily programme dates could not be generated. Set the journey departure and arrival times first.') }),
  });
  const updateDay = useMutation({
    mutationFn: async () => (await api.patch(base + '/days/' + editingDayId, {
      day_title: dayTitle, timezone: dayTimezone, briefing: dayBriefing, operational_notes: dayNotes,
    })).data.data,
    onSuccess: async () => {
      setEditingDayId('');
      setDayTitle('Daily movement programme');
      setDayBriefing('');
      setDayNotes('');
      setDayTimezone(timezone);
      setShowDayForm(false);
      setNotice({ kind: 'success', text: 'Programme day brief updated.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Programme day could not be updated.') }),
  });
  const createItem = useMutation({
    mutationFn: async () => {
      if (!activeDay) throw new Error('Create or select a programme day first.');
      const start = localDateTimeToIso(itemDraft.planned_start_at, activeDay.timezone);
      const end = localDateTimeToIso(itemDraft.planned_end_at, activeDay.timezone);
      if (!start || !end) throw new Error('Enter valid activity start and end times in the programme timezone.');
      const payload = { ...itemDraft, planned_start_at: start, planned_end_at: end, location_lat: itemDraft.location_lat.trim()===''?null:Number(itemDraft.location_lat), location_lng: itemDraft.location_lng.trim()===''?null:Number(itemDraft.location_lng), traveller_id: itemDraft.traveller_id || null, responsible_user_id: itemDraft.responsible_user_id || null, flight_segment_id: itemDraft.flight_segment_id || null };
      return (editingItemId ? await api.patch(base + '/items/' + editingItemId, payload) : await api.post(base + '/days/' + activeDay.id + '/items', payload)).data.data;
    },
    onSuccess: async () => {
      setEditingItemId('');
      setItemDraft({ ...EMPTY_ITEM });
      setShowItemForm(false);
      setNotice({ kind: 'success', text: 'Daily programme activity saved.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Programme activity could not be saved.') }),
  });
  const executeItem = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => (await api.patch(base + '/items/' + id + '/execution', {
      execution_status: status, execution_note: executionNotes[id] || '',
    })).data.data,
    onSuccess: async (_result, variables) => {
      setExecutionNotes(current => ({ ...current, [variables.id]: '' }));
      setNotice({ kind: 'success', text: 'Execution update recorded in the activity history.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Execution update was not accepted.') }),
  });
  const updateFlightStatus = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note: string }) => (await api.patch(base + '/flights/' + id + '/status', { status, note })).data.data,
    onSuccess: async (_result, variables) => {
      setFlightStatusNotes(current => ({ ...current, [variables.id]: '' }));
      setFlightStatusSelections(current => ({ ...current, [variables.id]: variables.status }));
      setNotice({ kind: 'success', text: 'Operator-supplied flight status recorded with its observation note.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Flight status was not updated.') }),
  });
  const reviewDocument = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: 'VERIFIED' | 'REJECTED'; note: string }) => {
      if (note.trim().length < 10) throw new Error('A meaningful document review note is required.');
      return (await api.patch(base + '/documents/' + id + '/review', { review_status: status, review_note: note.trim() })).data.data;
    },
    onSuccess: async (_result, variables) => {
      setDocumentReviewNotes(current => ({ ...current, [variables.id]: '' }));
      setNotice({ kind: 'success', text: 'Travel document review decision recorded.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'Document review was not saved.') }),
  });

  const archiveDocument = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      if (reason.trim().length < 10) throw new Error('Provide a meaningful archive or supersession reason.');
      return (await api.post(base + '/documents/' + id + '/archive', { reason: reason.trim() })).data.data;
    },
    onSuccess: async (_result, variables) => {
      setDocumentArchiveNotes(current => ({ ...current, [variables.id]: '' }));
      setArchivingDocumentId('');
      setNotice({ kind: 'success', text: 'Document record archived. The underlying evidence object has been retained under the SJM evidence-retention controls.' });
      await refresh();
    },
    onError: error => setNotice({ kind: 'error', text: errorMessage(error, 'The travel-document record could not be archived.') }),
  });

  const uploadDocument = async (traveller: Traveller, file?: File) => {
    if (!file || !canManage || !planEditable || documentUploadState) return;
    const maxBytes = file.type === 'application/pdf' ? 25 * 1024 * 1024 :
      file.type === 'image/jpeg' || file.type === 'image/png' ? 20 * 1024 * 1024 : 0;
    if (!maxBytes) {
      setNotice({ kind: 'error', text: 'Only PDF, JPEG and PNG travel documents are accepted.' });
      return;
    }
    if (file.size > maxBytes) {
      setNotice({ kind: 'error', text: 'This file exceeds the ' + (maxBytes / 1024 / 1024) + ' MiB limit for its file type.' });
      return;
    }
    setNotice(null);
    setDocumentUploadState({ travellerId: traveller.id, phase: 'Requesting a private upload capability…' });
    try {
      const response = await api.post(base + '/travellers/' + traveller.id + '/documents/upload-url', {
        document_type: documentType, holder_name: documentHolder.trim() || traveller.display_name,
        issuing_country: documentCountry || null, issue_date: documentIssueDate || null,
        expiry_date: documentExpiryDate || null, file_name: file.name, mime_type: file.type.toLowerCase(),
        size_bytes: file.size,
      });
      const signed = response.data?.data;
      if (!signed?.evidence_id || !signed?.upload_url || !signed?.required_headers) throw new Error('Private SJM storage did not return a valid upload capability.');
      setDocumentUploadState({ travellerId: traveller.id, phase: 'Uploading to private SJM storage…' });
      const uploaded = await fetch(signed.upload_url, {
        method: 'PUT', headers: signed.required_headers, body: file, credentials: 'omit', cache: 'no-store',
      });
      if (!uploaded.ok) throw new Error('Private document storage rejected the upload (HTTP ' + uploaded.status + ').');
      setDocumentUploadState({ travellerId: traveller.id, phase: 'Verifying file integrity and recording the document…' });
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
    } finally {
      setDocumentUploadState(null);
    }
  };
  const retryDocumentUpload = async (document: TravelDocument, file?: File) => {
    if (!file || !canManage || !planEditable || documentUploadState) return;
    if (file.name !== document.file_name || file.type.toLowerCase() !== document.mime_type || file.size !== document.size_bytes) {
      setNotice({ kind: 'error', text: 'Select the exact original file name, type and size. A pending evidence object cannot be replaced with different content.' });
      return;
    }
    setNotice(null);
    setDocumentUploadState({ travellerId: document.traveller_id, phase: 'Checking whether the original upload reached private storage…' });
    try {
      let committed;
      try {
        committed = await api.post(evidenceBase + '/' + document.evidence_id + '/commit');
      } catch (error) {
        const code = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
        if (code !== 'evidence_upload_missing') throw error;
        setDocumentUploadState({ travellerId: document.traveller_id, phase: 'Requesting a renewed private upload capability…' });
        const response = await api.post(base + '/documents/' + document.id + '/renew-upload-url');
        const signed = response.data?.data;
        if (!signed?.evidence_id || signed.evidence_id !== document.evidence_id || !signed?.upload_url || !signed?.required_headers) {
          throw new Error('Private SJM storage did not return a valid retry capability.');
        }
        setDocumentUploadState({ travellerId: document.traveller_id, phase: 'Resuming upload to private SJM storage…' });
        const uploaded = await fetch(signed.upload_url, {
          method: 'PUT', headers: signed.required_headers, body: file, credentials: 'omit', cache: 'no-store',
        });
        if (!uploaded.ok) throw new Error('Private storage rejected the retry (HTTP ' + uploaded.status + ').');
        setDocumentUploadState({ travellerId: document.traveller_id, phase: 'Verifying the original evidence object…' });
        committed = await api.post(evidenceBase + '/' + document.evidence_id + '/commit');
      }
      if (committed.data?.data?.status !== 'VERIFIED') throw new Error('Sonalit did not confirm the file integrity check.');
      setNotice({ kind: 'success', text: 'The existing travel-document upload is now integrity-verified and awaiting manager review.' });
      await refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'The pending travel-document upload could not be resumed.') });
    } finally {
      setDocumentUploadState(null);
    }
  };

  const downloadDocument = async (document: TravelDocument) => {
    // Open the tab in the direct click handler before awaiting the signed URL,
    // so browser popup protection does not silently discard the private file.
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setNotice({ kind: 'error', text: 'Allow pop-ups for Sonalit to open this private travel document.' });
      return;
    }
    try {
      const response = await api.post(evidenceBase + '/' + document.evidence_id + '/download-url');
      const url = response.data?.data?.download_url;
      if (!url) throw new Error('Sonalit did not return a private download URL.');
      tab.opener = null;
      tab.location.replace(url);
    } catch (error) {
      tab.close();
      setNotice({ kind: 'error', text: errorMessage(error, 'The private document could not be opened.') });
    }
  };
  const openHistory = async (item: Item) => {
    setHistoryItemId(current => current === item.id ? '' : item.id);
  };
  const validateTravellerStep = (step: number): string => {
    if (step === 0) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,47}$/.test(travellerDraft.traveller_reference.trim())) return 'Enter a unique traveller reference (2–48 letters, numbers, dashes or underscores).';
      if (!travellerDraft.given_name.trim() || !travellerDraft.family_name.trim()) return 'Enter the traveller’s given name and family name exactly as shown on the travel document.';
      if (travellerDraft.date_of_birth) { const dob = new Date(travellerDraft.date_of_birth + 'T00:00:00.000Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(travellerDraft.date_of_birth) || !Number.isFinite(dob.getTime()) || dob.toISOString().slice(0,10) !== travellerDraft.date_of_birth || travellerDraft.date_of_birth > new Date().toISOString().slice(0,10)) return 'Enter a valid date of birth that is not in the future.'; }
    }
    if (step === 1) {
      if (travellerDraft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(travellerDraft.email.trim())) return 'Enter a valid email address or leave the field blank.';
      for (const [label, value] of [['Traveller phone', travellerDraft.phone], ['Emergency phone', travellerDraft.emergency_contact_phone]] as const) {
        if (value && !/^[+0-9().\-\s]{5,48}$/.test(value)) return label + ' must use an international number format, for example +254 712 345 678.';
      }
      if (Boolean(travellerDraft.emergency_contact_name.trim()) !== Boolean(travellerDraft.emergency_contact_phone.trim())) return 'Provide both an emergency contact name and phone number, or leave both blank.';
    }
    if (step === 2) {
      if (documentIssueDate && documentExpiryDate && documentExpiryDate < documentIssueDate) return 'The document expiry date must be on or after its issue date.';
      if (travellerDocumentFile) {
        const maxBytes = travellerDocumentFile.type === 'application/pdf' ? 25 * 1024 * 1024 : (travellerDocumentFile.type === 'image/jpeg' || travellerDocumentFile.type === 'image/png' ? 20 * 1024 * 1024 : 0);
        if (!maxBytes) return 'Use a PDF, JPEG or PNG for travel documents.';
        if (travellerDocumentFile.size > maxBytes) return 'The selected file exceeds the '+(maxBytes/1024/1024)+' MiB limit.';
        if (!documentHolder.trim()) return 'Enter the name printed on the uploaded document.';
      }
    }
    return '';
  };
  const saveTravellerWizard = async () => {
    const validation = [0,1,2].map(validateTravellerStep).find(Boolean) || '';
    if (validation) { setTravellerFormError(validation); return; }
    const displayName = displayTravellerName(travellerDraft);
    const selectedFile = travellerDocumentFile;
    setTravellerFormError('');
    try {
      const saved = (editingTravellerId ? await updateTraveller.mutateAsync() : await createTraveller.mutateAsync()) as Traveller;
      if (selectedFile) await uploadDocument({ ...saved, display_name: saved.display_name || displayName } as Traveller, selectedFile);
    } catch (error) {
      setTravellerFormError(errorMessage(error, 'The traveller record could not be saved.'));
    }
  };
  const historyQuery = useQuery<Array<{ id: string; actor_name?: string | null; action: string; previous_status?: string | null; new_status?: string | null; detail?: { note?: string }; observed_at: string }>>({
    queryKey: ['sjm-itinerary-item-history', journeyId, historyItemId],
    queryFn: async () => (await api.get(base + '/items/' + historyItemId + '/history')).data.data,
    enabled: Boolean(historyItemId),
  });

  if (query.isLoading) return <section className={panel + ' p-6'}><RefreshCw size={16} className="animate-spin text-slate-400"/><p className="mt-3 text-xs text-slate-500">Loading traveller register and travel programme…</p></section>;
  if (query.isError) return <section className={panel + ' p-5'} role="alert"><AlertCircle size={17} className="text-amber-200"/><h3 className="mt-2 text-sm font-semibold text-white">Travel workspace unavailable</h3><p className="mt-2 text-xs leading-5 text-slate-400">{errorMessage(query.error, 'The travel register could not be loaded.')}</p><button className={button + ' mt-3'} onClick={() => void query.refetch()}><RefreshCw size={12}/>Retry</button></section>;

  return <section className="sjm-travel-programme space-y-4" data-testid="sjm-travel-workspace">
    <header className="sjm-travel-programme__header flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] pb-4">
      <div><p className="sjm-travel-programme__eyebrow font-mono text-[10px] font-semibold tracking-[.16em] text-sky-200">TRAVEL DOSSIER</p><h3 className="sjm-travel-programme__title mt-1 text-base font-semibold text-white">People, documents & travel plan</h3><p className="sjm-travel-programme__description mt-1 max-w-3xl text-[11px] leading-5 text-slate-400">Register each traveller, securely attach identity and booking documents, record every flight leg, and plan each local day through to verified execution. Assigned staff remain separate from traveller identities.</p></div>
      <button className={button} onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={12} className={query.isFetching ? 'animate-spin' : ''}/>Refresh dossier</button>
    </header>

    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={'sjm-travel-notice rounded-md border px-3 py-2.5 text-[11px] leading-5 ' + (notice.kind === 'error' ? 'border-red-300/20 bg-red-400/[0.04] text-red-100' : notice.kind === 'success' ? 'border-emerald-300/20 bg-emerald-300/[0.04] text-emerald-100' : 'border-white/10 text-slate-300')}>{notice.text}</div>}

    {data?.readiness && <section className={panel + ' sjm-travel-section sjm-travel-readiness-card p-4'} data-testid="sjm-travel-readiness" aria-live="polite">
      <div className="sjm-travel-section__header flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">RELEASE CONTROL / TRAVEL DOSSIER</p><h4 className="mt-1 text-sm font-semibold text-white">Departure readiness</h4><p className="mt-1 text-[10px] leading-4 text-slate-500">Authoritative server-side checks used by route approval and departure release. Document requirements are not guessed from nationality or destination.</p></div>
        <span className={'rounded border px-2.5 py-1.5 text-[10px] font-semibold tracking-wide '+(data.readiness.ready?'border-emerald-300/25 bg-emerald-300/[0.05] text-emerald-100':'border-amber-300/25 bg-amber-300/[0.04] text-amber-100')}>{data.readiness.ready?'DOSSIER READY':'ACTION REQUIRED'}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          ['Travellers',data.readiness.counts.traveller_count+' registered',data.readiness.counts.principal_traveller_count+' principal'],
          ['Flight legs',String(data.readiness.counts.flight_segment_count),'Airport service coverage'],
          ['Daily programme',data.readiness.counts.programme_day_count+' days',data.readiness.counts.timed_activity_count+' activities · '+data.readiness.counts.unassigned_activity_count+' unassigned'],
          ['Documents',data.readiness.counts.cleared_document_count+' cleared',data.readiness.counts.document_blocker_count+' requiring review'],
          ['Schedule integrity',typeof data.readiness.counts.schedule_conflict_count==='number'?((data.readiness.counts.schedule_conflict_count+(data.readiness.counts.flight_schedule_conflict_count||0))===0?'No overlaps':(data.readiness.counts.schedule_conflict_count+(data.readiness.counts.flight_schedule_conflict_count||0))+' overlaps'):'Not evaluated','Traveller, operator and flight-time overlaps'],
        ].map(([name,value,detail])=><div key={name} className="sjm-travel-metric rounded border border-white/[0.06] bg-black/15 p-2.5"><p className="text-[10px] text-slate-500">{name}</p><p className="mt-1 text-sm font-semibold tabular-nums text-slate-100">{value}</p><p className="mt-1 text-[9px] text-slate-600">{detail}</p></div>)}
      </div>
      {data.readiness.blockers.length>0&&<div className="mt-3 space-y-2"><p className="text-[10px] font-semibold tracking-wide text-amber-100">BLOCKING ITEMS</p>{data.readiness.blockers.map(blocker=><div key={blocker.code} className="flex items-start gap-2 rounded border border-amber-300/10 bg-amber-300/[0.025] p-2.5"><AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-200"/><div className="min-w-0"><p className="text-[10px] leading-4 text-slate-200">{blocker.message}</p>{blocker.missing_dates&&<p className="mt-1 font-mono text-[9px] text-amber-100/80">Missing dates: {blocker.missing_dates.join(', ')}</p>}{blocker.conflict_count!=null&&<p className="mt-1 font-mono text-[9px] text-amber-100/80">Conflicting pairs: {blocker.conflict_count}</p>}</div></div>)}</div>}
      {data.readiness.warnings.length>0&&<div className="mt-3 space-y-1">{data.readiness.warnings.map(warning=><p key={warning.code} className="text-[10px] leading-4 text-amber-100/80">Review: {warning.message}{warning.connection_count!=null?' ('+warning.connection_count+' connection(s))':''}</p>)}</div>}
      {data.readiness.ready&&<p className="mt-3 flex items-center gap-2 text-[10px] text-emerald-100/80"><ShieldCheck size={12}/>Traveller, flight, programme and uploaded-document checks pass. {typeof data.readiness.counts.schedule_conflict_count==='number'?'No overlapping traveller, operator or flight commitments were found. ':'Schedule overlap status was not returned. '}Human approval and operational readiness acknowledgement still apply.</p>}
    </section>}

    <div data-testid="sjm-travel-people-flights" className="sjm-travel-people-flights grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className={panel + ' sjm-travel-section sjm-travel-section--people overflow-hidden'}>
        <div className="sjm-travel-section__header flex items-center justify-between gap-3 border-b border-white/[0.07] p-4"><div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">01 / PEOPLE TRAVELLING</p><h4 className="mt-1 text-sm font-semibold text-white">Traveller register</h4><p className="mt-1 text-[10px] text-slate-500">Principal traveller and accompanying persons</p></div><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-slate-500">{travellers.length} registered</span>{canManage&&!readOnly&&<button type="button" className={buttonPrimary} onClick={()=>{setShowTravellerForm(value=>!value);setEditingTravellerId('');setTravellerDraft({...EMPTY_TRAVELLER,traveller_reference:nextTravellerReference(travellers)});setTravellerStep(0);setTravellerFormError('');setTravellerDocumentFile(null);setDocumentHolder('');setDocumentCountry('');setDocumentIssueDate('');setDocumentExpiryDate('');setDocumentType('passport');}}><Plus size={12}/>Register traveller</button>}</div></div>
        <div className="space-y-3 p-4">
          {travellers.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-[11px] leading-5 text-slate-500">No traveller profiles are registered against this journey. Add the principal traveller and each accompanying person separately.</p> :
            <div className="space-y-2">{travellers.map(traveller => <article key={traveller.id} className="sjm-travel-person-card rounded-md border border-white/[0.07] bg-black/15 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-slate-100">{traveller.display_name}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{traveller.traveller_reference} · {statusLabel(traveller.traveller_type)}</p></div><span className="sjm-travel-nationality">{countryFlagUrl(countryCodeFromName(traveller.nationality)) && <img src={countryFlagUrl(countryCodeFromName(traveller.nationality)) || '' } alt="" aria-hidden="true" className="sjm-country-flag" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/>}{traveller.nationality || 'Nationality not recorded'}</span></div>
              {canManage && <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.05] pt-3 text-[10px]"><div><dt className="text-slate-600">Date of birth</dt><dd className="mt-1 text-slate-300">{traveller.date_of_birth || 'Not recorded'}</dd></div><div><dt className="text-slate-600">Relationship</dt><dd className="mt-1 text-slate-300">{traveller.traveller_type === 'principal' ? 'Principal traveller' : traveller.relationship_to_principal || statusLabel(traveller.traveller_type)}</dd></div><div><dt className="text-slate-600">Contact</dt><dd className="mt-1 break-all text-slate-300">{traveller.email || traveller.phone || 'Not recorded'}</dd></div><div><dt className="text-slate-600">Emergency contact</dt><dd className="mt-1 text-slate-300">{traveller.emergency_contact_name ? [traveller.emergency_contact_name,traveller.emergency_contact_relationship].filter(Boolean).join(' · ') : 'Not recorded'}</dd></div><div><dt className="text-slate-600">Emergency number</dt><dd className="mt-1 text-slate-300">{traveller.emergency_contact_phone || 'Not recorded'}</dd></div></dl>}
              {canManage && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3"><span className="text-[10px] text-slate-500">{(docsByTraveller.get(traveller.id) || []).length} travel document(s)</span><button type="button" className={button} onClick={() => { setEditingTravellerId(traveller.id); setShowTravellerForm(true); setTravellerStep(0); setTravellerFormError(''); setTravellerDocumentFile(null); setDocumentHolder(traveller.display_name); setDocumentCountry(countryNameFromCode(countryCodeFromName(traveller.nationality)) || traveller.nationality || ''); setDocumentIssueDate(''); setDocumentExpiryDate(''); setTravellerDraft({ traveller_reference: traveller.traveller_reference, traveller_type: traveller.traveller_type, title: traveller.title || '', given_name: traveller.given_name || '', middle_name: traveller.middle_name || '', family_name: traveller.family_name || '', preferred_name: traveller.preferred_name || '', nationality: countryNameFromCode(countryCodeFromName(traveller.nationality)) || traveller.nationality || '', date_of_birth: traveller.date_of_birth ? String(traveller.date_of_birth).slice(0,10) : '', email: traveller.email || '', phone: traveller.phone || '', relationship_to_principal: traveller.relationship_to_principal || '', emergency_contact_name: traveller.emergency_contact_name || '', emergency_contact_relationship: traveller.emergency_contact_relationship || '', emergency_contact_phone: traveller.emergency_contact_phone || '', internal_notes: traveller.internal_notes || '' }); }} disabled={!planEditable}><Users size={11}/>Edit profile</button><button type="button" className={button} onClick={() => { setDocumentTravellerId(documentTravellerId === traveller.id ? '' : traveller.id); setDocumentHolder(traveller.display_name); }} disabled={!planEditable}><Upload size={11}/>Attach document</button></div>}
              {canManage && planEditable && documentTravellerId === traveller.id && <div className="mt-3 space-y-2 rounded-md border border-sky-300/20 bg-sky-300/[0.035] p-3">
                <p className="text-[10px] font-semibold tracking-wide text-sky-100">PRIVATE TRAVEL DOCUMENT</p>
                <div className="grid grid-cols-2 gap-2"><label className={label}>Document type<select className={field} value={documentType} onChange={event => setDocumentType(event.target.value)}>{[['passport','Passport'],['visa','Visa'],['e_ticket','E-ticket'],['boarding_pass','Boarding pass'],['booking_confirmation','Booking confirmation'],['itinerary','Travel itinerary'],['travel_insurance','Travel insurance'],['invitation_letter','Invitation letter'],['residence_permit','Residence permit'],['other','Other']].map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></label>{input('Holder name', documentHolder, setDocumentHolder)}</div>
                <div className="grid grid-cols-2 gap-2">{countrySelect('Issuing country',documentCountry,setDocumentCountry)}{input('Issue date',documentIssueDate,setDocumentIssueDate,'','date')}{input('Expiry date',documentExpiryDate,setDocumentExpiryDate,'','date')}</div>
                <label className={label}>PDF or image file<input className={field} type="file" accept="application/pdf,image/jpeg,image/png" disabled={!planEditable || Boolean(documentUploadState)} onChange={event => { const file = event.target.files?.[0]; void uploadDocument(traveller, file); event.currentTarget.value = ''; }}/></label>
                {documentUploadState?.travellerId===traveller.id&&<p role="status" className="text-[10px] leading-4 text-sky-100/85">{documentUploadState.phase}</p>}
                <p className="text-[10px] leading-4 text-slate-500">PDF up to 25 MiB; JPEG/PNG up to 20 MiB. Uploads require the dedicated private SJM storage bucket, a short-lived upload capability and server-side integrity verification. If private storage is not configured in this environment, upload is blocked; no public/shared media bucket fallback is allowed.</p>
              </div>}
              {canManage && (docsByTraveller.get(traveller.id) || []).length > 0 && <div className="mt-3 space-y-2">{(docsByTraveller.get(traveller.id) || []).map(document => <div key={document.id} className="sjm-travel-document-card rounded border border-white/[0.06] bg-black/20 p-2.5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="text-[11px] font-medium text-slate-200">{statusLabel(document.document_type)} · {document.file_name}</p><p className="mt-1 text-[10px] text-slate-500">{document.review_status.replaceAll('_',' ')} · {document.expiry_state==='expired'?'EXPIRED':document.expiry_state==='expiring_soon'?'EXPIRING WITHIN 90 DAYS':'expires '+(document.expiry_date || 'not recorded')} · {sizeLabel(document.size_bytes)}</p></div><button type="button" className={button} onClick={() => void downloadDocument(document)} disabled={document.review_status === 'UPLOAD_PENDING'}><Download size={11}/>Open</button></div>{planEditable && document.review_status === 'UPLOAD_PENDING' && <label className={label + ' mt-2'}>Retry the original file<input className={field} type="file" accept="application/pdf,image/jpeg,image/png" disabled={Boolean(documentUploadState)} onChange={event => { const file=event.target.files?.[0]; void retryDocumentUpload(document,file); event.currentTarget.value=''; }}/></label>}{planEditable && document.review_status === 'PENDING_REVIEW' && <div className="mt-2 space-y-2"><label className={label}>Review rationale<textarea className={field} rows={2} value={documentReviewNotes[document.id] || ''} onChange={event=>setDocumentReviewNotes(current=>({...current,[document.id]:event.target.value}))} placeholder="Confirm what was checked, any discrepancy, and the review basis."/></label><div className="flex flex-wrap gap-1.5"><button type="button" className={buttonPrimary} onClick={() => reviewDocument.mutate({ id: document.id, status: 'VERIFIED', note: documentReviewNotes[document.id] || '' })} disabled={reviewDocument.isPending || (documentReviewNotes[document.id] || '').trim().length<10}><Check size={11}/>Verify document</button><button type="button" className={button} onClick={() => reviewDocument.mutate({ id: document.id, status: 'REJECTED', note: documentReviewNotes[document.id] || '' })} disabled={reviewDocument.isPending || (documentReviewNotes[document.id] || '').trim().length<10}>Reject</button></div></div>}{planEditable && <div className="mt-2 border-t border-white/[0.05] pt-2">{archivingDocumentId===document.id ? <div className="space-y-2"><label className={label}>Archive / supersession reason<textarea className={field} rows={2} value={documentArchiveNotes[document.id] || ''} onChange={event=>setDocumentArchiveNotes(current=>({...current,[document.id]:event.target.value}))} placeholder="Explain why this copy is obsolete, replaced or should no longer count toward release readiness."/></label><div className="flex flex-wrap gap-1.5"><button type="button" className={button} onClick={()=>archiveDocument.mutate({id:document.id,reason:documentArchiveNotes[document.id]||''})} disabled={archiveDocument.isPending || (documentArchiveNotes[document.id]||'').trim().length<10}>Confirm archive</button><button type="button" className={button} onClick={()=>setArchivingDocumentId('')}>Cancel</button></div></div> : <button type="button" className={button} onClick={()=>setArchivingDocumentId(document.id)}>Archive / supersede record</button>}</div>}</div>)}</div>}
            </article>)}</div>}
        </div>
        {canManage && planEditable && showTravellerForm && <form className="sjm-traveller-wizard" onSubmit={event => { event.preventDefault(); if (travellerStep < 3) { const error = validateTravellerStep(travellerStep); if (error) { setTravellerFormError(error); return; } setTravellerFormError(''); if (travellerStep === 1) { setDocumentHolder(displayTravellerName(travellerDraft)); setDocumentCountry(travellerDraft.nationality); } setTravellerStep(step => Math.min(3, step + 1)); } else { void saveTravellerWizard(); } }}>
          <div className="sjm-traveller-wizard__header">
            <div>
              <p className="sjm-travel-programme__eyebrow">TRAVELLER REGISTRATION</p>
              <h5>{editingTravellerId ? 'Update traveller details' : 'Add a traveller to this journey'}</h5>
              <p className="sjm-traveller-wizard__intro">Use the name and details shown on the current travel document. You can add the document now or attach it later.</p>
            </div>
            <button type="button" className={button} onClick={() => { setShowTravellerForm(false); setTravellerFormError(''); setTravellerStep(0); setTravellerDocumentFile(null); }}>{editingTravellerId ? 'Close' : 'Cancel'}</button>
          </div>
          <nav className="sjm-traveller-steps" aria-label="Traveller registration steps">
            {['Identity','Contacts','Documents','Review'].map((name,index)=><button key={name} type="button" className={'sjm-traveller-step' + (travellerStep === index ? ' is-current' : travellerStep > index ? ' is-complete' : '')} aria-current={travellerStep === index ? 'step' : undefined} disabled={index > travellerStep} onClick={() => setTravellerStep(index)}><span className="sjm-traveller-step__number">{travellerStep > index ? '✓' : String(index+1).padStart(2,'0')}</span><span>{name}</span></button>)}
          </nav>
          <p className="sjm-traveller-wizard__counter">STEP {String(travellerStep+1).padStart(2,'0')} / 04 <span>·</span> {['Identity details','Contact and relationship','Travel documents','Confirm registration'][travellerStep]}</p>
          {travellerFormError && <p className="sjm-traveller-form-error" role="alert"><AlertCircle size={14}/>{travellerFormError}</p>}
          {travellerStep === 0 && <section className="sjm-traveller-wizard__body" aria-labelledby="sjm-traveller-identity-heading">
            <div className="sjm-traveller-step-heading"><div><h6 id="sjm-traveller-identity-heading">Identity details</h6><p>Enter the legal identity as it appears on the passport or other travel document.</p></div><span className="sjm-field-required-note">* Required</span></div>
            <div className="sjm-traveller-form-grid sjm-traveller-form-grid--identity">
              <label className={label}>Traveller reference *<input className={field} value={travellerDraft.traveller_reference} onChange={event=>setTravellerDraft({...travellerDraft,traveller_reference:event.target.value})} aria-describedby="sjm-traveller-ref-help"/></label>
              <label className={label}>Traveller role *<select className={field} value={travellerDraft.traveller_type} onChange={event=>setTravellerDraft({...travellerDraft,traveller_type:event.target.value})}>{[['principal','Principal traveller'],['accompanying','Accompanying traveller'],['assistant','Personal assistant'],['dependent','Dependent'],['other','Other']].map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
              <span id="sjm-traveller-ref-help" className="sjm-traveller-field-help">Journey-specific reference; generated automatically. Edit only if a duplicate needs resolving.</span>
            </div>
            <div className="sjm-traveller-form-grid sjm-traveller-form-grid--names">
              {input('Title',travellerDraft.title,value=>setTravellerDraft({...travellerDraft,title:value}),'Mr / Ms / Dr')}
              {input('Given name *',travellerDraft.given_name,value=>setTravellerDraft({...travellerDraft,given_name:value}),'As printed on travel document')}
              {input('Middle / additional names',travellerDraft.middle_name,value=>setTravellerDraft({...travellerDraft,middle_name:value}),'Include all document names')}
              {input('Family / surname *',travellerDraft.family_name,value=>setTravellerDraft({...travellerDraft,family_name:value}),'As printed on travel document')}
              {input('Preferred / known-as name',travellerDraft.preferred_name,value=>setTravellerDraft({...travellerDraft,preferred_name:value}),'Optional; used for operations')}
            </div>
            <div className="sjm-traveller-form-grid sjm-traveller-form-grid--identity">
              {countrySelect('Nationality / citizenship',travellerDraft.nationality,value=>setTravellerDraft({...travellerDraft,nationality:value}))}
              {input('Date of birth',travellerDraft.date_of_birth,value=>setTravellerDraft({...travellerDraft,date_of_birth:value}),'','date')}
            </div>
            <p className="sjm-traveller-field-help">Do not shorten names or substitute a preferred name for the legal document name. The reference and preferred name are internal Sonalit fields, not airline document data.</p>
          </section>}
          {travellerStep === 1 && <section className="sjm-traveller-wizard__body" aria-labelledby="sjm-traveller-contact-heading">
            <div className="sjm-traveller-step-heading"><div><h6 id="sjm-traveller-contact-heading">Contacts and relationships</h6><p>These details help coordinators contact the traveller and understand the party structure.</p></div></div>
            <div className="sjm-traveller-form-grid sjm-traveller-form-grid--identity">
              {input('Email address',travellerDraft.email,value=>setTravellerDraft({...travellerDraft,email:value}),'name@example.com','email')}
              {input('Traveller phone',travellerDraft.phone,value=>setTravellerDraft({...travellerDraft,phone:value}),'+254 712 345 678','tel')}
            </div>
            {travellerDraft.traveller_type !== 'principal' && <div className="sjm-traveller-form-grid sjm-traveller-form-grid--identity">
              <label className={label}>Relationship to principal traveller<select className={field} value={travellerDraft.relationship_to_principal} onChange={event=>setTravellerDraft({...travellerDraft,relationship_to_principal:event.target.value})}><option value="">Select relationship</option>{['Spouse / partner','Child','Parent','Sibling','Relative','Personal assistant','Colleague','Security detail','Other'].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
            </div>}
            <div className="sjm-traveller-subheading">Emergency contact <span>Optional, but recommended for international journeys</span></div>
            <div className="sjm-traveller-form-grid sjm-traveller-form-grid--identity">
              {input('Contact full name',travellerDraft.emergency_contact_name,value=>setTravellerDraft({...travellerDraft,emergency_contact_name:value}),'Full name')}
              <label className={label}>Relationship<select className={field} value={travellerDraft.emergency_contact_relationship} onChange={event=>setTravellerDraft({...travellerDraft,emergency_contact_relationship:event.target.value})}><option value="">Select relationship</option>{['Spouse / partner','Parent','Child','Sibling','Relative','Friend','Colleague','Other'].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
              {input('Emergency contact phone',travellerDraft.emergency_contact_phone,value=>setTravellerDraft({...travellerDraft,emergency_contact_phone:value}),'+254 7xx xxx xxx','tel')}
            </div>
            <label className="sjm-traveller-internal-notes">Restricted operational notes <span>Manager-only · optional</span><textarea className={field} rows={2} maxLength={1200} value={travellerDraft.internal_notes} onChange={event=>setTravellerDraft({...travellerDraft,internal_notes:event.target.value})} placeholder="Only information necessary for the authorised mobility team."/></label>
            <p className="sjm-traveller-field-help">Use international phone format with country calling code. Emergency contact details are restricted with the traveller profile.</p>
          </section>}
          {travellerStep === 2 && <section className="sjm-traveller-wizard__body" aria-labelledby="sjm-traveller-documents-heading">
            <div className="sjm-traveller-step-heading"><div><h6 id="sjm-traveller-documents-heading">Travel documents</h6><p>Add a passport, visa, e-ticket or other travel evidence. You may skip the upload and attach it later.</p></div><span className="sjm-field-optional-note">Optional at registration</span></div>
            <div className="sjm-traveller-form-grid sjm-traveller-form-grid--identity">
              <label className={label}>Document type<select className={field} value={documentType} onChange={event=>setDocumentType(event.target.value)}>{[['passport','Passport'],['visa','Visa'],['e_ticket','E-ticket'],['boarding_pass','Boarding pass'],['booking_confirmation','Booking confirmation'],['itinerary','Travel itinerary'],['travel_insurance','Travel insurance'],['invitation_letter','Invitation letter'],['residence_permit','Residence permit'],['other','Other']].map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
              {input('Name on document',documentHolder,value=>setDocumentHolder(value),'As printed on document')}
              {countrySelect('Issuing country',documentCountry,setDocumentCountry)}
              {input('Issue date',documentIssueDate,setDocumentIssueDate,'','date')}
              {input('Expiry date',documentExpiryDate,setDocumentExpiryDate,'','date')}
            </div>
            <label className="sjm-traveller-file-field"><span>Secure document file <span className="sjm-field-optional-note">Optional</span></span><input type="file" accept="application/pdf,image/jpeg,image/png" disabled={Boolean(documentUploadState)} onChange={event=>{setTravellerDocumentFile(event.target.files?.[0] || null); setTravellerFormError('');}}/><span className="sjm-traveller-field-help">PDF up to 25 MiB; JPEG / PNG up to 20 MiB. The file is uploaded to private SJM evidence storage, integrity-checked, then queued for authorised review.</span></label>
            {travellerDocumentFile && <p className="sjm-traveller-selected-file"><span>{travellerDocumentFile.name}</span><span>{sizeLabel(travellerDocumentFile.size)}</span></p>}
            <p className="sjm-traveller-field-help">Do not type a passport or visa number into operational notes. The private document object is the controlled record; upload availability depends on dedicated SJM storage configuration.</p>
          </section>}
          {travellerStep === 3 && <section className="sjm-traveller-wizard__body" aria-labelledby="sjm-traveller-review-heading">
            <div className="sjm-traveller-step-heading"><div><h6 id="sjm-traveller-review-heading">Review before saving</h6><p>Check spelling and contact details. You can go back to correct any section.</p></div></div>
            <dl className="sjm-traveller-review-list">
              <div><dt>Legal name</dt><dd>{displayTravellerName(travellerDraft) || 'Not entered'}</dd></div>
              <div><dt>Traveller role</dt><dd>{statusLabel(travellerDraft.traveller_type)}{travellerDraft.relationship_to_principal ? ' · '+travellerDraft.relationship_to_principal : ''}</dd></div>
              <div><dt>Nationality / citizenship</dt><dd>{countryFlagUrl(countryCodeFromName(travellerDraft.nationality)) && <img src={countryFlagUrl(countryCodeFromName(travellerDraft.nationality)) || ''} alt="" aria-hidden="true" className="sjm-country-flag" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/>}{travellerDraft.nationality || 'Not recorded'}</dd></div>
              <div><dt>Date of birth</dt><dd>{travellerDraft.date_of_birth || 'Not recorded'}</dd></div>
              <div><dt>Preferred name</dt><dd>{travellerDraft.preferred_name || 'Same as legal name / not provided'}</dd></div>
              <div><dt>Contact</dt><dd>{[travellerDraft.email,travellerDraft.phone].filter(Boolean).join(' · ') || 'Not provided'}</dd></div>
              <div><dt>Emergency contact</dt><dd>{travellerDraft.emergency_contact_name ? [travellerDraft.emergency_contact_name,travellerDraft.emergency_contact_relationship,travellerDraft.emergency_contact_phone].filter(Boolean).join(' · ') : 'Not provided'}</dd></div>
              <div><dt>Travel document</dt><dd>{travellerDocumentFile ? documentType.replaceAll('_',' ')+' · '+travellerDocumentFile.name : 'Not attached now · can be added later'}</dd></div>
            </dl>
          </section>}
          <div className="sjm-traveller-wizard__actions">
            <button type="button" className={button} onClick={()=>{ if (travellerStep===0) { setShowTravellerForm(false); setTravellerFormError(''); } else { setTravellerStep(step=>step-1); setTravellerFormError(''); } }} disabled={createTraveller.isPending || updateTraveller.isPending}>{travellerStep===0?'Cancel':'Back'}</button>
            <span className="sjm-traveller-wizard__action-spacer"/>
            {travellerStep < 3 ? <button type="submit" className={buttonPrimary}>Continue <span aria-hidden="true">→</span></button> : <button type="submit" className={buttonPrimary} disabled={createTraveller.isPending || updateTraveller.isPending}>{createTraveller.isPending || updateTraveller.isPending ? 'Saving…' : editingTravellerId ? 'Save traveller changes' : 'Register traveller'}</button>}
          </div>
        </form>}
      </section>

      <section className={panel + ' sjm-travel-section sjm-travel-section--flights overflow-hidden'}>
        <div className="sjm-travel-section__header flex items-center justify-between gap-3 border-b border-white/[0.07] p-4"><div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">02 / AIR MOVEMENTS</p><h4 className="mt-1 text-sm font-semibold text-white">Flight segments</h4><p className="mt-1 text-[10px] text-slate-500">Booked legs, connections and airport-local timings</p></div><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-slate-500">{flights.length} leg(s)</span>{canManage&&planEditable&&<button type="button" className={buttonPrimary} onClick={()=>{setShowFlightForm(value=>!value);setEditingFlightId('');setFlightDraft({...EMPTY_FLIGHT,departure_timezone:timezone,arrival_timezone:timezone});}}><Plus size={12}/>Add flight</button>}</div></div>
        <div className="space-y-3 p-4">
          {data?.legacy_flight_reference && Object.values(data.legacy_flight_reference).some(Boolean) && <div className="rounded-md border border-sky-300/10 bg-sky-300/[0.025] p-3"><p className="text-[10px] font-semibold tracking-wide text-sky-100/80">ORIGINAL JOURNEY INTAKE REFERENCE</p><p className="mt-1 text-[11px] text-slate-300">{[data.legacy_flight_reference.airline,data.legacy_flight_reference.flight_number,data.legacy_flight_reference.airport_code&&'Airport '+data.legacy_flight_reference.airport_code,data.legacy_flight_reference.terminal&&'Terminal '+data.legacy_flight_reference.terminal].filter(Boolean).join(' · ')}</p><p className="mt-1 text-[10px] text-slate-500">Scheduled · {dateLabel(data.legacy_flight_reference.scheduled_at,timezone)}. This is the original journey summary; it is retained for traceability but does not replace a complete departure/arrival flight segment.</p></div>}
          {flights.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-[11px] leading-5 text-slate-500">No complete flight legs have been registered. Record every connection separately; the aircraft surveillance feed is not a substitute for a confirmed booking or itinerary.</p> :
            <div className="space-y-2">{flights.map(flight => <article key={flight.id} className="sjm-travel-flight-card rounded-md border border-white/[0.07] bg-black/15 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-white">{flight.carrier} · {flight.flight_number}</p><p className="mt-1 font-mono text-[10px] text-slate-500">LEG {String(flight.sequence).padStart(2,'0')} · {flight.status.toUpperCase()} · {flight.status_source.replaceAll('_',' ')}</p>{flight.traveller_display_name&&<p className="mt-1 text-[10px] text-sky-100/85">Traveller · {flight.traveller_display_name}</p>}</div><AirlineMark code={airlineIataCodeFromFlightNumber(flight.flight_number)} workspaceBase={base}/></div><div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><div><p className="font-mono text-lg font-semibold text-white">{flight.departure_airport}</p><p className="text-[10px] text-slate-500">{flight.departure_airport_name || 'Departure airport'}</p><p className="mt-2 text-[10px] text-slate-300">{dateLabel(flight.departure_at,flight.departure_timezone)}</p><p className="mt-1 text-[10px] text-slate-600">{[flight.departure_terminal,flight.departure_gate].filter(Boolean).join(' · ')}</p></div><Plane size={14} className="text-sky-200"/><div className="text-right"><p className="font-mono text-lg font-semibold text-white">{flight.arrival_airport}</p><p className="text-[10px] text-slate-500">{flight.arrival_airport_name || 'Arrival airport'}</p><p className="mt-2 text-[10px] text-slate-300">{dateLabel(flight.arrival_at,flight.arrival_timezone)}</p><p className="mt-1 text-[10px] text-slate-600">{[flight.arrival_terminal,flight.arrival_gate].filter(Boolean).join(' · ')}</p></div></div>{flight.status_note&&<p className="mt-2 border-t border-white/[0.05] pt-2 text-[10px] leading-4 text-slate-500">{flight.status_note}</p>}<div className="mt-3 flex flex-wrap items-center gap-2">{canManage && planEditable && !['boarding','departed','landed','cancelled','diverted'].includes(flight.status) && <button type="button" className={button} onClick={() => { setEditingFlightId(flight.id); setShowFlightForm(true); setFlightDraft({ traveller_id: flight.traveller_id || '', carrier: flight.carrier, flight_number: flight.flight_number, departure_airport: flight.departure_airport, departure_airport_name: flight.departure_airport_name || '', departure_terminal: flight.departure_terminal || '', departure_gate: flight.departure_gate || '', departure_at: localDateTimeInputInTimezone(flight.departure_at,flight.departure_timezone), departure_timezone: flight.departure_timezone, arrival_airport: flight.arrival_airport, arrival_airport_name: flight.arrival_airport_name || '', arrival_terminal: flight.arrival_terminal || '', arrival_gate: flight.arrival_gate || '', arrival_at: localDateTimeInputInTimezone(flight.arrival_at,flight.arrival_timezone), arrival_timezone: flight.arrival_timezone, booking_reference: flight.booking_reference || '' }); }}>Edit flight</button>}{canManage || !readOnly ? <div className="min-w-[210px] flex-1"><label className={label}>Observed flight status<select className={field} value={flightStatusSelections[flight.id] || flight.status} disabled={readOnly} onChange={event=>setFlightStatusSelections(current=>({...current,[flight.id]:event.target.value}))}>{flight.allowed_next_statuses.map(status=><option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label className={label + ' mt-2'}>Operator observation note<textarea className={field} rows={2} value={flightStatusNotes[flight.id] || ''} disabled={readOnly} onChange={event=>setFlightStatusNotes(current=>({...current,[flight.id]:event.target.value}))} placeholder="Source, time observed and context for this status."/></label><button type="button" className={button + ' mt-2'} onClick={()=>updateFlightStatus.mutate({id:flight.id,status:flightStatusSelections[flight.id] || flight.status,note:flightStatusNotes[flight.id] || ''})} disabled={readOnly || updateFlightStatus.isPending || (flightStatusNotes[flight.id] || '').trim().length<10}>Record status</button></div> : <span className="text-[10px] text-slate-500">Status: {statusLabel(flight.status)}</span>}{flight.booking_reference&&canManage&&<span className="self-end text-[10px] text-slate-500">Booking ref: {flight.booking_reference}</span>}</div></article>)}</div>}
        </div>
        {canManage && planEditable && showFlightForm && <form className="space-y-3 border-t border-white/[0.07] bg-black/10 p-4" onSubmit={event=>{event.preventDefault();createFlight.mutate();}}>
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Plane size={14} className="text-sky-200"/><p className="text-xs font-semibold text-slate-200">{editingFlightId ? 'Edit flight segment' : 'Add a flight leg'}</p></div>{editingFlightId && <button type="button" className={button} onClick={() => { setEditingFlightId(''); setShowFlightForm(false); setFlightDraft({ ...EMPTY_FLIGHT, departure_timezone: timezone, arrival_timezone: timezone }); }}>Cancel edit</button>}</div>
          <div className="grid grid-cols-2 gap-2"><label className={label}>Traveller<select className={field} value={flightDraft.traveller_id} onChange={event=>setFlightDraft({...flightDraft,traveller_id:event.target.value})}><option value="">Shared / all travellers</option>{travellers.map(traveller=><option key={traveller.id} value={traveller.id}>{traveller.display_name}</option>)}</select></label>{input('Airline / carrier *',flightDraft.carrier,value=>setFlightDraft({...flightDraft,carrier:value}))}</div>
          <div className="grid grid-cols-2 gap-2">{input('Flight number *',flightDraft.flight_number,value=>setFlightDraft({...flightDraft,flight_number:value}),'KQ 100')}{input('Booking reference',flightDraft.booking_reference,value=>setFlightDraft({...flightDraft,booking_reference:value}))}</div>{airlineIataCodeFromFlightNumber(flightDraft.flight_number) && <div className="sjm-airline-preview"><AirlineMark code={airlineIataCodeFromFlightNumber(flightDraft.flight_number)} workspaceBase={base}/><span>Carrier mark · IATA {airlineIataCodeFromFlightNumber(flightDraft.flight_number)}</span></div>}
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
