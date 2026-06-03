-- T6.5: Partition archival — drop partitions older than retention window
-- Called by the hourly cron in app.js alongside ensure_future_partitions.

CREATE OR REPLACE FUNCTION drop_old_partitions(p_table TEXT, retain_months INT DEFAULT 12)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  cutoff      DATE;
  child_name  TEXT;
  dropped     INT := 0;
BEGIN
  cutoff := DATE_TRUNC('month', NOW() - (retain_months || ' months')::INTERVAL)::DATE;

  FOR child_name IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class  p ON p.oid = i.inhparent
    JOIN pg_class  c ON c.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.relname = p_table
      AND n.nspname = 'public'
      AND c.relname ~ ('^' || p_table || '_[0-9]{4}_[0-9]{2}$')
  LOOP
    -- Extract YYYY_MM suffix and convert to date
    DECLARE
      suffix TEXT := SUBSTRING(child_name FROM LENGTH(p_table) + 2);
      part_date DATE;
    BEGIN
      part_date := TO_DATE(suffix, 'YYYY_MM');
      IF part_date < cutoff THEN
        EXECUTE format('DROP TABLE IF EXISTS %I', child_name);
        dropped := dropped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN dropped;
END;
$$;
