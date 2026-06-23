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
  nodes: [
    { id: 'arm_smallarms', tier: 1, name: 'Small Arms',          icon: 'Skillicon7_10.png', desc: 'Unlocks the Marksman ranged unit.' },
    { id: 'arm_triage',    tier: 1, name: 'Triage',              icon: 'Skillicon7_11.png', desc: 'Unlocks the Medic unit.' },
    { id: 'arm_combined',  tier: 1, name: 'Combined Arms',       icon: 'Skillicon7_07.png', desc: 'Focus fire: when 2+ of your units hit the same target in a turn, each extra shot deals +10% damage (2nd, 3rd, 4th… — does not stack per shot).' },
    { id: 'arm_forge',     tier: 2, name: 'Forge',               icon: 'Skillicon7_16.png', desc: 'Unlocks the Tank unit.' },
    { id: 'arm_mechbay',   tier: 2, name: 'Mech Bay',            icon: 'Skillicon7_17.png', desc: 'Unlocks the Stalker unit.' },
    { id: 'arm_advproj',   tier: 2, name: 'Advanced Projectiles', icon: 'Skillicon7_18.png', desc: 'Tanks get +1 attack distance in siege mode (entering siege mode takes one turn).' },
    { id: 'arm_reactive',  tier: 3, name: 'Reactive Plating',    icon: 'Skillicon7_13.png', desc: 'Tanks and mechs gain a 10% defensive bonus.' },
    { id: 'arm_tracer',    tier: 3, name: 'Tracer Rounds',       icon: 'Skillicon7_01.png', desc: "Stalkers can fire a 'trace' round (separate from attack) revealing a target's position — including cloaked units — until healed." },
    { id: 'arm_replicator', tier: 3, name: 'Replicator',         icon: 'Skillicon7_12.png', desc: 'Unlocks a building that builds one extra unit per turn. Takes 3 turns to complete. Max 1 per city.' },
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
