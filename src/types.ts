/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MidiNote {
  id: string;
  key: number;
  noteName: string;
  time: number; // Startzeit in Beats
  duration: number; // Länge in Beats
  velocity: number; // 0-127
  gridOffset: number; // Abweichung vom nächsten Grid-Wert (-0.5 bis +0.5 Beats)
  gridOffsetMs: number; // Abweichung in Millisekunden
  nearestGrid: number; // Der nächstliegende Grid-Wert (z. B. 0.25, 0.5)
  trackName: string;
}

export interface BpmSegment {
  index: number;
  startBeat: number;
  endBeat: number;
  noteCount: number;
  bpm: number;
}

export interface AlsFileStats {
  fileName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (auf 30min gerundet), aus file.lastModified
  weekday: number; // 0=So, 1=Mo, …
  tempo: number; // BPM
  notesCount: number;
  avgVelocity: number;
  avgDriftMs: number; // Absoluter durchschnittlicher Drift
  swingFactor16th: number; // Errechneter Swingfaktor (z.B. 50% bis 70%)
  notes: MidiNote[];
  estimatedBpm?: number; // Gefundener realer Puls (BPM)
  styleCategory?: "Melodisch" | "Harmonisch";
  structureCategory?: "Improvisation" | "Klassisches Stück";
  estimatedKey?: string; // Tonart (z.B. "C Major", "A Minor")
  bpmSegments?: BpmSegment[];
  cloudDocId?: string; // Dokument-ID in Firestore (falls permanent gespeichert)
  focusScore?: number; // 0-100 Gesamtqualität (Analyse G)
  teacherStudentSplit?: {
    teacher: MidiNote[];
    student: MidiNote[];
    teacherNoteCount: number;
    studentNoteCount: number;
    teacherAvgDriftMs: number;
    studentAvgDriftMs: number;
  };
  
  // Advanced Medientechnik Metrics
  velocitySpread?: {
    velocityStdDev: number;
    velocityRange: number;
    expressionLevel: "Eintönig" | "Standard" | "Gefühlvoll" | "Meisterhaft";
  };
  polyphony?: {
    avgPolyphony: number;
    maxPolyphony: number;
    chordRatio: number;
  };
  slidingTempo?: {
    timeBeats: number;
    timeSec: number;
    bpm: number;
  }[];
  pedalAnalysis?: {
    pedalEvents: {
      time: number;
      timeSec: number;
      value: number;
      type: "press" | "release";
    }[];
    accuracyScore: number;
    avgDelayMs: number;
    errorClassification: "Hervorragend (Legato)" | "Geringer Verzug" | "Sloppy (Matschig)" | "Kein Pedal";
  };
}

export interface ScheduleEntry {
  weekday: number; // 0=So, 1=Mo, …
  time: string; // HH:MM
  studentName: string;
  duration: number; // Minuten (30 oder 45)
}

export interface MonthlySummary {
  month: string; // "Januar", "Februar", etc.
  fileCount: number;
  totalNotes: number;
  avgTempo: number;
  avgVelocity: number;
  avgDriftMs: number;
  avgSwing: number;
}

export interface ChartDataEntry {
  gridOffsetHistogram: { lower: number; upper: number; count: number }[];
  gridOffsetBassHistogram: { lower: number; upper: number; count: number }[];
  gridOffsetTrebleHistogram: { lower: number; upper: number; count: number }[];
  velocityHistogram: { lower: number; upper: number; count: number }[];
  noteDensity: { bar: number; count: number }[];
  keyDistribution: Record<number, number>;
  sixteenthGrid: {
    position: number;
    beat: number;
    sub: string;
    avgVelocity: number;
    avgDrift: number;
    count: number;
  }[];
  stats: {
    mean: number;
    std: number;
    median: number;
    earlyPercent: number;
    latePercent: number;
    tightPercent: number;
    skewness: number;
    bassPct: number;
    totalNotes: number;
  };
}
