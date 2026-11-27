import type { DialogueData, VisitorDef, VisitorMood } from '../data/schemas';
import type { SceneManager } from '../engine/SceneManager';
import type { HouseStore } from '../state/houseStore';

export interface ActiveVisitorSnapshot {
  instanceId: string;
  visitorId: string;
  mood: VisitorMood;
  x: number;
  z: number;
}

/**
 * Module boundary for visitors (`data/visitors.json` + `data/dialogue.json`).
 *
 * Phase 1 establishes the lifecycle contract and data access.
 * Phase 2 implements invitation UI, grid pathfinding, furniture usage, mood calculation,
 * speech bubbles, and emotes inside this module.
 */
export class VisitorModule {
  readonly store: HouseStore;
  readonly sceneManager: SceneManager;
  readonly visitorDefs: VisitorDef[];
  readonly dialogue: DialogueData;

  private activeVisitors: ActiveVisitorSnapshot[] = [];

  constructor(store: HouseStore, sceneManager: SceneManager) {
    this.store = store;
    this.sceneManager = sceneManager;
    this.visitorDefs = store.data.visitors.visitors;
    this.dialogue = store.data.dialogue;
  }

  invite(_visitorId: string): ActiveVisitorSnapshot | null {
    // Implemented in Phase 2
    return null;
  }

  dismiss(_instanceId: string): void {
    // Implemented in Phase 2
  }

  getActiveVisitors(): readonly ActiveVisitorSnapshot[] {
    return this.activeVisitors;
  }

  update(_dt: number): void {
    // Implemented in Phase 2
  }

  dispose(): void {
    this.activeVisitors = [];
  }
}
