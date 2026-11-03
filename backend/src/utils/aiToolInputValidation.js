'use strict';

const MAX_DEPTH = 8;
const MAX_OBJECT_KEYS = 80;
const MAX_ARRAY_ITEMS = 500;
const MAX_STRING_LENGTH = 4000;

function validateToolInput(schema, value) {
  const errors = [];

  function visit(rule, input, path, depth) {
    if (!rule || typeof rule !== 'object' || depth > MAX_DEPTH) {
      errors.push({ path, code: 'invalid_schema', message: 'Tool schema is invalid or too deeply nested.' });
      return;
    }

    const type = rule.type;
    if (type === 'object') {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        errors.push({ path, code: 'type', message: 'Expected an object.' });
        return;
      }
      const properties = rule.properties || {};
      const keys = Object.keys(input);
      if (keys.length > MAX_OBJECT_KEYS) {
        errors.push({ path, code: 'too_many_properties', message: 'Object contains too many properties.' });
        return;
      }
      for (const required of rule.required || []) {
        if (!Object.prototype.hasOwnProperty.call(input, required)) {
          errors.push({ path: path + '.' + required, code: 'required', message: 'Required field is missing.' });
        }
      }
      for (const key of keys) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          errors.push({ path: path + '.' + key, code: 'forbidden_key', message: 'Unsafe property name.' });
          continue;
        }
        const child = properties[key];
        if (!child) {
          if (rule.additionalProperties !== true) {
            errors.push({ path: path + '.' + key, code: 'unknown_property', message: 'Property is not permitted by this tool schema.' });
          }
          continue;
        }
        visit(child, input[key], path + '.' + key, depth + 1);
      }
    } else if (type === 'array') {
      if (!Array.isArray(input)) {
        errors.push({ path, code: 'type', message: 'Expected an array.' });
        return;
      }
      const maxItems = Number.isInteger(rule.maxItems) ? Math.min(rule.maxItems, MAX_ARRAY_ITEMS) : MAX_ARRAY_ITEMS;
      if (input.length < (Number.isInteger(rule.minItems) ? rule.minItems : 0) || input.length > maxItems) {
        errors.push({ path, code: 'array_length', message: 'Array length is outside the permitted bounds.' });
        return;
      }
      if (rule.items) input.forEach((item, index) => visit(rule.items, item, path + '[' + index + ']', depth + 1));
    } else if (type === 'string') {
      if (typeof input !== 'string') {
        errors.push({ path, code: 'type', message: 'Expected a string.' });
        return;
      }
      if (input.length > Math.min(Number(rule.maxLength) || MAX_STRING_LENGTH, MAX_STRING_LENGTH)) {
        errors.push({ path, code: 'string_length', message: 'String exceeds the permitted length.' });
      }
      if (Number.isInteger(rule.minLength) && input.length < rule.minLength) {
        errors.push({ path, code: 'string_length', message: 'String is shorter than the permitted minimum.' });
      }
    } else if (type === 'number' || type === 'integer') {
      if (typeof input !== 'number' || !Number.isFinite(input) || (type === 'integer' && !Number.isInteger(input))) {
        errors.push({ path, code: 'type', message: 'Expected a finite ' + type + '.' });
        return;
      }
      if (Number.isFinite(rule.minimum) && input < rule.minimum) {
        errors.push({ path, code: 'minimum', message: 'Number is below the permitted minimum.' });
      }
      if (Number.isFinite(rule.maximum) && input > rule.maximum) {
        errors.push({ path, code: 'maximum', message: 'Number exceeds the permitted maximum.' });
      }
    } else if (type === 'boolean') {
      if (typeof input !== 'boolean') errors.push({ path, code: 'type', message: 'Expected a boolean.' });
    } else if (type && type !== 'null') {
      errors.push({ path, code: 'unsupported_schema_type', message: 'Schema contains an unsupported type.' });
    }

    if (input !== undefined && Array.isArray(rule.enum) && !rule.enum.some(item => item === input)) {
      errors.push({ path, code: 'enum', message: 'Value is not an allowed option.' });
    }
  }

  if (!schema || schema.type !== 'object') {
    return { valid: false, errors: [{ path: 'input', code: 'invalid_schema', message: 'Tool schema must be an object schema.' }] };
  }
  visit(schema, value, 'input', 0);
  return { valid: errors.length === 0, errors: errors.slice(0, 40) };
}

module.exports = { validateToolInput };
