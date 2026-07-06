import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import supabase_db

STATIC_DIR = Path("/app/static")
AXINIO_BASE = "http://host.docker.internal:8081"

app = FastAPI(title="Midi Analyse Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ---------- SQLite (fallback) ----------

DB_DIR = Path("/data")
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "sessions.db"


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_sqlite():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            file_name TEXT UNIQUE NOT NULL,
            file_size INTEGER DEFAULT 0,
            file_type TEXT DEFAULT 'midi',
            session_date TEXT,
            tempo REAL DEFAULT 120,
            estimated_bpm REAL DEFAULT 120,
            notes_count INTEGER DEFAULT 0,
            avg_velocity REAL DEFAULT 0,
            avg_drift_ms REAL DEFAULT 0,
            avg_swing REAL DEFAULT 50,
            estimated_key TEXT DEFAULT 'Unbekannt',
            style_category TEXT DEFAULT 'Melodisch',
            structure_category TEXT DEFAULT 'Klassisches Stück',
            focus_score REAL DEFAULT 0,
            teacher_student_json TEXT DEFAULT '{}',
            velocity_spread_json TEXT DEFAULT '{}',
            polyphony_json TEXT DEFAULT '{}',
            sliding_tempo_json TEXT DEFAULT '[]',
            pedal_analysis_json TEXT DEFAULT '{}',
            notes_json TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)")
    conn.commit()
    conn.close()


# ---------- Init ----------

@app.on_event("startup")
async def startup():
    if supabase_db._USE_SUPABASE:
        await supabase_db.init_db()
    else:
        init_sqlite()


# ---------- Models ----------

class NoteModel(BaseModel):
    key: float
    noteName: str = ""
    velocity: float = 100
    time: float = 0
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
async def list_sessions():
    if supabase_db._USE_SUPABASE:
        return await supabase_db.list_sessions()
    conn = get_db()
    rows = conn.execute("""
        SELECT id, file_name, file_size, file_type, session_date, tempo,
               estimated_bpm, notes_count, avg_velocity, avg_drift_ms, avg_swing,
               estimated_key, style_category, structure_category, focus_score,
               velocity_spread_json, polyphony_json, created_at
        FROM sessions ORDER BY created_at DESC
    """).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        result.append({
            "id": d["id"],
            "fileName": d["file_name"],
            "date": d["session_date"] or "",
            "tempo": d["tempo"],
            "estimatedBpm": d["estimated_bpm"],
            "notesCount": d["notes_count"],
            "avgVelocity": d["avg_velocity"],
            "avgDriftMs": d["avg_drift_ms"],
            "swingFactor16th": d["avg_swing"],
            "estimatedKey": d["estimated_key"],
            "styleCategory": d["style_category"],
            "structureCategory": d["structure_category"],
            "focusScore": d["focus_score"],
            "velocitySpread": json.loads(d["velocity_spread_json"]),
            "polyphony": json.loads(d["polyphony_json"]),
            "notes": [],
            "createdAt": d["created_at"],
        })
    return result


@app.get("/sessions/count")
async def session_count():
    if supabase_db._USE_SUPABASE:
        rows = await supabase_db.list_sessions()
        return {"count": len(rows)}
    conn = get_db()
    row = conn.execute("SELECT COUNT(*) as cnt FROM sessions").fetchone()
    conn.close()
    return {"count": row["cnt"]}


@app.get("/sessions/{session_id}")
async def get_session(session_id: str):
    if supabase_db._USE_SUPABASE:
        result = await supabase_db.get_session(session_id)
        if not result:
            raise HTTPException(404, "Session not found")
        return result
    conn = get_db()
    r = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    conn.close()
    if not r:
        raise HTTPException(404, "Session not found")
    d = dict(r)
    notes_list = json.loads(d.pop("notes_json", "[]"))
    return {
        "id": d["id"],
        "fileName": d["file_name"],
        "date": d["session_date"] or "",
        "tempo": d["tempo"],
        "estimatedBpm": d["estimated_bpm"],
        "notesCount": d["notes_count"],
        "avgVelocity": d["avg_velocity"],
        "avgDriftMs": d["avg_drift_ms"],
        "swingFactor16th": d["avg_swing"],
        "estimatedKey": d["estimated_key"],
        "styleCategory": d["style_category"],
        "structureCategory": d["structure_category"],
        "focusScore": d["focus_score"],
        "teacherStudentSplit": json.loads(d["teacher_student_json"]),
        "velocitySpread": json.loads(d["velocity_spread_json"]),
        "polyphony": json.loads(d["polyphony_json"]),
        "slidingTempo": json.loads(d["sliding_tempo_json"]),
        "pedalAnalysis": json.loads(d["pedal_analysis_json"]),
        "notes": notes_list,
        "createdAt": d["created_at"],
    }


@app.get("/sessions/{session_id}/notes")
async def get_session_notes(session_id: str):
    if supabase_db._USE_SUPABASE:
        result = await supabase_db.get_session_notes(session_id)
        if not result:
            raise HTTPException(404, "Session not found")
        return result
    conn = get_db()
    r = conn.execute("SELECT id, notes_json FROM sessions WHERE id = ?", (session_id,)).fetchone()
    conn.close()
    if not r:
        raise HTTPException(404, "Session not found")
    notes_list = json.loads(r["notes_json"])
    return {"id": r["id"], "notes": notes_list}


@app.post("/sessions")
async def save_session(payload: SessionPayload):
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    notes_json = json.dumps([n.model_dump() for n in payload.notes], default=str)
    ts_json = json.dumps(payload.teacherStudentSplit or {}, default=str)
    vs_json = json.dumps(payload.velocitySpread or {}, default=str)
    poly_json = json.dumps(payload.polyphony or {}, default=str)
    st_json = json.dumps(payload.slidingTempo or [], default=str)
    pa_json = json.dumps(payload.pedalAnalysis or {}, default=str)

    if supabase_db._USE_SUPABASE:
        pg_id, created = await supabase_db.save_session(session_id, {
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
            "teacher_student_json": ts_json,
            "velocity_spread_json": vs_json,
            "polyphony_json": poly_json,
            "sliding_tempo_json": st_json,
            "pedal_analysis_json": pa_json,
            "notes_json": notes_json,
            "created_at": now,
        })
        return {"id": pg_id, "created": created}

    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM sessions WHERE file_name = ?", (payload.fileName,)
    ).fetchone()

    row = (
        payload.date,
        payload.tempo,
        payload.estimatedBpm or payload.tempo,
        payload.notesCount,
        payload.avgVelocity,
        payload.avgDriftMs,
        payload.swingFactor16th,
        payload.estimatedKey or "Unbekannt",
        payload.styleCategory or "Melodisch",
        payload.structureCategory or "Klassisches Stück",
        payload.focusScore or 0,
        ts_json,
        vs_json,
        poly_json,
        st_json,
        pa_json,
        notes_json,
        now,
    )

    if existing:
        conn.execute(
            """UPDATE sessions SET
                session_date=?, tempo=?, estimated_bpm=?, notes_count=?,
                avg_velocity=?, avg_drift_ms=?, avg_swing=?, estimated_key=?,
                style_category=?, structure_category=?, focus_score=?,
                teacher_student_json=?, velocity_spread_json=?, polyphony_json=?,
                sliding_tempo_json=?, pedal_analysis_json=?, notes_json=?, created_at=?
            WHERE file_name = ?""",
            (*row, payload.fileName),
        )
        session_id = existing["id"]
        created = False
    else:
        conn.execute(
            """INSERT INTO sessions (
                id, file_name, session_date, tempo, estimated_bpm, notes_count,
                avg_velocity, avg_drift_ms, avg_swing, estimated_key,
                style_category, structure_category, focus_score,
                teacher_student_json, velocity_spread_json, polyphony_json,
                sliding_tempo_json, pedal_analysis_json, notes_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, payload.fileName, *row),
        )
        created = True

    conn.commit()
    conn.close()
    return {"id": session_id, "created": created}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    if supabase_db._USE_SUPABASE:
        await supabase_db.delete_session(session_id)
        return {"deleted": True}
    conn = get_db()
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
    return {"deleted": True}


# ---------- Axinio proxy ----------

@app.api_route("/api/axinio/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_axinio(path: str, request: Request):
    url = f"{AXINIO_BASE}/{path}"
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.request(request.method, url, headers=headers, content=body)
    return resp.json()


# ---------- Static SPA (catch-all) ----------

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


@app.exception_handler(404)
async def spa_fallback(request: Request, exc):
    index = STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    raise exc
