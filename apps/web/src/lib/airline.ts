export function airlineIataCodeFromFlightNumber(flightNumber?: string | null): string | null {
  const value = String(flightNumber || '').trim().toUpperCase();
  const match = /^([A-Z0-9]{2})\s*(?=\d)/.exec(value);
  const code = match?.[1] || '';
  // A number-only prefix is ambiguous (for example, a reference like 12345).
  // Keep genuine mixed designators such as 6E and alphanumeric carriers.
  return code && /[A-Z]/.test(code) ? code : null;
}
