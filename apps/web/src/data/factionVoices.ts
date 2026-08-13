/**
 * Faction voice lines — placeholder SFX ripped for local prototyping (see
 * public/audio/starcraft/, gitignored: Blizzard IP, never ship or commit).
 *
 * The rip carries no per-unit metadata, so lines are HAND-CATEGORISED back to
 * their source units and mapped onto RIGBOUND kinds — each kind speaks ONE
 * consistent character:
 *   warrior→Marine, defender(Bulwark)→Firebat, tank→Goliath,
 *   titan→Battlecruiser, wraith→Ghost, sentinel→Wraith pilot, scout→Explorer.
 * Kinds without a matched character fall back to a small pool of anonymous
 * radio chatter (single-word acks that don't evoke any one unit). Comedy /
 * announcer / out-of-character lines from the rip are deliberately unused.
 * The Hive pool is empty until a creature/Zerg set is ripped (empty pool =
 * silent voice layer; the generic UI blips in GameSfx still play).
 */

export type VoiceEvent =
  | 'select' | 'move' | 'attackOrder' | 'death'
  | 'ready' | 'research' | 'build' | 'underAttack';

const V = '/audio/starcraft';
type Pools = Partial<Record<VoiceEvent, string[]>>;

// ── Vanguard: one StarCraft character per RIGBOUND kind ──────────────────────
const VANGUARD_KINDS: Record<string, Pools> = {
  // Marine — grunt infantry.
  warrior: {
    select: [`${V}/commander.mp3`, `${V}/what-s-up.mp3`, `${V}/yeah.mp3`, `${V}/yep.mp3`],
    move: [`${V}/go-go-go.mp3`, `${V}/you-got-it.mp3`, `${V}/i-gotcha.mp3`],
    attackOrder: [`${V}/you-want-a-piece-of-me-boy.mp3`, `${V}/give-me-something-to-shoot.mp3`, `${V}/alright-bring-it-on.mp3`],
    death: [`${V}/death-cry.mp3`],
  },
  // Second trooper flavour so lancers don't sound identical to warriors.
  lancer: {
    select: [`${V}/affirmative-sir.mp3`, `${V}/i-read-you-sir.mp3`, `${V}/yes-sir.mp3`],
    move: [`${V}/yes-sir-2.mp3`, `${V}/i-read-ya.mp3`, `${V}/we-gotta-move.mp3`],
    attackOrder: [`${V}/attack-formation.mp3`, `${V}/decisive-action.mp3`],
    death: [`${V}/death-cry.mp3`],
  },
  // Firebat — the flame-and-bravado shield line.
  defender: {
    select: [`${V}/fire-it-up.mp3`, `${V}/how-y-all-doing.mp3`, `${V}/howdy.mp3`],
    move: [`${V}/all-right.mp3`, `${V}/alright-then.mp3`],
    attackOrder: [`${V}/i-love-the-smell-of-napalm.mp3`, `${V}/ah-thats-the-stuff.mp3`],
    death: [`${V}/firebat-death.mp3`],
  },
  // Goliath — walker chassis chatter.
  tank: {
    select: [`${V}/go-ahead-taccom.mp3`, `${V}/systems-functional.mp3`, `${V}/checklist-protocol-initiated.mp3`],
    move: [`${V}/commencing.mp3`, `${V}/confirm.mp3`, `${V}/acknowledged-hq.mp3`],
    attackOrder: [`${V}/target-designated.mp3`, `${V}/checklist-completed-sob.mp3`],
    ready: [`${V}/goliath-online.mp3`],
  },
  // Battlecruiser — the capital-ship gravitas.
  titan: {
    select: [`${V}/battle-cruiser-operational.mp3`, `${V}/hailing-frequencies-open.mp3`, `${V}/good-day-commander.mp3`, `${V}/i-like-the-cut-of-your-jib.mp3`],
    move: [`${V}/take-it-slow.mp3`, `${V}/all-crews-reporting.mp3`],
    attackOrder: [`${V}/engage.mp3`, `${V}/and-dispense-some-indiscriminate-justice.mp3`],
    ready: [`${V}/battle-cruiser-operational.mp3`],
  },
  // Ghost — the cloaked sniper.
  wraith: {
    select: [`${V}/ghost-reportin.mp3`, `${V}/call-the-shot.mp3`],
    move: [`${V}/yeah-i-m-going.mp3`, `${V}/i-copy-that.mp3`],
    attackOrder: [`${V}/you-call-down-the-thunder.mp3`, `${V}/target-designated.mp3`],
    death: [`${V}/ghost-death.mp3`],
    ready: [`${V}/ghost-reportin.mp3`],
  },
  // Wraith pilot — the hovering support flyer.
  sentinel: {
    select: [`${V}/wraith-awaiting-launch-orders.mp3`, `${V}/go-ahead-commander.mp3`],
    move: [`${V}/coordinates-received.mp3`, `${V}/vector-locked-in.mp3`],
    attackOrder: [`${V}/engage.mp3`],
    ready: [`${V}/wraith-awaiting-launch-orders.mp3`],
  },
  // Explorer — light recon.
  scout: {
    select: [`${V}/explorer-reporting.mp3`, `${V}/hey-there.mp3`],
    move: [`${V}/i-dig.mp3`, `${V}/sure-thing.mp3`],
    attackOrder: [`${V}/alright-bring-it-on.mp3`],
    ready: [`${V}/explorer-reporting.mp3`],
  },
  // Stalker mech — clipped machine comms.
  stalker: {
    select: [`${V}/commlink-online.mp3`, `${V}/channel-open.mp3`],
    move: [`${V}/transmit-orders.mp3`, `${V}/confirm.mp3`],
    attackOrder: [`${V}/engage.mp3`, `${V}/target-designated.mp3`],
  },
};

// Anonymous radio chatter — single-word acks that don't evoke any specific
// character. Used by kinds without a matched voice set (medic, engineer…).
const VANGUARD_FALLBACK: Pools = {
  select: [`${V}/yes.mp3`, `${V}/go-ahead-hq.mp3`, `${V}/greetings-command.mp3`],
  move: [`${V}/affirmative.mp3`, `${V}/i-read-you.mp3`, `${V}/absolutely.mp3`],
  attackOrder: [`${V}/engage.mp3`],
  death: [`${V}/death-cry.mp3`],
  ready: [`${V}/all-crews-reporting.mp3`, `${V}/systems-functional.mp3`],
  research: [`${V}/upgrade-complete.mp3`],
  build: [`${V}/add-on-complete.mp3`, `${V}/construction.mp3`],
  underAttack: [`${V}/your-forces-are-under-attack.mp3`, `${V}/base-is-under-attack.mp3`],
};

// Hive: intentionally empty until a creature/Zerg sound set is ripped.
const HIVE_KINDS: Record<string, Pools> = {};
const HIVE_FALLBACK: Pools = {};

const KIND_POOLS: Record<string, Record<string, Pools>> = {
  vanguard: VANGUARD_KINDS,
  hive: HIVE_KINDS,
};
const FALLBACK: Record<string, Pools> = {
  vanguard: VANGUARD_FALLBACK,
  hive: HIVE_FALLBACK,
};

// Mode-variant kinds share their base kind's voice.
const KIND_ALIASES: Record<string, string> = {
  tank_assault: 'tank',
  wyrm_burrowed: 'wyrm',
};

// Shuffle-bag per pool so lines don't repeat back-to-back.
const bags = new Map<string[], string[]>();
function draw(pool: string[]): string {
  let bag = bags.get(pool);
  if (!bag || bag.length === 0) {
    bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    bags.set(pool, bag);
  }
  return bag.pop()!;
}

/** A voice line for the event — the unit kind's own character if it has one,
 *  else the faction's anonymous radio pool. Null = stay silent. */
export function voiceLine(factionId: string, event: VoiceEvent, unitKind?: string): string | null {
  const kind = unitKind ? (KIND_ALIASES[unitKind] ?? unitKind) : undefined;
  const pool = (kind && KIND_POOLS[factionId]?.[kind]?.[event]) || FALLBACK[factionId]?.[event];
  if (!pool || pool.length === 0) return null;
  return draw(pool);
}

/** Whether a voice exists for this event (lets callers swap a UI blip for the
 *  voice instead of stacking both). Does not consume from the shuffle bag. */
export function hasVoice(factionId: string, event: VoiceEvent, unitKind?: string): boolean {
  const kind = unitKind ? (KIND_ALIASES[unitKind] ?? unitKind) : undefined;
  const pool = (kind && KIND_POOLS[factionId]?.[kind]?.[event]) || FALLBACK[factionId]?.[event];
  return !!pool && pool.length > 0;
}
