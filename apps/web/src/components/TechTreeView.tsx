import React, { useState } from 'react';
import { getTechTrees, layoutTree, nodeState, NODE_W, NODE_H } from '../data/techTrees.js';
import type { TechNode } from '../data/techTrees.js';
import { useGameStore } from '../store/gameStore.js';
import { abilityDef } from './UnitSheet.js';
import { techCostForPlayer, techPlasmaCostForPlayer } from '@tactica/engine';
import type { DataRegistry, GameState } from '@tactica/engine';
import { PlasmaIcon } from './PlasmaIcon.js';

interface TechTreeViewProps {
  factionName: string;
  factionId: string;
  researched: Set<string>;
  onResearch: (id: string) => void;
  onClose: () => void;
}

const ICON_BASE = '/ui/skills/';

// A unit's display name + its PASSIVE abilities (from its conditions), for the tech card.
function unitDetail(registry: DataRegistry, unitId: string): { name: string; passives: string[] } {
  const ut = registry.unitTypes[unitId];
  if (!ut) return { name: unitId, passives: [] };
  const passives = (ut.conditions ?? [])
    .map(id => abilityDef(id))
    .filter(d => d.category === 'passive')
    .map(d => d.name);
  return { name: ut.name, passives };
}

export function TechTreeView({ factionName, factionId, researched, onResearch, onClose }: TechTreeViewProps) {
  const registry = useGameStore(s => s.registry);
  const gameState = useGameStore(s => s.gameState);
  // Live research price for a node: the city-scaled ore cost (incl. R&D) plus any
  // plasma cost, for the current player. null for the always-on base node.
  const costOf = (node: TechNode): { ore: number; plasma: number } | null => {
    if (node.root || !gameState) return null;
    const tech = registry.techs[node.id];
    if (!tech) return null;
    return {
      ore: techCostForPlayer(gameState, gameState.currentPlayer, tech, registry),
      plasma: techPlasmaCostForPlayer(gameState, gameState.currentPlayer, tech, registry),
    };
  };
  const TREES = getTechTrees(factionId);
  const firstActive = TREES.findIndex(t => !t.blank);
  const [activeId, setActiveId] = useState(TREES[firstActive]?.id ?? TREES[0].id);
  const active = TREES.find(t => t.id === activeId) ?? TREES[0];

  return (
    <div className="tech-overlay" onClick={onClose}>
      <div className="tech-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="tech-header">
          <h2>RESEARCH</h2>
          <span className="tech-faction">{factionName}</span>
          <button className="tech-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="tech-body">
          {/* Tree selector (left rail) */}
          <div className="tech-rail">
            {TREES.map(tree => (
              <button
                key={tree.id}
                className={`tech-tab${tree.id === activeId ? ' active' : ''}${tree.blank ? ' blank' : ''}`}
                onClick={() => setActiveId(tree.id)}
              >
                <img src={ICON_BASE + tree.icon} alt="" />
                <span>{tree.blank ? 'Locked' : tree.name}</span>
              </button>
            ))}
          </div>

          {/* Active tree — Polytopia-style DAG: levels on rows, connector lines between prereqs */}
          <div className="tech-content">
            {active.blank ? (
              <div className="tech-blank">
                <p>This research line is not available yet.</p>
              </div>
            ) : (() => {
              const layout = layoutTree(active);
              return (
                <div className="tech-dag-scroll">
                  <div className="tech-dag" style={{ width: layout.width + 56, height: layout.height + 24 }}>
                    {/* level labels + row guides */}
                    {layout.rows.map(r => (
                      <div key={r.tier} className="tech-row-label" style={{ top: r.y + NODE_H / 2 - 10 }}>
                        {r.tier === 0 ? 'BASE' : `LVL ${r.tier}`}
                      </div>
                    ))}
                    {/* connector lines (behind the nodes) */}
                    <svg className="tech-edges" width={layout.width + 56} height={layout.height + 24}>
                      {layout.edges.map((e, i) => (
                        <line key={i}
                          x1={e.x1 + 44} y1={e.y1 + 8} x2={e.x2 + 44} y2={e.y2 + 8}
                          stroke={e.dashed ? 'rgba(120,200,255,0.55)' : 'rgba(120,200,255,0.4)'}
                          strokeWidth={2} strokeDasharray={e.dashed ? '5 4' : undefined} />
                      ))}
                    </svg>
                    {/* nodes */}
                    {layout.nodes.map(p => {
                      if (p.node.heading) {
                        return (
                          <div key={p.node.id} className="tech-heading"
                            style={{ left: p.x + 44, top: p.y + 8, width: NODE_W }}>
                            {p.node.name}
                          </div>
                        );
                      }
                      const state = nodeState(p.node, active, researched);
                      return (
                        <TechCard
                          key={p.node.id}
                          node={p.node}
                          state={state}
                          registry={registry}
                          cost={state === 'cut' ? null : costOf(p.node)}
                          style={{ left: p.x + 44, top: p.y + 8 }}
                          onResearch={() => onResearch(p.node.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

type CardState = 'researched' | 'available' | 'locked' | 'excluded' | 'root' | 'cut';

function TechCard({
  node, state, style, onResearch, registry, cost,
}: {
  node: TechNode;
  state: CardState;
  style: React.CSSProperties;
  onResearch: () => void;
  registry: DataRegistry;
  cost: { ore: number; plasma: number } | null;
}) {
  const hasDetail = !!(node.unlockUnits?.length || node.unlockPassives?.length || node.unlockUpgrades?.length);
  return (
    <button
      className={`tech-node ${state}`}
      style={{ ...style, width: NODE_W, minHeight: NODE_H }}
      disabled={state !== 'available'}
      onClick={onResearch}
      title={state === 'excluded' ? (node.excludeNote ?? 'Locked out by a mutually-exclusive choice') : node.desc}
    >
      <div className="tech-node-icon"><img src={ICON_BASE + node.icon} alt="" /></div>
      <div className="tech-node-name">{node.name}</div>
      <div className="tech-node-status">
        {state === 'researched' ? '✓ DONE'
          : state === 'root' ? 'BASE'
          : state === 'cut' ? '✂ CUT'
          : state === 'excluded' ? '✕ LOCKED OUT'
          : (
            <>
              {state === 'available' ? 'RESEARCH' : '🔒'}
              {cost != null && (
                <span className="tech-node-cost">
                  {cost.ore}◈{cost.plasma > 0 && <> {cost.plasma}<PlasmaIcon size={11} /></>}
                </span>
              )}
            </>
          )}
      </div>

      {hasDetail && (
        <div className="tech-node-detail">
          {node.unlockUnits?.map(uid => {
            const d = unitDetail(registry, uid);
            return (
              <div key={uid} className="tnd-unit">
                <div className="tnd-unit-name">▸ {d.name}</div>
                {d.passives.map((pp, i) => <div key={i} className="tnd-passive">– {pp}</div>)}
              </div>
            );
          })}
          {node.unlockPassives?.map(pid => (
            <div key={pid} className="tnd-passive-line">◆ {abilityDef(pid).name}</div>
          ))}
          {node.unlockUpgrades?.map((up, i) => (
            <div key={i} className="tnd-upgrade">• {up}</div>
          ))}
        </div>
      )}
    </button>
  );
}
