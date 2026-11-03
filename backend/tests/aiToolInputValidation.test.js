'use strict';
const { validateToolInput } = require('../src/utils/aiToolInputValidation');

const schema = {
  type: 'object',
  required: ['name', 'radius_m'],
  properties: {
    name: { type: 'string' },
    radius_m: { type: 'number', minimum: 10, maximum: 100000 },
    mode: { type: 'string', enum: ['circle', 'corridor'] },
  },
};

describe('Copilot tool argument validation', () => {
  test('accepts valid inputs', () => {
    expect(validateToolInput(schema, { name: 'Test', radius_m: 300, mode: 'circle' }).valid).toBe(true);
  });
  test('rejects numeric strings and absent required values', () => {
    expect(validateToolInput(schema, { name: 'Test', radius_m: '300' }).valid).toBe(false);
    expect(validateToolInput(schema, { name: 'Test' }).valid).toBe(false);
  });
  test('rejects unknown properties and unsupported enum values', () => {
    expect(validateToolInput(schema, { name: 'Test', radius_m: 300, extra: true }).valid).toBe(false);
    expect(validateToolInput(schema, { name: 'Test', radius_m: 300, mode: 'unknown' }).valid).toBe(false);
  });
});
