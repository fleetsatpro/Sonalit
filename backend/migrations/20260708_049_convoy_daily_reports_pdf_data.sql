-- convoy_daily_reports.pdf_data: durable in-DB copy of the generated PDF.
-- R2 upload can fail (misconfigured credentials) and the local-disk fallback
-- in convoyReportWorker.js does not survive a Railway redeploy (ephemeral
-- filesystem), so reports marked 'generated' could 404 on download with no
-- way to recover the bytes short of regenerating. Storing the (small,
-- text-only) PDF in Postgres guarantees the download endpoint always has a
-- copy regardless of R2/disk state.
ALTER TABLE convoy_daily_reports ADD COLUMN IF NOT EXISTS pdf_data BYTEA;
