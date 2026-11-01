-- Upgrade saved SJM client report profiles to template version 2.
-- The original editor only exposed the six operational sections. Preserve each
-- profile's existing choices, then append the five traveller/flight/programme
-- sections that were previously unavailable in the UI. A deliberately empty
-- section list stays empty. Versioned profiles are never rewritten.
BEGIN;

UPDATE public.sjm_client_profiles AS profile
SET report_template = jsonb_set(
  jsonb_set(
    COALESCE(profile.report_template, '{}'::jsonb),
    '{sections}',
    CASE
      WHEN jsonb_typeof(profile.report_template->'sections') = 'array' THEN
        CASE
          WHEN jsonb_array_length(profile.report_template->'sections') = 0
            THEN profile.report_template->'sections'
          ELSE
            profile.report_template->'sections' ||
            COALESCE((
              SELECT jsonb_agg(to_jsonb(addition.section) ORDER BY addition.ordinality)
              FROM unnest(ARRAY[
                'traveller_dossier',
                'flight_segments',
                'daily_programme',
                'travel_readiness',
                'document_status'
              ]::text[]) WITH ORDINALITY AS addition(section, ordinality)
              WHERE NOT (profile.report_template->'sections' ? addition.section)
            ), '[]'::jsonb)
        END
      ELSE
        '["summary","itinerary","stops","route_assessment","operational_events","telemetry_snapshot","traveller_dossier","flight_segments","daily_programme","travel_readiness","document_status"]'::jsonb
    END,
    true
  ),
  '{version}',
  '2'::jsonb,
  true
)
WHERE jsonb_typeof(profile.report_template) = 'object'
  AND profile.report_template->>'version' IS DISTINCT FROM '2';

COMMIT;
