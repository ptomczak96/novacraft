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
  root?: boolean;        // always-available Lvl-0 base node (not a real engine tech)
  cut?: boolean;         // un-researchable "cut/unused" tech, shown greyed for reference
  heading?: boolean;     // renders as a plain text label (a cluster header), not a card
  col?: number;          // horizontal slot within its tier row (for the DAG layout)
  prereqs?: string[];    // ALL required (draws a connector line from each)
  prereqsAny?: string[]; // at least ONE required (dashed connectors)
  // Detail shown on the card: units this tech unlocks (their passives are looked up from
  // the unit registry), faction-wide passive abilities it grants (by id), and freeform
  // upgrade/active lines (for actives & TBD items that aren't unit passives).
  unlockUnits?: string[];
  unlockPassives?: string[];
  unlockUpgrades?: string[];
  // Mutually-exclusive picks (e.g. the Wyrm's two L3 upgrades): if any listed tech is
  // researched, THIS node is crossed out. `excludeNote` is the hover text on the crossed
  // node.
  excludes?: string[];
  excludeNote?: string;
}

export interface TechTreeDef {
  id: string;
  name: string;
  icon: string;
  blank?: boolean;
  nodes: TechNode[];
}

// Refinement / Economy tree — shared by both factions (node ids match the ENGINE tech ids
// in packages/data/json/tech-tree.json so research state lines up). `tier` = engine level;
// `mine_1` is the always-available Lvl-0 root. Layout: economy branch (left), mine spine
// (centre), plasma branch (right).
const refinement: TechTreeDef = {
  id: 'refinement',
  name: 'Resources',
  icon: 'Skillicon7_12.png',
  nodes: [
    // ── L1 roots ──
    { id: 'prospecting',      tier: 1, col: 1, name: 'Prospecting',      icon: 'Skillicon7_01.png', desc: 'Reveals resource tiles within a 9×9 of any friendly city through the clouds. Opens the Extractor & Refinery.', unlockUpgrades: ['Reveal resources within 9×9 of your cities'] },
    { id: 'colonial_charter', tier: 1, col: 2, name: 'Colonial Charter', icon: 'Skillicon7_16.png', desc: 'Newly founded cities start at Level 2. Also opens the Extractor & Refinery.', unlockUpgrades: ['Founded cities start at Level 2'] },

    // ── L2 ──
    { id: 'borderless', tier: 2, col: 0, prereqs: ['extractor'], name: 'Sprawling Borders', icon: 'Skillicon7_15.png', desc: 'Buy unclaimed resource tiles adjacent (3×3) to a REB2 and outside any city territory. (Purchase UI pending.)', unlockUpgrades: ['Buy adjacent unclaimed resource tiles — pending'] },
    { id: 'extractor',  tier: 2, col: 1, prereqsAny: ['prospecting', 'colonial_charter'], name: 'Extractor', icon: 'Skillicon7_15.png', desc: 'Unlocks the Plasma Extractor (all levels) — build on any plasma vent in your territory.', unlockUpgrades: ['Build Plasma Extractor (L1–L3)'] },
    { id: 'refinery_1', tier: 2, col: 2, prereqsAny: ['prospecting', 'colonial_charter'], name: 'Refinery',  icon: 'Skillicon7_12.png', desc: 'Unlocks the Refinery — sits next to your Mines: +20 ore and +1 supply per adjacent same-city Mine.', unlockUpgrades: ['Build Refinery'] },
    { id: 'slag_wash',  tier: 2, col: 3, prereqs: ['refinery_1'], name: 'Slag Wash', icon: 'Skillicon7_04.png', desc: 'Increases all mine output by 10%.', unlockUpgrades: ['Mine output +10%'] },

    // ── L3 ──
    { id: 'roads',            tier: 3, col: 0, prereqs: ['extractor'],  name: 'Roads', icon: 'Skillicon7_08.png', desc: 'Roads. (Effect pending — coming soon.)', unlockUpgrades: ['(coming soon)'] },
    { id: 'purifier_1',       tier: 3, col: 1, prereqs: ['extractor'],  name: 'Purifier', icon: 'Skillicon7_15.png', desc: 'Unlocks the Purifier — sits next to your Extractors: +5 plasma and +1 supply per adjacent same-city Extractor.', unlockUpgrades: ['Build Purifier'] },
    { id: 'habitation_domes', tier: 3, col: 2, prereqs: ['refinery_1'], name: 'Habitation Domes', icon: 'Skillicon7_10.png', desc: 'All cities gain +1 population capacity.', unlockUpgrades: ['All cities +1 population'] },
    { id: 'cross_border',     tier: 3, col: 3, prereqs: ['refinery_1'], name: 'Cross Border Resources', icon: 'Skillicon7_09.png', desc: 'REB2s benefit from adjacent REB1s (within their 3×3) in the territory of OTHER friendly cities.', unlockUpgrades: ['REB2s use adjacent REB1s across your cities'] },

    // ── Unused / cut tech (reference only — NOT researchable) ──
    { id: 'cut_label',            tier: 1, col: 5.5, heading: true, name: 'Unused / Cut Tech', icon: '', desc: 'Cut for now; kept for reference in case they return.' },
    { id: 'rnd',                  tier: 2, col: 5, cut: true, name: 'R&D',                  icon: 'Skillicon7_07.png', desc: 'CUT — would make all future research cost 10% less ore.' },
    { id: 'reinforced_rebs',      tier: 2, col: 6, cut: true, name: 'Reinforced REBs',      icon: 'Skillicon7_06.png', desc: 'CUT — would give REBs +1 HP (building-HP system pending).' },
    { id: 'automated_extraction', tier: 3, col: 5, cut: true, name: 'Automated Extraction', icon: 'Skillicon7_18.png', desc: 'CUT — would stop enemies on your REBs from blocking their output.' },
    { id: 'transmutation',        tier: 3, col: 6, cut: true, name: 'Transmutation',        icon: 'Skillicon7_03.png', desc: 'CUT — would convert 5 ore → 1 plasma.' },
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
    { id: 'small_arms', tier: 1, col: 1, name: 'Small Arms', icon: 'Skillicon7_10.png', desc: 'Unlocks the Lancer. Branches into Triage, Advanced Weaponry and Engineering.', unlockUnits: ['lancer'] },
    { id: 'forge',      tier: 1, col: 6, name: 'Forge',      icon: 'Skillicon7_16.png', desc: 'Prerequisite tech — enables Mech Bay and Crucible.' },

    // ── Level 2: Small Arms branch (three siblings, gated only by Small Arms) ──
    { id: 'triage',            tier: 2, col: 0, prereqs: ['small_arms'], name: 'Triage',            icon: 'Skillicon7_01.png', desc: 'Unlocks the Medic. (Medic behaviour TBD.)', unlockUnits: ['medic'] },
    { id: 'advanced_weaponry', tier: 2, col: 1, prereqs: ['small_arms'], name: 'Advanced Weaponry', icon: 'Skillicon7_07.png', desc: 'Unlocks the Bulwark and grants the Combined Arms passive.', unlockUnits: ['defender'], unlockPassives: ['combined_arms'] },
    { id: 'engineering',       tier: 2, col: 2, prereqs: ['small_arms'], name: 'Engineering',       icon: 'Skillicon7_18.png', desc: 'Unlocks the Engineer. (Engineer behaviour TBD.)', unlockUnits: ['engineer'] },
    // ── Level 2: Forge branch ──
    { id: 'mech_bay', tier: 2, col: 5, prereqs: ['forge'], name: 'Mech Bay', icon: 'Skillicon7_17.png', desc: 'Requires Forge. Unlocks the Stalker unit.', unlockUnits: ['stalker'] },
    { id: 'crucible', tier: 2, col: 7, prereqs: ['forge'], name: 'Crucible', icon: 'Skillicon7_13.png', desc: 'Requires Forge. Unlocks the Tank unit.', unlockUnits: ['tank'] },

    // ── Level 3: Small Arms branch (each gated by its L2 parent only) ──
    { id: 'advanced_biomed',      tier: 3, col: 0, prereqs: ['triage'],            name: 'Advanced Biomed',      icon: 'Skillicon7_15.png', desc: 'Gives the Medic the Cure active (remove conditions) + 1–2 more actives (TBD).', unlockUpgrades: ['Medic — Cure (active): remove conditions', 'Medic — +1–2 more actives (TBD)'] },
    { id: 'infiltration',         tier: 3, col: 1, prereqs: ['advanced_weaponry'], name: 'Infiltration',         icon: 'Skillicon7_11.png', desc: 'Unlocks the Wraith (comes with Raid + Plant Explosives).', unlockUnits: ['wraith'], unlockUpgrades: ['Wraith — Raid (active, TBD)', 'Wraith — Plant Explosives (active, TBD)'] },
    { id: 'tactical_engineering', tier: 3, col: 2, prereqs: ['engineering'],       name: 'Tactical Engineering', icon: 'Skillicon7_08.png', desc: 'Unlocks building Nodes — 3×3 buff/debuff structures. (Specifics TBD.)', unlockUpgrades: ['Build Nodes — 3×3 buff/debuff structures (TBD)'] },
    // ── Level 3: Forge branch ──
    { id: 'sentinel',             tier: 3, col: 4,   prereqs: ['mech_bay'], name: 'Sentinel',             icon: 'Skillicon7_09.png', desc: 'Requires Mech Bay. Unlocks the Sentinel — an air sensory unit.', unlockUnits: ['sentinel'] },
    { id: 'precision_targeting',  tier: 3, col: 5,   prereqs: ['mech_bay'], name: 'Precision Targeting',  icon: 'Skillicon7_04.png', desc: 'Requires Mech Bay. Grants the Stalker its Mountain Shooter II ability.', unlockUpgrades: ['Stalker — Mountain Shooter II'] },
    { id: 'composite_plating',    tier: 3, col: 6,   prereqsAny: ['crucible', 'mech_bay'], name: 'Composite Plating', icon: 'Skillicon7_03.png', desc: 'Requires Crucible OR Mech Bay. Stalker and Tank gain a permanent ×1.2 defence.', unlockUpgrades: ['Stalker & Tank — Composite Plating (+20% DEF)'] },
    { id: 'titan',                tier: 3, col: 7,   prereqs: ['crucible'], name: 'Titan',                icon: 'Skillicon7_12.png', desc: 'Requires Crucible. Unlocks the Titan unit.', unlockUnits: ['titan'] },
    { id: 'advanced_projectiles', tier: 3, col: 8,   prereqs: ['crucible'], name: 'Advanced Projectiles', icon: 'Skillicon7_02.png', desc: 'Requires Crucible. Upgrades the Tank’s assault-mode range to 2–4.', unlockUpgrades: ['Tank — Assault range 2–4'] },
    { id: 'tracer_rounds',        tier: 2, col: 4,   prereqs: ['mech_bay'], name: 'Tracer Rounds',        icon: 'Skillicon7_18.png', desc: 'Requires Mech Bay. Lets you mark an enemy unit. (Details TBD.)', unlockUpgrades: ['Mark an enemy unit (TBD)'] },
  ],
};

// Hive's Armory (node ids match the ENGINE hive_armory tech ids). Two roots — Reaper and
// Scab — that converge on the Wyrm at L3; the Wyrm then offers a one-of-two upgrade pick.
const armoryHive: TechTreeDef = {
  id: 'armory',
  name: 'Armory',
  icon: 'Skillicon7_13.png',
  nodes: [
    // ── Level 1 ──
    { id: 'reaper_tech',    tier: 1, col: 1, name: 'Reaper', icon: 'Skillicon7_10.png', desc: 'Unlocks the Reaper.', unlockUnits: ['reaper'] },
    { id: 'scab_tech',      tier: 1, col: 3.5, name: 'Scab',   icon: 'Skillicon7_16.png', desc: 'Unlocks the Scab.', unlockUnits: ['scab'] },
    // ── Level 2 ──
    { id: 'burstling_tech', tier: 2, col: 0, prereqs: ['reaper_tech'], name: 'Burstling', icon: 'Skillicon7_05.png', desc: 'Unlocks the Burstling. (Stats TBD.)', unlockUnits: ['burstling'] },
    { id: 'vindrace_tech',  tier: 2, col: 1, prereqs: ['reaper_tech'],   name: 'Vindrace',  icon: 'Skillicon7_17.png', desc: 'Unlocks the Vindrace.', unlockUnits: ['vindrace'] },
    { id: 'adrenal_glands', tier: 2, col: 2, prereqs: ['reaper_tech'], name: 'Adrenal Glands', icon: 'Skillicon7_07.png', desc: 'Gives the Reaper Dash II and Scuttlings +1 movement.', unlockUpgrades: ['Reaper — Dash II (2 move after attacking)', 'Scuttling — +1 movement'] },
    { id: 'seercaust_tech', tier: 2, col: 3.5, prereqs: ['scab_tech'],     name: 'Seercaust', icon: 'Skillicon7_11.png', desc: 'Unlocks the Seercaust.', unlockUnits: ['seercaust'] },
    { id: 'ravener_tech',   tier: 2, col: 4.5, prereqs: ['seercaust_tech'], name: 'Ravener',  icon: 'Skillicon7_01.png', desc: 'Unlocks the Ravener. (Stats TBD.)', unlockUnits: ['ravener'] },
    // ── Level 3 ──
    { id: 'hardened_carapace', tier: 3, col: 0,   prereqs: ['vindrace_tech'], name: 'Hardened Carapace', icon: 'Skillicon7_03.png', desc: 'The Vindrace survives any hit at 1 HP (a blow that would kill it leaves it on 1). (Effect pending.)', unlockUpgrades: ['Vindrace — survives any single hit at 1 HP (pending)'] },
    { id: 'berserker_glands',  tier: 3, col: 1,   prereqs: ['behemoth_tech'], name: 'Berserker Glands',  icon: 'Skillicon7_04.png', desc: 'Gives the Reaper Creep (ignores enemy AOI). Behemoth below 50% HP: +1 move & +20% attack (pending).', unlockUpgrades: ['Reaper — Creep: ignores enemy AOI', 'Behemoth — below 50% HP: +1 move & +20% attack (pending)'] },
    { id: 'behemoth_tech',     tier: 3, col: 2,   prereqs: ['vindrace_tech'], name: 'Behemoth',          icon: 'Skillicon7_12.png', desc: 'Unlocks the Behemoth. (Stats TBD.)', unlockUnits: ['behemoth'] },
    { id: 'wyrm_tech',         tier: 3, col: 3.5, prereqsAny: ['vindrace_tech', 'seercaust_tech'], name: 'Wyrm', icon: 'Skillicon7_09.png', desc: 'Unlocks the Wyrm. Reachable from Vindrace OR Seercaust.', unlockUnits: ['wyrm'] },
    { id: 'tunneling_network', tier: 3, col: 4.5, prereqs: ['wyrm_tech'], excludes: ['aftershock'],       excludeNote: 'Can only select 1 upgrade for Wyrm', name: 'Tunneling Network', icon: 'Skillicon7_05.png', desc: 'Wyrm burrows without spending a movement point (so it can burrow then move).', unlockUpgrades: ['Wyrm — burrow costs no movement'] },
    { id: 'aftershock',        tier: 3, col: 5.5, prereqs: ['wyrm_tech'], excludes: ['tunneling_network'], excludeNote: 'Can only select 1 upgrade for Wyrm', name: 'Aftershock',        icon: 'Skillicon7_18.png', desc: 'After the Wyrm erupts, every unit (friend or foe) in its 3×3 takes a 3-attack hit.', unlockUpgrades: ['Wyrm — on erupt, all units in its 3×3 take a 3-attack hit'] },
  ],
};

// ── Nodes tree (PURELY VISUAL / decorative) ──────────────────────────────────
// A central "Nodes" tile with four branches radiating diagonally (NE/SE/SW/NW).
// These ids are NOT engine techs — they carry no cost and no research/unlock logic.
// Every node is flagged `root: true` so nodeState() always returns 'root' (a plain
// decorative "BASE" card) and never tries to look up prereqs/research state, and
// costOf() returns null (registry.techs has no entry for these ids). Layout uses a
// 3-column / 3-row diamond: centre at (col 1, tier 1); branches on the diagonals.
const nodes: TechTreeDef = {
  id: 'nodes',
  name: 'Nodes',
  icon: 'Skillicon7_17.png',
  nodes: [
    { id: 'node_root',        tier: 1, col: 1, root: true, name: 'Nodes',       icon: 'Skillicon7_17.png', desc: 'Node network hub. (Visual only.)' },
    // NW / NE on the upper row (tier 0), SW / SE on the lower row (tier 2).
    { id: 'node_sensors',     tier: 0, col: 0, root: true, prereqs: ['node_root'], name: 'Sensors',     icon: 'Skillicon7_11.png', desc: 'Sensors branch. (Visual only.)' },
    { id: 'node_mobility',    tier: 0, col: 2, root: true, prereqs: ['node_root'], name: 'Mobility',    icon: 'Skillicon7_07.png', desc: 'Mobility branch. (Visual only.)' },
    { id: 'node_recruitment', tier: 2, col: 0, root: true, prereqs: ['node_root'], name: 'Recruitment', icon: 'Skillicon7_10.png', desc: 'Recruitment branch. (Visual only.)' },
    { id: 'node_resources',   tier: 2, col: 2, root: true, prereqs: ['node_root'], name: 'Resources',   icon: 'Skillicon7_16.png', desc: 'Resources branch. (Visual only.)' },
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

/** The research trees for a given faction — the Armory tab is faction-specific. */
export function getTechTrees(factionId: string): TechTreeDef[] {
  return [
    refinement,
    factionId === 'hive' ? armoryHive : armory,
    nodes,
    blank(1),
    blank(2),
  ];
}

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
export const NODE_W = 188;
export const NODE_H = 120; // minimum; cards grow with their unlock detail
const COL_W = 210;
const ROW_H = 300;

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
export function nodeState(node: TechNode, tree: TechTreeDef, researched: Set<string>): 'researched' | 'available' | 'locked' | 'excluded' | 'root' | 'cut' {
  if (node.root) return 'root'; // always-available Lvl-0 base (not researchable)
  if (node.cut) return 'cut';   // un-researchable, greyed reference tile
  if (researched.has(node.id)) return 'researched';
  // Mutually-exclusive: a researched sibling crosses this one out.
  if (node.excludes && node.excludes.some(e => researched.has(e))) return 'excluded';
  const hasPrereqData = (node.prereqs?.length ?? 0) > 0 || (node.prereqsAny?.length ?? 0) > 0;
  if (hasPrereqData) {
    // A prereq that points at a `root` base node counts as satisfied.
    const rootIds = new Set(tree.nodes.filter(n => n.root).map(n => n.id));
    const met = (id: string) => researched.has(id) || rootIds.has(id);
    const allReq = (node.prereqs ?? []).every(met);
    const anyReq = !node.prereqsAny?.length || node.prereqsAny.some(met);
    return allReq && anyReq ? 'available' : 'locked';
  }
  return isTierUnlocked(tree, node.tier, researched) ? 'available' : 'locked';
}
