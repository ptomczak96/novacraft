/**
 * Per-unit attack presentation, matched to what the unit MODEL is actually
 * doing (a rifle fires tracers, a sword swings, acid arcs, artillery lobs) —
 * pure render-side flavour over the engine's attack action.
 *
 * Defaults to melee (lunge + slash arc); only ranged/exotic kinds are listed.
 */

export type ProjectileShape = 'bullet' | 'shell' | 'bolt' | 'glob' | 'arrow';

export type AttackStyle =
  | { kind: 'melee' }
  | {
      kind: 'projectile';
      shape: ProjectileShape;
      color: string;
      /** Projectile radius / half-length scale multiplier (1 = default). */
      size?: number;
      /** Peak height of the lobbed arc in world units (0 = straight shot). */
      arc?: number;
    };

const MELEE: AttackStyle = { kind: 'melee' };

const STYLES: Record<string, AttackStyle> = {
  // ── Gun-holders: tracer fire (even at range 1 — a rifle is a rifle) ──
  scout:    { kind: 'projectile', shape: 'bullet', color: '#ffd98a' },
  lancer:   { kind: 'projectile', shape: 'bullet', color: '#ffd98a' },
  wraith:   { kind: 'projectile', shape: 'bullet', color: '#e8f4ff', size: 1.35 }, // sniper
  stalker:  { kind: 'projectile', shape: 'bullet', color: '#9fd8ff' },
  // ── Artillery: lobbed shells ──
  tank:                 { kind: 'projectile', shape: 'shell', color: '#ffab52', arc: 0.45 },
  tank_assault:         { kind: 'projectile', shape: 'shell', color: '#ffab52', arc: 0.35, size: 1.2 },
  // ── Energy / psychic: glowing bolts ──
  titan:     { kind: 'projectile', shape: 'bolt', color: '#65e0ff', size: 1.4 },
  seercaust: { kind: 'projectile', shape: 'bolt', color: '#b26bff' },
  // ── Hive organics: arcing acid globs ──
  scab:    { kind: 'projectile', shape: 'glob', color: '#8aff4d', arc: 0.3 },
  ravener: { kind: 'projectile', shape: 'glob', color: '#8aff4d', arc: 0.35 },
  // ── Bows ──
  archer:        { kind: 'projectile', shape: 'arrow', color: '#d9b380', arc: 0.25 },
  // Everything else (warrior's sword, hive claws/maws, shield bashes, the
  // reaper's diving strike…) stays MELEE by default.
};

export function attackStyleFor(kind: string): AttackStyle {
  return STYLES[kind] ?? MELEE;
}

/** Seconds from attack start until the hit lands on the defender — melee hits
 *  at the lunge apex; projectiles hit when they arrive. */
export function impactDelayFor(style: AttackStyle, dist: number): number {
  if (style.kind === 'melee') return 0.12;
  return Math.min(0.5, Math.max(0.16, dist * 0.1));
}
