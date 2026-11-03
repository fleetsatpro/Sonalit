# Intel Hub publication template studio

The studio is opened within the existing authenticated Intel Hub > Publication Desk. It can open a blank master or import a selected governed publication record. No new public route or unauthenticated publishing endpoint is added.

## Data contract
The adapter derives fields only from the selected record returned by the existing tenant-scoped publication API. It does not infer missing counts, confidence, sources, handling, event time, or risk. Missing values remain unresolved. The date range is formatted using the publication timezone where recorded, defaulting to the configured operations timezone for display only.

## Editor isolation
The A4 HTML authoring master runs in a sandboxed iframe without same-origin privileges. The parent passes a versioned postMessage contract. The template accepts messages only when event.source is its parent window, checks a fixed message type, bounds strings, and inserts imported values through textContent. Imported data is not executed as HTML.

## Release boundary
The studio is a local authoring/preview surface. It never writes changes to the publication record or overwrites the governed R2 PDF. Imported previews are visibly watermarked as not official releases. The existing authenticated PDF pipeline remains the official export and all evidence, research, editorial, handling and release gates remain authoritative. Analysts must still verify provenance and approval before distribution.
