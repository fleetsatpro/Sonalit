-- Intelligence geography hardening.
-- Feed/source country is a collection hint, never authoritative attribution.
-- Ambiguous articles mentioning multiple East African theatres are kept
-- unresolved rather than being forced into the wrong country.

CREATE OR REPLACE FUNCTION intel_country_evidence_ok(p_country_code text, p_text text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t text := lower(coalesce(p_text,''));
  c text := upper(coalesce(p_country_code,''));
  target_ok boolean := false;
  other_ok boolean := false;
BEGIN
  CASE c
    WHEN 'KE' THEN target_ok := t ~ '(\mkenya\M|\mnairobi\M|\mmombasa\M|\mkisumu\M|\mnakuru\M|\meldoret\M|\mgarissa\M|\mmandera\M|\mlamu\M|\misiolo\M|\mturkana\M|\mmarsabit\M|\mkakamega\M|\mkitale\M|\mkericho\M|\mmachakos\M|\mnarok\M|\mnaivasha\M|\mmalindi\M|\mkilifi\M|\mkwale\M)';
    WHEN 'TZ' THEN target_ok := t ~ '(\mtanzania\M|\mdar es salaam\M|\mdodoma\M|\marusha\M|\mmwanza\M|\mmbeya\M|\mzanzibar\M|\mtanga\M|\tmorogoro\M|\mmtwara\M|\mkigoma\M|\mmoshi\M)';
    WHEN 'UG' THEN target_ok := t ~ '(\muganda\M|\mkampala\M|\mentebbe\M|\mgulu\M|\mmbarara\M|\mjinja\M|\mfort portal\M|\mkasese\M|\mbusia\M|\mmbale\M|\mlira\M|\marua\M|\mmasaka\M)';
    WHEN 'RW' THEN target_ok := t ~ '(\mrwanda\M|\mkigali\M|\mrubavu\M|\mrusizi\M|\mmusanze\M|\mgisenyi\M|\mhuye\M|\mnyagatare\M|\mkarongi\M)';
    WHEN 'BI' THEN target_ok := t ~ '(\mburundi\M|\mbujumbura\M|\mgitega\M|\mngozi\M|\mrumonge\M|\mmuyinga\M|\mcibitoke\M)';
    WHEN 'SS' THEN target_ok := t ~ '(\msouth sudan\M|\mjuba\M|\mbor\M|\mmalakal\M|\mwau\M|\mnimule\M|\myei\M|\mbentiu\M|\mrenk\M)';
    WHEN 'ET' THEN target_ok := t ~ '(\methiopia\M|\maddis ababa\M|\mdire dawa\M|\mmekelle\M|\mgondar\M|\mbahir dar\M|\mjijiga\M|\madama\M|\mhawassa\M|\mtigray\M|\mamhara\M|\moromia\M)';
    WHEN 'SO' THEN target_ok := t ~ '(\msomalia\M|\mmogadishu\M|\mhargeisa\M|\mkismayo\M|\mbaidoa\M|\mgarowe\M|\mbosaso\M|\mbeledweyne\M|\mgalkayo\M|\mpuntland\M|\msomaliland\M)';
    WHEN 'CD' THEN target_ok := t ~ '(\mdrc\M|\mdr congo\M|\mdemocratic republic of the congo\M|\mkinshasa\M|\mgoma\M|\mbukavu\M|\mbukavu\M|\mbeni\M|\mmasisi\M|\mituri\M|\mnorth kivu\M|\msouth kivu\M|\mlubumbashi\M)';
    WHEN 'SD' THEN target_ok := t ~ '(\msudan\M|\mkhartoum\M|\mdarfur\M|\mport sudan\M|\mel fasher\M|\momdurman\M|\mgedaref\M|\mkassala\M|\mkordofan\M)';
    ELSE target_ok := false;
  END CASE;
  IF NOT target_ok THEN RETURN false; END IF;
  other_ok := CASE c
    WHEN 'KE' THEN t ~ '(\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'TZ' THEN t ~ '(\mkenya\M|\mnairobi\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'UG' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'RW' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'BI' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'SS' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'ET' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'SO' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\mdrc\M|\mgoma\M|\msudan\M|\mkhartoum\M)'
    WHEN 'CD' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\msudan\M|\mkhartoum\M)'
    WHEN 'SD' THEN t ~ '(\mkenya\M|\mnairobi\M|\mtanzania\M|\mdar es salaam\M|\muganda\M|\mkampala\M|\mrwanda\M|\mkigali\M|\mburundi\M|\mbujumbura\M|\msouth sudan\M|\mjuba\M|\methiopia\M|\maddis ababa\M|\msomalia\M|\mmogadishu\M|\mdrc\M|\mgoma\M)'
    ELSE false
  END;
  RETURN NOT other_ok;
END;
$$;

CREATE OR REPLACE FUNCTION intel_country_attribution_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE payload text;
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
  IF NOT intel_country_evidence_ok(NEW.country_code,payload) THEN NEW.country_code := NULL; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS intel_observations_country_attribution_guard ON intel_observations;
CREATE TRIGGER intel_observations_country_attribution_guard BEFORE INSERT OR UPDATE ON intel_observations FOR EACH ROW EXECUTE FUNCTION intel_country_attribution_guard();
DROP TRIGGER IF EXISTS intel_events_country_attribution_guard ON intel_events;
CREATE TRIGGER intel_events_country_attribution_guard BEFORE INSERT OR UPDATE ON intel_events FOR EACH ROW EXECUTE FUNCTION intel_country_attribution_guard();

UPDATE intel_observations o SET country_code=NULL WHERE o.country_code IS NOT NULL AND NOT intel_country_evidence_ok(o.country_code,CONCAT_WS(' ',o.title,o.body));
UPDATE intel_events e SET country_code=NULL WHERE e.country_code IS NOT NULL AND NOT intel_country_evidence_ok(e.country_code,CONCAT_WS(' ',e.title,e.summary));

CREATE INDEX IF NOT EXISTS idx_intel_observations_country_recent ON intel_observations (org_id,country_code,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_events_country_recent ON intel_events (org_id,country_code,last_seen_at DESC);
