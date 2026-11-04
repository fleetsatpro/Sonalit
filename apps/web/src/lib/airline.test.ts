import { describe, expect, it } from 'vitest';
import { airlineIataCodeFromFlightNumber } from './airline';

describe('airline IATA identifier from flight number', () => {
  it.each([
    ['KQ 100', 'KQ'],
    ['AF1234', 'AF'],
    ['6E 721', '6E'],
    ['BA 008', 'BA'],
    ['  KL 602  ', 'KL'],
  ])('extracts %s as %s', (flightNumber, expected) => {
    expect(airlineIataCodeFromFlightNumber(flightNumber)).toBe(expected);
  });
  it.each(['', 'Kenya Airways', '12345', 'NBO-CDG', 'KQ'])('does not infer an airline code from %s', value => {
    expect(airlineIataCodeFromFlightNumber(value)).toBeNull();
  });
});
