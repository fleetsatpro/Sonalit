-- Intelligence geography hardening.
-- A source/feed country is only a hint. Country attribution must be supported by
-- textual geographic evidence, otherwise the record becomes UNRESOLVED.

CREATE OR REPLACE FUNCTION intel_country_evidence_ok(p_country_code text, p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE UPPER(COALESCE(p_country_code,''))
    WHEN 'KE' THEN LOWER(COALESCE(p_text,'')) ~ '(\mkenya\M|\mnairobi\M|\mmombasa\M|\mkisumu\M|\mnakuru\M|\meldoret\M|\mgarissa\M|\mmandera\M|\mlamu\M|\misiolo\M|\mturkana\M|\mmarsabit\M|\mkakamega\M|\mkitale\M|\mkericho\M|\mmachakos\M|\mnarok\M|\mnaivasha\M|\mmalindi\M|\mkilifi\M|\mkwale\M)'
    WHEN 'TZ' THEN LOWER(COALESCE(p_text,'')) ~ '(\mtanzania\M|\mdar es salaam\M|\mdodoma\M|\marusha\M|\mmwanza\M|\mmbeya\M|\mzanzibar\M|\mtanga\M|\mmorogoro\M|\mmtwara\M|\mkigoma\M|\mmoshi\M)'
    WHEN 'UG' THEN LOWER(COALESCE(p_text,'')) ~ '(\muganda\M|\mkampala\M|\mentebbe\M|\mgulu\M|\mmbarara\M|\mjinja\M|\mfort portal\M|\mkasese\M|\mbusia\M|\mmbale\M|\mlira\M|\marua\M|\mmasaka\M)'
    WHEN 'RW' THEN LOWER(COALESCE(p_text,'')) ~ '(\mrwanda\M|\mkigali\M|\mrubavu\M|\mrusizi\M|\mmusanze\M|\mgisenyi\M|\mhuye\M|\mnyagatare\M|\mkarongi\M)'
    WHEN 'BI' THEN LOWER(COALESCE(p_text,'')) ~ '(\mburundi\M|\mbujumbura\M|\mgitega\M|\mngozi\M|\mrumonge\M|\mmuyinga\M|\mcibitoke\M)'
    WHEN 'SS' THEN LOWER(COALESCE(p_text,'')) ~ '(\msouth sudan\M|\mjuba\M|\mbor\M|\mmalakal\M|\mwau\M|\mnimule\M|\myei\M|\mbentiu\M|\mrenk\M)'
    WHEN 'ET' THEN LOWER(COALESCE(p_text,'')) ~ '(\methiopia\M|\maddis ababa\M|\mdire dawa\M|\mmekelle\M|\mgondar\M|\mbahir dar\M|\mjijiga\M|\madama\M|\mhawassa\M|\mtigray\M|\mamhara\M|\moromia\M)'
    WHEN 'SO' THEN LOWER(COALESCE(p_text,'')) ~ '(\msomalia\M|\mmogadishu\M|\mhargeisa\M|\mkismayo\M|\mbaidoa\M|\mgarowe\M|\mbosaso\M|\mbeledweyne\M|\mgalkayo\M|\mpuntland\M|\msomaliland\M)'
    WHEN 'CD' THEN LOWER(COALESCE(p_text,'')) ~ '(\mdrc\M|\mdr congo\M|\mdemocratic republic of the congo\M|\mkinshasa\M|\mgoma\M|\mbukavu\M|\mbeni\M|\mmasisi\M|\mituri\M|\mnorth kivu\M|\msouth kivu\M|\mlubumbashi\M)'
    WHEN 'SD' THEN LOWER(COALESCE(p_text,'')) ~ '(\msudan\M|\mkhartoum\M|\mdarfur\M|\mport sudan\M|\mel fasher\M|\momdurman\M|\mgedaref\M|\mkassala\M|\mkordofan\M)'
    ELSE TRUE
  END;
$$;

CREATE OR REPLACE FUNCTION intel_country_attribution_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payload text;
BEGIN
  IF NEW.country_code IS NULL THEN RETURN NEW; END IF;
  payload := LOWER(CONCAT_WS(' ',
    COALESCE(to_jsonb(NEW)->>'title',''),
    COALESCE(to_jsonb(NEW)->>'headline',''),
    COALESCE(to_jsonb(NEW)->>'summary',''),
    COALESCE(to_jsonb(NEW)->>'description',''),
    COALESCE(to_jsonb(NEW)->>'body',''),
    COALESCE(to_jsonb(NEW)->>'judgement',''),
    COALESCE(to_jsonb(NEW)->>'assessment',''),
    COALESCE(to_jsonb(NEW)->>'scenario',''),
    COALESCE(to_jsonb(NEW)->>'destination',''),
    COALESCE(to_jsonb(NEW)->>'reference',''),
    COALESCE(to_jsonb(NEW)->>'name','')
  ));
  IF NOT intel_country_evidence_ok(NEW.country_code,payload) THEN
    NEW.country_code := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS intel_observations_country_attribution_guard ON intel_observations;
CREATE TRIGGER intel_observations_country_attribution_guard
BEFORE INSERT OR UPDATE ON intel_observations
FOR EACH ROW EXECUTE FUNCTION intel_country_attribution_guard();

DROP TRIGGER IF EXISTS intel_events_country_attribution_guard ON intel_events;
CREATE TRIGGER intel_events_country_attribution_guard
BEFORE INSERT OR UPDATE ON intel_events
FOR EACH ROW EXECUTE FUNCTION intel_country_attribution_guard();

-- Repair existing misclassified observations/events. Records remain available
-- globally; they simply stop appearing inside an unsupported country theatre.
UPDATE intel_observations o
SET country_code = NULL
WHERE o.country_code IS NOT NULL
  AND NOT intel_country_evidence_ok(o.country_code, CONCAT_WS(' ',o.title,o.body));

UPDATE intel_events e
SET country_code = NULL
WHERE e.country_code IS NOT NULL
  AND NOT intel_country_evidence_ok(e.country_code, CONCAT_WS(' ',e.title,e.summary));

CREATE INDEX IF NOT EXISTS idx_intel_observations_country_recent
  ON intel_observations (org_id,country_code,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_events_country_recent
  ON intel_events (org_id,country_code,last_seen_at DESC);
