export type SjmAircraftObservation = {
  id:string;
  position_provider?:string|null;
  position_source_label?:string|null;
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
  | 'CORROBORATED'
  | 'SOURCE_DISAGREEMENT'
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
  sourceComparison?:{status?:string|null};
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
  const uniqueAircraftIds=new Set(aircraft.map(item=>String(item.id||'').toLowerCase()).filter(Boolean));
  const status:SjmFlightCorrelationStatus=input.sourceComparison?.status==='AIRCRAFT_ID_DISAGREEMENT'?'SOURCE_DISAGREEMENT'
    :uniqueAircraftIds.size===1&&input.sourceComparison?.status==='CORROBORATED'?'CORROBORATED'
      :uniqueAircraftIds.size===1?'MATCHED'
        :uniqueAircraftIds.size>1?'AMBIGUOUS'
          :events.length?'EVENT_ONLY'
            :!input.connected&&['UNAVAILABLE','RATE_LIMITED','DEGRADED'].includes(input.providerStatus)?'FEED_UNAVAILABLE':'NO_MATCH';
  const explanation=status==='CORROBORATED'
    ?'Independent provider observations share one ICAO24 address and pass the server-side time and position comparison. This corroborates an aircraft observation, not passenger identity or journey arrival.'
    :status==='MATCHED'
      ?'One unique ICAO24 aircraft identity matches the recorded callsign. Provider observations and timestamps remain separate; this is not proof of passenger identity or journey arrival.'
      :status==='SOURCE_DISAGREEMENT'
        ?'Providers associate this callsign with different ICAO24 addresses. Both observations remain visible; no aircraft is selected automatically.'
        :status==='AMBIGUOUS'
          ?'More than one distinct ICAO24 aircraft identity matches this reference. No aircraft is selected automatically.'
          :status==='EVENT_ONLY'
            ?'Provider flight-information events match this reference, but no current aircraft position matches it.'
            :status==='FEED_UNAVAILABLE'
              ?'All approved aircraft-position sources are unavailable or rate-limited; a missing match cannot be interpreted as absence of the flight.'
              :'No exact callsign match is present in the latest provider-bounded observations. Coverage is incomplete and an empty result does not prove the flight is absent.';
  return {...empty,status,aircraft,events,airport_alignment:airportAlignment,explanation};
}
