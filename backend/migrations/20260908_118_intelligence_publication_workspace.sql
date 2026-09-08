-- Give the publication workspace useful governed starting points without
-- fabricating intelligence. These are explicitly draft workspaces/templates.
INSERT INTO intel_publications (org_id,country_code,publication_type,title,subtitle,status,body,created_by)
SELECT DISTINCT u.org_id,'KE',v.publication_type,v.title,v.subtitle,'draft',
  jsonb_build_object('template',true,'state','workspace','note','Draft publication workspace. No intelligence judgement is asserted until evidence is attached and analyst review is completed.'),u.id
FROM users u
CROSS JOIN (VALUES
  ('country_profile','Kenya Security Profile — Working Draft','Governed country profile workspace'),
  ('daily','Kenya Daily Security Intelligence Brief — Working Draft','Daily change and incident synthesis'),
  ('weekly','Kenya Weekly Security & Risk Outlook — Working Draft','Weekly trend and trajectory assessment'),
  ('executive_brief','Kenya Executive Intelligence Brief — Working Draft','Decision-focused executive dissemination')
) AS v(publication_type,title,subtitle)
WHERE NOT EXISTS (
  SELECT 1 FROM intel_publications p
  WHERE p.org_id=u.org_id AND p.country_code='KE' AND p.title=v.title
);
