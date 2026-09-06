import { describe, expect, it } from 'vitest';
import { DEFAULT_CORAL_GROWTH, applyCoralFeedback, coralNodeEndpoint, createSeedCoralNode, generateCoralNodes } from './coral';

describe('deterministic coral growth', () => {
  it('produces the same skeleton for the same genome seed', () => {
    const first = generateCoralNodes('reef-alpha');
    const second = generateCoralNodes('reef-alpha');
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(DEFAULT_CORAL_GROWTH.rootCount);
  });

  it('changes the skeleton when the genome seed changes', () => {
    expect(generateCoralNodes('reef-alpha')).not.toEqual(generateCoralNodes('reef-beta'));
  });

  it('links every child to a parent endpoint and respects depth', () => {
    const nodes = generateCoralNodes(42, { ...DEFAULT_CORAL_GROWTH, rootCount: 2, maxDepth: 3 });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    nodes.forEach((node) => {
      expect(node.depth).toBeLessThanOrEqual(3);
      if (node.parentId !== null) {
        const parent = byId.get(node.parentId);
        expect(parent).toBeDefined();
        expect(node.position.x).toBeCloseTo(coralNodeEndpoint(parent!).x, 10);
        expect(node.position.y).toBeCloseTo(coralNodeEndpoint(parent!).y, 10);
        expect(node.depth).toBe(parent!.depth + 1);
      }
    });
  });

  it('supports a trunk-only growth mode', () => {
    const nodes = generateCoralNodes(9, { ...DEFAULT_CORAL_GROWTH, rootCount: 1, maxDepth: 3, branchChance: 0, maxChildren: 1 });
    expect(nodes).toHaveLength(4);
    expect(nodes.map((node) => node.depth)).toEqual([0, 1, 2, 3]);
  });

  it('rejects invalid growth parameters', () => {
    expect(() => generateCoralNodes(1, { ...DEFAULT_CORAL_GROWTH, rootCount: 0 })).toThrow(RangeError);
    expect(() => generateCoralNodes(1, { ...DEFAULT_CORAL_GROWTH, branchChance: 2 })).toThrow(RangeError);
  });

  it('grows and recovers a coral node under nutrient influence', () => {
    const node = generateCoralNodes(3, { ...DEFAULT_CORAL_GROWTH, rootCount: 1, maxDepth: 0 })[0];
    const initialLength = node.length;
    const initialGrowth = node.growth;
    applyCoralFeedback(node, { nutrient: 1, disturbance: 0, activity: 1 }, 1);
    expect(node.length).toBeGreaterThan(initialLength);
    expect(node.growth).toBeGreaterThan(initialGrowth);
  });

  it('limits growth and health under disturbance', () => {
    const node = generateCoralNodes(4, { ...DEFAULT_CORAL_GROWTH, rootCount: 1, maxDepth: 0 })[0];
    const initialHealth = node.health;
    applyCoralFeedback(node, { nutrient: 0, disturbance: 1, activity: 1 }, 1);
    expect(node.health).toBeLessThan(initialHealth);
    expect(node.health).toBeGreaterThanOrEqual(0);
    expect(node.growth).toBeGreaterThanOrEqual(0);
  });

  it('creates a deterministic coral seed at the requested position', () => {
    const first = createSeedCoralNode(9, { x: 0.25, y: -0.7 }, 99);
    const second = createSeedCoralNode(9, { x: 0.25, y: -0.7 }, 99);
    expect(first).toEqual(second);
    expect(first.position).toEqual({ x: 0.25, y: -0.7 });
    expect(first.parentId).toBeNull();
  });
});
