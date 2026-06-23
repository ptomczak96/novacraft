import React, { useState } from 'react';
import { TECH_TREES, treeTiers, isTierUnlocked } from '../data/techTrees.js';
import type { TechTreeDef, TechNode } from '../data/techTrees.js';

interface TechTreeViewProps {
  factionName: string;
  researched: Set<string>;
  onResearch: (id: string) => void;
  onClose: () => void;
}

const ICON_BASE = '/ui/skills/';

export function TechTreeView({ factionName, researched, onResearch, onClose }: TechTreeViewProps) {
  const firstActive = TECH_TREES.findIndex(t => !t.blank);
  const [activeId, setActiveId] = useState(TECH_TREES[firstActive]?.id ?? TECH_TREES[0].id);
  const active = TECH_TREES.find(t => t.id === activeId) ?? TECH_TREES[0];

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
            {TECH_TREES.map(tree => (
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

          {/* Active tree's cards, grouped by tier */}
          <div className="tech-content">
            {active.blank ? (
              <div className="tech-blank">
                <p>This research line is not available yet.</p>
              </div>
            ) : (
              treeTiers(active).map(tier => {
                const unlocked = isTierUnlocked(active, tier, researched);
                const tierNodes = active.nodes.filter(n => n.tier === tier);
                return (
                  <div className="tech-tier" key={tier}>
                    <div className="tech-tier-label">
                      <span>{tier === 0 ? 'BASE' : `TIER ${tier}`}</span>
                      {!unlocked && <span className="tech-tier-lock">LOCKED</span>}
                    </div>
                    <div className="tech-cards">
                      {tierNodes.map(node => (
                        <TechCard
                          key={node.id}
                          node={node}
                          state={cardState(node, active, researched)}
                          onResearch={() => onResearch(node.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type CardState = 'researched' | 'available' | 'locked';

function cardState(node: TechNode, tree: TechTreeDef, researched: Set<string>): CardState {
  if (researched.has(node.id)) return 'researched';
  if (isTierUnlocked(tree, node.tier, researched)) return 'available';
  return 'locked';
}

function TechCard({
  node, state, onResearch,
}: {
  node: TechNode;
  state: CardState;
  onResearch: () => void;
}) {
  return (
    <button
      className={`tech-card ${state}`}
      disabled={state !== 'available'}
      onClick={onResearch}
    >
      <div className="tech-card-icon">
        <img src={ICON_BASE + node.icon} alt="" />
      </div>
      <div className="tech-card-name">
        {node.name}
        {node.tentative && <span className="tech-card-tentative" title="Tier not finalised">?</span>}
      </div>
      <div className="tech-card-desc">{node.desc}</div>
      <div className="tech-card-status">
        {state === 'researched' ? 'RESEARCHED' : state === 'available' ? 'RESEARCH' : 'LOCKED'}
      </div>
    </button>
  );
}
