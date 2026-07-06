/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { AlsFileStats } from '../types';
import { ArrowLeftRight, Check, Zap, AlertTriangle, ShieldCheck, HelpCircle } from 'lucide-react';

interface SessionComparisonProps {
  sessionA: AlsFileStats;
  sessionB: AlsFileStats;
  onClose: () => void;
}

export const SessionComparison: React.FC<SessionComparisonProps> = ({ sessionA, sessionB, onClose }) => {
  const analysis = useMemo(() => {
    const tempoDiff = Math.abs(sessionA.tempo - sessionB.tempo);
    const driftDiff = Math.abs(sessionA.avgDriftMs - sessionB.avgDriftMs);
    const swingDiff = Math.abs(sessionA.swingFactor16th - sessionB.swingFactor16th);
    const velDiff = Math.abs(sessionA.avgVelocity - sessionB.avgVelocity);
    const notesDiff = Math.abs(sessionA.notesCount - sessionB.notesCount);

    const tighterSession = sessionA.avgDriftMs < sessionB.avgDriftMs ? 'A' : 'B';
    const tighterDoc = tighterSession === 'A' ? sessionA : sessionB;
    const looserDoc = tighterSession === 'A' ? sessionB : sessionA;
    const errorReductionPercent = looserDoc.avgDriftMs > 0 
      ? Math.round((driftDiff / looserDoc.avgDriftMs) * 100) 
      : 0;

    const tempoDescription = tempoDiff < 1 
      ? "nahezu identisches Tempo" 
      : `Tempo-Unterschied von ${tempoDiff.toFixed(1)} BPM (${sessionA.tempo < sessionB.tempo ? 'Session B ist schneller' : 'Session A ist schneller'})`;

    const velocityDescription = velDiff < 5
      ? "vergleichbare Anschlagsstärke"
      : `Dynamik-Abweichung von ${velDiff} Vel-Stufen (${sessionA.avgVelocity < sessionB.avgVelocity ? 'Session B hat festeren Anschlag' : 'Session A hat festeren Anschlag'})`;

    return {
      tempoDiff,
      driftDiff,
      swingDiff,
      velDiff,
      notesDiff,
      tighterSession,
      tighterDoc,
      looserDoc,
      errorReductionPercent,
      tempoDescription,
      velocityDescription
    };
  }, [sessionA, sessionB]);

  // Utility to determine badge styling based on drift
  const getDriftBadge = (drift: number) => {
    if (drift < 9) {
    return {
      text: "Exzellent (Ultra-Tight)",
      color: "text-emerald-300 bg-emerald-900/30 border-emerald-800/50",
      icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
      };
    }
    if (drift <= 17) {
      return {
        text: "Menschlicher Groove (Balanced)",
        color: "text-blue-300 bg-blue-900/30 border-blue-800/50",
        icon: <Zap className="w-3.5 h-3.5 text-blue-400" />
      };
    }
    if (drift <= 30) {
      return {
        text: "Lockerer Offbeat (Laid-back)",
        color: "text-amber-300 bg-amber-900/30 border-amber-800/50",
        icon: <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
      };
    }
    return {
      text: "Hohe Jitter-Drift (Achtung)",
      color: "text-rose-300 bg-rose-900/30 border-rose-800/50",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
    };
  };

  const badgeA = getDriftBadge(sessionA.avgDriftMs);
  const badgeB = getDriftBadge(sessionB.avgDriftMs);

  return (
    <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 relative overflow-hidden" id="session-comparison-card">
      {/* Decorative background visual badge */}
      <div className="absolute right-0 top-0 translate-x-12 -translate-y-8 text-slate-800 font-mono text-[90px] font-black select-none pointer-events-none opacity-20">
        VS
      </div>

      <div className="flex justify-between items-center border-b border-slate-700/50 pb-4 mb-5">
        <div className="flex items-center gap-2">
          <div className="bg-slate-800 text-white p-1.5 rounded">
            <ArrowLeftRight className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono">
              ⚡ SITZUNGS-DIREKTVERGLEICH
            </h3>
            <p className="text-xs text-slate-400 mt-1 italic font-serif">
              Gegenüberstellung zweier Einspielungen zur Timing- und Groovedifferenzierung.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-xs font-mono text-slate-400 hover:text-slate-200 border border-slate-700/50 hover:border-slate-500 px-2.5 py-1 rounded transition-all cursor-pointer bg-slate-800/40"
        >
          X VERGLEICH BEENDEN
        </button>
      </div>

      {/* Main Side-by-Side View */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative">
        
        {/* Divider line for desktop */}
        <div className="hidden md:block absolute left-1/2 top-4 bottom-4 w-px bg-slate-700/50 -translate-x-1/2"></div>
        
        {/* SESSION A (Left Side) */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 bg-slate-700 text-white font-mono text-xs font-bold flex items-center justify-center rounded-full">A</span>
            <div>
              <h4 className="text-sm font-bold text-slate-100 truncate max-w-sm" title={sessionA.fileName}>
                {sessionA.fileName}
              </h4>
              <span className="text-[10px] text-slate-500 font-mono">DATUM: {sessionA.date}</span>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded p-4 space-y-3.5 font-mono">
            {/* Metric 1: timing drift */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Mittlere Drift</span>
                <span className="text-slate-100">{sessionA.avgDriftMs.toFixed(2)} ms</span>
              </div>
              <div className="w-full bg-slate-700 h-2 rounded-full mt-1.5 overflow-hidden">
                <div 
                  className={`h-full rounded-full ${sessionA.avgDriftMs < 9 ? 'bg-emerald-500' : sessionA.avgDriftMs > 30 ? 'bg-rose-500' : 'bg-blue-500'}`}
                  style={{ width: `${Math.min(100, (sessionA.avgDriftMs / 45) * 100)}%` }}
                ></div>
              </div>
              <div className={`mt-2 border rounded px-2 py-1 text-[9px] flex items-center gap-1.5 ${badgeA.color}`}>
                {badgeA.icon}
                <span>{badgeA.text}</span>
              </div>
            </div>

            {/* Other stats list */}
            <div className="divide-y divide-slate-700/50 text-xs">
              <div className="flex justify-between py-2 text-slate-400">
                <span>Tempo (Echt/Klick):</span>
                <span className="text-slate-100 font-bold">{sessionA.tempo.toFixed(1)} BPM</span>
              </div>
              <div className="flex justify-between py-2 text-slate-400">
                <span>Midi-Noten gesamt:</span>
                <span className="text-slate-100 font-bold">{sessionA.notesCount} Events</span>
              </div>
              <span className="block h-px bg-slate-600 my-1"></span>
              <div className="flex justify-between py-2 text-slate-400">
                <span>Swingfaktor (16tel):</span>
                <span className="text-blue-400 font-bold">{sessionA.swingFactor16th.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between py-2 text-slate-400">
                <span>ø Anschlagsdynamik:</span>
                <span className="text-slate-100 font-bold">{sessionA.avgVelocity} (0-127)</span>
              </div>
              <div className="flex justify-between py-2 text-slate-400">
                <span>Stil-Kategorie:</span>
                <span className="text-slate-100 font-semibold">{sessionA.styleCategory || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* SESSION B (Right Side) */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 bg-blue-600 text-white font-mono text-xs font-bold flex items-center justify-center rounded-full">B</span>
            <div>
              <h4 className="text-sm font-bold text-slate-100 truncate max-w-sm" title={sessionB.fileName}>
                {sessionB.fileName}
              </h4>
              <span className="text-[10px] text-slate-400 font-mono">DATUM: {sessionB.date}</span>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded p-4 space-y-3.5 font-mono">
            {/* Metric 1: timing drift */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Mittlere Drift</span>
                <span className="text-blue-400">{sessionB.avgDriftMs.toFixed(2)} ms</span>
              </div>
              <div className="w-full bg-slate-700 h-2 rounded-full mt-1.5 overflow-hidden">
                <div 
                  className={`h-full rounded-full ${sessionB.avgDriftMs < 9 ? 'bg-emerald-500' : sessionB.avgDriftMs > 30 ? 'bg-rose-500' : 'bg-blue-600'}`}
                  style={{ width: `${Math.min(100, (sessionB.avgDriftMs / 45) * 100)}%` }}
                ></div>
              </div>
              <div className={`mt-2 border rounded px-2 py-1 text-[9px] flex items-center gap-1.5 ${badgeB.color}`}>
                {badgeB.icon}
                <span>{badgeB.text}</span>
              </div>
            </div>

            {/* Other stats list */}
            <div className="divide-y divide-slate-200 text-xs">
              <div className="flex justify-between py-2 text-slate-400">
                <span>Tempo (Echt/Klick):</span>
                <span className="text-slate-100 font-bold">{sessionB.tempo.toFixed(1)} BPM</span>
              </div>
              <div className="flex justify-between py-2 text-slate-400">
                <span>Midi-Noten gesamt:</span>
                <span className="text-slate-100 font-bold">{sessionB.notesCount} Events</span>
              </div>
              <span className="block h-px bg-slate-600 my-1"></span>
              <div className="flex justify-between py-2 text-slate-400">
                <span>Swingfaktor (16tel):</span>
                <span className="text-blue-400 font-bold">{sessionB.swingFactor16th.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between py-2 text-slate-400">
                <span>ø Anschlagsdynamik:</span>
                <span className="text-slate-100 font-bold">{sessionB.avgVelocity} (0-127)</span>
              </div>
              <div className="flex justify-between py-2 text-slate-400">
                <span>Stil-Kategorie:</span>
                <span className="text-slate-100 font-semibold">{sessionB.styleCategory || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Comparative Synthesis Summary */}
      <div className="mt-8 bg-slate-900 text-slate-200 rounded p-5 font-mono text-[11px] leading-relaxed border border-slate-800 space-y-3">
        <div className="text-white font-bold tracking-wider flex items-center gap-2 uppercase border-b border-slate-800 pb-2">
          <Check className="w-4 h-4 text-emerald-500" />
          SYSTEM DIAGNOSE // KOLLISIONS-SYNTHESE
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ul className="list-disc pl-4 space-y-1.5 text-slate-300">
            <li>
              <strong className="text-white">Timing-Groove:</strong> Session {analysis.tighterSession} ist im Schnitt um <strong className="text-white font-sans">{analysis.driftDiff.toFixed(2)} ms</strong> bzw. <strong className="text-emerald-400 font-sans">{analysis.errorReductionPercent}%</strong> präziser am Quantisierungsgrid eingespielt als Session {analysis.tighterSession === 'A' ? 'B' : 'A'}.
            </li>
            <li>
              <strong className="text-white">Tempo-Stabilität:</strong> {analysis.tempoDescription}.
            </li>
          </ul>
          <ul className="list-disc pl-4 space-y-1.5 text-slate-300">
            <li>
              <strong className="text-white">Dauer- & Groove-Swing:</strong> {sessionA.swingFactor16th > 51.5 || sessionB.swingFactor16th > 51.5 ? (
                <span>Der Swing-Unterschied liegt bei <strong className="text-white font-sans">{analysis.swingDiff.toFixed(1)}%</strong>. {sessionA.swingFactor16th > sessionB.swingFactor16th ? 'Session A besitzt markanteren MPC-Shuffle.' : 'Session B schlufft intensiver im Groove.'}</span>
              ) : (
                <span>Beide Einspielungen sind weitestgehend quantisiert und 'straight' eingespielt (kaum Swing-Abweichung).</span>
              )}
            </li>
            <li>
              <strong className="text-white">Anschlagdynamik:</strong> {analysis.velocityDescription}.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
