import React from 'react';
import type { CityEconomy, EconomySource } from '@tactica/engine';

// Resource glyphs match the top-bar totals (◈ ore, ✦ plasma).
const RES = {
  ore: { sym: '◈', label: 'Ore' },
  plasma: { sym: '✦', label: 'Plasma' },
} as const;
type ResKey = keyof typeof RES;

const KIND_LABEL: Record<string, string> = {
  mine: 'Mine', extractor: 'Extractor', refinery: 'Refinery', purifier: 'Purifier',
};

export function sourceLabel(s: EconomySource): string {
  if (s.kind === 'city') return 'City production';
  return `${KIND_LABEL[s.kind] ?? s.kind} ${s.index}`;
}

export function cityLabel(c: CityEconomy): string {
  return c.isCapital ? 'Capital' : `City ${c.cityIndex}`;
}

/** One source line — struck through + greyed when a REB is blocked by an enemy. */
function SourceRow({ s, sym, indent }: { s: EconomySource; sym: string; indent?: boolean }) {
  return (
    <div className={`eco-src${indent ? ' eco-indent' : ''}${s.blocked ? ' eco-blocked' : ''}`}>
      <span className="eco-src-label">{sourceLabel(s)}</span>
      <span className="eco-amt">+{s.amount}{sym}</span>
      {s.blocked && <span className="eco-block-tag">blocked</span>}
    </div>
  );
}

/**
 * Grand breakdown of ONE resource across all of a player's cities, grouped by city:
 * each city shows its collected total, then its individual sources indented beneath.
 * Used by the top-bar income tooltips.
 */
export function ResourceBreakdown({ resource, cities }: { resource: ResKey; cities: CityEconomy[] }) {
  const { sym, label } = RES[resource];
  const rows = cities
    .map(c => ({ c, bucket: resource === 'ore' ? c.ore : c.plasma }))
    .filter(({ bucket }) => bucket.sources.length > 0);
  const grand = rows.reduce((s, { bucket }) => s + bucket.total, 0);

  return (
    <div className="eco-breakdown">
      <div className="eco-title">{label} / turn</div>
      {rows.length === 0 && <div className="eco-empty">No {label.toLowerCase()} production</div>}
      {rows.map(({ c, bucket }) => (
        <div key={c.cityId} className="eco-group">
          <div className="eco-city-head">
            <span>{cityLabel(c)}</span>
            <span className="eco-amt">+{bucket.total}{sym}</span>
          </div>
          {bucket.sources.map((s, i) => <SourceRow key={i} s={s} sym={sym} indent />)}
        </div>
      ))}
      {rows.length > 0 && (
        <div className="eco-total">
          <span>Total</span>
          <span className="eco-amt">+{grand}{sym}</span>
        </div>
      )}
    </div>
  );
}

/** One resource's group for a single city — a header total + its source lines. */
function CityResourceGroup({ resource, bucket }: { resource: ResKey; bucket: CityEconomy['ore'] }) {
  const { sym, label } = RES[resource];
  return (
    <div className="eco-group">
      <div className="eco-city-head">
        <span>{label} / turn</span>
        <span className="eco-amt">+{bucket.total}{sym}</span>
      </div>
      {bucket.sources.map((s, i) => <SourceRow key={i} s={s} sym={sym} indent />)}
    </div>
  );
}

/**
 * Both-resource breakdown for a single city, shown in the city-info box. Ore always
 * has at least the base city production; the plasma group only appears when the city
 * actually produces plasma (an extractor / purifier).
 */
export function CityEconomyLines({ city }: { city: CityEconomy }) {
  return (
    <div className="eco-breakdown eco-inline">
      <CityResourceGroup resource="ore" bucket={city.ore} />
      {city.plasma.sources.length > 0 && <CityResourceGroup resource="plasma" bucket={city.plasma} />}
    </div>
  );
}
