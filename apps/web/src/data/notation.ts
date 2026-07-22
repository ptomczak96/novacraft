// ── Board notation (UI-only) ──
// Chess-style tile coordinates + short unit codes, purely for human discussion (coaching,
// chat). The engine never sees these; they hang off stable unit IDs so they survive morphs
// (Tank↔Assault, Wyrm↔Burrowed) and deaths without renumbering.

/** Column index → letter(s): 0→A … 25→Z, 26→AA, 27→AB … (spreadsheet style, for maps >26 wide). */
export function colLetter(x: number): string {
  let n = x, s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/** Tile (x,y) → chess-style label, e.g. (2,3) → "C4". Rows are 1-indexed, row 1 = top. */
export function coordLabel(x: number, y: number): string {
  return `${colLetter(x)}${y + 1}`;
}

/**
 * 3-letter code per unit TYPE (unique across all units). Morph variants share the base
 * unit's code (wyrm_burrowed→WYR, tank_assault→TNK) so a unit keeps one identity.
 */
export const UNIT_CODES: Record<string, string> = {
  scout: 'SCT', warrior: 'WAR', lancer: 'LAN', archer: 'ARC',
  defender: 'BUL', stalker: 'STL', wraith: 'WRA', medic: 'MED', engineer: 'ENG',
  tank: 'TNK', tank_assault: 'TNK', catapult: 'CAT', titan: 'TTN', sentinel: 'SEN',
  ironclad_berserker: 'BSK', ironclad_siege_tower: 'SIE',
  scuttling: 'SCU', hive_scout: 'HSC', reaper: 'REA', scab: 'SCB',
  vindrace: 'VIN', seercaust: 'SEE', wyrm: 'WYR', wyrm_burrowed: 'WYR',
  burstling: 'BUR', behemoth: 'BEH', ravener: 'RAV',
  sylvan_ranger: 'RNG', sylvan_treant: 'TRE',
};

export function unitCode(typeId: string): string {
  return UNIT_CODES[typeId] ?? typeId.slice(0, 3).toUpperCase();
}
