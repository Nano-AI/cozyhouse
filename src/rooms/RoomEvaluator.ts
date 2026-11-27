import type { GameDataBundle, HouseState, RoomLabelInfo } from '../data/schemas';

export interface RoomEvaluation {
  labelInfo: RoomLabelInfo;
  isOverride: boolean;
  tagCounts: Record<string, number>;
}

/**
 * Evaluates room-type rules from `data/room-rules.json` against currently placed items.
 * Phase 2 extends this with celebratory UI transitions and manual override picker.
 */
export function evaluateRoomType(state: HouseState, data: GameDataBundle): RoomEvaluation {
  const tagCounts: Record<string, number> = {};
  for (const placed of state.items) {
    const def = data.itemsById.get(placed.itemId);
    if (!def) continue;
    for (const tag of def.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  if (state.roomTypeOverride) {
    const matchingRule = data.roomRules.rules.find(
      (r) => r.id === state.roomTypeOverride || r.label === state.roomTypeOverride,
    );
    return {
      labelInfo: matchingRule ?? {
        id: 'custom_override',
        label: state.roomTypeOverride,
        description: 'Custom house label.',
        accentColor: data.roomRules.defaultLabel.accentColor,
      },
      isOverride: true,
      tagCounts,
    };
  }

  const sortedRules = [...data.roomRules.rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sortedRules) {
    const meetsRequired = Object.entries(rule.requiredTags).every(
      ([tag, minCount]) => (tagCounts[tag] ?? 0) >= minCount,
    );
    const hasExcluded = (rule.excludedTags ?? []).some((tag) => (tagCounts[tag] ?? 0) > 0);
    if (meetsRequired && !hasExcluded) {
      return {
        labelInfo: {
          id: rule.id,
          label: rule.label,
          description: rule.description,
          accentColor: rule.accentColor,
        },
        isOverride: false,
        tagCounts,
      };
    }
  }

  return {
    labelInfo: data.roomRules.defaultLabel,
    isOverride: false,
    tagCounts,
  };
}
