import { AlsFileStats } from "./types";

const API = "/sessions";

export async function saveSessionToCloud(session: AlsFileStats): Promise<string> {
  const payload: Record<string, unknown> = {
    fileName: session.fileName,
    date: session.date,
    time: session.time,
    weekday: session.weekday,
    tempo: session.tempo,
    estimatedBpm: session.estimatedBpm,
    notesCount: session.notesCount,
    avgVelocity: session.avgVelocity,
    avgDriftMs: session.avgDriftMs,
    swingFactor16th: session.swingFactor16th,
    estimatedKey: session.estimatedKey,
    styleCategory: session.styleCategory,
    structureCategory: session.structureCategory,
    focusScore: session.focusScore,
    teacherStudentSplit: session.teacherStudentSplit,
    velocitySpread: session.velocitySpread,
    polyphony: session.polyphony,
    slidingTempo: session.slidingTempo,
    pedalAnalysis: session.pedalAnalysis,
    notes: session.notes.map(n => ({
      key: n.key,
      noteName: n.noteName,
      velocity: n.velocity,
      time: n.time,
      gridOffset: n.gridOffset || 0,
      gridOffsetMs: n.gridOffsetMs || 0,
      nearestGrid: n.nearestGrid || 0,
      trackName: n.trackName || "",
    })),
  };

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend-Fehler (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.id;
}

function isFalsyStructuredField(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

function mapSessionItem(item: Record<string, unknown>, notes: AlsFileStats["notes"]): AlsFileStats {
  return {
    cloudDocId: item["id"] as string,
    fileName: item["fileName"] as string,
    date: (item["date"] as string) || "",
    time: (item["time"] as string) || "",
    weekday: (item["weekday"] as number) ?? 0,
    tempo: Number(item["tempo"] || 120),
    estimatedBpm: item["estimatedBpm"] ? Number(item["estimatedBpm"]) : undefined,
    notesCount: Number(item["notesCount"] || notes.length),
    avgVelocity: Number(item["avgVelocity"] || 0),
    avgDriftMs: Number(item["avgDriftMs"] || 0),
    swingFactor16th: Number(item["swingFactor16th"] || 50),
    estimatedKey: (item["estimatedKey"] as string) || "Unbekannt",
    styleCategory: (item["styleCategory"] as AlsFileStats["styleCategory"]) || "Melodisch",
    structureCategory: (item["structureCategory"] as AlsFileStats["structureCategory"]) || "Klassisches Stück",
    focusScore: item["focusScore"] ? Number(item["focusScore"]) : undefined,
    teacherStudentSplit: item["teacherStudentSplit"] as AlsFileStats["teacherStudentSplit"],
    velocitySpread: isFalsyStructuredField(item["velocitySpread"]) ? undefined : (item["velocitySpread"] as AlsFileStats["velocitySpread"]),
    polyphony: isFalsyStructuredField(item["polyphony"]) ? undefined : (item["polyphony"] as AlsFileStats["polyphony"]),
    slidingTempo: isFalsyStructuredField(item["slidingTempo"]) ? undefined : (item["slidingTempo"] as AlsFileStats["slidingTempo"]),
    pedalAnalysis: isFalsyStructuredField(item["pedalAnalysis"]) ? undefined : (item["pedalAnalysis"] as AlsFileStats["pedalAnalysis"]),
    notes,
  };
}

export async function loadSessionsFromCloud(): Promise<AlsFileStats[]> {
  const res = await fetch(API);
  if (!res.ok) return [];
  const list: Record<string, unknown>[] = await res.json();
  return list.map(item => mapSessionItem(item, []));
}

export async function loadSessionNotesFromCloud(docId: string): Promise<{
  notes: AlsFileStats["notes"];
  teacherStudentSplit: AlsFileStats["teacherStudentSplit"];
  velocitySpread: AlsFileStats["velocitySpread"];
  polyphony: AlsFileStats["polyphony"];
  slidingTempo: AlsFileStats["slidingTempo"];
  pedalAnalysis: AlsFileStats["pedalAnalysis"];
}> {
  const res = await fetch(`${API}/${encodeURIComponent(docId)}`);
  if (!res.ok) return { notes: [], teacherStudentSplit: undefined, velocitySpread: undefined, polyphony: undefined, slidingTempo: undefined, pedalAnalysis: undefined };
  const session: Record<string, unknown> = await res.json();
  const rawNotes = (session["notes"] as Record<string, unknown>[]) || [];
  const notes: AlsFileStats["notes"] = rawNotes.map((n: Record<string, unknown>, idx: number) => ({
    id: (n["id"] as string) || `${session["fileName"]}-${idx}`,
    key: n["key"] !== undefined ? Number(n["key"]) : 60,
    noteName: (n["noteName"] as string) || "C3",
    time: Number(n["time"] || 0),
    duration: n["duration"] !== undefined ? Number(n["duration"]) : 0.25,
    velocity: n["velocity"] !== undefined ? Number(n["velocity"]) : 100,
    gridOffset: n["gridOffset"] !== undefined ? Number(n["gridOffset"]) : 0,
    gridOffsetMs: n["gridOffsetMs"] !== undefined ? Number(n["gridOffsetMs"]) : 0,
    nearestGrid: n["nearestGrid"] !== undefined ? Number(n["nearestGrid"]) : 0,
    trackName: (n["trackName"] as string) || "Midi",
  }));
  return {
    notes,
    teacherStudentSplit: session["teacherStudentSplit"] as AlsFileStats["teacherStudentSplit"],
    velocitySpread: isFalsyStructuredField(session["velocitySpread"]) ? undefined : (session["velocitySpread"] as AlsFileStats["velocitySpread"]),
    polyphony: isFalsyStructuredField(session["polyphony"]) ? undefined : (session["polyphony"] as AlsFileStats["polyphony"]),
    slidingTempo: isFalsyStructuredField(session["slidingTempo"]) ? undefined : (session["slidingTempo"] as AlsFileStats["slidingTempo"]),
    pedalAnalysis: isFalsyStructuredField(session["pedalAnalysis"]) ? undefined : (session["pedalAnalysis"] as AlsFileStats["pedalAnalysis"]),
  };
}

export async function deleteSessionFromCloud(docId: string): Promise<void> {
  const res = await fetch(`${API}/${encodeURIComponent(docId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend-Fehler beim Löschen (${res.status}): ${text}`);
  }
}

export async function computeKde(values: number[], numPoints = 200): Promise<{ x: number; y: number }[]> {
  const res = await fetch("/api/analyze/kde", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values, numPoints }),
  });
  if (!res.ok) throw new Error(`KDE-Fehler (${res.status})`);
  const data = await res.json();
  return data.curve;
}

export interface JitterMetrics {
  maxDrift: number;
  avgDrift: number;
  stdDev: number;
  jitter: number;
}

export async function computeJitterMetrics(notes: { gridOffsetMs: number }[]): Promise<JitterMetrics> {
  const res = await fetch("/api/analyze/jitter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error(`Jitter-Fehler (${res.status})`);
  return res.json();
}

export interface AdvancedMetrics {
  velocitySpread: AlsFileStats["velocitySpread"];
  polyphony: AlsFileStats["polyphony"];
  slidingTempo: AlsFileStats["slidingTempo"];
  pedalAnalysis: AlsFileStats["pedalAnalysis"];
}

export async function computeAdvancedMetrics(
  notes: AlsFileStats["notes"],
  tempo: number,
  avgDriftMs: number
): Promise<AdvancedMetrics> {
  const res = await fetch("/api/analyze/advanced", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes, tempo, avgDriftMs }),
  });
  if (!res.ok) throw new Error(`Advanced-Fehler (${res.status})`);
  return res.json();
}

