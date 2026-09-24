/**
 * Sonalit RenderGovernor — adapted from GEV renderGovernor principles.
 * requestRenderMode + identity-keyed holds. One governor per Viewer.
 */

export type RenderMode = 'continuous' | 'idle';

export interface GovernorDiagnostics {
  installed: boolean;
  mode: RenderMode;
  holds: string[];
  recentRequests: Array<{ reason: string; at: number }>;
}

const RECENT_REQUEST_CAP = 16;

export class RenderGovernor {
  private viewer: {
    scene: {
      requestRenderMode: boolean;
      maximumRenderTimeChange: number;
      requestRender?: () => void;
    };
  } | null = null;
  private installed = false;
  private holds = new Set<string>();
  private recentRequests: Array<{ reason: string; at: number }> = [];

  install(viewer: {
    scene: {
      requestRenderMode: boolean;
      maximumRenderTimeChange: number;
      requestRender?: () => void;
    };
  }): void {
    if (!viewer?.scene) {
      throw new TypeError('RenderGovernor.install requires a Cesium Viewer with scene');
    }
    this.viewer = viewer;
    this.installed = true;
    viewer.scene.maximumRenderTimeChange = Infinity;
    this.applyMode();
  }

  hold(ownerId: string): void {
    if (!ownerId) return;
    this.holds.add(ownerId);
    this.applyMode();
  }

  release(ownerId: string): void {
    if (!ownerId) return;
    this.holds.delete(ownerId);
    this.applyMode();
  }

  requestRender(reason = 'unspecified'): void {
    if (!this.installed || !this.viewer?.scene) return;
    if (this.holds.size === 0) {
      this.recentRequests.push({ reason, at: Date.now() });
      if (this.recentRequests.length > RECENT_REQUEST_CAP) {
        this.recentRequests.shift();
      }
    }
    this.viewer.scene.requestRender?.();
  }

  getDiagnostics(): GovernorDiagnostics {
    return {
      installed: this.installed,
      mode: this.holds.size > 0 ? 'continuous' : 'idle',
      holds: Array.from(this.holds),
      recentRequests: [...this.recentRequests],
    };
  }

  destroy(): void {
    this.holds.clear();
    this.recentRequests = [];
    this.viewer = null;
    this.installed = false;
  }

  private applyMode(): void {
    if (!this.installed || !this.viewer?.scene) return;
    const continuous = this.holds.size > 0;
    const scene = this.viewer.scene;
    if (scene.requestRenderMode === !continuous) return;
    scene.requestRenderMode = !continuous;
    if (!continuous) {
      scene.requestRender?.();
    }
  }
}

export function createRenderGovernor(): RenderGovernor {
  return new RenderGovernor();
}
