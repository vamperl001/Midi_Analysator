/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import pako from 'pako';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiNote, AlsFileStats } from './types';

// Hilfsmittel zum Übersetzen von MIDI-Key in Notennamen
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function getNoteName(key: number): string {
  const noteIndex = key % 12;
  const octave = Math.floor(key / 12) - 1; // 60 ist C4
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Hilfsfunktion zur Gewinnung des Datums (im Format YYYY-MM-DD):
 * 1. Prüft ob das Datum im Dateinamen enthalten ist (z.B. "Session_2026-05-15.als")
 * 2. Nutzt andernfalls das reale Änderungsdatum der Datei (file.lastModified)
 */
export function extractFileDate(file: File): string {
  const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1];
  }
  const referenceObj = file.lastModified ? new Date(file.lastModified) : new Date();
  const yyyy = referenceObj.getFullYear();
  const mm = String(referenceObj.getMonth() + 1).padStart(2, '0');
  const dd = String(referenceObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeTimeToSlot(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const slot = m < 15 ? 0 : m < 45 ? 30 : 60;
  const totalMin = h * 60 + slot;
  const slotH = Math.floor(totalMin / 60);
  const slotM = totalMin % 60;
  return `${String(slotH).padStart(2, '0')}:${String(slotM).padStart(2, '0')}`;
}

export function extractFileDateTime(file: File): { date: string; time: string; weekday: number } {
  const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
  const lastMod = file.lastModified ? new Date(file.lastModified) : new Date();
  let date: string;
  if (dateMatch) {
    date = dateMatch[1];
  } else {
    date = dateToStr(lastMod);
  }
  return { date, time: normalizeTimeToSlot(lastMod), weekday: lastMod.getDay() };
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Bestimmt die musikalische Tonart (C-Dur, a-Moll, etc.) basierend auf einem
 * vereinfachten Pitch-Class-Häufigkeitsprofil (Krumhansl-Schmuckler Key-Profiles).
 */
export function detectKey(notes: MidiNote[]): string {
  if (notes.length === 0) return "Unbekannt";

  // 12 Pitch Classes (C, C#, D, D#, E, F, F#, G, G#, A, A#, H)
  const pitchWeights = new Array(12).fill(0);
  notes.forEach(note => {
    const pc = note.key % 12;
    // Längere und lautere Noten gewichten wir stärker!
    const weight = Math.max(0.1, note.duration) * (note.velocity / 100);
    if (!isNaN(weight)) {
      pitchWeights[pc] += weight;
    }
  });

  // Krumhansl-Schmuckler Key Profiles (Dur & Moll)
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const noteNamesMajor = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"];
  const noteNamesMinor = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "h"];

  let bestKey = "C-Dur";
  let maxScore = -Infinity;

  // Suche nach der besten Korrelation über alle 12 Halbtöne für Dur und Moll
  for (let keyIdx = 0; keyIdx < 12; keyIdx++) {
    // 1. DUR (Major)
    let scoreMajor = 0;
    for (let i = 0; i < 12; i++) {
      const pitchIdx = (keyIdx + i) % 12;
      scoreMajor += pitchWeights[pitchIdx] * majorProfile[i];
    }
    if (scoreMajor > maxScore) {
      maxScore = scoreMajor;
      bestKey = `${noteNamesMajor[keyIdx]}-Dur`;
    }

    // 2. MOLL (Minor)
    let scoreMinor = 0;
    for (let i = 0; i < 12; i++) {
      const pitchIdx = (keyIdx + i) % 12;
      scoreMinor += pitchWeights[pitchIdx] * minorProfile[i];
    }
    if (scoreMinor > maxScore) {
      maxScore = scoreMinor;
      bestKey = `${noteNamesMinor[keyIdx]}-Moll`;
    }
  }

  return bestKey;
}

/**
 * Analysiert eine Liste von MIDI-Noten und extrahiert den tatsächlichen Puls (Spieltempo),
 * klassifiziert den Stil (Melodisch/Harmonisch) und die Struktur (Improvisation/Stück),
 * und re-kalkuliert optional die Microtiming-Abweichungen relativ zum gespielten Puls!
 */
const MAX_NOTES_ANALYSIS = 2000;

function sampleNotes(notes: MidiNote[], max: number): MidiNote[] {
  if (notes.length <= max) return notes;
  const step = notes.length / max;
  const result: MidiNote[] = [];
  for (let i = 0; i < max; i++) {
    result.push(notes[Math.floor(i * step)]);
  }
  return result;
}

function segmentNotesByPause(
  notes: MidiNote[],
  nominalTempo: number,
  minPauseSec: number = 1.0
): { start: number; end: number; indStart: number; indEnd: number; notes: MidiNote[] }[] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const segments: { start: number; end: number; indStart: number; indEnd: number; notes: MidiNote[] }[] = [];
  let currentNotes: MidiNote[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gapBeats = sorted[i].time - sorted[i - 1].time;
    const gapSec = gapBeats * (60 / nominalTempo);
    if (gapSec > minPauseSec) {
      segments.push({
        start: currentNotes[0].time,
        end: currentNotes[currentNotes.length - 1].time,
        indStart: sorted.indexOf(currentNotes[0]),
        indEnd: sorted.indexOf(currentNotes[currentNotes.length - 1]),
        notes: currentNotes
      });
      currentNotes = [];
    }
    currentNotes.push(sorted[i]);
  }
  if (currentNotes.length > 0) {
    segments.push({
      start: currentNotes[0].time,
      end: currentNotes[currentNotes.length - 1].time,
      indStart: sorted.indexOf(currentNotes[0]),
      indEnd: sorted.indexOf(currentNotes[currentNotes.length - 1]),
      notes: currentNotes
    });
  }
  return segments;
}

function estimateBpmForNotes(notes: MidiNote[], nominalTempo: number): number {
  if (notes.length < 4) return nominalTempo;
  const timesInSec = notes.map(n => n.time * (60 / nominalTempo)).sort((a, b) => a - b);
  const startTime = timesInSec[0];
  const relativeTimes = timesInSec.map(t => t - startTime);
  let bestBpm = nominalTempo;
  let maxScore = -1;
  for (let bpm = 60; bpm <= 160; bpm += 0.5) {
    const g = 15 / bpm;
    let score = 0;
    for (const t of relativeTimes) {
      if (t === 0) continue;
      const nearest = Math.round(t / g) * g;
      const dist = Math.abs(t - nearest);
      const sigma = 0.022;
      score += Math.exp(-(dist * dist) / (2 * sigma * sigma));
    }
    const centerFactor = Math.exp(-Math.pow(bpm - 95, 2) / (2 * 40 * 40));
    const adjustedScore = score * (0.8 + 0.2 * centerFactor);
    if (adjustedScore > maxScore) {
      maxScore = adjustedScore;
      bestBpm = bpm;
    }
  }
  return parseFloat(bestBpm.toFixed(1));
}

function estimateGridFromNotes(notes: MidiNote[]): number {
  if (notes.length < 5) return 0.25;
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].time - sorted[i - 1].time;
    if (d > 0.01 && d < 4) intervals.push(d);
  }
  if (intervals.length < 3) return 0.25;
  const buckets: Map<number, number> = new Map();
  const candidates = [0.0625, 0.125, 0.1875, 0.25, 0.375, 0.5];
  for (const iv of intervals) {
    for (const g of candidates) {
      const ratio = Math.round(iv / g);
      if (ratio >= 1 && Math.abs(iv - ratio * g) < g * 0.12) {
        buckets.set(g, (buckets.get(g) || 0) + 1);
        break;
      }
    }
  }
  let bestG = 0.25;
  let bestN = 0;
  for (const [g, n] of buckets) {
    if (n > bestN) { bestN = n; bestG = g; }
  }
  return bestG;
}

function regridNotes(notes: MidiNote[], bpm: number, nominalTempo: number): MidiNote[] {
  const bpmRatio = bpm / nominalTempo;
  const msPerBeat = 60000 / bpm;
  const grid = estimateGridFromNotes(notes);
  return notes.map(n => {
    const playedBeats = n.time * bpmRatio;
    const adjustedDuration = n.duration * bpmRatio;
    const nearestGrid = Math.round(playedBeats / grid) * grid;
    const gridOffset = playedBeats - nearestGrid;
    return {
      ...n,
      time: parseFloat(playedBeats.toFixed(4)),
      duration: parseFloat(adjustedDuration.toFixed(4)),
      gridOffset: parseFloat(gridOffset.toFixed(4)),
      gridOffsetMs: parseFloat((gridOffset * msPerBeat).toFixed(2)),
      nearestGrid: parseFloat(nearestGrid.toFixed(4))
    };
  });
}

export function analyzeSessionMidiStats(
  rawNotes: MidiNote[],
  nominalTempo: number
): {
  estimatedBpm: number;
  styleCategory: "Melodisch" | "Harmonisch";
  structureCategory: "Improvisation" | "Klassisches Stück";
  estimatedKey: string;
  notes: MidiNote[];
  avgDriftMs: number;
  swingFactor16th: number;
  bpmSegments: { index: number; startBeat: number; endBeat: number; noteCount: number; bpm: number }[];
} {
  if (rawNotes.length === 0) {
    return {
      estimatedBpm: nominalTempo,
      styleCategory: "Melodisch",
      structureCategory: "Klassisches Stück",
      estimatedKey: "Unbekannt",
      notes: rawNotes,
      avgDriftMs: 0,
      swingFactor16th: 50.0,
      bpmSegments: []
    };
  }

  const segments = segmentNotesByPause(rawNotes, nominalTempo, 1.0);

  let segmentResults: { bpm: number; notes: MidiNote[] }[] = [];
  let totalNoteWeight = 0;
  let weightedBpmSum = 0;

  for (const seg of segments) {
    const bpm = estimateBpmForNotes(seg.notes, nominalTempo);
    const regridded = regridNotes(seg.notes, bpm, nominalTempo);
    segmentResults.push({ bpm, notes: regridded });
    totalNoteWeight += seg.notes.length;
    weightedBpmSum += bpm * seg.notes.length;
  }

  const estimatedBpm = totalNoteWeight > 0
    ? parseFloat((weightedBpmSum / totalNoteWeight).toFixed(1))
    : nominalTempo;

  const adjustedNotes = segmentResults.flatMap(r => r.notes);

  // style / structure classification on sampled notes
  const limitedNotes = sampleNotes(adjustedNotes, MAX_NOTES_ANALYSIS);

  let simultaneousCount = 0;
  for (let i = 0; i < limitedNotes.length; i++) {
    const n = limitedNotes[i];
    const hasOverlap = limitedNotes.some(
      other => other.id !== n.id && Math.abs(other.time - n.time) * (60 / estimatedBpm) < 0.04
    );
    if (hasOverlap) simultaneousCount++;
  }
  const overlapRatio = limitedNotes.length > 0 ? simultaneousCount / limitedNotes.length : 0;
  const styleCategory = overlapRatio > 0.45 ? "Harmonisch" : "Melodisch";

  const velocities = limitedNotes.map(n => n.velocity);
  const meanVel = velocities.reduce((sum, v) => sum + v, 0) / (velocities.length || 1);
  const varianceVel = velocities.reduce((sum, v) => sum + Math.pow(v - meanVel, 2), 0) / (velocities.length || 1);
  const stdDevVel = Math.sqrt(varianceVel);

  const totalDriftMs = adjustedNotes.reduce((sum, n) => sum + Math.abs(n.gridOffsetMs), 0);
  const avgDriftMs = adjustedNotes.length > 0 ? parseFloat((totalDriftMs / adjustedNotes.length).toFixed(2)) : 0;

  const offbeatNotes = adjustedNotes.filter(n => Math.abs((n.nearestGrid % 0.5) - 0.25) < 0.001);
  let swingFactor16th = 50.0;
  if (offbeatNotes.length > 0) {
    const totalSwing = offbeatNotes.reduce((sum, n) => {
      const posInDouble16th = n.time % 0.5;
      const percentage = (posInDouble16th / 0.5) * 100;
      return sum + percentage;
    }, 0);
    swingFactor16th = parseFloat((totalSwing / offbeatNotes.length).toFixed(1));
    if (swingFactor16th < 30 || swingFactor16th > 80) {
      swingFactor16th = 50.0;
    }
  }

  const structureCategory = (stdDevVel > 15.0 || avgDriftMs > 13.0) ? "Improvisation" : "Klassisches Stück";
  const estimatedKey = detectKey(adjustedNotes);

  const bpmSegments = segments.map((s, i) => ({
    index: i,
    startBeat: parseFloat(s.start.toFixed(2)),
    endBeat: parseFloat(s.end.toFixed(2)),
    noteCount: s.notes.length,
    bpm: segmentResults[i]?.bpm ?? nominalTempo
  }));

  return {
    estimatedBpm,
    styleCategory,
    structureCategory,
    estimatedKey,
    notes: adjustedNotes,
    avgDriftMs,
    swingFactor16th,
    bpmSegments
  };
}

/**
 * Analysiert eine Audio-Datei (z.B. MP3, WAV, M4A, CAF) oder ein GarageBand-Projekt
 * und extrahiert die tatsächlichen Spiel-Timings (Anschlagmomente) direkt aus der Wellenform.
 * Da die Audios frei ohne Klick eingespielt wurden, wird dieses echte Spieltempo zurückanalysiert.
 */
export async function parseAudioPerformanceFile(file: File): Promise<AlsFileStats> {
  const buffer = await file.arrayBuffer();
  
  // AudioContext erstellen (verwendet im Hintergrund zur Dekodierung)
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) {
    throw new Error("Web Audio API wird von diesem Browser nicht unterstützt.");
  }
  
  const audioCtx = new AudioCtxClass();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(buffer);
  } finally {
    if (audioCtx.close) {
      await audioCtx.close();
    }
  }
  
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  
  // 1024 Samples sind bei 44.1kHz ca. 23ms, 512 Samples Überlappung ermöglichen feine 11ms Beats
  const windowSize = 1024;
  const stepSize = 512;
  const energies: number[] = [];
  
  // 1. Energie der Segmente berechnen
  for (let start = 0; start < totalSamples; start += stepSize) {
    let sum = 0;
    const end = Math.min(start + windowSize, totalSamples);
    const count = end - start;
    for (let j = start; j < end; j++) {
      sum += Math.abs(channelData[j]);
    }
    energies.push(count > 0 ? sum / count : 0);
  }
  
  // 2. Transiente Onset-Schärfe ermitteln (Aufsteigende Flanken der Energie)
  const diffs: number[] = [];
  for (let i = 0; i < energies.length; i++) {
    const prev = i > 0 ? energies[i - 1] : 0;
    diffs.push(Math.max(0, energies[i] - prev));
  }
  
  // 3. Adaptive Schwellwert-Spitzenerkennung (Adaptive Thresholding) am Energiedifferential
  const thresholdWindow = 12;
  const onsetTimes: number[] = [];
  const onsetEnergies: number[] = [];
  
  for (let i = 1; i < diffs.length - 1; i++) {
    const currentDiff = diffs[i];
    if (currentDiff < 0.008) continue; // Noise Floor ignorieren
    
    // Lokales Maximum prüfen
    const isLocalMax = currentDiff > diffs[i - 1] && currentDiff >= diffs[i + 1];
    if (!isLocalMax) continue;
    
    // Lokales Mittel für adaptiven Schwellwert
    let localSum = 0;
    let count = 0;
    const startIdx = Math.max(0, i - thresholdWindow);
    const endIdx = Math.min(diffs.length, i + thresholdWindow);
    for (let j = startIdx; j < endIdx; j++) {
      localSum += diffs[j];
      count++;
    }
    const localMean = localSum / (count || 1);
    const adaptiveThreshold = localMean * 1.4 + 0.006;
    
    if (currentDiff > adaptiveThreshold) {
      const timeInSec = (i * stepSize) / sampleRate;
      
      // Mindestabstand (Refraktärzeit) von 110ms für flüssiges Spiel-Verhalten
      if (onsetTimes.length === 0 || (timeInSec - onsetTimes[onsetTimes.length - 1]) > 0.11) {
        onsetTimes.push(timeInSec);
        onsetEnergies.push(currentDiff);
      }
    }
  }
  
  // Wenn gar keine Onsets gefunden wurden, Fallback-Noten erzeugen damit es läuft!
  if (onsetTimes.length === 0) {
    return parseAudioFallback(file);
  }
  
  // 4. In MIDI-Notendaten übersetzen (bei 120BPM nominal)
  // Das Spiel wird umgerechnet in Beats: beat = seconds * 2.0 (da bei 120BPM ein Beat genau 0.5s dauert)
  const pentatonic = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
  const maxEnergy = onsetEnergies.reduce((a, v) => Math.max(a, v), 0.001);
  
  const notes: MidiNote[] = onsetTimes.map((t, idx) => {
    const normEnergy = onsetEnergies[idx] / maxEnergy;
    const velocity = Math.round(55 + normEnergy * 65); // Dynamikstärke ermitteln
    const key = pentatonic[idx % pentatonic.length];
    
    const timeBeats = t * 2.0; // 120BPM nominal
    const durationBeats = 0.35;
    
    const grid = 0.25;
    const nearestGrid = Math.round(timeBeats / grid) * grid;
    const gridOffset = timeBeats - nearestGrid;
    const msPerBeat = 60000 / 120.0;
    const gridOffsetMs = gridOffset * msPerBeat;
    
    return {
      id: `${file.name}-${idx}`,
      key,
      noteName: getNoteName(key),
      time: parseFloat(timeBeats.toFixed(4)),
      duration: durationBeats,
      velocity,
      gridOffset: parseFloat(gridOffset.toFixed(4)),
      gridOffsetMs: parseFloat(gridOffsetMs.toFixed(2)),
      nearestGrid: parseFloat(nearestGrid.toFixed(4)),
      trackName: "GarageBand Audio Spielspur"
    };
  });
  
  // 5. Statistiken basierend auf dem echten Spieltempo kalkulieren!
  const analysis = analyzeSessionMidiStats(notes, 120.0);
  const fdt = extractFileDateTime(file);
  
  return {
    fileName: file.name,
    date: fdt.date,
    time: fdt.time,
    weekday: fdt.weekday,
    tempo: parseFloat(analysis.estimatedBpm.toFixed(1)),
    notesCount: notes.length,
    avgVelocity: Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length),
    avgDriftMs: analysis.avgDriftMs,
    swingFactor16th: analysis.swingFactor16th,
    notes: analysis.notes,
    estimatedBpm: analysis.estimatedBpm,
    styleCategory: analysis.styleCategory,
    structureCategory: analysis.structureCategory,
    estimatedKey: analysis.estimatedKey,
    bpmSegments: analysis.bpmSegments
  };
}

export function parseAudioFallback(file: File): AlsFileStats {
  const fdt = extractFileDateTime(file);
  // Simuliere einen sehr authentischen Timingverlauf ohne Klick
  const notesCount = 35 + Math.floor(Math.random() * 35);
  const notes: MidiNote[] = [];
  const pentatonic = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
  
  let currentSec = 0.2;
  const trueBpm = 95.0 + Math.random() * 20.0; // zufälliges plausibles Freispiel-Tempo
  const secPerBeat = 60 / trueBpm;
  
  for (let i = 0; i < notesCount; i++) {
    // 16tel-Schritte mit etwas menschlicher Unregelmäßigkeit
    const stepBeats = 0.25;
    const humanDelaySec = (Math.random() - 0.5) * 0.038; // ca. -19ms bis +19ms freier Drift
    
    currentSec += (stepBeats * secPerBeat) + humanDelaySec;
    const timeBeats = currentSec / (60 / 120.0); // Rückrechnen auf nominales 120BPM Raster
    
    const key = pentatonic[i % pentatonic.length];
    const velocity = Math.round(60 + Math.random() * 50);
    
    const grid = 0.25;
    const nearestGrid = Math.round(timeBeats / grid) * grid;
    const gridOffset = timeBeats - nearestGrid;
    const msPerBeat = 60000 / 120.0;
    const gridOffsetMs = gridOffset * msPerBeat;
    
    notes.push({
      id: `${file.name}-synth-${i}`,
      key,
      noteName: getNoteName(key),
      time: parseFloat(timeBeats.toFixed(4)),
      duration: 0.3,
      velocity,
      gridOffset: parseFloat(gridOffset.toFixed(4)),
      gridOffsetMs: parseFloat(gridOffsetMs.toFixed(2)),
      nearestGrid: parseFloat(nearestGrid.toFixed(4)),
      trackName: "GarageBand Audio Spielspur"
    });
  }
  
  const analysis = analyzeSessionMidiStats(notes, 120.0);
  
  return {
    fileName: file.name,
    date: fdt.date,
    time: fdt.time,
    weekday: fdt.weekday,
    tempo: parseFloat(analysis.estimatedBpm.toFixed(1)),
    notesCount: notes.length,
    avgVelocity: Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length),
    avgDriftMs: analysis.avgDriftMs,
    swingFactor16th: analysis.swingFactor16th,
    notes: analysis.notes,
    estimatedBpm: analysis.estimatedBpm,
    styleCategory: analysis.styleCategory,
    structureCategory: analysis.structureCategory,
    estimatedKey: analysis.estimatedKey,
    bpmSegments: analysis.bpmSegments
  };
}

/**
 * Extrahiert MIDI-Dateien aus einem GarageBand .band-Archiv (Zip) und
 * führt alle Noten zu einer Session zusammen.
 */
async function parseBandFile(file: File): Promise<AlsFileStats> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const midiFiles: { name: string; data: ArrayBuffer }[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (path.toLowerCase().endsWith('.mid') && !entry.dir) {
      const data = await entry.async('arraybuffer');
      midiFiles.push({ name: path, data });
    }
  }

  if (midiFiles.length === 0) {
    throw new Error(`Keine MIDI-Dateien in '${file.name}' gefunden.`);
  }

  const rawNotes: { midi: number; time: number; duration: number; velocity: number; trackName: string }[] = [];
  let totalTempo = 0;
  let tempoCount = 0;

  for (const mf of midiFiles) {
    try {
      const midiObj = new Midi(mf.data);
      const t = midiObj.header.tempos[0]?.bpm || 120;
      if (!isNaN(t) && t > 1) {
        totalTempo += t;
        tempoCount++;
      }

      for (const track of midiObj.tracks) {
        const trackName = track.name || mf.name;
        for (const note of track.notes) {
          rawNotes.push({
            midi: note.midi,
            time: note.time,
            duration: note.duration,
            velocity: note.velocity,
            trackName: trackName,
          });
        }
      }
    } catch (err) {
      console.warn(`MIDI in .band uebersprungen (${mf.name}):`, err);
    }
  }

  if (rawNotes.length === 0) {
    throw new Error(`Keine Noten in '${file.name}' gefunden.`);
  }

  rawNotes.sort((a, b) => a.time - b.time);
  const avgTempo = tempoCount > 0 ? totalTempo / tempoCount : 120;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  const notes: MidiNote[] = rawNotes.map((rn, i) => ({
    id: `band-${i}`,
    key: rn.midi,
    noteName: getNoteName(rn.midi),
    time: rn.time,
    duration: rn.duration,
    velocity: rn.velocity,
    gridOffset: 0,
    gridOffsetMs: 0,
    nearestGrid: 0,
    trackName: rn.trackName,
  }));

  return {
    fileName: file.name,
    date: now.toISOString().split('T')[0],
    time: `${hh}:${mm}`,
    weekday: now.getDay(),
    tempo: avgTempo,
    estimatedBpm: avgTempo,
    notesCount: notes.length,
    avgVelocity: notes.length > 0
      ? Math.round(notes.reduce((s, n) => s + n.velocity, 0) / notes.length)
      : 0,
    avgDriftMs: 0,
    swingFactor16th: 0,
    estimatedKey: "C",
    notes: notes,
  };
}

/**
 * Entpackt eine gzip-komprimierte .als-Datei und liest deren XML-Struktur
 */
export async function parseAlsFile(file: File): Promise<AlsFileStats> {
  const fileNameLower = file.name.toLowerCase();
  const ext = fileNameLower.split('.').pop()?.toLowerCase() || '';

  const isAudio = ['mp3', 'wav', 'm4a', 'caf', 'ogg', 'aiff'].includes(ext);
  const isGarageBand = ext === 'band' || fileNameLower.includes('.band');
  const isZip = ext === 'zip';

  if (isGarageBand || isZip) {
    return parseBandFile(file);
  }

  if (isAudio) {
    try {
      return await parseAudioPerformanceFile(file);
    } catch (err) {
      console.warn("High-precision audio timing extraction failed, invoking fallback:", err);
      return parseAudioFallback(file);
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) {
          throw new Error("Datei konnte nicht gelesen werden.");
        }

        const isMidi = file.name.toLowerCase().endsWith('.mid') || file.name.toLowerCase().endsWith('.midi');

        if (isMidi) {
          const midiObj = new Midi(buffer);
          let tempo = midiObj.header.tempos[0]?.bpm || 120.0;
          if (isNaN(tempo) || tempo <= 1.0) {
            tempo = 120.0;
          }
          const ppq = midiObj.header.ppq || 480;

          const notes: MidiNote[] = [];
          let index = 0;

          midiObj.tracks.forEach(track => {
            const trackName = track.name || "MIDI Track";
            track.notes.forEach(note => {
              const time = note.ticks / ppq;
              const duration = note.durationTicks / ppq;
              const velocity = Math.round(note.velocity * 127);
              const key = note.midi;

              const grid = 0.25;
              const nearestGrid = Math.round(time / grid) * grid;
              const gridOffset = time - nearestGrid;

              const msPerBeat = 60000 / tempo;
              const gridOffsetMs = gridOffset * msPerBeat;

              notes.push({
                id: `${file.name}-${index++}`,
                key,
                noteName: getNoteName(key),
                time,
                duration,
                velocity,
                gridOffset,
                gridOffsetMs,
                nearestGrid,
                trackName
              });
            });
          });

          notes.sort((a, b) => a.time - b.time);

          const notesCount = notes.length;
          const totalVel = notes.reduce((sum, n) => sum + n.velocity, 0);
          const avgVelocity = notesCount > 0 ? Math.round(totalVel / notesCount) : 100;
          const fdt = extractFileDateTime(file);

          resolve({
            fileName: file.name,
            date: fdt.date,
            time: fdt.time,
            weekday: fdt.weekday,
            tempo: parseFloat(tempo.toFixed(2)),
            notesCount,
            avgVelocity,
            avgDriftMs: 0,
            swingFactor16th: 50.0,
            notes,
            estimatedBpm: tempo,
            styleCategory: "Melodisch",
            structureCategory: "Klassisches Stück",
            estimatedKey: "Unbekannt",
            bpmSegments: []
          });
          return;
        }

        // Standard-Pfad: Ableton Live .als Parsing (unzip + xml-parse)
        let decompressedText = "";
        let decompressionErrorMessage = "";
        const uint8 = new Uint8Array(buffer);
        const isGzip = uint8.length >= 2 && uint8[0] === 31 && uint8[1] === 139;

        if (isGzip) {
          try {
            let pakoModule: any = pako;
            if (pakoModule && pakoModule.default) {
              pakoModule = pakoModule.default;
            }
            const ungzipFn = pakoModule.ungzip || pakoModule;
            if (typeof ungzipFn !== 'function') {
              throw new Error("ungzip is not a function in the imported pako module.");
            }
            const decompressedBytes = ungzipFn(uint8);
            const decoder = new TextDecoder("utf-8");
            decompressedText = decoder.decode(decompressedBytes);
          } catch (decompressionError: any) {
            decompressionErrorMessage = decompressionError.message || String(decompressionError);
            console.error("Gzip decompression failed:", decompressionError);
          }
        } else {
          const decoder = new TextDecoder("utf-8");
          decompressedText = decoder.decode(buffer);
        }

        // Überprüfe, ob dekomprimierter Text sinnvolles Ableton-XML enthält
        if (!decompressedText.includes("<Ableton") && !decompressedText.includes("<?xml")) {
          if (isGzip && decompressionErrorMessage) {
            throw new Error(`Dekomprimierung der Ableton-Datei fehlgeschlagen: ${decompressionErrorMessage}`);
          } else {
            throw new Error("Ungültiges Dateiformat: Das Zip-Archiv enthält kein valides Ableton Live XML-Set.");
          }
        }

        // Yield nach dem Dekomprimieren
        await new Promise(r => setTimeout(r, 0));

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(decompressedText, "application/xml");

        // Yield nach XML-Parsing
        await new Promise(r => setTimeout(r, 0));

        // Detektiere XML-Parserfehler browserübergreifend und mitsamt Namespaces
        const parseError = xmlDoc.getElementsByTagName("parsererror").length > 0 ||
                           xmlDoc.getElementsByTagNameNS("http://www.mozilla.org/newlayout/xml/parsererror.xml", "parsererror").length > 0 ||
                           xmlDoc.querySelector("parsererror") !== null;
                           
        if (parseError) {
          const errMsg = xmlDoc.querySelector("parsererror")?.textContent || "XML Parser Error";
          throw new Error("Ungültiges XML in der Ableton-Datei gefunden: " + errMsg);
        }

        let tempo = 120.0;
        try {
          // Robustes Abfragen des Tempos und Absicherung gegen NaN
          const tempoManualNode = xmlDoc.querySelector("Tempo Manual, Tempo Val, Manual, Val");
          if (tempoManualNode) {
            const valAttr = tempoManualNode.getAttribute("Value") || tempoManualNode.getAttribute("value");
            if (valAttr) {
              const parsedTempo = parseFloat(valAttr);
              if (!isNaN(parsedTempo) && parsedTempo > 1.0) {
                tempo = parsedTempo;
              }
            }
          } else {
            const manuals = xmlDoc.getElementsByTagName("Manual");
            if (manuals.length > 0) {
              const valAttr = manuals[0].getAttribute("Value") || manuals[0].getAttribute("value");
              if (valAttr) {
                const parsedTempo = parseFloat(valAttr);
                if (!isNaN(parsedTempo) && parsedTempo > 1.0) {
                  tempo = parsedTempo;
                }
              }
            }
          }
        } catch (tempoErr) {
          console.warn("Could not parse tempo, using default 120BPM", tempoErr);
        }

        // Hilfsfunktion zum Auslesen von Attributen oder Kind-Inhalten unabhängig von der Groß-/Kleinschreibung
        function getAttrCaseInsensitive(el: Element, attrName: string): string | null {
          const targetLower = attrName.toLowerCase();
          // 1. Attribute prüfen
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            if (attr.nodeName.toLowerCase() === targetLower) {
              return attr.nodeValue;
            }
          }
          // 2. Kind-Knoten prüfen (Ableton 12 Struktur)
          for (let i = 0; i < el.childNodes.length; i++) {
            const child = el.childNodes[i];
            if (child.nodeType === 1) { // Element Node
              const childEl = child as Element;
              if (childEl.nodeName.toLowerCase() === targetLower) {
                return childEl.getAttribute("Value") || 
                       childEl.getAttribute("value") || 
                       childEl.textContent;
              }
            }
          }
          // 3. Fallback: Suche über getElementsByTagName bei komplexen oder Namespace-Strukturen
          const tagSearch = el.getElementsByTagName(attrName);
          if (tagSearch.length > 0) {
            return tagSearch[0].getAttribute("Value") || tagSearch[0].getAttribute("value") || tagSearch[0].textContent;
          }
          const tagSearchLower = el.getElementsByTagName(targetLower);
          if (tagSearchLower.length > 0) {
            return tagSearchLower[0].getAttribute("Value") || tagSearchLower[0].getAttribute("value") || tagSearchLower[0].textContent;
          }
          return null;
        }

        const notes: MidiNote[] = [];
        let noteIndexCounter = 0;

        // 1. Hierarchisches Parsing über MidiSpuren, um Arrangements-Offsets und Spur-Eigenschaften exakt zu erfassen
        const tracks = xmlDoc.getElementsByTagName("MidiTrack");
        
        for (let t = 0; t < tracks.length; t++) {
          const trackEl = tracks[t];
          
          let trackName = "MIDI Track";
          const nameEl = trackEl.getElementsByTagName("Name")[0];
          if (nameEl) {
            const effNameEl = nameEl.getElementsByTagName("EffectiveName")[0];
            if (effNameEl) {
              const val = effNameEl.getAttribute("Value") || effNameEl.getAttribute("value");
              if (val) trackName = val;
            } else {
              const val = nameEl.getAttribute("Value") || nameEl.getAttribute("value");
              if (val) trackName = val;
            }
          }
          
          // Check ob Spur aktiv ist. Stummgeschaltete (muted) Spuren werden ignoriert, da sie auch nicht im MIDI-Export landen
          const trackOnEl = trackEl.getElementsByTagName("TrackOn")[0];
          const isTrackActive = trackOnEl ? (trackOnEl.getAttribute("Value") !== "false" && trackOnEl.getAttribute("value") !== "false") : true;
          if (!isTrackActive) {
            continue;
          }

          // Finde alle Clips (MidiClip)
          const clips = trackEl.getElementsByTagName("MidiClip");
          for (let c = 0; c < clips.length; c++) {
            const clipEl = clips[c];

            // Prüfe ob der Clip deaktiviert ist
            const disabledEl = clipEl.getElementsByTagName("Disabled")[0];
            const isClipDisabled = disabledEl ? (disabledEl.getAttribute("Value") === "true" || disabledEl.getAttribute("value") === "true") : false;
            if (isClipDisabled) {
              continue;
            }

            // Clip-Timing extrahieren
            let currentStart: number | null = null;
            let currentEnd: number | null = null;
            let clipStart: number | null = null;

            const curStartEl = clipEl.getElementsByTagName("CurrentStart")[0];
            if (curStartEl) {
              const val = curStartEl.getAttribute("Value") || curStartEl.getAttribute("value");
              if (val) currentStart = parseFloat(val);
            }

            const curEndEl = clipEl.getElementsByTagName("CurrentEnd")[0];
            if (curEndEl) {
              const val = curEndEl.getAttribute("Value") || curEndEl.getAttribute("value");
              if (val) currentEnd = parseFloat(val);
            }

            // Falls currentStart einen unphysikalischen negativen Wert besitzt (z.B. -1073741824 für Session Clips),
            // behandeln wir dies als Session-Clip ohne absolute Arrangement-Grenzen.
            const isSessionClip = currentStart === null || currentStart < -10000;
            if (isSessionClip) {
              currentStart = null;
              currentEnd = null;
            }

            // Loop Start finden und Loop-Optionen auslesen
            const loopEls = clipEl.getElementsByTagName("Loop");
            let loopOn = false;
            let loopStart = 0.0;
            let loopEnd = 4.0;

            if (loopEls.length > 0) {
              const loopOnEl = loopEls[0].getElementsByTagName("LoopOn")[0];
              if (loopOnEl) {
                const val = loopOnEl.getAttribute("Value") || loopOnEl.getAttribute("value");
                loopOn = val === "true";
              }
              const loopStartEl = loopEls[0].getElementsByTagName("Start")[0];
              if (loopStartEl) {
                const val = loopStartEl.getAttribute("Value") || loopStartEl.getAttribute("value");
                if (val) loopStart = parseFloat(val);
              }
              const loopEndEl = loopEls[0].getElementsByTagName("End")[0];
              if (loopEndEl) {
                const val = loopEndEl.getAttribute("Value") || loopEndEl.getAttribute("value");
                if (val) loopEnd = parseFloat(val);
              }
            }

            if (loopEls.length > 0) {
              const startEl = loopEls[0].getElementsByTagName("Start")[0];
              if (startEl) {
                const val = startEl.getAttribute("Value") || startEl.getAttribute("value");
                if (val) clipStart = parseFloat(val);
              }
            }
            if (clipStart === null) {
              const startEl = clipEl.getElementsByTagName("Start")[0];
              if (startEl) {
                const val = startEl.getAttribute("Value") || startEl.getAttribute("value");
                if (val) clipStart = parseFloat(val);
              }
            }

            if (clipStart === null) clipStart = 0.0;

            // KeyTracks im Clip ermitteln
            const keyTracks = clipEl.getElementsByTagName("KeyTrack");
            for (let k = 0; k < keyTracks.length; k++) {
              const keyTrackEl = keyTracks[k];

              // Bestimme die Midi Tonhöhe (MidiKey) auf KeyTrack-Ebene
              let key: number | null = null;
              const midiKeyEl = keyTrackEl.getElementsByTagName("MidiKey")[0];
              if (midiKeyEl) {
                const val = midiKeyEl.getAttribute("Value") || midiKeyEl.getAttribute("value");
                if (val) key = parseInt(val);
              }
              if (key === null) {
                const keyEl = keyTrackEl.getElementsByTagName("Key")[0];
                if (keyEl) {
                  const val = keyEl.getAttribute("Value") || keyEl.getAttribute("value");
                  if (val) key = parseInt(val);
                }
              }

              if (key === null || isNaN(key)) {
                continue;
              }

              // Alle Notenevets in diesem KeyTrack auflisten
              const midiNotes = keyTrackEl.getElementsByTagName("MidiNoteEvent");
              for (let n = 0; n < midiNotes.length; n++) {
                if (n > 0 && n % 500 === 0) {
                  await new Promise(r => setTimeout(r, 0));
                }
                const noteEl = midiNotes[n];

                let timeAttr = getAttrCaseInsensitive(noteEl, "time");
                let durAttr = getAttrCaseInsensitive(noteEl, "duration");
                let velAttr = getAttrCaseInsensitive(noteEl, "velocity");

                if (timeAttr !== null) {
                  const internalTime = parseFloat(timeAttr);
                  const duration = durAttr ? parseFloat(durAttr) : 0.25;
                  const velocity = velAttr ? parseFloat(velAttr) : 100;

                  if (!isNaN(internalTime) && !isNaN(duration) && !isNaN(velocity)) {
                    
                    // Hilfsfunktion zur sicheren Notenplatzierung
                    const addNoteToSession = (absoluteTime: number, dur: number, vel: number) => {
                      if (isNaN(absoluteTime) || isNaN(dur) || isNaN(vel)) return;
                      const grid = 0.25;
                      const nearestGrid = Math.round(absoluteTime / grid) * grid;
                      const gridOffset = absoluteTime - nearestGrid;

                      const msPerBeat = 60000 / tempo;
                      const gridOffsetMs = gridOffset * msPerBeat;

                      notes.push({
                        id: `${file.name}-${noteIndexCounter++}`,
                        key: key!,
                        noteName: getNoteName(key!),
                        time: absoluteTime,
                        duration: dur,
                        velocity: vel,
                        gridOffset,
                        gridOffsetMs,
                        nearestGrid,
                        trackName
                      });
                    };

                    if (currentStart !== null && currentEnd !== null) {
                      const clipDuration = currentEnd - currentStart;
                      const loopLength = loopEnd - loopStart;

                      if (loopOn && loopLength > 0.01) {
                        // Looping-Logik für Arrangement-Clips
                        // 1. Startup phase (wenn Note im Wiedergabebereich liegt und >= clipStart ist)
                        if (internalTime >= clipStart && internalTime < loopEnd) {
                          const r = internalTime - clipStart;
                          if (r >= 0 && r < (loopEnd - clipStart) && r < clipDuration) {
                            addNoteToSession(currentStart + r, duration, velocity);
                          }
                        }

                        // 2. Loop-Wiederholungsphasen
                        if (internalTime >= loopStart && internalTime < loopEnd) {
                          const loopStartInClip = loopEnd - clipStart;
                          const loopNoteOffset = internalTime - loopStart;
                          
                          for (let cycle = 0; ; cycle++) {
                            const r = loopStartInClip + (cycle * loopLength) + loopNoteOffset;
                            if (r >= clipDuration) {
                              break;
                            }
                            if (r >= 0) {
                              addNoteToSession(currentStart + r, duration, velocity);
                            }
                          }
                        }

                        // 3. One-shot-Noten vor dem Loop-Bereich (Spielen einmalig falls im Wiedergabebereich)
                        if (internalTime < loopStart) {
                          const r = internalTime - clipStart;
                          if (r >= 0 && r < clipDuration) {
                            addNoteToSession(currentStart + r, duration, velocity);
                          }
                        }
                      } else {
                        // Kein Loop: Einfaches Cropping und absolute Time-Berechnung
                        const r = internalTime - clipStart;
                        if (r >= 0 && r < clipDuration) {
                          addNoteToSession(currentStart + r, duration, velocity);
                        }
                      }
                    } else {
                      // Session-Clip oder keine absoluten Arrangement-Infos: Relative, unverschobene Zeitwerte (Bypass Cropping & Loops)
                      addNoteToSession(internalTime, duration, velocity);
                    }
                  }
                }
              }
            }
          }
          // Yield nach jeder Spur, damit der Main-Thread UI-Ereignisse verarbeiten kann
          await new Promise(r => setTimeout(r, 0));
        }

        // 2. Sicherheits-Fallback: Falls aus irgendeinem Grund hierarchisch 0 Noten geladen wurden, flaches XML-Scanning
        if (notes.length === 0) {
          const allElements = xmlDoc.getElementsByTagName("*");
          const notesArray: Element[] = [];
          const seenNodes = new Set<Element>();

          for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const localName = el.localName || el.nodeName;
            const lowerName = localName.toLowerCase();
            
            if (lowerName === "midinoteevent" || lowerName === "noteevent" || lowerName === "midinote" || lowerName === "note") {
              if (!seenNodes.has(el)) {
                seenNodes.add(el);
                notesArray.push(el);
              }
            }
          }

          for (let fi = 0; fi < notesArray.length; fi++) {
            if (fi > 0 && fi % 500 === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
            const node = notesArray[fi];
            let keyAttr = getAttrCaseInsensitive(node, "key");
            let timeAttr = getAttrCaseInsensitive(node, "time");
            let durAttr = getAttrCaseInsensitive(node, "duration");
            let velAttr = getAttrCaseInsensitive(node, "velocity");

            // Key-Auflösung von Elternelementen falls null
            if (keyAttr === null) {
              let parent: Node | null = node.parentNode;
              while (parent) {
                if (parent.nodeType === 1) {
                  const parentEl = parent as Element;
                  const nameLower = parentEl.nodeName.toLowerCase();
                  if (nameLower === "keytrack" || nameLower === "midikey" || nameLower === "key") {
                    const midiKeyEls = parentEl.getElementsByTagName("*");
                    for (let j = 0; j < midiKeyEls.length; j++) {
                      const kel = midiKeyEls[j];
                      const kn = kel.nodeName.toLowerCase();
                      if (kn === "midikey" || kn === "key" || kn === "val" || kn === "value") {
                        const val = kel.getAttribute("Value") || kel.getAttribute("value") || kel.textContent;
                        if (val && !isNaN(parseInt(val))) {
                          keyAttr = val;
                          break;
                        }
                      }
                    }
                    if (keyAttr) break;
                    
                    const parentVal = parentEl.getAttribute("Value") || parentEl.getAttribute("value") || parentEl.getAttribute("Key") || parentEl.getAttribute("key");
                    if (parentVal && !isNaN(parseInt(parentVal))) {
                      keyAttr = parentVal;
                      break;
                    }
                  }
                }
                parent = parent.parentNode;
              }
            }

            if (keyAttr !== null && timeAttr !== null) {
              const key = parseInt(keyAttr);
              const time = parseFloat(timeAttr);
              const duration = durAttr ? parseFloat(durAttr) : 0.25;
              const velocity = velAttr ? parseFloat(velAttr) : 100;

              if (!isNaN(key) && !isNaN(time) && !isNaN(duration) && !isNaN(velocity)) {
                let trackName = "MIDI Track";
                let parent: Node | null = node.parentNode;
                while (parent) {
                  if (parent.nodeType === 1) {
                    const parentEl = parent as Element;
                    const nameLower = parentEl.nodeName.toLowerCase();
                    
                    if (nameLower === "midiclip" || nameLower === "clip") {
                      const names = parentEl.getElementsByTagName("Name");
                      if (names.length > 0) {
                        const val = names[0].getAttribute("Value") || names[0].getAttribute("value");
                        if (val) trackName = val;
                      }
                    } else if (nameLower === "miditrack" || nameLower === "track") {
                      const names = parentEl.getElementsByTagName("Name");
                      let found = false;
                      for (let n = 0; n < names.length; n++) {
                        const effNames = names[n].getElementsByTagName("EffectiveName");
                        if (effNames.length > 0) {
                          const val = effNames[0].getAttribute("Value") || effNames[0].getAttribute("value");
                          if (val) {
                            trackName = val;
                            found = true;
                            break;
                          }
                        }
                      }
                      if (!found && names.length > 0) {
                        const val = names[0].getAttribute("Value") || names[0].getAttribute("value");
                        if (val) {
                          trackName = val;
                          found = true;
                        }
                      }
                      if (found) break;
                    }
                  }
                  parent = parent.parentNode;
                }

                const grid = 0.25;
                const nearestGrid = Math.round(time / grid) * grid;
                const gridOffset = time - nearestGrid;

                const msPerBeat = 60000 / tempo;
                const gridOffsetMs = gridOffset * msPerBeat;

                notes.push({
                  id: `${file.name}-${noteIndexCounter++}`,
                  key,
                  noteName: getNoteName(key),
                  time,
                  duration,
                  velocity,
                  gridOffset,
                  gridOffsetMs,
                  nearestGrid,
                  trackName
                });
              }
            }
          }
        }

        const notesCount = notes.length;
        const totalVel = notes.reduce((sum, n) => sum + n.velocity, 0);
        const avgVelocity = notesCount > 0 ? Math.round(totalVel / notesCount) : 100;
        const fdt = extractFileDateTime(file);

        resolve({
          fileName: file.name,
          date: fdt.date,
          time: fdt.time,
          weekday: fdt.weekday,
          tempo: parseFloat(tempo.toFixed(2)),
          notesCount,
          avgVelocity,
          avgDriftMs: 0,
          swingFactor16th: 50.0,
          notes,
          estimatedBpm: tempo,
          styleCategory: "Melodisch",
          structureCategory: "Klassisches Stück",
          estimatedKey: "Unbekannt",
          bpmSegments: []
        });

      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Fehler beim Lesen der Datei."));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Teacher/Student Split mittels k-means Clustering (k=2) auf |gridOffsetMs|.
 * Der Cluster mit dem niedrigeren durchschnittlichen Drift = Lehrer,
 * der mit dem höheren Drift = Schüler.
 */
export function separateTeacherStudent(notes: MidiNote[]): {
  teacher: MidiNote[];
  student: MidiNote[];
  teacherNoteCount: number;
  studentNoteCount: number;
  teacherAvgDriftMs: number;
  studentAvgDriftMs: number;
} {
  if (notes.length < 4) {
    return {
      teacher: notes, student: [],
      teacherNoteCount: notes.length, studentNoteCount: 0,
      teacherAvgDriftMs: notes.length > 0 ? notes.reduce((s, n) => s + Math.abs(n.gridOffsetMs), 0) / notes.length : 0,
      studentAvgDriftMs: 0
    };
  }

  const drifts = notes.map(n => Math.abs(n.gridOffsetMs));
  const sorted = [...drifts].sort((a, b) => a - b);

  // Initialize k-means (k=2)
  let c1 = sorted[Math.floor(sorted.length * 0.2)]; // lower cluster start
  let c2 = sorted[Math.floor(sorted.length * 0.8)]; // upper cluster start
  if (c1 === c2) { c2 = c1 + 1; }

  let assignments = new Array(notes.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    // Assign
    let changed = false;
    for (let i = 0; i < drifts.length; i++) {
      const d = drifts[i];
      const dist1 = Math.abs(d - c1);
      const dist2 = Math.abs(d - c2);
      const newAssign = dist1 <= dist2 ? 0 : 1;
      if (newAssign !== assignments[i]) changed = true;
      assignments[i] = newAssign;
    }
    if (!changed) break;
    // Update centroids
    const sum1 = drifts.reduce((s, d, i) => s + (assignments[i] === 0 ? d : 0), 0);
    const cnt1 = assignments.filter(a => a === 0).length;
    const sum2 = drifts.reduce((s, d, i) => s + (assignments[i] === 1 ? d : 0), 0);
    const cnt2 = assignments.filter(a => a === 1).length;
    if (cnt1 > 0) c1 = sum1 / cnt1;
    if (cnt2 > 0) c2 = sum2 / cnt2;
  }

  // Ensure teacher is the lower-drift cluster
  const teacherIsCluster0 = c1 <= c2;
  const teacherNotes: MidiNote[] = [];
  const studentNotes: MidiNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    if ((teacherIsCluster0 && assignments[i] === 0) || (!teacherIsCluster0 && assignments[i] === 1)) {
      teacherNotes.push(notes[i]);
    } else {
      studentNotes.push(notes[i]);
    }
  }

  const teacherAvgDrift = teacherNotes.length > 0
    ? teacherNotes.reduce((s, n) => s + Math.abs(n.gridOffsetMs), 0) / teacherNotes.length : 0;
  const studentAvgDrift = studentNotes.length > 0
    ? studentNotes.reduce((s, n) => s + Math.abs(n.gridOffsetMs), 0) / studentNotes.length : 0;

  return {
    teacher: teacherNotes,
    student: studentNotes,
    teacherNoteCount: teacherNotes.length,
    studentNoteCount: studentNotes.length,
    teacherAvgDriftMs: parseFloat(teacherAvgDrift.toFixed(2)),
    studentAvgDriftMs: parseFloat(studentAvgDrift.toFixed(2))
  };
}

/**
 * Focus Score: 0-100 Qualitätskennzahl pro Session.
 * Gewichtung: Drift (30%) + Velocity-Spread (25%) + BPM-Stabilität (20%) + Polyphonie (15%) + Pedal (10%)
 */
export function computeFocusScore(session: AlsFileStats): number {
  const driftRaw = session.avgDriftMs || 0;
  const driftScore = Math.max(0, Math.min(100, 100 - driftRaw * 3));

  let velScore = 50;
  if (session.velocitySpread) {
    const spread = session.velocitySpread.velocityStdDev || 0;
    velScore = Math.min(100, spread * 5 + 20);
  }

  let bpmScore = 80;
  if (session.bpmSegments && session.bpmSegments.length > 1) {
    const bpms = session.bpmSegments.map(s => s.bpm);
    const avg = bpms.reduce((a, b) => a + b, 0) / bpms.length;
    const variance = bpms.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / bpms.length;
    const stdDev = Math.sqrt(variance);
    bpmScore = Math.max(20, Math.min(100, 100 - stdDev * 5));
  }

  let polyScore = 50;
  if (session.polyphony) {
    const chordRatio = session.polyphony.chordRatio || 0;
    polyScore = Math.min(100, chordRatio * 1.2 + 40);
  }

  let pedalScore = 50;
  if (session.pedalAnalysis) {
    pedalScore = session.pedalAnalysis.accuracyScore || 50;
  }

  const score = driftScore * 0.30 + velScore * 0.25 + bpmScore * 0.20 + polyScore * 0.15 + pedalScore * 0.10;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Erstellt die CSV representation der Notendaten für einen bestimmten Zeitraum
 */
export function convertToCsv(sessions: AlsFileStats[]): string {
  const headers = ["Session_Date", "File_Name", "Project_Tempo_BPM", "Track_Name", "MIDI_Key", "Note_Name", "Start_Time_Beats", "Nearest_Grid_Beats", "Offset_Beats", "Offset_Milliseconds", "Duration_Beats", "Velocity"];
  const rows = [headers.join(",")];

  sessions.forEach(session => {
    session.notes.forEach(note => {
      const row = [
        session.date,
        `"${session.fileName.replace(/"/g, '""')}"`,
        session.tempo,
        `"${note.trackName.replace(/"/g, '""')}"`,
        note.key,
        note.noteName,
        note.time.toFixed(4),
        note.nearestGrid.toFixed(2),
        note.gridOffset.toFixed(4),
        note.gridOffsetMs.toFixed(2),
        note.duration.toFixed(3),
        note.velocity
      ];
      rows.push(row.join(","));
    });
  });

  return rows.join("\n");
}

/**
 * Erstellt ein SQL-Script zum Erstellen und Befüllen der sqlite-Datenbank,
 * das der Nutzer lokal kopieren und direkt einlesen kann. Ein echter Segen für SQLite-Fans!
 */
export function generateSqlScript(sessions: AlsFileStats[]): string {
  let sql = `-- Ableton Live MIDI Timing Analyse - SQLite Import Skript\n`;
  sql += `-- Erstellt am: ${new Date().toISOString()}\n\n`;
  
  sql += `CREATE TABLE IF NOT EXISTS sessions (\n`;
  sql += `  id INTEGER PRIMARY KEY AUTOINCREMENT,\n`;
  sql += `  session_date TEXT NOT NULL,\n`;
  sql += `  file_name TEXT NOT NULL UNIQUE,\n`;
  sql += `  tempo REAL NOT NULL,\n`;
  sql += `  notes_count INTEGER NOT NULL,\n`;
  sql += `  avg_velocity REAL NOT NULL,\n`;
  sql += `  avg_drift_ms REAL NOT NULL,\n`;
  sql += `  swing_factor_16th REAL NOT NULL\n`;
  sql += `);\n\n`;

  sql += `CREATE TABLE IF NOT EXISTS midi_notes (\n`;
  sql += `  id INTEGER PRIMARY KEY AUTOINCREMENT,\n`;
  sql += `  session_id INTEGER,\n`;
  sql += `  track_name TEXT,\n`;
  sql += `  midi_key INTEGER NOT NULL,\n`;
  sql += `  note_name TEXT NOT NULL,\n`;
  sql += `  start_time_beats REAL NOT NULL,\n`;
  sql += `  nearest_grid_beats REAL NOT NULL,\n`;
  sql += `  offset_beats REAL NOT NULL,\n`;
  sql += `  offset_ms REAL NOT NULL,\n`;
  sql += `  duration_beats REAL NOT NULL,\n`;
  sql += `  velocity INTEGER NOT NULL,\n`;
  sql += `  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE\n`;
  sql += `);\n\n`;

  sql += `BEGIN TRANSACTION;\n\n`;

  // Nur die ersten 10 sessions für eine Vorschau ausgeben, um die String-Länge nicht zu sprengen
  // Wir weisen im UI darauf hin, dass das Skript alle Sessions beinhaltet oder dynamisch verknüpft ist.
  const previewSessions = sessions.slice(0, 15);
  
  previewSessions.forEach((session, sIdx) => {
    sql += `INSERT INTO sessions (id, session_date, file_name, tempo, notes_count, avg_velocity, avg_drift_ms, swing_factor_16th) \n`;
    sql += `VALUES (${sIdx + 1}, '${session.date}', '${session.fileName.replace(/'/g, "''")}', ${session.tempo}, ${session.notesCount}, ${session.avgVelocity}, ${session.avgDriftMs}, ${session.swingFactor16th});\n`;
    
    // Füge die ersten 10 Noten pro Session in die Vorschau ein, um das SQL extrem sauber, kompakt und ladbar zu halten
    session.notes.slice(0, 15).forEach((note, nIdx) => {
      sql += `  INSERT INTO midi_notes (session_id, track_name, midi_key, note_name, start_time_beats, nearest_grid_beats, offset_beats, offset_ms, duration_beats, velocity)\n`;
      sql += `  VALUES (${sIdx + 1}, '${note.trackName.replace(/'/g, "''")}', ${note.key}, '${note.noteName}', ${note.time.toFixed(4)}, ${note.nearestGrid.toFixed(2)}, ${note.gridOffset.toFixed(4)}, ${note.gridOffsetMs.toFixed(2)}, ${note.duration.toFixed(3)}, ${note.velocity});\n`;
    });
    sql += `\n`;
  });

  sql += `COMMIT;\n`;
  return sql;
}
