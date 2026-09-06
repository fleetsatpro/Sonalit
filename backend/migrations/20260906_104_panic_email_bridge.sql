-- Bridge every persisted Guardian panic into the existing Resend/BullMQ
-- notification pipeline. The application worker consumes this notification
-- and resolves the eligible organization authority recipients server-side.

CREATE OR REPLACE FUNCTION notify_sonalit_panic_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'sonalit_panic',
    json_build_object('id', NEW.id)::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sonalit_panic_email ON panic_events;

CREATE TRIGGER trg_sonalit_panic_email
AFTER INSERT ON panic_events
FOR EACH ROW
EXECUTE FUNCTION notify_sonalit_panic_email();
