/**
 * Unified spatial entity registry / picking abstraction.
 * Replaces ad-hoc scene.pick() rules. Semantic identity over string-prefix hacks.
 */

import type { SpatialObservation } from '../model/observation.js';

export type EntityDomain = 'sonalit' | 'external';

export interface SpatialEntityDescriptor {
  id: string;
  domain: EntityDomain;
  entityType: string;
  cesiumId?: string;
  label?: string;
  observationId?: string;
  orgId?: string;
  convoyId?: string;
  vehicleId?: string;
  summary?: Record<string, unknown>;
  source?: string;
  freshnessClass?: string;
}

export interface SelectionContext {
  entity: SpatialEntityDescriptor;
  pickedAt: string;
  screenPosition?: { x: number; y: number };
}

export class EntityRegistry {
  private byId = new Map<string, SpatialEntityDescriptor>();
  private byCesiumId = new Map<string, string>();
  private selection: SelectionContext | null = null;
  private listeners = new Set<(ctx: SelectionContext | null) => void>();

  register(desc: SpatialEntityDescriptor): void {
    const existing = this.byId.get(desc.id);
    if (existing?.cesiumId && existing.cesiumId !== desc.cesiumId) {
      this.byCesiumId.delete(existing.cesiumId);
    }

    if (desc.cesiumId) {
      const previousSemanticId = this.byCesiumId.get(desc.cesiumId);
      if (previousSemanticId && previousSemanticId !== desc.id) {
        const previous = this.byId.get(previousSemanticId);
        if (previous?.cesiumId === desc.cesiumId) {
          previous.cesiumId = undefined;
          this.byId.set(previousSemanticId, previous);
        }
      }
      this.byCesiumId.set(desc.cesiumId, desc.id);
    }

    this.byId.set(desc.id, desc);
  }

  registerMany(descs: SpatialEntityDescriptor[]): void {
    for (const d of descs) this.register(d);
  }

  unregister(id: string): void {
    const existing = this.byId.get(id);
    if (existing?.cesiumId) this.byCesiumId.delete(existing.cesiumId);
    this.byId.delete(id);
    if (this.selection?.entity.id === id) {
      this.select(null);
    }
  }

  clear(): void {
    this.byId.clear();
    this.byCesiumId.clear();
    this.select(null);
  }

  get(id: string): SpatialEntityDescriptor | undefined {
    return this.byId.get(id);
  }

  getByCesiumId(cesiumId: string): SpatialEntityDescriptor | undefined {
    const id = this.byCesiumId.get(cesiumId);
    return id ? this.byId.get(id) : undefined;
  }

  resolvePick(pickedId: string): SpatialEntityDescriptor | undefined {
    return this.get(pickedId) ?? this.getByCesiumId(pickedId);
  }

  select(
    entity: SpatialEntityDescriptor | null,
    screenPosition?: { x: number; y: number },
  ): void {
    this.selection = entity
      ? { entity, pickedAt: new Date().toISOString(), screenPosition }
      : null;
    for (const fn of this.listeners) {
      try {
        fn(this.selection);
      } catch {
        /* listener failures must not break selection */
      }
    }
  }

  getSelection(): SelectionContext | null {
    return this.selection;
  }

  onSelectionChange(fn: (ctx: SelectionContext | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  size(): number {
    return this.byId.size;
  }

  static fromObservations(
    observations: SpatialObservation[],
  ): SpatialEntityDescriptor[] {
    return observations.map((o) => ({
      id: o.id,
      domain: 'external' as const,
      entityType: o.entityType,
      cesiumId: o.id,
      label:
        (o.attributes['callsign'] as string) ||
        (o.attributes['name'] as string) ||
        o.id,
      observationId: o.id,
      summary: {
        altitudeM: o.altitudeM,
        speedMps: o.speedMps,
        headingDeg: o.headingDeg,
        status: o.status,
      },
      source: o.source,
      freshnessClass: o.quality.freshnessClass,
    }));
  }
}
