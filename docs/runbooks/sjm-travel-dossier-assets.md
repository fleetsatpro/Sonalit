# SJM travel dossier — identity and visual assets

## Traveller identity capture

The traveller registration flow uses four short steps: identity, contacts and relationships, documents, and review. Enter legal names in the same order and spelling as the travel document; keep a preferred/known-as name as a separate operational label. Nationality/citizenship and issuing country are selected from the ISO 3166-1 alpha-2 catalogue and rendered with SVG country flags.

Do not add passport or visa numbers to free-text fields. The uploaded document is the controlled identity record: it is stored in the dedicated private SJM evidence bucket, committed through the existing integrity-verification flow, and then awaits authorised manager review. Traveller identity and emergency contact data remain manager-only. Field roles receive the minimum traveller display and movement information they need.

## Country flag artwork

The country list is the complete 249-entry ISO alpha-2 catalogue. Flag artwork is loaded as SVG from the MIT-licensed `flag-icons` package, pinned to version `7.6.0` through jsDelivr. The upstream copyright and MIT permission notice are retained in `apps/web/public/licenses/flag-icons-MIT.txt`. Country flag images are decorative; the country name remains visible and accessible in the form and profile summary. No flag emoji or unofficial text-symbol substitute is used.

## Airline logos

Airline marks are resolved from the IATA two-character designator in the flight number. SJM uses Airhex's airline-logo catalogue and its server-side signed image URL pattern. The API key is kept on the backend and must never be exposed via a `VITE_` browser variable or committed as a real secret.

1. Obtain an Airhex API key and confirm the intended production display / commercial rights with the provider.
2. Set `AIRHEX_API_KEY` in the backend secret store for each environment that is authorised to display the marks.
3. Deploy the backend route with the key. The authenticated SJM endpoint is `GET /api/v1/sjm/journeys/{journeyId}/travel-workspace/airline-logo/{IATA}`. It validates the provider response and returns PNG bytes through the authenticated SJM API; it does not redirect the browser to the Airhex CDN.
4. Verify a known carrier code, the signed image response, caching, and the fallback for an unknown carrier.

When the key is not configured or a provider has no matching mark, the frontend retains the carrier name and the flight's IATA code; it must not show a broken image, generic emoji, invented logo, or imply a provider relationship that is not configured.

## Asset and data boundaries

- Country flags identify a country; they do not prove nationality or citizenship.
- An airline logo identifies a flight-number prefix; it does not prove a booking, operating carrier, live flight status, or airline confirmation.
- Flight status remains operator-entered unless a separate provider observation is explicitly returned.
- The image proxy is authenticated against the journey's SJM access controls. It accepts only a valid two-character code, a PNG response, and a bounded image size. The Airhex key and signature inputs stay server-side.
- Document evidence is private and remains subject to SJM role-based access, integrity verification, retention, and review rules.


## Form design and accessibility basis

The wizard groups the form into identity, contact/relationship, documents, and review. This follows the W3C WAI multi-page form guidance to split long forms into logical stages, show progress, and make optional stages skippable. The interface validates both on the client and through the existing server contract, exposes inline errors, and provides a review step before save. See:

- https://www.w3.org/WAI/tutorials/forms/multi-page/
- https://www.w3.org/WAI/tutorials/forms/validation/
- https://design-system.service.gov.uk/patterns/complete-multiple-tasks/

The initial profile save is distinct from private-document upload. A profile may be registered before storage is ready, but the UI must explicitly report that an attachment was not uploaded or integrity-verified; it must never imply that a missing document was received.
