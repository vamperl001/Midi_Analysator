/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileCode, 
  Sliders, 
  Database, 
  Activity, 
  FileUp, 
  Download, 
  Check, 
  Copy, 
  RotateCcw, 
  Info, 
  Layers, 
  Calendar, 
  TrendingUp, 
  Sparkles, 
  Code, 
  AlertTriangle, 
  Search, 
  Music,
  Cloud,
  Trash2,
  CloudUpload,
  RefreshCw,
  CheckCircle2,
  User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseAlsFile, convertToCsv, generateSqlScript, analyzeSessionMidiStats, separateTeacherStudent, computeFocusScore } from './alsParser';
import { AlsFileStats, ScheduleEntry } from './types';
import { SvgCharts } from './components/SvgCharts';
import { pythonScriptText } from './pythonScriptText';
import { CalendarView } from './components/CalendarView';
import { ProgressionChart } from './components/ProgressionChart';
import { AdvancedCharts } from './components/AdvancedCharts';
import { SessionComparison } from './components/SessionComparison';
import { CreativeVisualizer } from './components/CreativeVisualizer';
import { StudentProgress } from './components/StudentProgress';
import { saveSessionToCloud, loadSessionsFromCloud, deleteSessionFromCloud, loadSessionNotesFromCloud } from './firebase';
import { enrichSessionWithAdvancedMetrics } from './medientechnikAnalysis';
import { CountUp } from './components/CountUp';

// Framer Motion Animation-Variants für das Statistik-Board
const statsContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05
    }
  }
};

const statsCardVariants = {
  hidden: { opacity: 0, y: 15, scale: 0.97 },
  show: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { type: "spring", stiffness: 120, damping: 14 } 
  }
};

export default function App() {
  // --- Zustand (State) ---
  const [loadedFiles, setLoadedFiles] = useState<AlsFileStats[]>([]);
  const [selectedFileIdx, setSelectedFileIdx] = useState<number | null>(null); // Index des fokussierten Files, null für Gesamtansicht
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL"); // "ALL", "0" (Jan) bis "5" (Jun)
  const [activeTab, setActiveTab] = useState<"dashboard" | "database" | "python" | "calendar" | "visualizer" | "progress">("dashboard");
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [errorString, setErrorString] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const [selectedNoteKey, setSelectedNoteKey] = useState<number | null>(null);
  const [trackSearch, setTrackSearch] = useState<string>("");
  const [minVelocity, setMinVelocity] = useState<number>(0);
  const [maxVelocity, setMaxVelocity] = useState<number>(127);

  // --- Cloud Database Sync ---
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [cloudSyncMessage, setCloudSyncMessage] = useState<string | null>(null);
  const [isCloudSaving, setIsCloudSaving] = useState<string | null>(null); // Dateiname, der gerade gespeichert wird
  // Automatisch gespeicherte HAW-Bewerbungssitzungen beim Laden laden (Offline-/Online-Synchronisation)
  useEffect(() => {
    async function loadCloudSessions() {
      setIsCloudSyncing(true);
      setCloudSyncMessage("📡 Verbinde mit SQLite-Datenbank...");
      try {
        const cloudSessions = await loadSessionsFromCloud();
        if (cloudSessions.length > 0) {
          const enriched = cloudSessions.map(enrichSessionWithAdvancedMetrics);
          setLoadedFiles(enriched);
          setCloudSyncMessage(`📂 ${cloudSessions.length} Sitzungen erfolgreich geladen! (Dauerhaft in der Datenbank hinterlegt)`);
        } else {
          setCloudSyncMessage("ℹ️ Keine Sitzungen in der Datenbank gefunden. Lade Dateien hoch, um sie automatisch zu speichern.");
        }
      } catch (err: any) {
        console.error("Fehler beim Laden aus der Datenbank:", err);
        setCloudSyncMessage("⚠️ Datenbank-Laden fehlgeschlagen. Lokale RAM-Speicherung aktiv.");
      } finally {
        setIsCloudSyncing(false);
        // Nachricht nach 6 Sekunden ausblenden
        setTimeout(() => setCloudSyncMessage(null), 6000);
      }
    }
    loadCloudSessions();
  }, []);

  // Lazy-load notes and heavy fields when a specific session is selected
  useEffect(() => {
    async function loadNotesForSelection() {
      const targetSession = selectedFileIdx !== null ? loadedFiles[selectedFileIdx] : null;
      if (!targetSession || !targetSession.cloudDocId) return;
      if (targetSession.notes.length > 0) return; // schon geladen

      try {
        const sessionData = await loadSessionNotesFromCloud(targetSession.cloudDocId);
        setLoadedFiles(prev => {
          const copy = [...prev];
          const idx = copy.findIndex(f => f.cloudDocId === targetSession.cloudDocId);
          if (idx !== -1) {
            copy[idx] = {
              ...copy[idx],
              notes: sessionData.notes,
              notesCount: sessionData.notes.length,
              teacherStudentSplit: sessionData.teacherStudentSplit,
              slidingTempo: sessionData.slidingTempo,
              pedalAnalysis: sessionData.pedalAnalysis,
            };
          }
          return copy;
        });
      } catch (err) {
        console.warn("Fehler beim Laden der Noten:", err);
      }
    }
    loadNotesForSelection();
  }, [selectedFileIdx]);
  const handleSaveToCloud = async (session: AlsFileStats, index: number) => {
    setIsCloudSaving(session.fileName);
    setCloudSyncMessage(`Speichere '${session.fileName}'...`);
    try {
      const docId = await saveSessionToCloud(session);
      
      setLoadedFiles(prev => {
        const copy = [...prev];
        const fIdx = prev.findIndex(p => p.fileName === session.fileName && p.date === session.date);
        if (fIdx !== -1) {
          copy[fIdx] = {
            ...copy[fIdx],
            cloudDocId: docId
          };
        }
        return copy;
      });
      
      setCloudSyncMessage(`✓ '${session.fileName}' dauerhaft in der Datenbank gesichert!`);
    } catch (err: any) {
      console.error(err);
      setErrorString(`DB-Fehler beim Speichern: ${err.message || err}`);
    } finally {
      setIsCloudSaving(null);
      setTimeout(() => setCloudSyncMessage(null), 4000);
    }
  };

  const handleDeleteFromCloud = async (session: AlsFileStats) => {
    if (!session.cloudDocId) return;
    if (!confirm(`Sitzung '${session.fileName}' wirklich dauerhaft aus der Datenbank löschen?`)) return;
    
    setIsCloudSyncing(true);
    setCloudSyncMessage(`Lösche '${session.fileName}'...`);
    try {
      await deleteSessionFromCloud(session.cloudDocId);
      
      setLoadedFiles(prev => {
        const copy = [...prev];
        const fIdx = prev.findIndex(p => p.fileName === session.fileName && p.date === session.date);
        if (fIdx !== -1) {
          delete copy[fIdx].cloudDocId;
        }
        return copy;
      });
      
      setCloudSyncMessage(`✓ '${session.fileName}' erfolgreich aus der Datenbank gelöscht!`);
    } catch (err: any) {
      console.error(err);
      setErrorString(`DB-Fehler beim Löschen: ${err.message || err}`);
    } finally {
      setIsCloudSyncing(false);
      setTimeout(() => setCloudSyncMessage(null), 4000);
    }
  };

  // Alle ungesicherten Sessions nacheinander in die Datenbank speichern (Bulk-Upload)
  const handleSaveAllToCloud = async () => {
    const unsaved = loadedFiles.filter(f => !f.cloudDocId);
    if (unsaved.length === 0) return;
    
    setIsCloudSyncing(true);
    setCloudSyncMessage(`Sichere ${unsaved.length} Sitzungen in der Datenbank...`);
    let successCount = 0;
    try {
      for (let i = 0; i < unsaved.length; i++) {
        const session = unsaved[i];
        setCloudSyncMessage(`Sichere (${i + 1}/${unsaved.length}): '${session.fileName}'...`);
        const docId = await saveSessionToCloud(session);
        
        setLoadedFiles(prev => {
          const copy = [...prev];
          const fIdx = prev.findIndex(p => p.fileName === session.fileName && p.date === session.date);
          if (fIdx !== -1) {
            copy[fIdx] = {
              ...copy[fIdx],
              cloudDocId: docId
            };
          }
          return copy;
        });
        successCount++;
      }
      setCloudSyncMessage(`✓ Alle ${successCount} Sitzungen erfolgreich in der Datenbank gesichert!`);
    } catch (err: any) {
      console.error(err);
      setErrorString(`Fehler bei Massensicherung: ${err.message || err}. ${successCount} Sitzungen gesichert.`);
    } finally {
      setIsCloudSyncing(false);
      setTimeout(() => setCloudSyncMessage(null), 6000);
    }
  };

  // --- Stundenplan (Schedule) ---
  const defaultSchedule: ScheduleEntry[] = [
    { weekday: 1, time: '14:00', studentName: '', duration: 30 },
    { weekday: 1, time: '14:30', studentName: '', duration: 30 },
    { weekday: 2, time: '14:00', studentName: '', duration: 30 },
    { weekday: 2, time: '14:30', studentName: '', duration: 30 },
    { weekday: 3, time: '14:00', studentName: '', duration: 30 },
    { weekday: 3, time: '14:30', studentName: '', duration: 30 },
    { weekday: 4, time: '14:00', studentName: '', duration: 30 },
    { weekday: 4, time: '14:30', studentName: '', duration: 30 },
    { weekday: 5, time: '14:00', studentName: '', duration: 30 },
    { weekday: 5, time: '14:30', studentName: '', duration: 30 },
  ];
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(() => {
    try {
      const saved = localStorage.getItem('schedule');
      return saved ? JSON.parse(saved) : defaultSchedule;
    } catch { return defaultSchedule; }
  });
  const handleScheduleChange = (s: ScheduleEntry[]) => {
    setSchedule(s);
    localStorage.setItem('schedule', JSON.stringify(s));
  };

  // --- Vergleichsmodus (Compare Mode) ---
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [comparedIndices, setComparedIndices] = useState<number[]>([]);

  // Lazy-load in compare mode (muss nach comparedIndices kommen)
  useEffect(() => {
    async function loadNotesForCompare() {
      if (!compareMode) return;
      for (const idx of comparedIndices) {
        const session = loadedFiles[idx];
        if (!session || !session.cloudDocId) continue;
        if (session.notes.length > 0) continue;
        try {
          const sessionData = await loadSessionNotesFromCloud(session.cloudDocId);
          setLoadedFiles(prev => {
            const copy = [...prev];
            const fIdx = copy.findIndex(f => f.cloudDocId === session.cloudDocId);
            if (fIdx !== -1) {
              copy[fIdx] = {
                ...copy[fIdx],
                notes: sessionData.notes,
                notesCount: sessionData.notes.length,
                teacherStudentSplit: sessionData.teacherStudentSplit,
                slidingTempo: sessionData.slidingTempo,
                pedalAnalysis: sessionData.pedalAnalysis,
              };
            }
            return copy;
          });
        } catch (err) {
          console.warn("Fehler beim Laden der Noten:", err);
        }
      }
    }
    loadNotesForCompare();
  }, [compareMode, comparedIndices]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Monatsliste ---
  const MONTHS = [
    { label: "Gesamtes Halbjahr", value: "ALL" },
    { label: "Januar", value: "0" },
    { label: "Februar", value: "1" },
    { label: "März", value: "2" },
    { label: "April", value: "3" },
    { label: "Mai", value: "4" },
    { label: "Juni", value: "5" }
  ];

  // --- Dateihandling ---
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processUploadedFiles(e.target.files);
    }
  };

  const [processingProgress, setProcessingProgress] = useState<string | null>(null);

  const processUploadedFiles = async (files: FileList) => {
    setIsParsing(true);
    setErrorString(null);
    setProcessingProgress("Initialisiere...");
    const parsedSessions: AlsFileStats[] = [];

    // Sortiere die hochgeladenen Dateien alphabetisch/numerisch (z.B. Tag1, Tag2 oder Lektion1, Lektion2)
    const sortedFiles = Array.from(files).sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      const validExtensions = ['als', 'mid', 'midi', 'band', 'zip', 'mp3', 'wav', 'm4a', 'caf'];
      if (!ext || !validExtensions.includes(ext)) {
        setErrorString(`Datei '${file.name}' übersprungen: Ungültige Endung. Unterstützt werden .als, .mid, .midi, .band, .zip, .mp3, .wav, .m4a und .caf.`);
        continue;
      }
      try {
        setProcessingProgress(`Lese ${i + 1}/${sortedFiles.length}: ${file.name}`);
        const raw = await parseAlsFile(file);
        await new Promise(r => setTimeout(r, 0));

        setProcessingProgress(`BPM-Analyse ${i + 1}/${sortedFiles.length}: ${file.name}`);
        const analysis = analyzeSessionMidiStats(raw.notes, raw.tempo);
        const merged: AlsFileStats = {
          ...raw,
          estimatedBpm: analysis.estimatedBpm,
          avgDriftMs: analysis.avgDriftMs,
          swingFactor16th: analysis.swingFactor16th,
          notes: analysis.notes,
          styleCategory: analysis.styleCategory,
          structureCategory: analysis.structureCategory,
          estimatedKey: analysis.estimatedKey,
          bpmSegments: analysis.bpmSegments
        };
        await new Promise(r => setTimeout(r, 0));

        setProcessingProgress(`Feinanalyse ${i + 1}/${sortedFiles.length}: ${file.name}`);
        const enriched = enrichSessionWithAdvancedMetrics(merged);

        setProcessingProgress(`Lehrer/Schüler-Split ${i + 1}/${sortedFiles.length}: ${file.name}`);
        const split = separateTeacherStudent(enriched.notes);
        enriched.teacherStudentSplit = split;

        enriched.focusScore = computeFocusScore(enriched);

        parsedSessions.push(enriched);
        await new Promise(r => setTimeout(r, 0));
      } catch (err: any) {
        console.error(err);
        setErrorString(`Fehler beim Verarbeiten von '${file.name}': ${err.message || err}.`);
      }
    }

    setProcessingProgress("Aktualisiere Ansicht...");

    if (parsedSessions.length > 0) {
      setLoadedFiles(prev => {
        const updated = [...prev];
        const existingDates = new Set<string>(prev.map(p => p.date));

        // Hilfsfunktion zur Ermittlung des nächsten freien Tages im Kalender
        const findNextAvailableDate = (baseDateStr: string, takenDates: Set<string>): string => {
          let curr = new Date(baseDateStr);
          let attempts = 0;
          while (takenDates.has(curr.toISOString().split("T")[0]) && attempts < 100) {
            curr.setDate(curr.getDate() + 1);
            attempts++;
          }
          return curr.toISOString().split("T")[0];
        };

        parsedSessions.forEach(session => {
          // Falls die Datei denselben Namen hat, aktualisieren wir sie (ersetzen)
          const duplicateNameIdx = updated.findIndex(p => p.fileName === session.fileName);
          if (duplicateNameIdx !== -1) {
            // Behalte das ursprüngliche Datum der bestehenden Datei, damit sie an ihrem Platz bleibt
            session.date = updated[duplicateNameIdx].date;
            // Behalte die bestehende cloudDocId, falls vorhanden, damit die Datei markiert bleibt
            if (updated[duplicateNameIdx].cloudDocId) {
              session.cloudDocId = updated[duplicateNameIdx].cloudDocId;
            }
            updated[duplicateNameIdx] = session;
          } else {
            // Es ist eine neue Datei: falls das Datum bereits belegt ist, weichen wir auf den nächsten freien Tag aus!
            if (existingDates.has(session.date)) {
              const freeDate = findNextAvailableDate(session.date, existingDates);
              session.date = freeDate;
            }
            existingDates.add(session.date);
            updated.push(session);
          }
        });

        return updated.sort((a, b) => a.date.localeCompare(b.date));
      });
    }
    setProcessingProgress(null);
    setIsParsing(false);
  };

  // Drag and Drop Zone Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processUploadedFiles(e.dataTransfer.files);
    }
  };

  const handleToggleCompareFile = (idx: number) => {
    setComparedIndices(prev => {
      if (prev.includes(idx)) {
        return prev.filter(i => i !== idx);
      } else {
        if (prev.length >= 2) {
          return [prev[1], idx]; // Shift the selection
        }
        return [...prev, idx];
      }
    });
  };

  // --- Filtering ---
  // 1. Erst nach Monat filtern
  const filteredByMonth = useMemo(() => {
    if (selectedMonth === "ALL") return loadedFiles;
    const monthIndex = parseInt(selectedMonth);
    return loadedFiles.filter(file => {
      const dateObj = new Date(file.date);
      return dateObj.getMonth() === monthIndex;
    });
  }, [loadedFiles, selectedMonth]);

  // 2. Einzelne gezielte Dateiauswahl berücksichtigen
  const activeViewSessions = useMemo(() => {
    if (compareMode && comparedIndices.length === 2) {
      return [loadedFiles[comparedIndices[0]], loadedFiles[comparedIndices[1]]].filter(Boolean);
    }
    if (selectedFileIdx !== null) {
      const actualFile = loadedFiles[selectedFileIdx];
      if (actualFile) {
        // Falls das ausgewählte File nicht im aktuellen gefilterten Monat liegt, heben wir die Monatsbeschränkung auf
        const fileMonth = new Date(actualFile.date).getMonth().toString();
        if (selectedMonth !== "ALL" && selectedMonth !== fileMonth) {
          return [actualFile];
        }
        return [actualFile];
      }
    }
    return filteredByMonth;
  }, [loadedFiles, filteredByMonth, selectedFileIdx, selectedMonth, compareMode, comparedIndices]);

  // --- Filter sessions & their notes by Velocity ---
  const filteredViewSessions = useMemo(() => {
    return activeViewSessions.map(session => {
      const matchedNotes = session.notes.filter(note => note.velocity >= minVelocity && note.velocity <= maxVelocity);
      const avgVelocity = matchedNotes.length > 0 
        ? Math.round(matchedNotes.reduce((sum, n) => sum + n.velocity, 0) / matchedNotes.length) 
        : 0;
      const avgDriftMs = matchedNotes.length > 0 
        ? matchedNotes.reduce((sum, n) => sum + n.gridOffsetMs, 0) / matchedNotes.length 
        : 0;
      return {
        ...session,
        notes: matchedNotes,
        notesCount: matchedNotes.length,
        avgVelocity,
        avgDriftMs
      };
    });
  }, [activeViewSessions, minVelocity, maxVelocity]);

  // --- Global Stats der aktuell gefilterten View ---
  const totals = useMemo(() => {
    const sessions = filteredViewSessions;
    const sessionCount = sessions.length;
    
    if (sessionCount === 0) {
      return { notesCount: 0, avgTempo: 0, avgVelocity: 0, avgDriftMs: 0, avgSwing: 0 };
    }

    const notesCount = sessions.reduce((sum, s) => sum + s.notesCount, 0);
    const avgTempo = sessions.reduce((sum, s) => sum + (s.estimatedBpm ?? s.tempo), 0) / sessionCount;
    const avgVelocity = sessions.reduce((sum, s) => sum + s.avgVelocity, 0) / sessionCount;
    const avgDriftMs = sessions.reduce((sum, s) => sum + s.avgDriftMs, 0) / sessionCount;
    const avgSwing = sessions.reduce((sum, s) => sum + s.swingFactor16th, 0) / sessionCount;

    return {
      notesCount,
      avgTempo: parseFloat(avgTempo.toFixed(1)),
      avgVelocity: Math.round(avgVelocity),
      avgDriftMs: parseFloat(avgDriftMs.toFixed(2)),
      avgSwing: parseFloat(avgSwing.toFixed(1))
    };
  }, [filteredViewSessions]);

  // --- Spurenanalyse (Track-by-Track-Vergleich) ---
  const trackAnalysis = useMemo(() => {
    const table: { [name: string]: { totalNotes: number, totalDriftMs: number, avgVel: number, name: string } } = {};
    filteredViewSessions.forEach(session => {
      session.notes.forEach(note => {
        const trName = note.trackName || "Haupt-Sequenzer";
        if (!table[trName]) {
          table[trName] = { totalNotes: 0, totalDriftMs: 0, avgVel: 0, name: trName };
        }
        table[trName].totalNotes++;
        table[trName].totalDriftMs += Math.abs(note.gridOffsetMs);
        table[trName].avgVel += note.velocity;
      });
    });

    const entries = Object.values(table).map(entry => {
      return {
        name: entry.name,
        notesCount: entry.totalNotes,
        avgDriftMs: parseFloat((entry.totalDriftMs / entry.totalNotes).toFixed(2)),
        avgVelocity: Math.round(entry.avgVel / entry.totalNotes)
      };
    });

    // Filtern nach Suchbegriff
    if (trackSearch.trim() !== "") {
      return entries.filter(tr => tr.name.toLowerCase().includes(trackSearch.toLowerCase()));
    }

    return entries.sort((a, b) => b.notesCount - a.notesCount);
  }, [filteredViewSessions, trackSearch]);

  // --- Downloader für CSV ---
  const handleDownloadCsv = () => {
    if (loadedFiles.length === 0) return;
    const csvContent = convertToCsv(activeViewSessions);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `ableton_midi_export_${selectedMonth === "ALL" ? "halbjahr" : `monat_${selectedMonth}`}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Downloader für SQLite SQL Script ---
  const handleDownloadSql = () => {
    if (loadedFiles.length === 0) return;
    const sqlContent = generateSqlScript(activeViewSessions);
    const blob = new Blob([sqlContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ableton_midi_database_import.sql");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Downloader für den Python Code ---
  const handleDownloadPythonScript = () => {
    const blob = new Blob([pythonScriptText], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ableton_midi_analyzer.py");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Skript kopieren ---
  const handleCopyScriptToClipboard = () => {
    navigator.clipboard.writeText(pythonScriptText).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/20 selection:text-indigo-200">
      
      {/* 1. TOP NAV / HEADER */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm sticky top-0 z-50 px-8 py-6" id="main-header">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-2.5 rounded font-bold flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tighter uppercase text-white flex flex-wrap items-baseline gap-2">
                MIDI ANALYSE - HALBES JAHR MUSIKUNTERRICHT
                <span className="text-[10px] bg-indigo-600 text-white font-mono font-bold px-2 py-0.5 rounded tracking-wider">v2.0-DARK</span>
              </h1>
              <p className="text-xs text-slate-500 font-mono tracking-widest mt-0.5 uppercase">
                SYSTEM_STATUS: ACTIVE // CLIENT-SIDE ANALYSIS
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex bg-slate-800/60 p-1 rounded border border-slate-700/50">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer ${activeTab === "dashboard" ? 'bg-slate-950 text-indigo-300 border border-slate-600 shadow-sm font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>DASHBOARD</span>
            </button>
            <button
              onClick={() => setActiveTab("visualizer")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer relative ${activeTab === "visualizer" ? 'bg-slate-950 text-indigo-300 border border-slate-600 shadow-sm font-bold' : 'text-indigo-400 hover:text-indigo-200'}`}
              id="tab-visualizer-button"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>VISUALIZER ✨</span>
            </button>
            <button
              onClick={() => setActiveTab("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer ${activeTab === "calendar" ? 'bg-slate-950 text-indigo-300 border border-slate-600 shadow-sm font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>KALENDER</span>
            </button>
            <button
              onClick={() => setActiveTab("progress")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer ${activeTab === "progress" ? 'bg-slate-950 text-indigo-300 border border-slate-600 shadow-sm font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <User className="w-3.5 h-3.5" />
              <span>FORTSCHRITT</span>
            </button>
            <button
              onClick={() => setActiveTab("database")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer ${activeTab === "database" ? 'bg-slate-950 text-indigo-300 border border-slate-600 shadow-sm font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>DATEN</span>
            </button>
            <button
              onClick={() => setActiveTab("python")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer ${activeTab === "python" ? 'bg-slate-950 text-indigo-300 border border-slate-600 shadow-sm font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>PYTHON</span>
            </button>
          </div>

        </div>
      </header>

      {/* 2. MAIN GRID LAYOUT */}
      <main className="flex-grow max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col gap-6">

        {/* --- DOCK: UPLOADER & DEMO CONTROLLER --- */}
        <section className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 md:p-8 flex flex-col md:flex-row items-stretch gap-8" id="ops-dock">
          
          {/* Linker Flügel: Drag and Drop Uploader */}
          <div className="flex-1 flex flex-col">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-1.5 font-mono">
              <Upload className="w-3.5 h-3.5 text-indigo-400" />
              01 // ALS PARSE & IMPORT
            </h2>
            
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex-grow border-2 border-dashed rounded p-6 flex flex-col items-center justify-center text-center transition-all cursor-pointer hover:bg-slate-800/40 relative ${dragActive ? 'border-indigo-500 bg-slate-800/60' : 'border-slate-600 hover:border-slate-500 bg-slate-800/20'}`}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                multiple 
                accept="*/*" 
                className="hidden" 
              />
              <FileUp className={`w-8 h-8 mb-2 transition-transform duration-300 ${dragActive ? 'scale-110 text-indigo-400' : 'text-slate-500'}`} />
              
              <span className="text-xs font-semibold text-slate-200">Dateien einspielen (.als, .mid, .midi, .band, .zip, .mp3, .wav, .m4a, .caf)</span>
              <span className="text-[10px] text-slate-500 font-serif italic mt-1 leading-normal max-w-xs">
                Zieh Ableton (.als), MIDI, GarageBand (.band, .zip) oder Klick-freies Audio hierhin.
              </span>
            </div>
          </div>

          {/* Rechter Flügel: Steuerung & Filter */}
          <div className="md:w-1/2 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-700/50 pt-6 md:pt-0 md:pl-8">
            <div>
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  02 // STEUERUNG & FILTER
                </h2>
                {loadedFiles.length > 0 && (
                  <button 
                    onClick={() => { setLoadedFiles([]); setSelectedFileIdx(null); setSelectedMonth("ALL"); setCompareMode(false); setComparedIndices([]); }}
                    className="text-[10px] text-red-400 hover:text-red-300 font-mono flex items-center gap-1 cursor-pointer underline"
                  >
                    <RotateCcw className="w-3 h-3" />
                    RESET
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {loadedFiles.length > 0 && (
                <div className="w-full flex flex-col gap-2.5 font-mono text-xs">
                  {/* Monatsfilter */}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 w-20 uppercase font-bold text-[10px] tracking-wider">Monat:</span>
                    <select 
                      value={selectedMonth}
                      onChange={(e) => { setSelectedMonth(e.target.value); setSelectedFileIdx(null); }}
                      className="flex-1 bg-slate-800 border border-slate-600 focus:border-indigo-500 text-slate-200 py-1.5 px-2.5 rounded text-xs focus:outline-none"
                    >
                      {MONTHS.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Einzeldateien/Sessions-Selektor */}
                  {!compareMode && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 w-20 uppercase font-bold text-[10px] tracking-wider">Sitzung:</span>
                      <select 
                        value={selectedFileIdx === null ? "ALL" : selectedFileIdx.toString()}
                        onChange={(e) => setSelectedFileIdx(e.target.value === "ALL" ? null : parseInt(e.target.value))}
                        className="flex-1 bg-slate-800 border border-slate-600 focus:border-indigo-500 text-slate-200 py-1.5 px-2.5 rounded text-xs focus:outline-none"
                      >
                        <option value="ALL">Alle ({filteredByMonth.length} Dateien)</option>
                         {loadedFiles.map((f, idx) => {
                          const fMonth = new Date(f.date).getMonth().toString();
                          if (selectedMonth !== "ALL" && selectedMonth !== fMonth) return null;
                          
                          const isHighDrift = f.avgDriftMs > 30;
                          const cloudIndicator = f.cloudDocId ? "☁️ " : "💻 ";
                          const keyText = f.estimatedKey ? ` [${f.estimatedKey}]` : " [C-Dur]";
                          const displayName = f.fileName.length > 20 ? f.fileName.slice(0, 20) + "..." : f.fileName;
                          return (
                            <option key={idx} value={idx}>
                              {cloudIndicator}{isHighDrift ? "⚠️ " : ""}[{f.date}] {displayName}{keyText} ({f.avgDriftMs.toFixed(1)}ms)
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {/* Geschwindigkeit (Velocity / Anschlagsstärke) Filter */}
                  <div className="flex flex-col gap-1 mt-1.5 pt-2.5 border-t border-slate-700/50" id="velocity-filter-section">
                    <span className="text-slate-400 uppercase font-bold text-[10px] tracking-wider mb-2 flex justify-between items-center font-mono">
                      <span>⚡ Velocity-Filter:</span>
                      <span className="text-slate-300 font-bold bg-slate-800 px-2 py-0.5 rounded text-[9px] border border-slate-600">
                        {minVelocity} - {maxVelocity} Vel
                      </span>
                    </span>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col flex-grow gap-1">
                          <div className="flex justify-between items-center text-[8.5px] font-mono text-slate-500 font-bold">
                            <span>MIN</span>
                            <span>{minVelocity}</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="127" 
                            value={minVelocity} 
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setMinVelocity(val);
                              if (val > maxVelocity) setMaxVelocity(val);
                            }}
                            className="w-full accent-indigo-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                        <div className="flex flex-col flex-grow gap-1">
                          <div className="flex justify-between items-center text-[8.5px] font-mono text-slate-500 font-bold">
                            <span>MAX</span>
                            <span>{maxVelocity}</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="127" 
                            value={maxVelocity} 
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setMaxVelocity(val);
                              if (val < minVelocity) setMinVelocity(val);
                            }}
                            className="w-full accent-indigo-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      </div>
                      
                      {/* Presets */}
                      <div className="flex gap-1.5 justify-end font-mono">
                        <button 
                          onClick={() => { setMinVelocity(0); setMaxVelocity(127); }}
                          className={`px-2 py-1 rounded text-[8.5px] border cursor-pointer font-bold transition-all ${minVelocity === 0 && maxVelocity === 127 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300'}`}
                        >
                          ALLE
                        </button>
                        <button 
                          onClick={() => { setMinVelocity(0); setMaxVelocity(50); }}
                          className={`px-2 py-1 rounded text-[8.5px] border cursor-pointer font-bold transition-all ${minVelocity === 0 && maxVelocity === 50 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300'}`}
                        >
                          GHOST (&lt;50)
                        </button>
                        <button 
                          onClick={() => { setMinVelocity(51); setMaxVelocity(95); }}
                          className={`px-2 py-1 rounded text-[8.5px] border cursor-pointer font-bold transition-all ${minVelocity === 51 && maxVelocity === 95 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300'}`}
                        >
                          MID (51-95)
                        </button>
                        <button 
                          onClick={() => { setMinVelocity(96); setMaxVelocity(127); }}
                          className={`px-2 py-1 rounded text-[8.5px] border cursor-pointer font-bold transition-all ${minVelocity === 96 && maxVelocity === 127 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300'}`}
                        >
                          ACCENT (&gt;95)
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Vergleichsmodus */}
                  <div className="flex flex-col gap-2 mt-1.5 pt-2 border-t border-slate-700/50">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-300 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={compareMode}
                        onChange={(e) => {
                          setCompareMode(e.target.checked);
                          if (e.target.checked) {
                            setSelectedFileIdx(null);
                          } else {
                            setComparedIndices([]);
                          }
                        }}
                        className="rounded border-slate-600 text-indigo-500 focus:ring-indigo-500 w-4 h-4 cursor-pointer bg-slate-800"
                      />
                      <span>🔄 Session-Direktvergleich (A/B)</span>
                    </label>

                    {compareMode && (
                      <div className="mt-1 space-y-2">
                        <span className="text-[10px] text-slate-500 font-serif italic block leading-relaxed">
                          Markiere <strong className="text-indigo-400 font-bold">2 Sessions</strong> per Checkbox:
                        </span>
                        
                        <div className="max-h-36 overflow-y-auto border border-slate-700 rounded p-2 bg-slate-800/40 space-y-1 scrollbar-thin">
                          {loadedFiles.map((f, idx) => {
                            const fMonth = new Date(f.date).getMonth().toString();
                            if (selectedMonth !== "ALL" && selectedMonth !== fMonth) return null;

                            const isChecked = comparedIndices.includes(idx);
                            const isHighDrift = f.avgDriftMs > 30;
                            return (
                              <label 
                                key={idx} 
                                className={`flex items-center justify-between gap-2.5 p-1.5 rounded transition-all cursor-pointer text-[10px] font-mono border ${
                                  isChecked 
                                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50 font-semibold' 
                                    : 'bg-slate-800/60 hover:bg-slate-700/40 text-slate-400 border-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input 
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleCompareFile(idx)}
                                    className="rounded border-slate-600 text-indigo-500 focus:ring-indigo-500 w-3.5 h-3.5 bg-slate-800"
                                  />
                                  <span className="truncate">
                                    [{f.date}] {f.fileName.length > 25 ? f.fileName.slice(0, 25) + "..." : f.fileName}
                                  </span>
                                </div>
                                <span className={`text-[9px] font-bold shrink-0 ${isChecked ? 'text-indigo-300 font-bold' : isHighDrift ? 'text-red-400' : 'text-slate-500'}`}>
                                  {f.avgDriftMs.toFixed(1)}ms
                                </span>
                              </label>
                            );
                          })}
                        </div>

                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono mt-1">
                          <span>Ausgewählt: {comparedIndices.length} / 2</span>
                          {comparedIndices.length === 2 ? (
                            <span className="text-emerald-400 font-bold flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                              ✓ Vergleich bereit!
                            </span>
                          ) : (
                            <span className="text-amber-400 font-semibold">Noch {2 - comparedIndices.length} wählen</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Datenbank-Sicherung */}
                  {loadedFiles.some(f => !f.cloudDocId) && (
                    <div className="mt-4 pt-3 border-t border-slate-700/50 flex flex-col gap-2" id="bulk-cloud-actions">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 uppercase font-bold text-[9px] tracking-wider font-mono flex items-center gap-1">
                          <Database className="w-3 h-3 text-sky-400" />
                          Datenbank ({loadedFiles.filter(f => !f.cloudDocId).length} ungesichert)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                        <button
                          id="btn-save-all-cloud"
                          onClick={handleSaveAllToCloud}
                          disabled={isCloudSyncing}
                          className="w-full h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-bold px-2 rounded border border-emerald-500 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <CloudUpload className="w-3.5 h-3.5" />
                          ALLE IN DB SPEICHERN
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Alle Daten aus DB laden */}
                  {loadedFiles.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-col gap-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                        <button
                          id="btn-load-all-cloud"
                          onClick={async () => {
                            setIsCloudSyncing(true);
                            setCloudSyncMessage("📡 Lade alle Sessions nacheinander...");
                            const { loadSessionNotesFromCloud } = await import('./firebase');
                            let loaded = 0;
                            const total = loadedFiles.filter(s => s.cloudDocId && s.notes.length === 0).length;
                            if (total === 0) {
                              setCloudSyncMessage("✓ Alle Sessions bereits geladen.");
                              setTimeout(() => setCloudSyncMessage(null), 2000);
                              setIsCloudSyncing(false);
                              return;
                            }
                            for (const session of loadedFiles) {
                              if (!session.cloudDocId || session.notes.length > 0) continue;
                              try {
                                const sessionData = await loadSessionNotesFromCloud(session.cloudDocId);
                                setLoadedFiles(prev => {
                                  const copy = [...prev];
                                  const idx = copy.findIndex(s => s.cloudDocId === session.cloudDocId);
                                  if (idx !== -1) {
                                    copy[idx] = {
                                      ...copy[idx],
                                      notes: sessionData.notes,
                                      notesCount: sessionData.notes.length,
                                      teacherStudentSplit: sessionData.teacherStudentSplit,
                                      slidingTempo: sessionData.slidingTempo,
                                      pedalAnalysis: sessionData.pedalAnalysis,
                                    };
                                  }
                                  return copy;
                                });
                                loaded++;
                                setCloudSyncMessage(`📡 Lade Sessions... ${loaded}/${total}`);
                              } catch (err) {
                                console.warn(`Fehler bei ${session.fileName}:`, err);
                              }
                            }
                            setCloudSyncMessage(`✓ ${loaded} Sessions vollständig geladen!`);
                            setTimeout(() => setCloudSyncMessage(null), 4000);
                            setIsCloudSyncing(false);
                          }}
                          disabled={isCloudSyncing}
                          className="w-full h-9 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-[10px] font-bold px-2 rounded border border-indigo-500/50 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Database className="w-3.5 h-3.5" />
                          ALLE AUS DB LADEN ({loadedFiles.filter(s => s.cloudDocId && s.notes.length === 0).length} fehlen)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </section>

        {/* FEEDBACK BANNERS */}
        {cloudSyncMessage && (
          <div className="bg-slate-900/80 border border-slate-700/50 text-slate-100 rounded-lg p-4 text-xs font-mono flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <Cloud className="w-4 h-4 text-sky-400 animate-pulse shrink-0" />
              <span>{cloudSyncMessage}</span>
            </div>
            {isCloudSyncing && (
              <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />
            )}
          </div>
        )}

        {errorString && (
          <div className="bg-red-900/30 border border-red-800/50 rounded-lg p-4 text-red-300 text-xs font-mono flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p>{errorString}</p>
          </div>
        )}

        {isParsing && (
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 text-slate-300 text-xs font-mono flex items-center gap-3">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-slate-300 animate-spin"></div>
            <span>{processingProgress || "Verarbeite Dateien..."}</span>
          </div>
        )}

        {/* --- GLOBAL STATISTICS BOARD --- */}
        {loadedFiles.length > 0 && (
          <motion.div 
            key={`stats-${activeViewSessions.length}-${selectedFileIdx}-${selectedMonth}`}
            variants={statsContainerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 lg:grid-cols-6 gap-6" 
            id="stats-boards"
          >
            
            <motion.div variants={statsCardVariants} className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-5 flex flex-col justify-between" id="card-sessions">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Sessions</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-light leading-none text-white">
                  <CountUp end={activeViewSessions.length} decimals={0} id="val-sessions" />
                </span>
                <span className="text-slate-400 text-xs">Files</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-2 flex items-center gap-1 font-mono uppercase">
                <Calendar className="w-3 h-3 text-slate-500" />
                JAN - JUN 2026
              </div>
            </motion.div>

            <motion.div variants={statsCardVariants} className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-5 flex flex-col justify-between" id="card-midi">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">MIDI Events</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-light leading-none text-white">
                  <CountUp end={totals.notesCount} decimals={0} id="val-midi" />
                </span>
                <span className="text-slate-400 text-xs">Notes</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-2 flex items-center gap-1 font-mono uppercase">
                <Layers className="w-3 h-3 text-slate-500" />
                Grid [1/16 Note]
              </div>
            </motion.div>

            <motion.div variants={statsCardVariants} className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-5 flex flex-col justify-between" id="card-drift">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Drift-Abw</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-light leading-none text-red-400 font-bold">
                  <CountUp end={totals.avgDriftMs} decimals={2} id="val-drift" />
                </span>
                <span className="text-slate-400 text-xs">ms</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-2 flex items-center gap-1 font-mono uppercase">
                <TrendingUp className="w-3 h-3 text-red-400" />
                Jitter Drift
              </div>
            </motion.div>

            <motion.div variants={statsCardVariants} className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-5 flex flex-col justify-between" id="card-swing">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Swing (μ)</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-light leading-none text-white">
                  <CountUp end={totals.avgSwing} decimals={1} id="val-swing" />
                </span>
                <span className="text-slate-400 text-xs">%</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-2 flex items-center gap-1 font-mono uppercase">
                <Sliders className="w-3 h-3 text-slate-500" />
                μ Swing Factor
              </div>
            </motion.div>

            <motion.div variants={statsCardVariants} className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-5 col-span-2 lg:col-span-1 flex flex-col justify-between" id="card-tempo">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Tempo (ø)</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-light leading-none text-white">
                  <CountUp end={totals.avgTempo} decimals={1} id="val-tempo" />
                </span>
                <span className="text-slate-400 text-xs">BPM</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-2 flex items-center gap-1 font-mono uppercase">
                <Music className="w-3 h-3 text-slate-500" />
                PROJECT SPEED
              </div>
            </motion.div>
            <motion.div variants={statsCardVariants} className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-5 flex flex-col justify-between" id="card-focus">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Focus Score (ø)</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-light leading-none text-indigo-300">
                  <CountUp end={(() => {
                    const scores = activeViewSessions.filter(s => s.focusScore !== undefined).map(s => s.focusScore!) || [];
                    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                  })()} decimals={0} id="val-focus" />
                </span>
                <span className="text-slate-400 text-xs">/ 100</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-2 flex items-center gap-1 font-mono uppercase">
                <TrendingUp className="w-3 h-3 text-indigo-400" />
                QUALITÄTSINDEX
              </div>
            </motion.div>

          </motion.div>
        )}

        {/* --- DYNAMIC WORKSPACE TABS INTERACTION --- */}
        <div className="flex-grow">
          {loadedFiles.length === 0 ? (
            <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-12 text-center flex flex-col items-center justify-center" id="empty-state">
              <div className="bg-slate-800 p-4 rounded-full border border-slate-600 text-slate-500 mb-4">
                <Sliders className="w-10 h-10" />
              </div>
              <h3 className="text-base font-medium tracking-tight text-slate-200 uppercase">System Status: Idle</h3>
              <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed italic font-serif">
                Der ALS Timing Analyzer liest Ableton Live Midi-Noten und misst Nuancen unterhalb der Millisekundengrenze. Importieren Sie eine .als, .midi oder Audio-Datei, um die Grafiken und Exportoptionen freizuschalten.
              </p>
              
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-lg w-full text-left font-mono">
                <div className="bg-slate-800 border border-slate-700 p-4 rounded text-slate-400 text-[11px] leading-relaxed">
                  <span className="text-slate-200 font-bold block mb-1">🎯 RHYTHMUS-DRIFT</span>
                  Analysiert, wie viele Millisekunden Sie vor oder hinter dem geraden Grid liegen. Erkennen Sie Ihren individuellen "Treibend- oder Laid-Back"-Stil.
                </div>
                <div className="bg-slate-800 border border-slate-700 p-4 rounded text-slate-400 text-[11px] leading-relaxed">
                  <span className="text-slate-200 font-bold block mb-1">🎹 PIANO ROLL DETAILS</span>
                  Wählen Sie spezifische Tasten aus, um den zeitgleichen Groove von Snare, Kick oder Lead-Akkorden isoliert darzustellen.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              
              {/* --- TAB 1: VISUAL DASHBOARD --- */}
              {activeTab === "dashboard" && (
                <div className="space-y-6 animate-fade-in" id="tab-dashboard-view">
                  
                  {/* Session-Direktvergleich */}
                  {compareMode && comparedIndices.length === 2 && (
                    <SessionComparison 
                      sessionA={filteredViewSessions[0]} 
                      sessionB={filteredViewSessions[1]} 
                      onClose={() => {
                        setCompareMode(false);
                        setComparedIndices([]);
                      }}
                    />
                  )}

                  {/* Focused Session Detailed Workspace Card (HAW Presentation / Cloud Database Integration) */}
                  {filteredViewSessions.length === 1 && (
                    <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-5 md:p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6" id="single-session-workspace">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[9px] bg-indigo-600 text-white font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider">Fokus-Session</span>
                          {filteredViewSessions[0].cloudDocId ? (
                            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> ☁️ IN CLOUD GESICHERT
                            </span>
                          ) : (
                            <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/30 font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1">
                              <Cloud className="w-3 h-3 text-amber-400" /> LOKAL (RAM)
                            </span>
                          )}
                        </div>
                        <h2 className="text-base font-bold text-white tracking-tight mt-1.5 font-mono truncate max-w-lg">
                          📁 {filteredViewSessions[0].fileName}
                        </h2>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-400 text-xs font-mono pt-1">
                          <span>📅 Datum: <strong className="text-slate-200 font-bold">{filteredViewSessions[0].date}</strong></span>
                          <span>|</span>
                          <span>⏳ Tempo: <strong className="text-slate-200 font-bold">{filteredViewSessions[0].tempo} BPM</strong></span>
                          <span>|</span>
                          <span>🎼 Tonart: <strong className="text-indigo-300 font-bold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/30">{filteredViewSessions[0].estimatedKey || "C-Dur"}</strong></span>
                          <span>|</span>
                          <span>🎯 Focus: <strong className="text-indigo-300 font-bold">{filteredViewSessions[0].focusScore ?? "?"}/100</strong></span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 shrink-0 w-full md:w-auto">
                        <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-right font-mono text-xs">
                          <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Spiel-Tempo</div>
                          <div className="text-sm font-black text-white mt-0.5">
                            ⚡ {filteredViewSessions[0].estimatedBpm?.toFixed(1) || filteredViewSessions[0].tempo} <span className="text-[9px] text-slate-400 font-normal">BPM</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {!filteredViewSessions[0].cloudDocId ? (
                            <button
                              onClick={() => {
                                const originalIdx = loadedFiles.findIndex(f => f.fileName === filteredViewSessions[0].fileName && f.date === filteredViewSessions[0].date);
                                if (originalIdx !== -1) {
                                  handleSaveToCloud(filteredViewSessions[0], originalIdx);
                                }
                              }}
                              disabled={isCloudSaving === filteredViewSessions[0].fileName}
                              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold px-4 py-2.5 rounded border border-indigo-500 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <CloudUpload className="w-3.5 h-3.5 shrink-0" />
                              <span>☁️ In DB sichern</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeleteFromCloud(filteredViewSessions[0])}
                              className="bg-slate-800 hover:bg-red-900/40 text-red-400 hover:text-red-300 border border-slate-600 hover:border-red-500/50 text-xs font-mono px-3.5 py-2.5 rounded transition-all flex items-center gap-1.5 cursor-pointer"
                              title="Aus der Cloud-Datenbank entfernen"
                            >
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Löschen</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Visual Charts (Histogram, Trends, Heatmap) */}
                  <SvgCharts 
                    data={filteredViewSessions} 
                    selectedNoteKey={selectedNoteKey} 
                    setSelectedNoteKey={setSelectedNoteKey} 
                  />

                  {/* Erweiterte grafische Auswertungen */}
                  <AdvancedCharts data={loadedFiles} />

                  {/* Timing-Drift Entwicklung (Recharts Liniengrafik) */}
                  <ProgressionChart loadedFiles={loadedFiles} />

                  {/* Track Vergleicher */}
                  <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="data-track-table">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono">
                          🔍 Spuranalyse & Mikrotiming-Vergleich
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 italic font-serif">
                          Welche Spuren weichen am stärksten vom Grid ab?
                        </p>
                      </div>

                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input 
                          type="text" 
                          placeholder="Spur filtern..."
                          value={trackSearch}
                          onChange={(e) => setTrackSearch(e.target.value)}
                          className="bg-slate-800 border border-slate-600 focus:border-indigo-500 text-xs px-3 py-2 pl-9 rounded text-slate-200 placeholder-slate-500 focus:outline-none w-full md:w-56 transition-colors font-mono"
                        />
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded border border-slate-700 bg-slate-900/50">
                      <table className="w-full text-left border-collapse text-xs font-mono">
                        <thead>
                          <tr className="bg-slate-800 border-b border-slate-700 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                            <th className="py-3 px-4 font-normal">Track / Spur Name</th>
                            <th className="py-3 px-4 font-normal text-right">Events</th>
                            <th className="py-3 px-4 font-normal text-right">ø Drift</th>
                            <th className="py-3 px-4 font-normal text-right">ø Velocity</th>
                            <th className="py-3 px-4 font-normal text-right">Groove-Qualität</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700 text-slate-300">
                          {trackAnalysis.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-6 text-center text-slate-500">Keine passende Spur gefunden.</td>
                            </tr>
                          ) : (
                            trackAnalysis.map((tr) => {
                              let rating = "Ausgeglichen";
                              let ratingColor = "text-slate-300 bg-slate-800 px-2.5 py-0.5 rounded border border-slate-600";
                              if (tr.avgDriftMs < 8) {
                                  rating = "Tight";
                                  ratingColor = "text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/30 font-bold";
                              } else if (tr.avgDriftMs > 18) {
                                  rating = "Locker (Offbeat)";
                                  ratingColor = "text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/30 font-bold";
                              } else {
                                  rating = "Menschlich (Groove)";
                                  ratingColor = "text-blue-400 bg-blue-500/10 px-2.5 py-0.5 rounded border border-blue-500/30 font-bold";
                              }

                              return (
                                <tr key={tr.name} className="hover:bg-slate-800/40 transition-colors">
                                  <td className="py-3 px-4 font-semibold text-slate-200 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full inline-block"></span>
                                    {tr.name}
                                  </td>
                                  <td className="py-3 px-4 text-right text-slate-400">{tr.notesCount.toLocaleString()} n</td>
                                  <td className="py-3 px-4 text-right font-medium">{tr.avgDriftMs.toFixed(1)} ms</td>
                                  <td className="py-3 px-4 text-right text-slate-400">{tr.avgVelocity}</td>
                                  <td className="py-3 px-4 text-right"><span className={ratingColor}>{rating}</span></td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              )}

              {activeTab === "database" && (
                <div className="space-y-6" id="tab-database-view">
                  <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 md:p-8 flex flex-col md:flex-row gap-8">
                    <div className="flex-1 space-y-4">
                      <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono mb-1">
                        ⚙ Daten-Exporter
                      </h3>
                      <p className="text-xs text-slate-500 italic font-serif leading-relaxed">
                        CSV-Export oder SQL-Installationsskript für SQLite.
                      </p>

                      <div className="border border-slate-700 rounded bg-slate-800/40 p-4 font-mono text-[11px] leading-relaxed text-slate-400 space-y-2">
                        <div className="text-slate-200 font-bold flex items-center gap-1.5 uppercase tracking-wide">
                          <Database className="w-3.5 h-3.5 text-indigo-400" />
                          SQLite Schema:
                        </div>
                        <ul className="list-disc pl-4 space-y-1.5 text-slate-400">
                          <li><strong className="text-slate-200">sessions:</strong> Metadaten (Dateiname, Tempo, Swing, Drift).</li>
                          <li><strong className="text-slate-200">midi_notes:</strong> Notenevents mit Foreign Key.</li>
                        </ul>
                      </div>
                    </div>

                    <div className="md:w-80 flex flex-col justify-center gap-3.5 bg-slate-800/40 p-5 border border-slate-700 rounded">
                      <button 
                        onClick={handleDownloadCsv}
                        className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-500 py-3 px-4 rounded flex items-center justify-center gap-2 font-mono text-xs font-semibold transition-all cursor-pointer active:scale-[0.98]"
                      >
                        <Download className="w-4 h-4 text-slate-300" />
                        CSV exportieren
                      </button>

                      <button 
                        onClick={handleDownloadSql}
                        className="w-full bg-indigo-600 text-white hover:bg-indigo-500 py-3 px-4 rounded flex items-center justify-center gap-2 font-mono text-xs font-bold transition-all cursor-pointer active:scale-[0.98]"
                      >
                        <Database className="w-4 h-4 fill-current" />
                        SQL BOOTSTRAP
                      </button>

                      <div className="text-center text-[9px] text-slate-500 font-mono mt-1">
                        {totals.notesCount.toLocaleString()} Events
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6">
                    <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono mb-3">
                      💻 SQLite CLI - SQL SNIPPETS
                    </h3>
                    <p className="text-xs text-slate-500 mb-4 italic font-serif">
                      Data-Science-Abfragen für die exportierte Datenbank:
                    </p>

                    <div className="space-y-4">
                      <div className="font-mono text-xs bg-slate-950 rounded border border-slate-800 p-4 text-slate-300">
                        <p className="text-blue-400 mb-1.5">// 1. Welche Spur hat die höchste Drift?</p>
                        <pre className="text-[11px] text-slate-300 leading-normal overflow-x-auto">
                          {`SELECT track_name, count(*) as n, avg(abs(offset_ms)) as drift\n` + 
                           `FROM midi_notes GROUP BY track_name\n` + 
                           `HAVING n > 50 ORDER BY drift DESC;`}
                        </pre>
                      </div>

                      <div className="font-mono text-xs bg-slate-950 rounded border border-slate-800 p-4 text-slate-300">
                        <p className="text-blue-400 mb-1.5">// 2. Tempo und Swing pro Monat</p>
                        <pre className="text-[11px] text-slate-300 leading-normal overflow-x-auto">
                          {`SELECT substr(session_date,1,7) as month,\n` + 
                           `  avg(tempo) as bpm, avg(swing_factor_16th) as swing\n` + 
                           `FROM sessions GROUP BY month ORDER BY month;`}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "python" && (
                <div className="space-y-6" id="tab-python-view">
                  <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 md:p-8">
                    <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono mb-3">
                      🐍 Python Pipeline
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed mb-4 italic font-serif">
                      Extrahiert MIDI-Noten aus .als-Dateien, speichert in SQLite, exportiert CSV.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs text-slate-400 mt-2">
                      <div className="bg-slate-800 border border-slate-700 p-4 rounded">
                        <span className="text-slate-200 font-bold block mb-1">🛠 1. INSTALL</span>
                        <code className="text-slate-300 block bg-slate-900 p-1.5 rounded border border-slate-700 mt-2">pip install matplotlib numpy</code>
                      </div>
                      <div className="bg-slate-800 border border-slate-700 p-4 rounded">
                        <span className="text-slate-200 font-bold block mb-1">🚀 2. AUSFÜHRUNG</span>
                        <code className="text-slate-300 block bg-slate-900 p-1.5 rounded border border-slate-700 mt-2">python ableton_midi_analyzer.py</code>
                      </div>
                      <div className="bg-slate-800 border border-slate-700 p-4 rounded">
                        <span className="text-slate-200 font-bold block mb-1">📊 3. OUTPUT</span>
                        <ul className="list-disc pl-4 mt-1.5 space-y-0.5 text-slate-400 font-mono text-[11px]">
                          <li>ableton_midi_timing.db</li>
                          <li>/monthly_exports/*.csv</li>
                          <li>ableton_timing_dashboard.png</li>
                        </ul>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-6 border-t border-slate-700/50 pt-5 justify-between items-center">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Info className="w-4 h-4 text-indigo-400" />
                        <span>Modulares Python-Skript.</span>
                      </div>
                      <div className="flex gap-2 font-mono">
                        <button 
                          onClick={handleCopyScriptToClipboard}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-500 py-2.5 px-4 rounded flex items-center justify-center gap-1.5 text-xs font-bold transition-all cursor-pointer active:scale-[0.98]"
                        >
                          {copySuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          <span>{copySuccess ? "KOPIERT!" : "KOPIEREN"}</span>
                        </button>

                        <button 
                          onClick={handleDownloadPythonScript}
                          className="bg-indigo-600 text-white hover:bg-indigo-500 py-2.5 px-4 rounded flex items-center justify-center gap-1.5 text-xs font-bold transition-all cursor-pointer active:scale-[0.98]"
                        >
                          <Download className="w-4 h-4" />
                          <span>HERUNTERLADEN</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded overflow-hidden flex flex-col">
                    <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center font-mono text-xs px-5 text-slate-400">
                      <span className="flex items-center gap-2">
                        <FileCode className="w-4 h-4 text-blue-400" />
                        ableton_midi_analyzer.py
                      </span>
                      <span className="text-slate-500">Python 3.8+</span>
                    </div>

                    <div className="p-5 bg-slate-950 overflow-x-auto max-h-[460px] font-mono text-[11px] leading-relaxed text-slate-300 scrollbar-thin">
                      <pre><code>{pythonScriptText}</code></pre>
                    </div>
                  </div>
                </div>
              )}

              {/* --- TAB 4: CALENDAR & WEEKDAYS --- */}
              {activeTab === "calendar" && (
                <CalendarView
                  data={loadedFiles}
                  setSelectedFileIdx={setSelectedFileIdx}
                  setActiveTab={setActiveTab}
                  setSelectedMonth={setSelectedMonth}
                />
              )}

              {/* --- TAB 5: CREATIVE VISUALIZER --- */}
              {activeTab === "visualizer" && (
                <div className="space-y-6 animate-fade-in" id="tab-visualizer-view">
                  <CreativeVisualizer 
                    loadedFiles={loadedFiles} 
                    initialSelectedFileIdx={selectedFileIdx}
                  />
                </div>
              )}

              {/* --- TAB 6: STUDENT PROGRESS --- */}
              {activeTab === "progress" && (
                <div className="space-y-6 animate-fade-in" id="tab-progress-view">
                  <StudentProgress
                    sessions={loadedFiles}
                    schedule={schedule}
                    onScheduleChange={handleScheduleChange}
                  />
                </div>
              )}

            </div>
          )}
        </div>

      </main>

      {/* 3. Humble Footer */}
      <footer className="bg-slate-900 text-slate-500 text-[10px] px-8 py-6 flex flex-col sm:flex-row justify-between items-center gap-3 font-mono mt-12" id="main-footer">
        <div>© 2026 ABLETON_MIDI_ANALYZE_STABLE // SYSTEM_RAM_SYNC: OK</div>
        <div className="text-slate-600 font-medium">CLIENT-SIDE PROCESSING (NO SERVERS INVOLVED) // DATA_WINDOW: JAN-JUN 2024</div>
      </footer>

    </div>
  );
}
