# Architecture Audit – MIDI Analysator

**Datum:** 2026-07-08
**Basis:** `ARCHITECTUR.md` v1.0, `docs/roadmap.md`, `README.md`
**Stand:** Nach Phase 1 (Quick Wins)

---

## Überblick

Phase 1 des Migrationsfahrplans ist **vollständig umgesetzt**:
- `ARCHITECTUR.md` erstellt
- `firebase.ts` → `backendApi.ts`
- `supabase_db.py` → `postgres_db.py`
- Jitter-Berechnung aus `CreativeVisualizer.tsx` → `medientechnikAnalysis.ts`

Das Repository-Layer (`repository/sqlite_repo.py`, 273 Zeilen) existiert und wird von den CRUD-Routen (`/sessions`) genutzt – ein Fortschritt über Phase 2 hinaus. Die `/api/upload`- und `/api/analyze`-Routen umgehen es jedoch noch.

---

## Violations

### 🔴 HIGH

#### H1 – SQL in FastAPI-Routen (nicht vollständig isoliert)

- **Dateien:** `backend/main.py:200,217,258` → `backend/process_als.py:535-602`
- **Befund:** `main.py` importiert `save_to_db` aus `process_als.py` und ruft es in `/api/upload` (Z. 217) und `/api/analyze` (Z. 258) auf. `save_to_db()` (Z. 535-602) enthält rohes SQL: `sqlite3.connect()`, `conn.execute("UPDATE ...")`, `conn.execute("INSERT INTO ...")`.
- **Roadmap:** Aufgabe 2.1 / 2.2 – **PENDING**
- **Aufwand:** 2h
- **Teilerledigt:** CRUD-Routen (`/sessions`, `/schedule`) nutzen bereits `repo.*`

#### H2 – process_als.py > 200 Zeilen, kein analysis/-Modul

- **Datei:** `backend/process_als.py` (720 Zeilen)
- **Befund:** 11+ Verantwortungen in einer Datei: Datei-Parsing, Grid-Fitting, Swing, Key Detection, Style Classification, Teacher/Student Split, Focus Score, Chart-Daten, `save_to_db`. Verzeichnis `backend/analysis/` existiert nicht.
- **Roadmap:** Aufgabe 2.3 – **PENDING**
- **Aufwand:** 3h

#### H3 – alsParser.ts mischt Parsing + Analyse (1500 Zeilen)

- **Datei:** `src/alsParser.ts` (1500 Zeilen)
- **Befund:** Enthält reine Parse-Funktionen (ALS XML, MIDI, Band, Audio) UND Analyse-Funktionen (`analyzeSessionMidiStats`, `separateTeacherStudent`, `computeFocusScore`, `detectKey`, `estimateBpmForNotes`, `estimateGridFromNotes`).
- **Roadmap:** Aufgabe 3.3 – **PENDING**
- **Aufwand:** 2h

#### H4 – Analyse in React-Komponenten

**H4a – KDE in SvgCharts.tsx**
- **Datei:** `src/components/SvgCharts.tsx:249-272`
- **Befund:** `gaussianKde()` und `gaussianKdeForDisplay()` werden direkt in der Komponente berechnet (Gauß-Kernel, Bandbreiten-Schätzung nach Silverman's rule).
- **Roadmap:** Aufgabe 3.4 – **PENDING**
- **Aufwand:** 1h

**H4b – Jitter-Aufruf in CreativeVisualizer.tsx**
- **Datei:** `src/components/CreativeVisualizer.tsx:98-106`
- **Befund:** `useEffect` ruft `computeJitterMetrics()` aus `medientechnikAnalysis.ts` auf – Analyse bleibt clientseitig.
- **Roadmap:** Aufgabe 3.4 – **PENDING**
- **Aufwand:** 1h (gebündelt mit H4a)

**H4c – avgDriftMs-Neuberechnung in App.tsx**
- **Datei:** `src/App.tsx:692-694`
- **Befund:** Bei Velocity-Filter-Änderung wird `avgDriftMs` clientseitig aus `matchedNotes` neu berechnet: `matchedNotes.reduce((sum, n) => sum + n.gridOffsetMs, 0) / matchedNotes.length`.
- **Roadmap:** Nicht explizit gelistet – fällt unter Phase 3 (Backend-Migration)
- **Aufwand:** 0.5h

#### H5 – medientechnikAnalysis.ts (clientseitige Analyse)

- **Datei:** `src/medientechnikAnalysis.ts` (424 Zeilen)
- **Befund:** 6 Analyse-Funktionen laufen ausschließlich clientseitig – kein Backend-Pendant:
  - `computeFourierSlidingTempo()` – Sliding Tempo
  - `computePolyphonyMetrics()` – Polyphonie
  - `computeVelocitySpread()` – Velocity Spread
  - `analyzeSustainPedal()` – Pedalanalyse
  - `computeJitterMetrics()` – Jitter
  - `enrichSessionWithAdvancedMetrics()` – Orchestrator
- **Roadmap:** Aufgabe 3.2 – **PENDING**
- **Aufwand:** 2h

#### H6 – Doppelte Analyse-Logik (TypeScript + Python)

- **Dateien:** `src/alsParser.ts:259` (`analyzeSessionMidiStats`) vs `backend/process_als.py:259` (`analyze_notes`)
- **Befund:** Beide implementieren dieselben Algorithmen mit identischen Konstanten (BPM 60-160, Grid-Kandidaten `[0.0625,0.125,0.1875,0.25,0.375,0.5]`, Gauß-Sigma `0.022`, Krumhansl-Schmuckler-Profile):

  | Schritt | TypeScript | Python |
  |---|---|---|
  | BPM-Schätzung | `estimateBpmForNotes()` | `analyze_notes()` Z. 278-292 |
  | Grid-Fitting | `estimateGridFromNotes()` | `_estimate_grid()` |
  | Swing | In `analyzeSessionMidiStats()` | `_estimate_swing()` |
  | Key Detection | `detectKey()` | `_estimate_key()` |
  | Style | In `analyzeSessionMidiStats()` | `_classify_style()` |
  | Teacher/Student | `separateTeacherStudent()` | `separate_teacher_student()` |
  | Focus Score | `computeFocusScore()` | `compute_focus_score()` |
- **Roadmap:** Aufgabe 3.1 – **PENDING**
- **Aufwand:** 3h

---

### 🟡 MEDIUM

#### M1 – Python-Code in TypeScript-String (pythonScriptText.ts)

- **Datei:** `src/pythonScriptText.ts` (614 Zeilen)
- **Befund:** Enthält ein vollständiges Python-Skript als Template-Literal (Z. 6-614): `AlsMidiAnalyzer`-Klasse mit eigenem SQLite, CSV-Export, matplotlib – eine dritte Kopie der Analyse-Logik (neben TypeScript + Python-Backend). Wird nur zum Download angeboten, nicht ausgeführt.
- **Roadmap:** Nicht gelistet
- **Aufwand:** 0.5h
- **Vorschlag:** Entfernen oder durch Link auf Backend ersetzen

---

### 🟢 LOW

#### L1 – postgres_db.py (Name)

- **Datei:** `backend/postgres_db.py`
- **Befund:** Enthält asyncpg-Code für PostgreSQL. Ehemals `supabase_db.py` – Umbenennung abgeschlossen. Der Name ist präzise, aber die Datei wird im aktuellen SQLite-Setup nicht verwendet.
- **Roadmap:** Aufgabe 1.3 – **COMPLETED**
- **Aufwand:** 0h (erledigt)

---

## Zusammenfassung

| # | Violation | Severity | Roadmap | Aufwand |
|---|---|---|---|---|
| H1 | SQL nicht vollständig in Repository | 🔴 HIGH | 2.1/2.2 | 2h |
| H2 | process_als.py zu gross (720 Z.) | 🔴 HIGH | 2.3 | 3h |
| H3 | alsParser.ts mischt Parser/Analyse | 🔴 HIGH | 3.3 | 2h |
| H4a | KDE in SvgCharts.tsx | 🔴 HIGH | 3.4 | 1h |
| H4b | Jitter in CreativeVisualizer.tsx | 🔴 HIGH | 3.4 | – |
| H4c | avgDriftMs in App.tsx | 🔴 HIGH | (Implizit) | 0.5h |
| H5 | medientechnikAnalysis.ts clientseitig | 🔴 HIGH | 3.2 | 2h |
| H6 | Doppelte Analyse TS/Python | 🔴 HIGH | 3.1 | 3h |
| M1 | pythonScriptText.ts (Embedded Python) | 🟡 MEDIUM | – | 0.5h |
| L1 | postgres_db.py (Name) | 🟢 LOW | 1.3 | ✅ |

**Gesamtaufwand (offen):** ~14h

---

## Minimal-Migration (Vorschlag)

Kleinster Schritt mit größtem Effekt:

1. **H1 (2h):** `save_to_db()` aus `process_als.py` entfernen, stattdessen `repo.save_session()` in `/api/upload` und `/api/analyze` verwenden. → Schließt die letzte SQL-Lücke in `main.py`.
2. **H4a+H4b (1h):** KDE-Funktion (`gaussianKde`) als ersten Backend-Analyse-Endpoint implementieren (`/api/analyze/kde`), `SvgCharts.tsx` und `CreativeVisualizer.tsx` rufen API auf.
3. **H4c (0.5h):** avgDriftMs-Filter in `App.tsx` durch Backend-Call ersetzen oder Drift-Werte aus dem `enriched`-Objekt direkt nutzen.

**→ 3.5h für den größten Fortschritt.** Danach ist das Repository vollständig und die erste clientseitige Analyse ins Backend migriert.

---

## Erfolgskriterien-Check

| Kriterium | Status |
|---|---|
| `main.py` enthält kein SQL | ❌ (`save_to_db`-Umweg) |
| `process_als.py` ≤ 200 Z./Modul | ❌ (720 Z., kein analysis/) |
| `alsParser.ts` nur Parsing | ❌ (1500 Z., gemischt) |
| Analyse-Metriken via API | ❌ (alle clientseitig) |
| TypeScript-Build 0 Fehler | ✅ |
| Docker-Container läuft | ✅ |
| Alte Sessions lesbar | ✅ |
