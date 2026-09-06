import { SeededRandom, clampUnit, hashSeed, type CoralNode, type InfluenceCell, type Vec2 } from './simulation';

export interface CoralGrowthParameters {
  rootCount: number;
  maxDepth: number;
  maxChildren: number;
  branchChance: number;
  baseY: number;
  spread: number;
}

export const DEFAULT_CORAL_GROWTH: CoralGrowthParameters = {
  rootCount: 7,
  maxDepth: 4,
  maxChildren: 2,
  branchChance: 0.72,
  baseY: -0.89,
  spread: 0.46,
};

export interface CoralFeedbackParameters {
  nutrientGrowthRate: number;
  disturbanceStressRate: number;
  healthRecoveryRate: number;
}

export const DEFAULT_CORAL_FEEDBACK: CoralFeedbackParameters = {
  nutrientGrowthRate: 0.18,
  disturbanceStressRate: 0.08,
  healthRecoveryRate: 0.06,
};

interface PendingBranch {
  node: CoralNode;
  depth: number;
}

function normalize(vector: Vec2): Vec2 {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude === 0) return { x: 0, y: 1 };
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

function endpoint(node: CoralNode): Vec2 {
  return {
    x: node.position.x + node.direction.x * node.length,
    y: node.position.y + node.direction.y * node.length,
  };
}

function createRoot(id: number, random: SeededRandom, parameters: CoralGrowthParameters): CoralNode {
  const angle = random.range(-0.25, 0.25);
  return {
    id,
    parentId: null,
    position: { x: random.range(-0.9, 0.9), y: parameters.baseY },
    direction: normalize({ x: Math.sin(angle), y: Math.cos(angle) }),
    length: random.range(0.18, 0.32),
    radius: random.range(0.014, 0.026),
    depth: 0,
    health: random.range(0.84, 1),
    growth: random.range(0.35, 0.82),
    seed: random.nextUint(),
  };
}

function createChild(id: number, parent: CoralNode, childIndex: number, random: SeededRandom, parameters: CoralGrowthParameters): CoralNode {
  const parentAngle = Math.atan2(parent.direction.x, parent.direction.y);
  const side = childIndex % 2 === 0 ? -1 : 1;
  const angle = parentAngle + side * random.range(parameters.spread * 0.65, parameters.spread) + random.range(-0.1, 0.1);
  const direction = normalize({ x: Math.sin(angle), y: Math.cos(angle) });
  const position = endpoint(parent);
  return {
    id,
    parentId: parent.id,
    position,
    direction,
    length: parent.length * random.range(0.58, 0.78),
    radius: parent.radius * random.range(0.58, 0.76),
    depth: parent.depth + 1,
    health: parent.health * random.range(0.91, 1.02),
    growth: random.range(0.25, 0.78),
    seed: random.nextUint(),
  };
}

/** Generates a deterministic branching coral skeleton from a genome seed. */
export function generateCoralNodes(
  genomeSeed: string | number,
  parameters: CoralGrowthParameters = DEFAULT_CORAL_GROWTH,
): CoralNode[] {
  if (!Number.isInteger(parameters.rootCount) || parameters.rootCount < 1) throw new RangeError('rootCount must be a positive integer');
  if (!Number.isInteger(parameters.maxDepth) || parameters.maxDepth < 0) throw new RangeError('maxDepth must be a non-negative integer');
  if (!Number.isInteger(parameters.maxChildren) || parameters.maxChildren < 1 || parameters.maxChildren > 4) throw new RangeError('maxChildren must be between 1 and 4');
  if (parameters.branchChance < 0 || parameters.branchChance > 1) throw new RangeError('branchChance must be between 0 and 1');

  const random = new SeededRandom(hashSeed(genomeSeed));
  const nodes: CoralNode[] = [];
  const pending: PendingBranch[] = [];
  let nextId = 0;

  for (let index = 0; index < parameters.rootCount; index += 1) {
    const root = createRoot(nextId, random, parameters);
    nextId += 1;
    nodes.push(root);
    pending.push({ node: root, depth: 0 });
  }

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || current.depth >= parameters.maxDepth) continue;
    const childCount = random.next() < parameters.branchChance ? parameters.maxChildren : 1;
    for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
      const child = createChild(nextId, current.node, childIndex, random, parameters);
      nextId += 1;
      nodes.push(child);
      pending.push({ node: child, depth: current.depth + 1 });
    }
  }
  return nodes;
}

export function coralNodeEndpoint(node: CoralNode): Vec2 {
  return endpoint(node);
}

export function createSeedCoralNode(id: number, position: Vec2, seed: number): CoralNode {
  const random = new SeededRandom(seed);
  const angle = random.range(-0.22, 0.22);
  return {
    id,
    parentId: null,
    position: { ...position },
    direction: normalize({ x: Math.sin(angle), y: Math.cos(angle) }),
    length: random.range(0.12, 0.2),
    radius: random.range(0.014, 0.022),
    depth: 0,
    health: 0.72,
    growth: 0.35,
    seed: random.nextUint(),
  };
}

export function applyCoralFeedback(
  node: CoralNode,
  influence: InfluenceCell,
  deltaSeconds: number,
  parameters: CoralFeedbackParameters = DEFAULT_CORAL_FEEDBACK,
): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  const nutrient = clampUnit(influence.nutrient);
  const disturbance = clampUnit(influence.disturbance);
  const growthDelta = nutrient * parameters.nutrientGrowthRate - disturbance * parameters.disturbanceStressRate;
  node.growth = clampUnit(node.growth + growthDelta * deltaSeconds);
  const maximumLength = Math.max(0.08, 0.68 / (1 + node.depth * 0.18));
  node.length = Math.min(maximumLength, Math.max(0.01, node.length * (1 + nutrient * parameters.nutrientGrowthRate * deltaSeconds)));
  node.health = clampUnit(node.health + (nutrient * parameters.healthRecoveryRate - disturbance * parameters.disturbanceStressRate) * deltaSeconds);
}
