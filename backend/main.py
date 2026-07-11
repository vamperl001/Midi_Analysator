import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import postgres_db
from repository.sqlite_repo import SqliteSessionRepository

STATIC_DIR = Path("/app/static")
AXINIO_BASE = "http://host.docker.internal:8081"

app = FastAPI(title="Midi Analyse Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ---------- SQLite Repository ----------

DB_DIR = Path("/data")
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "sessions.db"

repo = SqliteSessionRepository(str(DB_PATH))


def init_sqlite():
    repo.init_db()


# ---------- Init ----------

@app.on_event("startup")
async def startup():
    if postgres_db._USE_SUPABASE:
        await postgres_db.init_db()
    else:
        init_sqlite()


# ---------- Models ----------

class NoteModel(BaseModel):
    key: float
    noteName: str = ""
    velocity: float = 100
    time: float = 0
    duration: float = 0.25
    gridOffset: float = 0
    gridOffsetMs: float = 0
    nearestGrid: float = 0
    trackName: str = ""


class SessionPayload(BaseModel):
    fileName: str
    date: str = ""
    time: str = ""
    weekday: int = 0
    tempo: float = 120
    estimatedBpm: float | None = None
    notesCount: int = 0
    avgVelocity: float = 0
    avgDriftMs: float = 0
    swingFactor16th: float = 50
    estimatedKey: str = "Unbekannt"
    styleCategory: str = "Melodisch"
    structureCategory: str = "Klassisches Stück"
    focusScore: float | None = None
    teacherStudentSplit: dict | None = None
    velocitySpread: dict | None = None
    polyphony: dict | None = None
    slidingTempo: list | None = None
    pedalAnalysis: dict | None = None
    notes: list[NoteModel] = []


# ---------- Routes ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sessions")
def list_sessions():
    if postgres_db._USE_SUPABASE:
        raise HTTPException(503, "Supabase not supported in sync mode")
    return repo.list_sessions()


@app.get("/sessions/count")
async def session_count():
    if postgres_db._USE_SUPABASE:
        rows = await postgres_db.list_sessions()
        return {"count": len(rows)}
    return {"count": repo.count_sessions()}


@app.get("/sessions/chart-data")
def get_chart_data():
    return repo.get_chart_data()


@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    if postgres_db._USE_SUPABASE:
        raise HTTPException(503, "Supabase not supported in sync mode")
    session = repo.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@app.get("/sessions/{session_id}/notes")
def get_session_notes(session_id: str):
    if postgres_db._USE_SUPABASE:
        raise HTTPException(503, "Supabase not supported in sync mode")
    result = repo.get_session_notes(session_id)
    if not result:
        raise HTTPException(404, "Session not found")
    return result


@app.post("/sessions")
async def save_session(payload: SessionPayload):
    if postgres_db._USE_SUPABASE:
        pg_id, created = await postgres_db.save_session(session_id, {
            "file_name": payload.fileName,
            "session_date": payload.date,
            "tempo": payload.tempo,
            "estimated_bpm": payload.estimatedBpm or payload.tempo,
            "notes_count": payload.notesCount,
            "avg_velocity": payload.avgVelocity,
            "avg_drift_ms": payload.avgDriftMs,
            "avg_swing": payload.swingFactor16th,
            "estimated_key": payload.estimatedKey or "Unbekannt",
            "style_category": payload.styleCategory or "Melodisch",
            "structure_category": payload.structureCategory or "Klassisches Stück",
            "focus_score": payload.focusScore or 0,
            "teacher_student_json": json.dumps(payload.teacherStudentSplit or {}, default=str),
            "velocity_spread_json": json.dumps(payload.velocitySpread or {}, default=str),
            "polyphony_json": json.dumps(payload.polyphony or {}, default=str),
            "sliding_tempo_json": json.dumps(payload.slidingTempo or [], default=str),
            "pedal_analysis_json": json.dumps(payload.pedalAnalysis or {}, default=str),
            "notes_json": json.dumps([n.model_dump() for n in payload.notes], default=str),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return {"id": pg_id, "created": created}

    session_id, created = repo.save_session(payload.model_dump())
    return {"id": session_id, "created": created}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    if postgres_db._USE_SUPABASE:
        await postgres_db.delete_session(session_id)
        return {"deleted": True}
    repo.delete_session(session_id)
    return {"deleted": True}


# ---------- Schedule ----------

class SchedulePayload(BaseModel):
    schedule: list[dict] = []


@app.get("/schedule")
@app.get("/api/schedule")
def get_schedule():
    return {"schedule": repo.get_schedule()}


@app.post("/schedule")
@app.post("/api/schedule")
def save_schedule(payload: SchedulePayload):
    repo.save_schedule(payload.schedule)
    return {"saved": True}


# ---------- Axinio proxy ----------

@app.api_route("/api/axinio/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_axinio(path: str, request: Request):
    url = f"{AXINIO_BASE}/{path}"
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.request(request.method, url, headers=headers, content=body)
    return resp.json()


# ---------- Upload & Analysis Endpoints ----------

from process_als import process_midi_file, process_band_file, analyze_notes, separate_teacher_student, compute_focus_score, extract_file_datetime
from analysis.advanced import compute_velocity_spread, compute_polyphony_metrics, compute_fourier_sliding_tempo, analyze_sustain_pedal


@app.post("/api/upload")
async def upload_session(request: Request, file_name: str = "unknown.als"):
    """Pure Python processing for .mid/.midi/.band files"""
    body = await request.body()
    if not body:
        raise HTTPException(400, "No file data received")
    ext = Path(file_name).suffix.lower()
    try:
        if ext in ('.mid', '.midi'):
            result = process_midi_file(body, file_name)
        elif ext in ('.band', '.zip'):
            result = process_band_file(body, file_name)
        else:
            raise HTTPException(400, f"Unsupported format for server-side: {ext}")
        advanced = _compute_advanced_metrics(result.get("notes", []), result.get("tempo", 120), result.get("avgDriftMs", 0))
        result.update(advanced)
        sid, _created = repo.save_session(result)
        return {"id": sid, **result}
    except Exception as e:
        raise HTTPException(500, f"Processing failed: {e}")


@app.post("/api/analyze")
async def analyze_session(payload: dict):
    """Receive pre-parsed ALS data from JS, run analysis server-side"""
    raw_notes = payload.get("notes", [])
    tempo = payload.get("tempo", 120)
    file_name = payload.get("fileName", "unknown.als")

    analysis = analyze_notes(raw_notes, tempo)
    analysis_notes = analysis["notes"]

    date_str, time_str, weekday = extract_file_datetime(file_name)
    teacher_student = separate_teacher_student(analysis_notes)
    focus_score = compute_focus_score(analysis_notes, analysis["avgDriftMs"])

    import numpy as np
    avg_vel = float(np.mean([n["velocity"] for n in raw_notes])) if raw_notes else 0

    advanced = _compute_advanced_metrics(analysis_notes, analysis["estimatedBpm"], analysis["avgDriftMs"])
    result = {
        "fileName": file_name,
        "date": date_str,
        "time": time_str,
        "weekday": weekday,
        "tempo": analysis["estimatedBpm"],
        "notesCount": len(raw_notes),
        "avgVelocity": round(avg_vel, 1),
        "avgDriftMs": analysis["avgDriftMs"],
        "swingFactor16th": analysis["swingFactor16th"],
        "estimatedKey": analysis["estimatedKey"],
        "styleCategory": analysis["styleCategory"],
        "structureCategory": analysis["structureCategory"],
        "focusScore": focus_score,
        "teacherStudentSplit": teacher_student,
        "notes": analysis_notes,
        "velocitySpread": advanced["velocitySpread"],
        "polyphony": advanced["polyphony"],
        "slidingTempo": advanced["slidingTempo"],
        "pedalAnalysis": advanced["pedalAnalysis"],
    }

    sid, _created = repo.save_session(result)
    return {"id": sid, **result}


@app.post("/api/analyze/notes")
async def analyze_notes_only(payload: dict):
    raw_notes = payload.get("notes", [])
    tempo = payload.get("tempo", 120)
    file_name = payload.get("fileName", "unknown.als")

    analysis = analyze_notes(raw_notes, tempo)
    analysis_notes = analysis["notes"]

    date_str, time_str, weekday = extract_file_datetime(file_name)
    teacher_student = separate_teacher_student(analysis_notes)
    focus_score = compute_focus_score(analysis_notes, analysis["avgDriftMs"])

    import numpy as np
    avg_vel = float(np.mean([n["velocity"] for n in raw_notes])) if raw_notes else 0

    advanced = _compute_advanced_metrics(analysis_notes, analysis["estimatedBpm"], analysis["avgDriftMs"])
    return {
        "fileName": file_name,
        "date": date_str,
        "time": time_str,
        "weekday": weekday,
        "tempo": analysis["estimatedBpm"],
        "notesCount": len(raw_notes),
        "avgVelocity": round(avg_vel, 1),
        "avgDriftMs": analysis["avgDriftMs"],
        "swingFactor16th": analysis["swingFactor16th"],
        "estimatedKey": analysis["estimatedKey"],
        "styleCategory": analysis["styleCategory"],
        "structureCategory": analysis["structureCategory"],
        "focusScore": focus_score,
        "teacherStudentSplit": teacher_student,
        "notes": analysis_notes,
        "velocitySpread": advanced["velocitySpread"],
        "polyphony": advanced["polyphony"],
        "slidingTempo": advanced["slidingTempo"],
        "pedalAnalysis": advanced["pedalAnalysis"],
    }


@app.post("/api/analyze/kde")
async def kde_analysis(payload: dict):
    from analysis.timing import gaussian_kde
    data = payload.get("values", [])
    num_points = payload.get("numPoints", 200)
    return {"curve": gaussian_kde(data, num_points)}


@app.post("/api/analyze/jitter")
async def jitter_analysis(payload: dict):
    notes = payload.get("notes", [])
    if not notes:
        return {"maxDrift": 0, "avgDrift": 0, "stdDev": 0, "jitter": 0}

    drifts = [abs(n["gridOffsetMs"]) for n in notes]
    max_drift = max(drifts)
    avg = sum(drifts) / len(drifts)
    variance = sum((d - avg) ** 2 for d in drifts) / len(drifts)
    std_dev = variance ** 0.5

    diff_sum = sum(abs(drifts[i] - drifts[i - 1]) for i in range(1, len(drifts)))
    jitter = diff_sum / (len(drifts) - 1) if len(drifts) > 1 else 0

    return {
        "maxDrift": round(max_drift, 2),
        "avgDrift": round(avg, 2),
        "stdDev": round(std_dev, 2),
        "jitter": round(jitter, 2),
    }




def _compute_advanced_metrics(notes: list[dict], tempo: float, avg_drift_ms: float) -> dict:
    if not notes:
        return {"velocitySpread": None, "polyphony": None, "slidingTempo": None, "pedalAnalysis": None}
    from analysis.advanced import compute_velocity_spread, compute_polyphony_metrics, compute_fourier_sliding_tempo, analyze_sustain_pedal
    return {
        "velocitySpread": compute_velocity_spread(notes),
        "polyphony": compute_polyphony_metrics(notes),
        "slidingTempo": compute_fourier_sliding_tempo(notes, tempo, tempo),
        "pedalAnalysis": analyze_sustain_pedal(notes, tempo, avg_drift_ms),
    }

@app.post("/api/analyze/advanced")
async def advanced_analysis(payload: dict):
    from analysis.advanced import compute_velocity_spread, compute_polyphony_metrics, compute_fourier_sliding_tempo, analyze_sustain_pedal
    notes = payload.get("notes", [])
    tempo = payload.get("tempo", 120)
    avg_drift_ms = payload.get("avgDriftMs", 0)
    if not notes:
        return {"velocitySpread": None, "polyphony": None, "slidingTempo": None, "pedalAnalysis": None}
    velocity_spread = compute_velocity_spread(notes)
    polyphony = compute_polyphony_metrics(notes)
    sliding_tempo = compute_fourier_sliding_tempo(notes, tempo, tempo)
    pedal = analyze_sustain_pedal(notes, tempo, avg_drift_ms)
    return {
        "velocitySpread": velocity_spread,
        "polyphony": polyphony,
        "slidingTempo": sliding_tempo,
        "pedalAnalysis": pedal,
    }


# ---------- Static SPA (catch-all) ----------

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


@app.exception_handler(404)
async def spa_fallback(request: Request, exc):
    index = STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    raise exc
