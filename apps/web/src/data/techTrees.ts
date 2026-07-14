// ── Tech tree definitions (UI layer) ──
// Card-based, tier-gated tech trees. Five "universal" trees; two are defined
// (Refinement, Armory) and three are blank placeholders. Tiers are gated:
// researching ANY tech in a tier unlocks the next tier (not per-node prereqs).
//
// Icons are filenames under /public/ui/skills. Some tier-4 Refinement techs are
// flagged tentative (the design still had a "?" against their tier).

export type Tier = number;

export interface TechNode {
  id: string;
  name: string;
  icon: string;
  tier: Tier;
  desc: string;
  tentative?: boolean;
  col?: number;          // horizontal slot within its tier row (for the DAG layout)
  prereqs?: string[];    // ALL required (draws a connector line from each)
  prereqsAny?: string[]; // at least ONE required (dashed connectors)
}

export interface TechTreeDef {
  id: string;
  name: string;
  icon: string;
  blank?: boolean;
  nodes: TechNode[];
}

const refinement: TechTreeDef = {
  id: 'refinement',
  name: 'Refinement',
  icon: 'Skillicon7_12.png',
  nodes: [
    { id: 'ref_mine',       tier: 0, name: 'Mine',                icon: 'Skillicon7_12.png', desc: 'Builds a level 1 mine on top of ore. Available from the start.' },
    { id: 'ref_drilling',   tier: 1, name: 'Drilling',           icon: 'Skillicon7_02.png', desc: 'Unlocks mine level 2.' },
    { id: 'ref_prospect',   tier: 1, name: 'Prospecting',        icon: 'Skillicon7_01.png', desc: 'Shows all resource tiles within 4 squares of a city (not those already holding a REB).' },
    { id: 'ref_slag',       tier: 2, name: 'Slag Wash',          icon: 'Skillicon7_04.png', desc: 'Increases output of all mines by 10%.' },
    { id: 'ref_plasmatap',  tier: 2, name: 'Plasma Tap',         icon: 'Skillicon7_15.png', desc: 'Unlocks the plasma extractor.' },
    { id: 'ref_refineries', tier: 2, name: 'Refineries',         icon: 'Skillicon7_06.png', desc: 'Allows the refinery REB2.' },
    { id: 'ref_fracking',   tier: 3, name: 'Plasma Fracking',    icon: 'Skillicon7_03.png', desc: 'Unlocks the plasma purifier REB2.' },
    { id: 'ref_shafts',     tier: 3, name: 'Subterranean Shafts', icon: 'Skillicon7_05.png', desc: 'Unlocks mine level 3.' },
    { id: 'ref_crossborder', tier: 3, name: 'Cross-Border Economy', icon: 'Skillicon7_09.png', desc: "Lets REB2s extract from adjacent REB1s in other cities' territory." },
    { id: 'ref_taxation',   tier: 4, name: 'Taxation',           icon: 'Skillicon7_07.png', desc: "Set a 'tax' on REB1s: reduces output by x% but increases supply.", tentative: true },
    { id: 'ref_markets',    tier: 4, name: 'Markets',            icon: 'Skillicon7_08.png', desc: 'Increases the output of all mines by a further 10%.', tentative: true },
    { id: 'ref_investment', tier: 4, name: 'Investment',         icon: 'Skillicon7_10.png', desc: 'Allows a term deposit for 5 or 10 turns.', tentative: true },
  ],
};

const armory: TechTreeDef = {
  id: 'armory',
  name: 'Armory',
  icon: 'Skillicon7_13.png',
  // NOTE: node ids match the ENGINE tech ids (packages/data/json/tech-tree.json) so
  // research state lines up; `tier` = engine level. This view is still tier-gated for
  // display — the true per-node prerequisite DAG lives in the engine tree (TODO: draw
  // the prereq links here).
  nodes: [
    // ── Level 1 (roots) ──
    { id: 'combined_arms',       tier: 1, col: 0,   prereqs: ['small_arms'], name: 'Combined Arms',       icon: 'Skillicon7_07.png', desc: 'Requires Small Arms. Repeat shots on the SAME target by your LIGHT units gain ×1.2 attack (2nd, 3rd, 4th… — does not stack); resets each turn and on switching target. (Combat logic TBD.)' },
    { id: 'small_arms',          tier: 1, col: 1,   name: 'Small Arms',          icon: 'Skillicon7_10.png', desc: 'Enables the Bulwark and Lancer units.' },
    { id: 'forge',               tier: 1, col: 5.5, name: 'Forge',               icon: 'Skillicon7_16.png', desc: 'Prerequisite tech — enables Mech Bay and Crucible.' },
    // ── Level 2 ──
    { id: 'raiding',             tier: 2, col: 0,   prereqs: ['infiltration'], name: 'Raiding',             icon: 'Skillicon7_01.png', desc: 'Requires Infiltration. Wraiths steal resources from an enemy REB and damage/destroy it. (Details TBD.)' },
    { id: 'infiltration',        tier: 2, col: 1,   prereqs: ['small_arms'], name: 'Infiltration',        icon: 'Skillicon7_11.png', desc: 'Requires Small Arms. Unlocks the Wraith unit.' },
    { id: 'tracer_rounds',       tier: 2, col: 3,   prereqs: ['mech_bay'], name: 'Tracer Rounds',       icon: 'Skillicon7_18.png', desc: 'Requires Mech Bay. Lets you mark an enemy unit. (Details TBD.)' },
    { id: 'mech_bay',            tier: 2, col: 4,   prereqs: ['forge'], name: 'Mech Bay',            icon: 'Skillicon7_17.png', desc: 'Requires Forge. Unlocks the Stalker unit.' },
    { id: 'precision_targeting', tier: 2, col: 5,   prereqs: ['mech_bay'], name: 'Precision Targeting', icon: 'Skillicon7_04.png', desc: 'Requires Mech Bay. Grants the Stalker its Mountain Shooter II ability.' },
    { id: 'crucible',            tier: 2, col: 7,   prereqs: ['forge'], name: 'Crucible',            icon: 'Skillicon7_13.png', desc: 'Requires Forge. Unlocks the Tank unit.' },
    // ── Level 3 ──
    { id: 'sentinel',            tier: 3, col: 4,   prereqs: ['mech_bay'], name: 'Sentinel',            icon: 'Skillicon7_09.png', desc: 'Requires Mech Bay. Unlocks the Sentinel — an air sensory unit with Detect II. (Stats TBD.)' },
    { id: 'composite_plating',   tier: 3, col: 5.5, prereqsAny: ['crucible', 'mech_bay'], name: 'Composite Plating',   icon: 'Skillicon7_03.png', desc: 'Requires Crucible OR Mech Bay. Stalker and Tank gain a permanent ×1.2 defence. (Upgrade wiring TBD.)' },
    { id: 'titan',               tier: 3, col: 6.5, prereqs: ['crucible'], name: 'Titan',              icon: 'Skillicon7_12.png', desc: 'Requires Crucible. Unlocks the Titan unit. (Stats TBD.)' },
    { id: 'advanced_projectiles', tier: 3, col: 7.5, prereqs: ['crucible'], name: 'Advanced Projectiles', icon: 'Skillicon7_02.png', desc: 'Requires Crucible. Upgrades the Tank’s assault-mode range to 2–4 (default 2–3). (Upgrade wiring TBD.)' },
  ],
};

const blank = (n: number): TechTreeDef => ({
  id: `blank${n}`,
  name: '—',
  icon: 'Skillicon7_05.png',
  blank: true,
  nodes: [],
});

export const TECH_TREES: TechTreeDef[] = [
  refinement,
  armory,
  blank(1),
  blank(2),
  blank(3),
];

/** Distinct tiers present in a tree, ascending. */
export function treeTiers(tree: TechTreeDef): Tier[] {
  return [...new Set(tree.nodes.map(n => n.tier))].sort((a, b) => a - b);
}

/** A tier is open if it's the tree's lowest tier, or any tech in the previous present tier is researched. */
export function isTierUnlocked(tree: TechTreeDef, tier: Tier, researched: Set<string>): boolean {
  const tiers = treeTiers(tree);
  const idx = tiers.indexOf(tier);
  if (idx <= 0) return true; // lowest tier always open
  const prevTier = tiers[idx - 1];
  return tree.nodes.some(n => n.tier === prevTier && researched.has(n.id));
}

// ── DAG layout (Polytopia-style: levels on rows, connector lines between prereqs) ──
export const NODE_W = 132;
export const NODE_H = 96;
const COL_W = 152;
const ROW_H = 152;

export interface PositionedNode { node: TechNode; col: number; x: number; y: number; cx: number; cy: number; }
export interface Edge { x1: number; y1: number; x2: number; y2: number; dashed: boolean }
export interface TreeLayout { nodes: PositionedNode[]; edges: Edge[]; rows: { tier: Tier; y: number }[]; width: number; height: number }

export function layoutTree(tree: TechTreeDef): TreeLayout {
  const tiers = treeTiers(tree);
  const minTier = tiers[0] ?? 0;
  const perTier: Record<number, number> = {};
  const nodes: PositionedNode[] = tree.nodes.map(node => {
    const row = node.tier - minTier;
    const autoCol = perTier[node.tier] ?? 0;
    perTier[node.tier] = autoCol + 1;
    const col = node.col ?? autoCol;
    const x = col * COL_W;
    const y = row * ROW_H;
    return { node, col, x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 };
  });
  const byId: Record<string, PositionedNode> = {};
  for (const p of nodes) byId[p.node.id] = p;
  const edges: Edge[] = [];
  for (const p of nodes) {
    for (const pr of p.node.prereqs ?? []) { const s = byId[pr]; if (s) edges.push({ x1: s.cx, y1: s.cy, x2: p.cx, y2: p.cy, dashed: false }); }
    for (const pr of p.node.prereqsAny ?? []) { const s = byId[pr]; if (s) edges.push({ x1: s.cx, y1: s.cy, x2: p.cx, y2: p.cy, dashed: true }); }
  }
  const maxCol = Math.max(0, ...nodes.map(p => p.col));
  const rows = tiers.map(t => ({ tier: t, y: (t - minTier) * ROW_H }));
  return { nodes, edges, rows, width: maxCol * COL_W + NODE_W, height: (tiers.length - 1) * ROW_H + NODE_H };
}

/** Card state from per-node prereqs (falls back to tier-gating when a node has no prereq data). */
export function nodeState(node: TechNode, tree: TechTreeDef, researched: Set<string>): 'researched' | 'available' | 'locked' {
  if (researched.has(node.id)) return 'researched';
  const hasPrereqData = (node.prereqs?.length ?? 0) > 0 || (node.prereqsAny?.length ?? 0) > 0;
  if (hasPrereqData) {
    const allReq = (node.prereqs ?? []).every(p => researched.has(p));
    const anyReq = !node.prereqsAny?.length || node.prereqsAny.some(p => researched.has(p));
    return allReq && anyReq ? 'available' : 'locked';
  }
  return isTierUnlocked(tree, node.tier, researched) ? 'available' : 'locked';
}
