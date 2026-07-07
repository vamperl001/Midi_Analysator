"""
Repository-Layer für SQLite.
Isoliert sämtliche SQL-Zugriffe aus main.py.
"""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


class SqliteSessionRepository:
    def __init__(self, db_path: str = "/data/sessions.db"):
        self.db_path = db_path

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    # ---------- Init ----------

    def init_db(self):
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                file_name TEXT UNIQUE NOT NULL,
                file_size INTEGER DEFAULT 0,
                file_type TEXT DEFAULT 'midi',
                session_date TEXT,
                session_time TEXT DEFAULT '',
                session_weekday INTEGER DEFAULT 0,
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
                chart_data_json TEXT DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                data_json TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()

    # ---------- CRUD Sessions ----------

    def list_sessions(self) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute("""
            SELECT id, file_name, file_size, file_type, session_date,
                   session_time, session_weekday,
                   tempo, estimated_bpm, notes_count, avg_velocity, avg_drift_ms, avg_swing,
                   estimated_key, style_category, structure_category, focus_score,
                   teacher_student_json, velocity_spread_json, polyphony_json,
                   sliding_tempo_json, pedal_analysis_json, created_at
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
                "time": d["session_time"] or "",
                "weekday": d["session_weekday"] or 0,
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
                "notes": [],
                "createdAt": d["created_at"],
            })
        return result

    def get_session(self, session_id: str) -> dict | None:
        conn = self._get_conn()
        r = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        conn.close()
        if not r:
            return None
        d = dict(r)
        notes_list = json.loads(d.pop("notes_json", "[]"))
        return {
            "id": d["id"],
            "fileName": d["file_name"],
            "date": d["session_date"] or "",
            "time": d["session_time"] or "",
            "weekday": d["session_weekday"] or 0,
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

    def get_session_notes(self, session_id: str) -> dict | None:
        conn = self._get_conn()
        r = conn.execute("SELECT id, notes_json FROM sessions WHERE id = ?", (session_id,)).fetchone()
        conn.close()
        if not r:
            return None
        notes_list = json.loads(r["notes_json"])
        return {"id": r["id"], "notes": notes_list}

    def save_session(self, payload: dict) -> tuple[str, bool]:
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        notes_json = json.dumps(payload.get("notes", []), default=str)
        ts_json = json.dumps(payload.get("teacherStudentSplit") or {}, default=str)
        vs_json = json.dumps(payload.get("velocitySpread") or {}, default=str)
        poly_json = json.dumps(payload.get("polyphony") or {}, default=str)
        st_json = json.dumps(payload.get("slidingTempo") or [], default=str)
        pa_json = json.dumps(payload.get("pedalAnalysis") or {}, default=str)

        conn = self._get_conn()
        existing = conn.execute(
            "SELECT id FROM sessions WHERE file_name = ?", (payload["fileName"],)
        ).fetchone()

        row = (
            payload.get("date", ""),
            payload.get("time", ""),
            payload.get("weekday", 0),
            payload.get("tempo", 120),
            payload.get("estimatedBpm") or payload.get("tempo", 120),
            payload.get("notesCount", 0),
            payload.get("avgVelocity", 0),
            payload.get("avgDriftMs", 0),
            payload.get("swingFactor16th", 50),
            payload.get("estimatedKey", "Unbekannt"),
            payload.get("styleCategory", "Melodisch"),
            payload.get("structureCategory", "Klassisches Stück"),
            payload.get("focusScore", 0),
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
                    session_date=?, session_time=?, session_weekday=?,
                    tempo=?, estimated_bpm=?, notes_count=?,
                    avg_velocity=?, avg_drift_ms=?, avg_swing=?, estimated_key=?,
                    style_category=?, structure_category=?, focus_score=?,
                    teacher_student_json=?, velocity_spread_json=?, polyphony_json=?,
                    sliding_tempo_json=?, pedal_analysis_json=?, notes_json=?, created_at=?
                WHERE file_name = ?""",
                (*row, payload["fileName"]),
            )
            session_id = existing["id"]
            created = False
        else:
            conn.execute(
                """INSERT INTO sessions (
                    id, file_name, session_date, session_time, session_weekday,
                    tempo, estimated_bpm, notes_count,
                    avg_velocity, avg_drift_ms, avg_swing, estimated_key,
                    style_category, structure_category, focus_score,
                    teacher_student_json, velocity_spread_json, polyphony_json,
                    sliding_tempo_json, pedal_analysis_json, notes_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (session_id, payload["fileName"], *row),
            )
            created = True

        conn.commit()
        conn.close()
        return session_id, created

    def delete_session(self, session_id: str) -> None:
        conn = self._get_conn()
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        conn.close()

    # ---------- Chart Data ----------

    def get_chart_data(self) -> dict:
        from process_als import compute_chart_data
        conn = self._get_conn()
        rows = conn.execute("SELECT id, notes_json, chart_data_json FROM sessions ORDER BY created_at").fetchall()
        conn.close()
        result = {}
        for r in rows:
            chart = json.loads(r["chart_data_json"])
            if not chart:
                notes = json.loads(r["notes_json"])
                chart = compute_chart_data(notes)
                conn2 = self._get_conn()
                conn2.execute("UPDATE sessions SET chart_data_json=? WHERE id=?", (json.dumps(chart, default=str), r["id"]))
                conn2.commit()
                conn2.close()
            result[r["id"]] = chart
        return result

    # ---------- Schedule ----------

    def get_schedule(self) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute("SELECT data_json FROM app_config WHERE key = 'schedule'").fetchone()
        conn.close()
        return json.loads(rows["data_json"]) if rows else []

    def save_schedule(self, schedule: list[dict]) -> None:
        conn = self._get_conn()
        existing = conn.execute("SELECT 1 FROM app_config WHERE key = 'schedule'").fetchone()
        data = json.dumps(schedule, default=str)
        if existing:
            conn.execute("UPDATE app_config SET data_json = ? WHERE key = 'schedule'", (data,))
        else:
            conn.execute("INSERT INTO app_config (key, data_json) VALUES ('schedule', ?)", (data,))
        conn.commit()
        conn.close()

    # ---------- Count ----------

    def count_sessions(self) -> int:
        conn = self._get_conn()
        row = conn.execute("SELECT COUNT(*) as cnt FROM sessions").fetchone()
        conn.close()
        return row["cnt"]
