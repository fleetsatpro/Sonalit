'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('GEV CCTV wall contract', () => {
  test('contains interactive wall, expansion, fullscreen and navigation affordances', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'CctvViewerPanel.tsx'),
      'utf8'
    );
    expect(source).toContain('CAMERA WALL');
    expect(source).toContain('gev-cctv-wall-overlay');
    expect(source).toContain('requestFullscreen');
    expect(source).toContain('ArrowRight');
    expect(source).toContain('ArrowLeft');
    expect(source).toContain('onPointerUp');
    expect(source).toContain('ZoomIn');
    expect(source).toContain('OPEN PUBLISHER');
  });

  test('does not attempt to force iframe embedding for source-only cameras', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'CctvViewerPanel.tsx'),
      'utf8'
    );
    expect(source).not.toContain('<iframe');
    expect(source).toContain("mode === 'source'");
    expect(source).toContain('OPEN SOURCE');
  });
});
