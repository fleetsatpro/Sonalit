'use strict';

const fs = require('fs');
const path = require('path');

describe('Copilot get_world_context tool registration', () => {
  const aiSrc = fs.readFileSync(
    path.join(__dirname, '../src/routes/ai.js'),
    'utf8',
  );

  test('tool definition is present in TOOLS', () => {
    expect(aiSrc).toMatch(/name:\s*'get_world_context'/);
    expect(aiSrc).toMatch(/async function toolGetWorldContext/);
    expect(aiSrc).toMatch(/buildWorldContext/);
  });

  test('runTool switch includes get_world_context case', () => {
    expect(aiSrc).toMatch(/case\s+'get_world_context'\s*:/);
  });

  test('system prompt documents spatial world context usage', () => {
    expect(aiSrc).toMatch(/Use get_world_context for spatial situational awareness/);
  });
});
