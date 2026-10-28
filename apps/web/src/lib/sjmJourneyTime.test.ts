import { describe, expect, test } from 'vitest';
import { localDateTimeInputInTimezone } from './sjmJourneyTime.js';

describe('SJM datetime-local reverse conversion', () => {
 test('renders Nairobi local time without shifting the stored instant',()=>{
  expect(localDateTimeInputInTimezone('2026-10-27T22:30:00.000Z','Africa/Nairobi')).toBe('2026-10-28T01:30');
 });
 test('renders a stored instant using the journey timezone',()=>{
  expect(localDateTimeInputInTimezone('2026-10-27T22:30:00.000Z','Europe/Paris')).toBe('2026-10-27T23:30');
 });
 test('returns an empty field when the instant/timezone is unavailable',()=>{
  expect(localDateTimeInputInTimezone(null,'Africa/Nairobi')).toBe('');
  expect(localDateTimeInputInTimezone('not-a-date','Africa/Nairobi')).toBe('');
  expect(localDateTimeInputInTimezone('2026-10-27T22:30:00.000Z','Not/AZone')).toBe('');
 });
});
