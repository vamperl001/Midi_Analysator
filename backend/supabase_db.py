"""
Datenbank-Backend: PostgreSQL (Supabase) via asyncpg, Fallback SQLite.
"""

import json
import os
from datetime import datetime, timezone

import asyncpg

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
_USE_SUPABASE = bool(SUPABASE_DB_URL)

_pool = None


async def get_pool():
    global _pool
    if _pool is None and _USE_SUPABASE:
        _pool = await asyncpg.create_pool(
            SUPABASE_DB_URL,
            statement_cache_size=0,
            min_size=1,
            max_size=5,
        )
    return _pool


async def init_db():
    if not _USE_SUPABASE:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
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
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC)")


async def list_sessions():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, file_name, file_size, file_type, session_date, tempo,
                   estimated_bpm, notes_count, avg_velocity, avg_drift_ms, avg_swing,
                   estimated_key, style_category, structure_category, focus_score,
                   velocity_spread_json, polyphony_json, created_at
            FROM sessions ORDER BY created_at DESC
        """)
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
            "velocitySpread": json.loads(d["velocity_spread_json"]) if d["velocity_spread_json"] else {},
            "polyphony": json.loads(d["polyphony_json"]) if d["polyphony_json"] else {},
            "notes": [],
            "createdAt": d["created_at"].isoformat() if d["created_at"] else "",
        })
    return result


async def get_session(session_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM sessions WHERE id = $1", session_id)
    if not r:
        return None
    d = dict(r)
    notes_list = json.loads(d["notes_json"]) if d["notes_json"] else []
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
        "teacherStudentSplit": json.loads(d["teacher_student_json"]) if d["teacher_student_json"] else {},
        "velocitySpread": json.loads(d["velocity_spread_json"]) if d["velocity_spread_json"] else {},
        "polyphony": json.loads(d["polyphony_json"]) if d["polyphony_json"] else {},
        "slidingTempo": json.loads(d["sliding_tempo_json"]) if d["sliding_tempo_json"] else [],
        "pedalAnalysis": json.loads(d["pedal_analysis_json"]) if d["pedal_analysis_json"] else {},
        "notes": notes_list,
        "createdAt": d["created_at"].isoformat() if d["created_at"] else "",
    }


async def get_session_notes(session_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT id, notes_json FROM sessions WHERE id = $1", session_id)
    if not r:
        return None
    return {"id": r["id"], "notes": json.loads(r["notes_json"]) if r["notes_json"] else []}


async def save_session(session_id: str, payload: dict):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchval("SELECT id FROM sessions WHERE file_name = $1", payload["file_name"])
        if existing:
            await conn.execute("""
                UPDATE sessions SET session_date=$1, tempo=$2, estimated_bpm=$3,
                    notes_count=$4, avg_velocity=$5, avg_drift_ms=$6, avg_swing=$7,
                    estimated_key=$8, style_category=$9, structure_category=$10,
                    focus_score=$11, teacher_student_json=$12, velocity_spread_json=$13,
                    polyphony_json=$14, sliding_tempo_json=$15, pedal_analysis_json=$16,
                    notes_json=$17, created_at=$18
                WHERE file_name=$19
            """,
                payload["session_date"], payload["tempo"], payload["estimated_bpm"],
                payload["notes_count"], payload["avg_velocity"], payload["avg_drift_ms"],
                payload["avg_swing"], payload["estimated_key"], payload["style_category"],
                payload["structure_category"], payload["focus_score"],
                payload["teacher_student_json"], payload["velocity_spread_json"],
                payload["polyphony_json"], payload["sliding_tempo_json"],
                payload["pedal_analysis_json"], payload["notes_json"],
                payload["created_at"], payload["file_name"],
            )
            return existing, False
        else:
            await conn.execute("""
                INSERT INTO sessions (id, file_name, session_date, tempo, estimated_bpm,
                    notes_count, avg_velocity, avg_drift_ms, avg_swing, estimated_key,
                    style_category, structure_category, focus_score,
                    teacher_student_json, velocity_spread_json, polyphony_json,
                    sliding_tempo_json, pedal_analysis_json, notes_json, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            """,
                session_id, payload["file_name"], payload["session_date"],
                payload["tempo"], payload["estimated_bpm"],
                payload["notes_count"], payload["avg_velocity"], payload["avg_drift_ms"],
                payload["avg_swing"], payload["estimated_key"], payload["style_category"],
                payload["structure_category"], payload["focus_score"],
                payload["teacher_student_json"], payload["velocity_spread_json"],
                payload["polyphony_json"], payload["sliding_tempo_json"],
                payload["pedal_analysis_json"], payload["notes_json"],
                payload["created_at"],
            )
            return session_id, True


async def delete_session(session_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM sessions WHERE id = $1", session_id)
