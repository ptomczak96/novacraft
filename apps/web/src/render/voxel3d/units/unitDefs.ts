/**
 * Bespoke voxel box-models for EVERY unit type, designed from each unit's
 * stats, conditions and abilities in packages/data/json/units.json.
 * Sizes/positions are in voxels (VOXEL world units each); pos is the part
 * CENTER, x/z from body midline, y up from the ground. Models face +Z.
 *
 * Two glow channels per unit:
 *  - teamGlow parts (visor/eyes) bloom in the owner's team colour, so
 *    allegiance always reads;
 *  - fixed `emissive` parts carry unit identity (Hive acid green, artillery
 *    payload orange, thruster cyan...).
 */

export const VOXEL = 0.03; // 24 voxels ≈ 0.72 world units tall

export interface UnitPartDef {
  size: [number, number, number];
  pos: [number, number, number];
  /** Euler rotation in radians, applied to the part. */
  rot?: [number, number, number];
  color?: string;
  /** Painted with the owning player's team colour. */
  teamColor?: boolean;
  emissive?: string;
  /** Visor/eye glow in the owning player's team colour (blooms). */
  teamGlow?: boolean;
  emissiveIntensity?: number;
}

export interface UnitDef {
  parts: UnitPartDef[];
}

// ── Vanguard / shared hard-surface palette ──
const GUNMETAL = '#57627a';
const DARK = '#39415a';
const JOINT = '#232838';
const STEEL = '#6b7690';
// ── Hive chitin palette ──
const CHITIN = '#4a3b52';
const CARAPACE = '#5f4a6b';
const BONE = '#8d7f96';
const ACID = '#8aff4d';
// ── Sylvan / misc ──
const BARK = '#4a3b28';
const LEAF = '#2a6b4f';
const WOOD = '#6b5537';

/** Generic trooper — fallback for unknown/modded unit ids. */
const FALLBACK: UnitDef = {
  parts: [
    { size: [3, 8, 3], pos: [-2.2, 4, 0], color: DARK },
    { size: [3, 8, 3], pos: [2.2, 4, 0], color: DARK },
    { size: [8, 8, 5], pos: [0, 12, 0], teamColor: true },
    { size: [2.5, 6.5, 2.5], pos: [-5.2, 12.5, 0], color: GUNMETAL },
    { size: [2.5, 6.5, 2.5], pos: [5.2, 12.5, 0], color: GUNMETAL },
    { size: [5, 5, 5], pos: [0, 18.8, 0], color: GUNMETAL },
    { size: [4.2, 1.4, 0.8], pos: [0, 19.3, 2.6], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [1.8, 1.8, 8], pos: [5.2, 10.5, 3], color: JOINT },
  ],
};

// ─────────────────────────── Shared ───────────────────────────

/** Scout — fragile recon (vis 2, atk 0.5): slim frame, sensor mast, pack. */
const SCOUT: UnitDef = {
  parts: [
    { size: [2.5, 7, 2.5], pos: [-1.8, 3.5, 0], color: DARK },
    { size: [2.5, 7, 2.5], pos: [1.8, 3.5, 0], color: DARK },
    { size: [6, 7, 4], pos: [0, 10.5, 0], teamColor: true },
    { size: [2.2, 6, 2.2], pos: [-4.2, 11, 0], color: GUNMETAL },
    { size: [2.2, 6, 2.2], pos: [4.2, 11, 0], color: GUNMETAL },
    { size: [4, 4, 4], pos: [0, 16.5, 0], color: GUNMETAL },
    // Wide recon goggles.
    { size: [3.6, 1.4, 0.8], pos: [0, 17, 2.2], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [4, 5, 2], pos: [0, 11, -3.2], color: JOINT },
    { size: [0.8, 6, 0.8], pos: [2.5, 18.5, -2], color: JOINT },
    { size: [1.2, 1.2, 1.2], pos: [2.5, 22, -2], color: '#000000', teamGlow: true, emissiveIntensity: 3 },
  ],
};

/** Warrior — basic melee: pauldrons and a heavy blade. */
const WARRIOR: UnitDef = {
  parts: [
    { size: [3, 7, 3], pos: [-2.1, 3.5, 0], color: DARK },
    { size: [3, 7, 3], pos: [2.1, 3.5, 0], color: DARK },
    { size: [7.5, 7, 4.5], pos: [0, 10.5, 0], teamColor: true },
    { size: [3, 2.5, 4.5], pos: [-5.2, 14.2, 0], color: STEEL },
    { size: [3, 2.5, 4.5], pos: [5.2, 14.2, 0], color: STEEL },
    { size: [2.4, 6, 2.4], pos: [-5, 11, 0], color: GUNMETAL },
    { size: [2.4, 6, 2.4], pos: [5, 11, 0], color: GUNMETAL },
    { size: [4.5, 4.5, 4.5], pos: [0, 16.8, 0], color: GUNMETAL },
    { size: [3.8, 1.3, 0.8], pos: [0, 17.3, 2.4], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Blade held low-forward.
    { size: [1.2, 9, 2.2], pos: [5.5, 6.5, 3], color: STEEL },
    { size: [2.2, 1.5, 3], pos: [5.5, 11.5, 3], color: JOINT },
  ],
};

/** Archer — ranged 2, mobile: hooded, crossbow, quiver. */
const ARCHER: UnitDef = {
  parts: [
    { size: [2.6, 7, 2.6], pos: [-1.9, 3.5, 0], color: DARK },
    { size: [2.6, 7, 2.6], pos: [1.9, 3.5, 0], color: DARK },
    { size: [6.5, 7, 4], pos: [0, 10.5, 0], teamColor: true },
    { size: [2.2, 6, 2.2], pos: [-4.4, 11, 0], color: GUNMETAL },
    { size: [2.2, 6, 2.2], pos: [4.4, 11, 0], color: GUNMETAL },
    { size: [4.4, 4.4, 4.4], pos: [0, 16.5, 0], color: GUNMETAL },
    { size: [5, 1.6, 5], pos: [0, 19.3, -0.6], color: DARK }, // hood
    { size: [3.6, 1.2, 0.8], pos: [0, 17, 2.3], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Crossbow: stock + cross limb.
    { size: [1.5, 1.5, 8], pos: [4.4, 11, 3], color: WOOD },
    { size: [6, 1.2, 1.2], pos: [4.4, 11, 5.5], color: JOINT },
    { size: [2.5, 6, 1.5], pos: [-2, 11.5, -3.2], color: JOINT }, // quiver
  ],
};

/** Catapult — atk 10 rng 3, can't move-and-attack: tracked artillery sled. */
const CATAPULT: UnitDef = {
  parts: [
    { size: [3.2, 4, 11], pos: [-5.5, 2.5, 0], color: JOINT },
    { size: [3.2, 4, 11], pos: [5.5, 2.5, 0], color: JOINT },
    { size: [11, 3, 9], pos: [0, 5, 0], teamColor: true },
    { size: [5, 4, 4], pos: [0, 7.5, -3.5], color: GUNMETAL }, // counterweight
    // Throwing arm, leaned back, basket at the top.
    { size: [2, 13, 2], pos: [0, 11.5, 1.5], rot: [-0.55, 0, 0], color: WOOD },
    { size: [4, 2.2, 4], pos: [0, 16.5, 5.5], color: JOINT },
    { size: [2.4, 2.4, 2.4], pos: [0, 18, 5.5], color: '#000000', emissive: '#ffb163', emissiveIntensity: 3 },
  ],
};

// ─────────────────────────── Vanguard ───────────────────────────

/** Lancer — range-2 pike (mountain_shooter): long powered lance + buckler. */
const LANCER: UnitDef = {
  parts: [
    { size: [2.8, 7, 2.8], pos: [-2, 3.5, 0], color: DARK },
    { size: [2.8, 7, 2.8], pos: [2, 3.5, 0], color: DARK },
    { size: [7, 7, 4.2], pos: [0, 10.5, 0], teamColor: true },
    { size: [2.3, 6, 2.3], pos: [-4.7, 11, 0], color: GUNMETAL },
    { size: [2.3, 6, 2.3], pos: [4.7, 11, 0], color: GUNMETAL },
    { size: [4.4, 4.4, 4.4], pos: [0, 16.6, 0], color: GUNMETAL },
    { size: [3.7, 1.2, 0.8], pos: [0, 17.1, 2.3], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Powered lance, well past the body.
    { size: [1.2, 1.2, 16], pos: [4.7, 11, 5], color: STEEL },
    { size: [1.8, 1.8, 2.5], pos: [4.7, 11, 13.5], color: '#000000', teamGlow: true, emissiveIntensity: 3 },
    { size: [4.5, 4.5, 1], pos: [-4.7, 11, 2.2], color: JOINT }, // buckler
  ],
};

/** Bulwark — def 3: body-height tower shield with a glowing sight slit. */
const DEFENDER: UnitDef = {
  parts: [
    { size: [3.5, 6, 3.5], pos: [-2.4, 3, 0], color: DARK },
    { size: [3.5, 6, 3.5], pos: [2.4, 3, 0], color: DARK },
    { size: [8, 7, 5], pos: [0, 9.5, 0], teamColor: true },
    { size: [2.6, 6, 2.6], pos: [-5.4, 10, 0], color: GUNMETAL },
    { size: [2.6, 6, 2.6], pos: [5.4, 10, 0], color: GUNMETAL },
    { size: [4.2, 4.2, 4.2], pos: [0, 15.3, 0], color: GUNMETAL },
    { size: [3.5, 1.2, 0.8], pos: [0, 15.8, 2.2], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Tower shield.
    { size: [9.5, 15, 1.6], pos: [0, 8, 4.6], color: STEEL },
    { size: [5, 1, 0.6], pos: [0, 10.5, 5.6], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
  ],
};

/** Stalker — heavy 4-legged walker (mountain_movement, rng 2): spider chassis. */
const STALKER: UnitDef = {
  parts: [
    { size: [10, 6, 8], pos: [0, 12, 0], teamColor: true },
    // Four splayed legs + feet.
    { size: [1.8, 11, 1.8], pos: [-5.5, 6, -3.5], rot: [0, 0, 0.35], color: JOINT },
    { size: [1.8, 11, 1.8], pos: [5.5, 6, -3.5], rot: [0, 0, -0.35], color: JOINT },
    { size: [1.8, 11, 1.8], pos: [-5.5, 6, 3.5], rot: [0, 0, 0.35], color: JOINT },
    { size: [1.8, 11, 1.8], pos: [5.5, 6, 3.5], rot: [0, 0, -0.35], color: JOINT },
    { size: [2.6, 1.5, 2.6], pos: [-7.3, 0.8, -3.5], color: DARK },
    { size: [2.6, 1.5, 2.6], pos: [7.3, 0.8, -3.5], color: DARK },
    { size: [2.6, 1.5, 2.6], pos: [-7.3, 0.8, 3.5], color: DARK },
    { size: [2.6, 1.5, 2.6], pos: [7.3, 0.8, 3.5], color: DARK },
    // Turret + long gun.
    { size: [4.5, 3, 6], pos: [0, 16.5, 1], color: GUNMETAL },
    { size: [1.2, 1.2, 8], pos: [0, 16.7, 6.5], color: STEEL },
    { size: [3, 1, 0.8], pos: [0, 13.5, 4.2], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
  ],
};

/** Wraith — cloak + stun, rng 3: sleek assassin, twin antennae, rail rifle. */
const WRAITH: UnitDef = {
  parts: [
    { size: [2, 7, 2], pos: [-1.6, 3.5, 0], color: JOINT },
    { size: [2, 7, 2], pos: [1.6, 3.5, 0], color: JOINT },
    { size: [6, 8, 3.5], pos: [0, 11, 0], teamColor: true },
    { size: [7, 4.5, 4.5], pos: [0, 6.5, -0.6], color: JOINT }, // cloak flare
    { size: [2, 5.5, 2], pos: [-4, 11.5, 0], color: DARK },
    { size: [2, 5.5, 2], pos: [4, 11.5, 0], color: DARK },
    { size: [3.8, 4, 3.8], pos: [0, 17.5, 0], color: DARK },
    { size: [3, 0.9, 0.6], pos: [0, 18, 2], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [0.6, 4.5, 0.6], pos: [-1.5, 21.5, -0.5], color: JOINT },
    { size: [0.6, 4.5, 0.6], pos: [1.5, 21.5, -0.5], color: JOINT },
    // Long rail rifle.
    { size: [1, 1, 13], pos: [4, 11.5, 4.5], color: STEEL },
    { size: [1.4, 1.4, 1.4], pos: [4, 11.5, 11], color: '#000000', teamGlow: true, emissiveIntensity: 3 },
  ],
};

/** Tank — treads, turret, short gun; morphs to assault mode. */
const TANK: UnitDef = {
  parts: [
    { size: [3.5, 4.5, 14], pos: [-6.2, 3, 0], color: JOINT },
    { size: [3.5, 4.5, 14], pos: [6.2, 3, 0], color: JOINT },
    { size: [11, 4, 12.5], pos: [0, 5.5, 0], color: GUNMETAL },
    { size: [11.3, 1.2, 3.5], pos: [0, 6.8, -3.5], teamColor: true },
    { size: [6.5, 3.5, 7], pos: [0, 9.5, -0.5], color: DARK },
    { size: [1.4, 1.4, 9], pos: [0, 9.8, 6], color: STEEL },
    { size: [1.8, 1.8, 1.2], pos: [0, 9.8, 10.5], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
    { size: [2.5, 1, 2.5], pos: [2, 11.5, -2], color: JOINT },
  ],
};

/** Tank (Assault Mode) — deployed: outriggers, elevated long gun, mast. */
const TANK_ASSAULT: UnitDef = {
  parts: [
    { size: [3.5, 4.5, 14], pos: [-6.2, 3, 0], color: JOINT },
    { size: [3.5, 4.5, 14], pos: [6.2, 3, 0], color: JOINT },
    { size: [11, 4, 12.5], pos: [0, 5.5, 0], color: GUNMETAL },
    { size: [11.3, 1.2, 3.5], pos: [0, 6.8, -3.5], teamColor: true },
    { size: [6.5, 3.5, 7], pos: [0, 9.5, -0.5], color: DARK },
    // Deployed outrigger stabilisers.
    { size: [1.8, 1.4, 6], pos: [-7.5, 1.5, 7], rot: [0, 0.7, 0], color: STEEL },
    { size: [1.8, 1.4, 6], pos: [7.5, 1.5, 7], rot: [0, -0.7, 0], color: STEEL },
    { size: [1.8, 1.4, 6], pos: [-7.5, 1.5, -7], rot: [0, -0.7, 0], color: STEEL },
    { size: [1.8, 1.4, 6], pos: [7.5, 1.5, -7], rot: [0, 0.7, 0], color: STEEL },
    // Elevated siege barrel + spotting mast (vis 3 in this mode).
    { size: [1.4, 1.4, 13], pos: [0, 11, 6.5], rot: [-0.18, 0, 0], color: STEEL },
    { size: [1.9, 1.9, 1.4], pos: [0, 12.2, 12.8], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
    { size: [0.8, 7, 0.8], pos: [2.5, 13, -3.5], color: JOINT },
    { size: [1.2, 1.2, 1.2], pos: [2.5, 17, -3.5], color: '#000000', teamGlow: true, emissiveIntensity: 3 },
  ],
};

/** Titan — 300-cost flagship: huge biped, twin shoulder shell cannons. */
const TITAN: UnitDef = {
  parts: [
    { size: [5, 12, 6], pos: [-4.5, 6, 0], color: DARK },
    { size: [5, 12, 6], pos: [4.5, 6, 0], color: DARK },
    { size: [12, 4, 7], pos: [0, 13.5, 0], color: JOINT },
    { size: [14, 10, 9], pos: [0, 20.5, 0], teamColor: true },
    { size: [4.5, 6, 4.5], pos: [-8.8, 20, 0], color: GUNMETAL },
    { size: [4.5, 6, 4.5], pos: [8.8, 20, 0], color: GUNMETAL },
    { size: [5, 4, 5], pos: [0, 27, 0.5], color: GUNMETAL },
    { size: [4.2, 1.5, 0.8], pos: [0, 27.3, 3.1], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Percussive Shells: twin shoulder cannons with hot muzzles.
    { size: [3.5, 3.5, 11], pos: [-8.8, 25.5, 1], color: STEEL },
    { size: [3.5, 3.5, 11], pos: [8.8, 25.5, 1], color: STEEL },
    { size: [3.9, 3.9, 1.2], pos: [-8.8, 25.5, 6.8], color: '#000000', emissive: '#ffb163', emissiveIntensity: 3 },
    { size: [3.9, 3.9, 1.2], pos: [8.8, 25.5, 6.8], color: '#000000', emissive: '#ffb163', emissiveIntensity: 3 },
    { size: [10, 2, 8], pos: [0, 26.5, -1], color: DARK },
  ],
};

/** Sentinel — flying detector/shield drone: hovering disc, dish, thruster. */
const SENTINEL: UnitDef = {
  parts: [
    { size: [8, 3, 8], pos: [0, 16, 0], teamColor: true },
    { size: [5.5, 1.5, 5.5], pos: [0, 18.2, 0], color: GUNMETAL },
    // Hover thruster (fixed cyan — engine, not allegiance).
    { size: [4, 1.6, 4], pos: [0, 13.8, 0], color: '#000000', emissive: '#33f0ff', emissiveIntensity: 3 },
    // Rotor/emitter pods on four corners (Kinetic Shield projectors).
    { size: [2.6, 1.6, 2.6], pos: [-5.2, 16.5, -5.2], color: JOINT },
    { size: [2.6, 1.6, 2.6], pos: [5.2, 16.5, -5.2], color: JOINT },
    { size: [2.6, 1.6, 2.6], pos: [-5.2, 16.5, 5.2], color: JOINT },
    { size: [2.6, 1.6, 2.6], pos: [5.2, 16.5, 5.2], color: JOINT },
    // Detection dish on a stem, facing forward.
    { size: [0.8, 3, 0.8], pos: [0, 20.5, 1], color: JOINT },
    { size: [5, 4.5, 1], pos: [0, 22.5, 2], rot: [0.3, 0, 0], color: STEEL },
    { size: [1.4, 1.4, 1], pos: [0, 22.5, 2.8], rot: [0.3, 0, 0], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
  ],
};

/** Berserker — rage melee (atk 8, mov 3): horned helm, huge axe. */
const BERSERKER: UnitDef = {
  parts: [
    { size: [3.5, 6.5, 3.5], pos: [-2.4, 3.2, 0], color: DARK },
    { size: [3.5, 6.5, 3.5], pos: [2.4, 3.2, 0], color: DARK },
    { size: [9, 8, 5.5], pos: [0, 10.5, 0], teamColor: true },
    { size: [3.6, 3, 5], pos: [-6, 14.8, 0], color: STEEL },
    { size: [3.6, 3, 5], pos: [6, 14.8, 0], color: STEEL },
    { size: [2.8, 6, 2.8], pos: [-6, 10.5, 0], color: GUNMETAL },
    { size: [2.8, 6, 2.8], pos: [6, 10.5, 0], color: GUNMETAL },
    { size: [5, 4.5, 5], pos: [0, 17, 0], color: GUNMETAL },
    { size: [1.2, 3, 1.2], pos: [-3, 20.5, 0], rot: [0, 0, 0.4], color: BONE },
    { size: [1.2, 3, 1.2], pos: [3, 20.5, 0], rot: [0, 0, -0.4], color: BONE },
    { size: [4.2, 1.3, 0.8], pos: [0, 17.5, 2.6], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Great axe.
    { size: [1.3, 13, 1.3], pos: [6, 10, 2.5], color: WOOD },
    { size: [1, 5.5, 6], pos: [6, 15.5, 4.5], color: STEEL },
  ],
};

/** Siege Tower — def 5, rng 2, static shooter: rolling armored tower. */
const SIEGE_TOWER: UnitDef = {
  parts: [
    { size: [12, 4, 12], pos: [0, 2.5, 0], color: JOINT },
    { size: [3, 3, 3], pos: [-5.5, 1.5, -5.5], color: DARK },
    { size: [3, 3, 3], pos: [5.5, 1.5, -5.5], color: DARK },
    { size: [3, 3, 3], pos: [-5.5, 1.5, 5.5], color: DARK },
    { size: [3, 3, 3], pos: [5.5, 1.5, 5.5], color: DARK },
    { size: [9, 18, 9], pos: [0, 13.5, 0], color: GUNMETAL },
    { size: [9.4, 3, 9.4], pos: [0, 18, 0], teamColor: true },
    { size: [11, 2, 11], pos: [0, 23.5, 0], color: DARK },
    { size: [2, 2.5, 2], pos: [-4, 25.7, -4], color: JOINT },
    { size: [2, 2.5, 2], pos: [4, 25.7, -4], color: JOINT },
    { size: [2, 2.5, 2], pos: [-4, 25.7, 4], color: JOINT },
    { size: [2, 2.5, 2], pos: [4, 25.7, 4], color: JOINT },
    // Firing port + ram beam.
    { size: [4, 1.4, 0.8], pos: [0, 15, 4.8], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
    { size: [2, 2, 9], pos: [0, 7.5, 6], color: WOOD },
  ],
};

// ─────────────────────────── Hive ───────────────────────────

/** Scuttling — throwaway swarm bug (blind, pop ½): low six-legged crawler. */
const SCUTTLING: UnitDef = {
  parts: [
    { size: [5, 3.5, 7], pos: [0, 3.5, -0.5], color: CHITIN },
    { size: [3.5, 2.5, 3], pos: [0, 3.5, 4], color: CARAPACE },
    { size: [0.8, 0.8, 2.2], pos: [-1.4, 2.8, 6], color: BONE },
    { size: [0.8, 0.8, 2.2], pos: [1.4, 2.8, 6], color: BONE },
    // Six splayed legs.
    { size: [0.8, 3.5, 0.8], pos: [-3.2, 1.8, -2.5], rot: [0, 0, 0.5], color: CARAPACE },
    { size: [0.8, 3.5, 0.8], pos: [3.2, 1.8, -2.5], rot: [0, 0, -0.5], color: CARAPACE },
    { size: [0.8, 3.5, 0.8], pos: [-3.2, 1.8, 0], rot: [0, 0, 0.5], color: CARAPACE },
    { size: [0.8, 3.5, 0.8], pos: [3.2, 1.8, 0], rot: [0, 0, -0.5], color: CARAPACE },
    { size: [0.8, 3.5, 0.8], pos: [-3.2, 1.8, 2.5], rot: [0, 0, 0.5], color: CARAPACE },
    { size: [0.8, 3.5, 0.8], pos: [3.2, 1.8, 2.5], rot: [0, 0, -0.5], color: CARAPACE },
    // No eyes (it's blind) — just a team marker on the carapace.
    { size: [1.6, 0.8, 1.6], pos: [0, 5.5, -0.5], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
  ],
};

/** Hive Scout — fast stilt-legged eye (mov 2): one huge glowing eye. */
const HIVE_SCOUT: UnitDef = {
  parts: [
    { size: [4.5, 4.5, 4.5], pos: [0, 10.5, 0], color: CHITIN },
    { size: [0.9, 9.5, 0.9], pos: [-2.6, 4.5, -2], rot: [0, 0, 0.25], color: CARAPACE },
    { size: [0.9, 9.5, 0.9], pos: [2.6, 4.5, -2], rot: [0, 0, -0.25], color: CARAPACE },
    { size: [0.9, 9.5, 0.9], pos: [-2.6, 4.5, 2], rot: [0, 0, 0.25], color: CARAPACE },
    { size: [0.9, 9.5, 0.9], pos: [2.6, 4.5, 2], rot: [0, 0, -0.25], color: CARAPACE },
    // The eye.
    { size: [3.2, 3.2, 1], pos: [0, 10.5, 2.4], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [0.6, 3.5, 0.6], pos: [-1.2, 14.5, 0], rot: [0, 0, 0.3], color: BONE },
    { size: [0.6, 3.5, 0.6], pos: [1.2, 14.5, 0], rot: [0, 0, -0.3], color: BONE },
  ],
};

/** Reaper — dash melee: mantis with scythe arms and a raised abdomen. */
const REAPER: UnitDef = {
  parts: [
    { size: [2, 7, 2], pos: [-1.8, 3.5, 0], color: CARAPACE },
    { size: [2, 7, 2], pos: [1.8, 3.5, 0], color: CARAPACE },
    { size: [4, 4.5, 6.5], pos: [0, 8, -3.5], rot: [0.35, 0, 0], color: CHITIN },
    { size: [5, 6, 4], pos: [0, 11, 0], teamColor: true },
    { size: [3.5, 3, 3.5], pos: [0, 15.5, 1], color: CHITIN },
    { size: [2.6, 1, 0.8], pos: [0, 15.9, 2.8], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Scythe arms: raised upper arms, long down-curving blades.
    { size: [1.5, 6, 1.5], pos: [-4, 13.5, 1], rot: [0, 0, 0.5], color: CARAPACE },
    { size: [1.5, 6, 1.5], pos: [4, 13.5, 1], rot: [0, 0, -0.5], color: CARAPACE },
    { size: [0.9, 9, 2], pos: [-6.4, 10.5, 3], rot: [0.35, 0, 1.0], color: BONE },
    { size: [0.9, 9, 2], pos: [6.4, 10.5, 3], rot: [0.35, 0, -1.0], color: BONE },
  ],
};

/** Scab — corrosive spitter (rng 2): hunched bug, glowing acid sac, spout. */
const SCAB: UnitDef = {
  parts: [
    { size: [6, 5, 7], pos: [0, 6, -0.5], color: CHITIN },
    { size: [3, 2.5, 3], pos: [0, 7, 3.8], color: CARAPACE },
    // Acid sac.
    { size: [4, 3.5, 4], pos: [0, 9, -3], color: '#1a2a10', emissive: ACID, emissiveIntensity: 2.2 },
    // Spitting tube.
    { size: [1.5, 1.5, 5.5], pos: [0, 8.5, 4], rot: [-0.25, 0, 0], color: BONE },
    { size: [1.2, 1.2, 0.8], pos: [0, 9.3, 6.8], color: '#000000', emissive: ACID, emissiveIntensity: 3 },
    { size: [1.6, 0.8, 0.8], pos: [0, 7.8, 5.2], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
    { size: [1, 4.5, 1], pos: [-3, 2.5, -2], rot: [0, 0, 0.4], color: CARAPACE },
    { size: [1, 4.5, 1], pos: [3, 2.5, -2], rot: [0, 0, -0.4], color: CARAPACE },
    { size: [1, 4.5, 1], pos: [-3, 2.5, 2], rot: [0, 0, 0.4], color: CARAPACE },
    { size: [1, 4.5, 1], pos: [3, 2.5, 2], rot: [0, 0, -0.4], color: CARAPACE },
  ],
};

/** Vindrace — heavy charger (slash arc, ram): rhino-beetle with a great horn. */
const VINDRACE: UnitDef = {
  parts: [
    { size: [12, 8, 14], pos: [0, 9.5, -1], teamColor: true },
    { size: [12.6, 2.2, 14.6], pos: [0, 14, -1], color: CARAPACE },
    { size: [3, 7, 3], pos: [-4.5, 3.5, -5], color: CHITIN },
    { size: [3, 7, 3], pos: [4.5, 3.5, -5], color: CHITIN },
    { size: [3, 7, 3], pos: [-4.5, 3.5, 3.5], color: CHITIN },
    { size: [3, 7, 3], pos: [4.5, 3.5, 3.5], color: CHITIN },
    { size: [5.5, 4.5, 4], pos: [0, 10, 7], color: CHITIN },
    { size: [1.4, 1, 0.8], pos: [-1.6, 10.8, 9], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [1.4, 1, 0.8], pos: [1.6, 10.8, 9], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // The horn, sweeping up-forward.
    { size: [2.5, 2.5, 7], pos: [0, 13, 10], rot: [-0.5, 0, 0], color: BONE },
    { size: [1.5, 5.5, 1.5], pos: [0, 17.5, 12.5], rot: [-0.3, 0, 0], color: BONE },
  ],
};

/** Seercaust — seer/support (detect, Infect, Spray Bile): third eye, bile sacs. */
const SEERCAUST: UnitDef = {
  parts: [
    { size: [6.5, 4, 6.5], pos: [0, 2, 0], color: CHITIN },
    { size: [5, 8, 5], pos: [0, 8, 0], teamColor: true },
    { size: [4, 6, 4], pos: [0, 15, 0], color: CHITIN },
    { size: [3.6, 3.6, 3.6], pos: [0, 20, 0], color: CARAPACE },
    // The all-seeing third eye.
    { size: [2.6, 1.6, 0.8], pos: [0, 20.4, 2], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Sensory stalks.
    { size: [0.6, 5, 0.6], pos: [0, 24, -0.5], color: BONE },
    { size: [0.6, 4.5, 0.6], pos: [-1.6, 23.5, 0], rot: [0, 0, 0.3], color: BONE },
    { size: [0.6, 4.5, 0.6], pos: [1.6, 23.5, 0], rot: [0, 0, -0.3], color: BONE },
    // Bile sacs (Spray Bile).
    { size: [2.6, 3.2, 2.6], pos: [-3.4, 6, -1], color: '#1a2a10', emissive: ACID, emissiveIntensity: 2.2 },
    { size: [2.6, 3.2, 2.6], pos: [3.4, 6, -1], color: '#1a2a10', emissive: ACID, emissiveIntensity: 2.2 },
  ],
};

/** Wyrm — burrowing heavy: segmented body arcing out of the plates. */
const WYRM: UnitDef = {
  parts: [
    { size: [5, 5, 5], pos: [0, 2.8, -8], color: CHITIN },
    { size: [6, 6, 6], pos: [0, 4, -3.5], color: CARAPACE },
    { size: [6.5, 6.5, 6.5], pos: [0, 6.5, 1.5], color: CHITIN },
    { size: [7, 7, 7], pos: [0, 10, 5.5], rot: [0.3, 0, 0], color: CARAPACE },
    // Mandible ring around the maw.
    { size: [1, 1, 4], pos: [-2.6, 9, 9.5], rot: [0.3, 0, 0.4], color: BONE },
    { size: [1, 1, 4], pos: [2.6, 9, 9.5], rot: [0.3, 0, -0.4], color: BONE },
    { size: [1, 1, 4], pos: [-2, 12.5, 9.5], rot: [0.5, 0, 0.2], color: BONE },
    { size: [1, 1, 4], pos: [2, 12.5, 9.5], rot: [0.5, 0, -0.2], color: BONE },
    { size: [1.6, 1, 0.8], pos: [-1.8, 11.5, 8.9], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [1.6, 1, 0.8], pos: [1.8, 11.5, 8.9], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Dorsal glow slits.
    { size: [3, 0.8, 1], pos: [0, 8, 1.5], color: '#000000', emissive: ACID, emissiveIntensity: 2 },
    { size: [2.6, 0.8, 1], pos: [0, 5.8, -3.5], color: '#000000', emissive: ACID, emissiveIntensity: 2 },
  ],
};

/** Wyrm (Burrowed) — travelling underground: a churned mound, tail tip out. */
const WYRM_BURROWED: UnitDef = {
  parts: [
    { size: [10, 2.2, 10], pos: [0, 1.1, 0], color: '#2e2a3a' },
    { size: [7, 2.2, 7], pos: [0, 3, 0], color: '#3a3348' },
    { size: [4.5, 1.8, 4.5], pos: [0, 4.8, 0], color: '#2e2a3a' },
    { size: [1.5, 4.5, 1.5], pos: [2.2, 5, 1.8], rot: [0, 0, 0.35], color: CARAPACE },
    // Glow seeping through the cracked plates.
    { size: [3.2, 0.6, 3.2], pos: [0, 4.2, 0], color: '#000000', emissive: ACID, emissiveIntensity: 1.6 },
    { size: [1.6, 0.8, 1.6], pos: [-2.4, 2.4, -2.2], color: '#000000', teamGlow: true, emissiveIntensity: 3 },
  ],
};

/** Sylvan Ranger — camouflage skirmisher: leaf cloak and a longbow. */
const SYLVAN_RANGER: UnitDef = {
  parts: [
    { size: [2.6, 7, 2.6], pos: [-1.9, 3.5, 0], color: BARK },
    { size: [2.6, 7, 2.6], pos: [1.9, 3.5, 0], color: BARK },
    { size: [6, 7, 4], pos: [0, 10.5, 0], teamColor: true },
    // Leaf cloak layers.
    { size: [7, 8.5, 1.6], pos: [0, 10, -3], color: LEAF },
    { size: [5.5, 5, 1.4], pos: [0, 6.5, -4], color: '#1f4d3a' },
    { size: [2.2, 6, 2.2], pos: [-4.2, 11, 0], color: BARK },
    { size: [2.2, 6, 2.2], pos: [4.2, 11, 0], color: BARK },
    { size: [4.2, 4.2, 4.2], pos: [0, 16.4, 0], color: BARK },
    { size: [4.8, 1.6, 4.8], pos: [0, 19, -0.5], color: LEAF }, // leaf hood
    { size: [3.4, 1.2, 0.8], pos: [0, 16.9, 2.2], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    // Longbow held at the side.
    { size: [1, 11, 1], pos: [4.4, 11, 2.5], color: WOOD },
    { size: [1.3, 1.3, 1.3], pos: [4.4, 11, 2.9], color: JOINT },
  ],
};

/** Treant — entangling tree golem: bark trunk, branch arms, canopy shoulders. */
const TREANT: UnitDef = {
  parts: [
    { size: [4, 6, 4.5], pos: [-3, 3, 0], color: BARK },
    { size: [4, 6, 4.5], pos: [3, 3, 0], color: BARK },
    { size: [9, 12, 7], pos: [0, 12, 0], color: BARK },
    { size: [4, 3, 1], pos: [0, 14, 3.8], teamColor: true }, // moss sigil
    // Branch arms, reaching out (Entangle).
    { size: [2.5, 10, 2.5], pos: [-6.5, 11, 1], rot: [0.2, 0, 0.55], color: WOOD },
    { size: [2.5, 10, 2.5], pos: [6.5, 11, 1], rot: [0.2, 0, -0.55], color: WOOD },
    { size: [1.2, 4.5, 1.2], pos: [-9.5, 6.5, 3], rot: [0, 0, 0.3], color: WOOD },
    { size: [1.2, 4.5, 1.2], pos: [9.5, 6.5, 3], rot: [0, 0, -0.3], color: WOOD },
    // Canopy.
    { size: [8, 4.5, 8], pos: [0, 21, 0], color: LEAF },
    { size: [5.5, 3.5, 5.5], pos: [-4, 19, -1], color: '#1f4d3a' },
    { size: [5.5, 3.5, 5.5], pos: [4, 19, -1], color: '#1f4d3a' },
    { size: [1.6, 1.2, 0.8], pos: [-1.8, 15.5, 3.6], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
    { size: [1.6, 1.2, 0.8], pos: [1.8, 15.5, 3.6], color: '#000000', teamGlow: true, emissiveIntensity: 4 },
  ],
};

// ─────────────────────────── Registry ───────────────────────────

const DEFS: Record<string, UnitDef> = {
  scout: SCOUT,
  warrior: WARRIOR,
  archer: ARCHER,
  catapult: CATAPULT,
  lancer: LANCER,
  defender: DEFENDER,
  stalker: STALKER,
  wraith: WRAITH,
  tank: TANK,
  tank_assault: TANK_ASSAULT,
  titan: TITAN,
  sentinel: SENTINEL,
  ironclad_berserker: BERSERKER,
  ironclad_siege_tower: SIEGE_TOWER,
  scuttling: SCUTTLING,
  hive_scout: HIVE_SCOUT,
  reaper: REAPER,
  scab: SCAB,
  vindrace: VINDRACE,
  seercaust: SEERCAUST,
  wyrm: WYRM,
  wyrm_burrowed: WYRM_BURROWED,
  sylvan_ranger: SYLVAN_RANGER,
  sylvan_treant: TREANT,
};

/** unitClass "heavy" ids (from units.json) — drives the hostile scan cones. */
const HEAVY_KINDS = new Set([
  'vindrace', 'wyrm', 'wyrm_burrowed', 'stalker', 'tank', 'tank_assault', 'titan',
]);

export function isHeavyKind(kind: string): boolean {
  return HEAVY_KINDS.has(kind);
}

export function defForKind(kind: string): UnitDef {
  return DEFS[kind] ?? FALLBACK;
}
