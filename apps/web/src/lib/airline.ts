export function airlineIataCodeFromFlightNumber(flightNumber?: string | null): string | null {
  const value = String(flightNumber || '').trim().toUpperCase();
  const match = /^([A-Z0-9]{2})\\s*(?=\\d)/.exec(value);
  return match?.[1] || null;
}
