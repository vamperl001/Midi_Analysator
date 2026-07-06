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
    velocitySpread: item["velocitySpread"] as AlsFileStats["velocitySpread"],
    polyphony: item["polyphony"] as AlsFileStats["polyphony"],
    slidingTempo: item["slidingTempo"] as AlsFileStats["slidingTempo"],
    pedalAnalysis: item["pedalAnalysis"] as AlsFileStats["pedalAnalysis"],
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
  slidingTempo: AlsFileStats["slidingTempo"];
  pedalAnalysis: AlsFileStats["pedalAnalysis"];
}> {
  const res = await fetch(`${API}/${encodeURIComponent(docId)}`);
  if (!res.ok) return { notes: [], teacherStudentSplit: undefined, slidingTempo: undefined, pedalAnalysis: undefined };
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
    slidingTempo: session["slidingTempo"] as AlsFileStats["slidingTempo"],
    pedalAnalysis: session["pedalAnalysis"] as AlsFileStats["pedalAnalysis"],
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
