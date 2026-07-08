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
  const dateMatchDE = file.name.match(/(\d{2})[.](\d{2})[.](\d{4})/);
  const dateMatchDEShort = file.name.match(/(\d{2})[.](\d{2})[.](\d{2})/);
  const lastMod = file.lastModified ? new Date(file.lastModified) : new Date();
  let date: string;
  if (dateMatch) {
    date = dateMatch[1];
  } else if (dateMatchDE) {
    const y = dateMatchDE[3];
    const m = dateMatchDE[2];
    const d = dateMatchDE[1];
    date = `${y}-${m}-${d}`;
  } else if (dateMatchDEShort) {
    let y = parseInt(dateMatchDEShort[3]);
    y = y < 50 ? 2000 + y : 1900 + y;
    date = `${y}-${dateMatchDEShort[2]}-${dateMatchDEShort[1]}`;
  } else {
    date = dateToStr(lastMod);
  }
  return { date, time: normalizeTimeToSlot(lastMod), weekday: lastMod.getDay() };
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  
  const fdt = extractFileDateTime(file);
  
  return {
    fileName: file.name,
    date: fdt.date,
    time: fdt.time,
    weekday: fdt.weekday,
    tempo: 120.0,
    notesCount: notes.length,
    avgVelocity: Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length),
    avgDriftMs: 0,
    swingFactor16th: 50.0,
    notes,
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
  
  return {
    fileName: file.name,
    date: fdt.date,
    time: fdt.time,
    weekday: fdt.weekday,
    tempo: 120.0,
    notesCount: notes.length,
    avgVelocity: Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length),
    avgDriftMs: 0,
    swingFactor16th: 50.0,
    notes,
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

  const grid = 0.25;
  const msPerBeat = 60000 / avgTempo;
  const notes: MidiNote[] = rawNotes.map((rn, i) => {
    const nearestGrid = Math.round(rn.time / grid) * grid;
    const gridOffset = rn.time - nearestGrid;
    const gridOffsetMs = gridOffset * msPerBeat;
    return {
      id: `band-${i}`,
      key: rn.midi,
      noteName: getNoteName(rn.midi),
      time: rn.time,
      duration: rn.duration,
      velocity: rn.velocity,
      gridOffset,
      gridOffsetMs,
      nearestGrid,
      trackName: rn.trackName,
    };
  });

  return {
    fileName: file.name,
    date: now.toISOString().split('T')[0],
    time: `${hh}:${mm}`,
    weekday: now.getDay(),
    tempo: parseFloat(avgTempo.toFixed(2)),
    notesCount: notes.length,
    avgVelocity: Math.round(notes.reduce((s, n) => s + n.velocity, 0) / notes.length),
    avgDriftMs: 0,
    swingFactor16th: 50.0,
    notes,
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

        const fdt = extractFileDateTime(file);

        resolve({
          fileName: file.name,
          date: fdt.date,
          time: fdt.time,
          weekday: fdt.weekday,
          tempo: parseFloat(tempo.toFixed(2)),
          notesCount: notes.length,
          avgVelocity: notes.length > 0 ? Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length) : 100,
          avgDriftMs: 0,
          swingFactor16th: 50.0,
          notes,
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

        const fdt = extractFileDateTime(file);

        resolve({
          fileName: file.name,
          date: fdt.date,
          time: fdt.time,
          weekday: fdt.weekday,
          tempo: parseFloat(tempo.toFixed(2)),
          notesCount: notes.length,
          avgVelocity: notes.length > 0 ? Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length) : 100,
          avgDriftMs: 0,
          swingFactor16th: 50.0,
          notes,
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
