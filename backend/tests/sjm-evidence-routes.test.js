'use strict';

const {
  normalizeUploadInput,
  canUploadEvidence,
  CATEGORY_MIME_TYPES,
  MAX_BYTES,
} = require('../src/routes/sjmEvidence').__test;

describe('SJM evidence capture contract', () => {
  test('accepts supported photo, video and document metadata without trusting file location paths', () => {
    const photo = normalizeUploadInput({
      category: 'photo',
      file_name: '../../principal/photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
      captured_at: '2026-10-31T09:30:00.000Z',
    });
    expect(photo.error).toBeUndefined();
    expect(photo.value.fileName).toBe('_.._principal_photo.jpg');
    expect(photo.value.captureTimeQuality).toBe('DEVICE_CLOCK_UNVERIFIED');
    expect(photo.value.location.source).toBe('NOT_CAPTURED');

    expect(normalizeUploadInput({
      category: 'video', file_name: 'arrival.mp4', mime_type: 'video/mp4', size_bytes: 2048,
    }).error).toBeUndefined();
    expect(normalizeUploadInput({
      category: 'document', file_name: 'handover.pdf', mime_type: 'application/pdf', size_bytes: 512,
    }).error).toBeUndefined();
  });

  test('rejects unsupported types, oversized files, invalid timestamps and invalid coordinates', () => {
    expect(normalizeUploadInput({
      category: 'photo', file_name: 'image.svg', mime_type: 'image/svg+xml', size_bytes: 100,
    }).error).toBe('unsupported_evidence_type');
    expect(normalizeUploadInput({
      category: 'video', file_name: 'large.mp4', mime_type: 'video/mp4', size_bytes: MAX_BYTES['video/mp4'] + 1,
    }).error).toBe('invalid_evidence_size');
    expect(normalizeUploadInput({
      category: 'photo', file_name: 'image.jpg', mime_type: 'image/jpeg', size_bytes: 100, captured_at: 'yesterday-ish',
    }).error).toBe('invalid_capture_timestamp');
    expect(normalizeUploadInput({
      category: 'check_in', file_name: 'image.jpg', mime_type: 'image/jpeg', size_bytes: 100,
      location: { latitude: 120, longitude: 36, accuracy_m: 12 },
    }).error).toBe('invalid_location_observation');
    expect(normalizeUploadInput({
      category: 'photo', file_name: 'image.jpg', mime_type: 'image/jpeg', size_bytes: 100,
      device_id: 'invalid' + String.fromCharCode(10) + 'reference',
    }).error).toBe('invalid_device_reference');
  });

  test('stores explicit browser geolocation as unverified device-reported evidence only', () => {
    const result = normalizeUploadInput({
      category: 'check_in',
      file_name: 'check-in.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1000,
      location: { latitude: -1.2864, longitude: 36.8172, accuracy_m: 18.5 },
    });
    expect(result.value.location).toEqual({
      lat: -1.2864,
      lng: 36.8172,
      accuracyM: 18.5,
      source: 'BROWSER_GEOLOCATION_UNVERIFIED',
    });
  });

  test('only operational mission roles may upload evidence', () => {
    expect(canUploadEvidence({ role: 'admin' }, [])).toBe(true);
    expect(canUploadEvidence({ role: 'dispatcher' }, [])).toBe(true);
    expect(canUploadEvidence({ role: 'operator' }, ['driver'])).toBe(true);
    expect(canUploadEvidence({ role: 'operator' }, ['cpo'])).toBe(true);
    expect(canUploadEvidence({ role: 'analyst' }, ['analyst'])).toBe(false);
    expect(canUploadEvidence({ role: 'analyst' }, [])).toBe(false);
  });

  test('keeps the category and MIME allow-list finite and explicit', () => {
    expect(Object.keys(CATEGORY_MIME_TYPES)).toEqual([
      'photo','video','document','incident_attachment','check_in','handover',
    ]);
    expect(Object.keys(MAX_BYTES)).toEqual(['image/jpeg','image/png','video/mp4','application/pdf']);
  });
});
