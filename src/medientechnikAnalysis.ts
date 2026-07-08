/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Medientechnische Analyse – Thin Client.
 * Sämtliche Analyse-Logik läuft serverseitig in Python (backend/analysis/advanced.py).
 * Diese Datei ruft die Analyse-Ergebnisse via REST-API ab und reichert Session-Daten an.
 * Fallback: Falls das Backend nicht erreichbar ist, werden NaN-Werte gesetzt.
 */

import { AlsFileStats } from "./types";
import { computeAdvancedMetrics } from "./backendApi";

export function enrichSessionWithAdvancedMetrics(session: AlsFileStats): AlsFileStats {
  if (!session.notes || session.notes.length === 0) return session;
  if (session.velocitySpread && session.polyphony && session.slidingTempo && session.pedalAnalysis) {
    return session;
  }
  return {
    ...session,
    velocitySpread: session.velocitySpread || undefined,
    polyphony: session.polyphony || undefined,
    slidingTempo: session.slidingTempo || undefined,
    pedalAnalysis: session.pedalAnalysis || undefined,
  };
}

export async function enrichSessionFromBackend(session: AlsFileStats): Promise<AlsFileStats> {
  if (!session.notes || session.notes.length === 0) return session;
  if (session.velocitySpread && session.polyphony && session.slidingTempo && session.pedalAnalysis) {
    return session;
  }
  try {
    const metrics = await computeAdvancedMetrics(
      session.notes,
      session.estimatedBpm || session.tempo || 120,
      session.avgDriftMs || 0
    );
    return {
      ...session,
      velocitySpread: metrics.velocitySpread || undefined,
      polyphony: metrics.polyphony || undefined,
      slidingTempo: metrics.slidingTempo || undefined,
      pedalAnalysis: metrics.pedalAnalysis || undefined,
    };
  } catch {
    return enrichSessionWithAdvancedMetrics(session);
  }
}
