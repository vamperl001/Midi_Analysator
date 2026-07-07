# Roadmap — Architektur-Migration

Geordnet nach Phasen. Ziel: Die Architekturregeln aus `ARCHITECTUR.md` vollständig erfüllen.

---

## Phase 1: Quick Wins (abgeschlossen)

| Nr | Aufgabe | Status | Datei |
|---|---|---|---|
| 1.1 | `ARCHITECTUR.md` erstellen | ✅ | `ARCHITECTUR.md` |
| 1.2 | `firebase.ts` → `backendApi.ts` umbenennen | ✅ | `src/backendApi.ts` |
| 1.3 | `supabase_db.py` → `postgres_db.py` umbenennen | ✅ | `backend/postgres_db.py` |
| 1.4 | Jitter-Berechnung aus `CreativeVisualizer.tsx` nach `medientechnikAnalysis.ts` verschieben | ✅ | `src/medientechnikAnalysis.ts` |
| 1.5 | Build prüfen (TypeScript + Vite) | ✅ | — |

---

## Phase 2: Repository-Layer + Analyse-Split

| Nr | Aufgabe | Priorität | Geschätzter Aufwand |
|---|---|---|---|
| 2.1 | SQL aus `main.py` in `backend/repository/sqlite_repo.py` extrahieren | 🔴 Hoch | 4h |
| 2.2 | `main.py` auf reines Routing reduzieren (nur noch Repo-Aufrufe) | 🔴 Hoch | 2h |
| 2.3 | `process_als.py` in Module aufteilen: | 🟡 Mittel | 3h |
| | `analysis/__init__.py`, `analysis/timing.py`, `analysis/swing.py`, | | |
| | `analysis/key.py`, `analysis/style.py`, `analysis/separation.py`, | | |
| | `analysis/focus.py` | | |

### Detail: 2.1 Repository-Layer

```python
# backend/repository/sqlite_repo.py

class SqliteSessionRepository:
    def __init__(self, db_path: str = "/data/sessions.db"):
        self.db_path = db_path

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def list_sessions(self) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute("SELECT ...").fetchall()
        conn.close()
        return [self._row_to_dict(r) for r in rows]

    def get_session(self, session_id: str) -> dict | None:
        ...

    def get_session_notes(self, session_id: str) -> list[dict]:
        ...

    def save_session(self, payload: SessionPayload) -> tuple[str, bool]:
        ...

    def delete_session(self, session_id: str) -> None:
        ...

    def get_chart_data(self) -> dict:
        ...

    def get_schedule(self) -> list[dict]:
        ...

    def save_schedule(self, schedule: list[dict]) -> None:
        ...

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        ...
```

### Detail: 2.3 Analyse-Module

```
backend/
├── analysis/
│   ├── __init__.py        # Lädt alle Module
│   ├── timing.py          # Grid-Fitting, Drift, Jitter
│   ├── swing.py           # Swing-Faktor
│   ├── key.py             # Tonart-Erkennung
│   ├── style.py           # Stil-Klassifikation
│   ├── separation.py      # Teacher/Student-Split
│   └── focus.py           # Focus Score
├── process_als.py         # bleibt als Orchestrator (ruft Module auf)
├── main.py                # nur noch Routing
└── repository/
    └── sqlite_repo.py     # SQL isoliert
```

---

## Phase 3: Analyse komplett ins Backend

| Nr | Aufgabe | Priorität | Geschätzter Aufwand |
|---|---|---|---|
| 3.1 | `analyzeSessionMidiStats()` (TypeScript) durch API-Call ersetzen | 🟡 Mittel | 3h |
| 3.2 | `medientechnikAnalysis.ts` durch Backend-Endpoint ersetzen | 🟡 Mittel | 2h |
| 3.3 | `alsParser.ts` auf reines Parsing reduzieren | 🟢 Niedrig | 2h |
| 3.4 | KDE/Jitter aus `SvgCharts.tsx` + `CreativeVisualizer.tsx` in Backend-API verschieben | 🟢 Niedrig | 1h |

---

## Phase 4: Feinschliff

| Nr | Aufgabe | Priorität | Geschätzter Aufwand |
|---|---|---|---|
| 4.1 | Unittests für Analyse-Module schreiben (pytest) | 🟡 Mittel | 4h |
| 4.2 | TypeScript-Seite: eigene Tests (vitest) für Parser | 🟢 Niedrig | 2h |
| 4.3 | CI/CD: GitHub Actions für Docker-Build + Push | 🟢 Niedrig | 1h |
| 4.4 | `README.md` aktualisieren mit neuer Architektur | 🟢 Niedrig | 0.5h |

---

## Abhängigkeiten

```
Phase 1 (abgeschlossen)
    │
    ▼
Phase 2 (Repository + Analyse-Split)
    │
    ├── 2.1 SQL → Repository ───┐
    │                            ├──> main.py wird schlank
    ├── 2.3 process_als.py ├─────┘
    │      in Module aufteilen
    ▼
Phase 3 (Analyse komplett ins Backend)
    │
    ├── 3.1 analyzeSessionMidiStats() via API
    ├── 3.2 medientechnikAnalysis.ts via API
    └── 3.3 alsParser.ts → reiner Parser
    │
    ▼
Phase 4 (Tests + CI/CD)
```

---

## Aktuelle Blockaden

- **Keine**: Phase 1 ist abgeschlossen. Phase 2 kann begonnen werden.

---

## Erfolgskriterien

- [ ] `main.py` enthält kein SQL mehr (nur noch `repository.*`-Aufrufe)
- [ ] `process_als.py` ist in Module aufgeteilt (max 200 Zeilen pro Modul)
- [ ] `alsParser.ts` enthält keine Analyse-Logik mehr
- [ ] Alle Analyse-Metriken laufen (mindestens) über einen Backend-Endpoint
- [ ] TypeScript-Build: 0 Fehler
- [ ] Docker-Container läuft ohne Fehler
- [ ] Alte Sessions bleiben lesbar (Abwärtskompatibilität)
