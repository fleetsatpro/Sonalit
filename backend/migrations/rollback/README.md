# Rollback migrations

Manual DOWN migrations for every UP migration under `../`. They are **not**
run by `scripts/db-migrate.js` (which globs `*.sql` in the parent directory
alphabetically) — they live in this subdirectory so the sequential runner
skips them.

## Running a rollback

Pick the file that matches the UP you want to reverse, then apply it against
the target database yourself:

```
psql "$DATABASE_URL" -f backend/migrations/rollback/<file>.sql
```

Also remove the corresponding row from `schema_migrations` so the runner
knows the UP is no longer applied:

```
psql "$DATABASE_URL" -c "DELETE FROM schema_migrations WHERE filename = '<up file name>';"
```
