export type SjmAircraftObservation = {
  id:string;
  ident:string;
  registration?:string|null;
  origin?:string|null;
  destination?:string|null;
  observed_at:string;
  freshness:string;
  latitude:number;
  longitude:number;
  altitude_m:number|null;
  altitude_reference?:'WGS84_ELLIPSOID'|'GEOMETRIC'|'BAROMETRIC_PRESSURE'|null;
  ground_speed_mps:number|null;
  heading_deg:number|null;
};
export type SjmProviderFlightEvent = {
  type:string;
  flight_id?:string|null;
  ident?:string|null;
  airport?:string|null;
  origin?:string|null;
  destination?:string|null;
  observed_at?:string|null;
  received_at:string;
};
export type SjmFlightCorrelationStatus =
  | 'NO_REFERENCE'
  | 'NOT_CONFIGURED'
  | 'FEED_UNAVAILABLE'
  | 'MATCHED'
  | 'AMBIGUOUS'
  | 'EVENT_ONLY'
  | 'NO_MATCH';
export type SjmFlightCorrelation = {
  status:SjmFlightCorrelationStatus;
  reference:string|null;
  normalised_reference:string|null;
  aircraft:SjmAircraftObservation[];
  events:SjmProviderFlightEvent[];
  airport_alignment:'MATCHED'|'NOT_ESTABLISHED'|'NO_AIRPORT_REFERENCE';
  explanation:string;
};

export function normaliseFlightIdent(value:string|null|undefined):string {
  return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
}

export function correlateJourneyFlight(input:{
  flightReference?:string|null;
  airportCode?:string|null;
  configured:boolean;
  connected:boolean;
  providerStatus:string;
  aircraft:SjmAircraftObservation[];
  events:SjmProviderFlightEvent[];
}):SjmFlightCorrelation {
  const reference=String(input.flightReference||'').trim()||null;
  const key=normaliseFlightIdent(reference);
  const airport=normaliseFlightIdent(input.airportCode);
  const empty={
    reference,normalised_reference:key||null,aircraft:[] as SjmAircraftObservation[],
    events:[] as SjmProviderFlightEvent[],
    airport_alignment:(airport?'NOT_ESTABLISHED':'NO_AIRPORT_REFERENCE') as SjmFlightCorrelation['airport_alignment'],
  };
  if(!key)return {...empty,status:'NO_REFERENCE',explanation:'No flight reference is recorded on this journey.'};
  if(!input.configured||input.providerStatus==='NOT_CONFIGURED')return {...empty,status:'NOT_CONFIGURED',explanation:'OpenSky access is not configured; no flight correlation is available.'};
  const aircraft=(input.aircraft||[]).filter(item=>{
    const ident=normaliseFlightIdent(item.ident);
    return ident===key;
  });
  const events=(input.events||[]).filter(item=>normaliseFlightIdent(item.ident)===key);
  const airportAlignment=airport&&aircraft.some(item=>
    normaliseFlightIdent(item.origin)===airport||normaliseFlightIdent(item.destination)===airport,
  )?'MATCHED':airport?'NOT_ESTABLISHED':'NO_AIRPORT_REFERENCE';
  const status:SjmFlightCorrelationStatus=aircraft.length===1?'MATCHED'
    :aircraft.length>1?'AMBIGUOUS'
      :events.length?'EVENT_ONLY'
        :!input.connected&&['UNAVAILABLE','RATE_LIMITED','DEGRADED'].includes(input.providerStatus)?'FEED_UNAVAILABLE':'NO_MATCH';
  const explanation=status==='MATCHED'
    ?'One OpenSky state vector has an exact callsign match. The REST response does not include aircraft registration; this correlation is not proof of passenger identity or journey arrival.'
    :status==='AMBIGUOUS'
      ?'More than one OpenSky callsign record matches this reference. No aircraft is selected automatically.'
      :status==='EVENT_ONLY'
        ?'Provider flight-information events match this reference, but no current aircraft position matches it.'
        :status==='FEED_UNAVAILABLE'
          ?'The OpenSky snapshot is unavailable or rate-limited; a missing match cannot be interpreted as absence of the flight.'
          :'No exact callsign match is present in the latest bounded OpenSky snapshot. Coverage is incomplete and airline flight-information events are not supplied by this API.';
  return {...empty,status,aircraft,events,airport_alignment:airportAlignment,explanation};
}
