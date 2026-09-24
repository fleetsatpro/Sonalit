'use strict';

/**
 * Loop 02 — get_world_context tool registration + summarization contract.
 * Does not call OpenSky; validates catalog wiring and tool shape only.
 */

const { TOOL_CATALOG } = require('../../src/services/aiSwarm');

describe('get_world_context tool (Loop 02)', () => {
  test('is registered in TOOL_CATALOG', () => {
    expect(TOOL_CATALOG.get_world_context).toBeDefined();
    expect(TOOL_CATALOG.get_world_context.description).toMatch(/OpenSky|aircraft|spatial/i);
    expect(TOOL_CATALOG.get_world_context.schema).toBeDefined();
    expect(TOOL_CATALOG.get_world_context.schema.properties.location).toBeDefined();
  });

  test('schema accepts location and coordinates', () => {
    const props = TOOL_CATALOG.get_world_context.schema.properties;
    expect(props.latitude).toBeDefined();
    expect(props.longitude).toBeDefined();
    expect(props.radius_km).toBeDefined();
  });
});
