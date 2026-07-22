import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore.js';

const AUTOSAVE_KEY = 'rigbound-coach-autosave';

/**
 * Coaching sidebar: a move log (human + AI) with the AI's scored candidates ("why did you
 * do this?"), per-move comment boxes, a strategy-notes timeline, and JSON export. The
 * annotations are a corpus we translate into eval/rule changes — the bot doesn't auto-learn.
 */
export function CoachPanel() {
  const {
    coachEnabled, coachLog, strategyNotes, gameState,
    setCoachEnabled, addCoachComment, addStrategyNote, clearCoach,
  } = useGameStore();
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Auto-persist to the browser on EVERY change (each move, comment, note) — no clicks, no
  // download spam. Survives reload. The Export button still produces a shareable file.
  useEffect(() => {
    if (!coachEnabled) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
        savedTurn: gameState?.turn ?? null,
        actionLog: gameState?.actionLog ?? [],
        strategyNotes, moves: coachLog,
      }));
    } catch { /* quota / private mode — ignore */ }
  }, [coachEnabled, coachLog, strategyNotes, gameState?.turn, gameState?.actionLog]);

  if (!coachEnabled) return null;

  const toggle = (seq: number) => setExpanded(prev => {
    const n = new Set(prev); n.has(seq) ? n.delete(seq) : n.add(seq); return n;
  });

  const exportJson = () => {
    const payload = {
      exportedTurn: gameState?.turn ?? null,
      actionLog: gameState?.actionLog ?? [],   // raw action sequence (for replay)
      strategyNotes,
      moves: coachLog,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rigbound-coach-turn${gameState?.turn ?? 0}.json`;
    a.click();
  };

  const rows = [...coachLog].reverse(); // newest first

  return (
    <div className="coach-panel">
      <div className="coach-head">
        <h3>Coach</h3>
        <div className="coach-head-actions">
          <span className="coach-autosave" title="Every move is auto-saved to this browser">⟳ auto</span>
          <button className="ghost" onClick={exportJson} title="Download annotated game">Export</button>
          <button className="ghost" onClick={clearCoach} title="Clear log & notes">Clear</button>
          <button className="ghost" onClick={() => setCoachEnabled(false)} title="Hide coach">✕</button>
        </div>
      </div>

      {/* Strategy notes */}
      <div className="coach-section">
        <div className="coach-section-title">Strategy notes</div>
        {strategyNotes.length > 0 && (
          <div className="coach-notes">
            {strategyNotes.map((n, i) => (
              <div key={i} className="coach-note">
                <span className={`coach-turn p${n.player}`}>T{n.turn}</span> {n.text}
              </div>
            ))}
          </div>
        )}
        <div className="coach-note-input">
          <textarea
            value={note}
            placeholder="Why are you doing this? (e.g. 'push WA1/WA2 center, capture the mid city before Hive gets Vindrace')"
            onChange={e => setNote(e.target.value)}
            rows={2}
          />
          <button className="primary" disabled={!note.trim()} onClick={() => { addStrategyNote(note); setNote(''); }}>
            Add note
          </button>
        </div>
      </div>

      {/* Move log */}
      <div className="coach-section coach-log">
        <div className="coach-section-title">Move log ({coachLog.length})</div>
        {rows.map(e => (
          <div key={e.seq} className={`coach-entry ${e.actor}`}>
            <div className="coach-entry-head">
              <span className={`coach-turn p${e.player}`}>T{e.turn}</span>
              <span className="coach-actor">{e.actor === 'ai' ? '🤖' : '🧑'}</span>
              <span className="coach-desc">{e.desc}</span>
              {e.candidates?.length ? (
                <button className="coach-why" onClick={() => toggle(e.seq)}>
                  {expanded.has(e.seq) ? 'hide' : 'why?'}
                </button>
              ) : null}
            </div>

            {e.candidates?.length && expanded.has(e.seq) ? (
              <table className="coach-cands">
                <tbody>
                  {e.candidates.map((c, i) => (
                    <tr key={i} className={c.chosen ? 'chosen' : ''}>
                      <td className="coach-cand-score">{c.score}</td>
                      <td className="coach-cand-desc">{c.chosen ? '▶ ' : ''}{c.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <input
              className="coach-comment"
              value={e.comment}
              placeholder="comment: good / bad because…"
              onChange={ev => addCoachComment(e.seq, ev.target.value)}
            />
          </div>
        ))}
        {coachLog.length === 0 && <div className="coach-empty">Moves will appear here as they're played.</div>}
      </div>
    </div>
  );
}
