import React, { useState } from 'react';
import { TECH_TREES, layoutTree, nodeState, NODE_W, NODE_H } from '../data/techTrees.js';
import type { TechNode } from '../data/techTrees.js';

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
                      const state = nodeState(p.node, active, researched);
                      return (
                        <TechCard
                          key={p.node.id}
                          node={p.node}
                          state={state}
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

type CardState = 'researched' | 'available' | 'locked';

function TechCard({
  node, state, style, onResearch,
}: {
  node: TechNode;
  state: CardState;
  style: React.CSSProperties;
  onResearch: () => void;
}) {
  return (
    <button
      className={`tech-node ${state}`}
      style={{ ...style, width: NODE_W, minHeight: NODE_H }}
      disabled={state !== 'available'}
      onClick={onResearch}
      title={node.desc}
    >
      <div className="tech-node-icon"><img src={ICON_BASE + node.icon} alt="" /></div>
      <div className="tech-node-name">{node.name}</div>
      <div className="tech-node-status">
        {state === 'researched' ? '✓ DONE' : state === 'available' ? 'RESEARCH' : '🔒'}
      </div>
    </button>
  );
}
