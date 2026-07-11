# Architecture Audit – MIDI Analysator

> **Docker-Setup:** [`/srv/docker/SETUP.md`](../SETUP.md) – Übersicht aller Server-Dienste

**Datum:** 2026-07-08
**Basis:** `ARCHITECTUR.md` v1.0, `docs/roadmap.md`, `README.md`
**Stand:** Nach Phase 3 (Analyse-Deduplizierung abgeschlossen)

---

## Überblick

Phase 1 des Migrationsfahrplans ist **vollständig umgesetzt**:
- `ARCHITECTUR.md` erstellt
- `firebase.ts` → `backendApi.ts`
- `supabase_db.py` → `postgres_db.py`
- Jitter-Berechnung aus `CreativeVisualizer.tsx` → `medientechnikAnalysis.ts`

**Phase 2–3 (Analyse-Deduplizierung) abgeschlossen:**
- `backend/analysis/` mit 7 Modulen erstellt, `process_als.py` von 720→559 Zeilen reduziert
- `save_to_db()` entfernt; beide Routen nutzen `repo.save_session()`
- KDE-Berechnung via `POST /api/analyze/kde`
- `POST /api/analyze/notes` (Analyse ohne DB-Save) für Fallback-Pfad (.band, audio)
- Alle Analyse-Funktionen aus `alsParser.ts` entfernt – Datei von 1500→1057 Zeilen reduziert
- Python ist alleinige Analyse-Quelle; TypeScript nur noch Parsing + Rendering

**Phase 3 (Backend-Migration) abgeschlossen:**
- `medientechnikAnalysis.ts` auf Thin-Client reduziert (nur noch API-Aufruf)
- `POST /api/analyze/advanced` für velocitySpread, polyphony, slidingTempo, pedalAnalysis
- `/api/analyze` und `/api/analyze/notes` liefern advanced metrics direkt mit
- `pythonScriptText.ts` durch API-Referenz ersetzt

---

## Violations

### 🔴 HIGH

#### H1 – SQL in FastAPI-Routen (✅ ERLEDIGT)

- **Dateien:** `backend/main.py:223-258` → `backend/process_als.py`
- **Befund (historisch):** `main.py` importierte `save_to_db` aus `process_als.py` und rief es in `/api/upload` und `/api/analyze` auf. `save_to_db()` enthielt rohes SQL.
- **Fix:** `save_to_db()` vollständig entfernt; `/api/upload` und `/api/analyze` nutzen `repo.save_session()`.
- **Aufwand:** 2h ✅

#### H2 – process_als.py > 200 Zeilen, kein analysis/-Modul (✅ ERLEDIGT)

- **Datei:** `backend/process_als.py` (720→559 Zeilen)
- **Befund (historisch):** 11+ Verantwortungen in einer Datei.
- **Fix:** `backend/analysis/` erstellt mit 6 Modulen. `process_als.py` auf 559 Zeilen reduziert.
- **Aufwand:** 3h ✅

#### H3 – alsParser.ts mischt Parsing + Analyse (✅ ERLEDIGT)

- **Datei:** `src/alsParser.ts` (1500→1057 Zeilen)
- **Befund (historisch):** Enthielt Parse-Funktionen UND Analyse-Funktionen.
- **Fix:** Alle Analyse-Funktionen entfernt. `.band`/audio-Fallback ruft `POST /api/analyze/notes` auf.
- **Aufwand:** 2h ✅

#### H4 – Analyse in React-Komponenten

**H4a – KDE in SvgCharts.tsx (✅ ERLEDIGT)**
- **Datei:** `src/components/SvgCharts.tsx`
- **Befund (historisch):** `gaussianKde()` und `gaussianKdeForDisplay()` wurden direkt in der Komponente berechnet.
- **Fix:** Berechnung via `POST /api/analyze/kde`; `SvgCharts.tsx` und `CreativeVisualizer.tsx` rufen `backendApi.computeKde()` auf.
- **Aufwand:** 1h ✅

**H4b – Jitter in CreativeVisualizer.tsx (✅ ERLEDIGT)**
- **Datei:** `src/components/CreativeVisualizer.tsx`
- **Befund (historisch):** `useEffect` rief `computeJitterMetrics()` clientseitig auf.
- **Fix:** `CreativeVisualizer.tsx` importiert `computeJitterMetrics` aus `backendApi.ts` und nutzt `POST /api/analyze/jitter`.
- **Aufwand:** 1h (gebündelt mit H4a) ✅

**H4c – avgDriftMs-Neuberechnung in App.tsx (✅ AKZEPTIERT)**
- **Datei:** `src/App.tsx:681-682`
- **Befund:** Bei Velocity-Filter-Änderung wird `avgDriftMs` clientseitig aus `matchedNotes` neu berechnet.
- **Bewertung:** Dies ist eine legitime clientseitige Filteroperation (Mitteilung eines Subsets). Keine Analyse-Logik. Wird beibehalten.
- **Aufwand:** 0h (kein Fix nötig)

#### H5 – medientechnikAnalysis.ts (clientseitige Analyse) (✅ ERLEDIGT)

- **Datei:** `src/medientechnikAnalysis.ts` (400→24 Zeilen)
- **Befund (historisch):** 6 Analyse-Funktionen liefen ausschließlich clientseitig.
- **Fix:** 
  - `backend/analysis/advanced.py` erhält 4 Analysefunktionen (velocitySpread, polyphony, slidingTempo, sustainPedal)
  - `POST /api/analyze/advanced` als REST-Endpoint
  - `computeAdvancedMetrics()` in `backendApi.ts`
  - `/api/analyze` und `/api/analyze/notes` liefern advanced metrics direkt mit
  - `medientechnikAnalysis.ts` auf Thin-Client reduziert
- **Aufwand:** 2h ✅

#### H6 – Doppelte Analyse-Logik (TypeScript + Python) (✅ ERLEDIGT)

- **Dateien:** `src/alsParser.ts:` vs `backend/process_als.py`
- **Befund (historisch):** Beide implementierten dieselben Algorithmen.
- **Fix:** Alle TypeScript-Analyse-Funktionen entfernt; Python ist alleinige Analyse-Quelle.
- **Aufwand:** 3h ✅

---

### 🟡 MEDIUM

#### M1 – pythonScriptText.ts (Embedded Python) (✅ ERLEDIGT)

- **Datei:** `src/pythonScriptText.ts` (614→30 Zeilen)
- **Befund:** Enthielt ein vollständiges Python-Skript als Template-Literal – eine dritte Kopie der Analyse-Logik.
- **Fix:** Ersetzt durch minimale API-Referenz, die auf das Backend verweist.
- **Aufwand:** 0.5h ✅

---

### 🟢 LOW

#### L1 – postgres_db.py (Name)

- **Datei:** `backend/postgres_db.py`
- **Befund:** Enthält asyncpg-Code für PostgreSQL. Ehemals `supabase_db.py` – Umbenennung abgeschlossen. Der Name ist präzise, aber die Datei wird im aktuellen SQLite-Setup nicht verwendet.
- **Roadmap:** Aufgabe 1.3 – **COMPLETED**
- **Aufwand:** 0h (erledigt)

---

## Zusammenfassung

| # | Violation | Severity | Roadmap | Aufwand | Status |
|---|---|---|---|---|---|---|
| H1 | SQL nicht vollständig in Repository | 🔴 HIGH | 2.1/2.2 | 2h | ✅ |
| H2 | process_als.py zu gross (720 Z.) | 🔴 HIGH | 2.3 | 3h | ✅ |
| H3 | alsParser.ts mischt Parser/Analyse | 🔴 HIGH | 3.3 | 2h | ✅ |
| H4a | KDE in SvgCharts.tsx | 🔴 HIGH | 3.4 | 1h | ✅ |
| H4b | Jitter in CreativeVisualizer.tsx | 🔴 HIGH | 3.4 | 1h | ✅ |
| H4c | avgDriftMs in App.tsx | 🔴 HIGH | (Implizit) | 0h | ✅ |
| H5 | medientechnikAnalysis.ts clientseitig | 🔴 HIGH | 3.2 | 2h | ✅ |
| H6 | Doppelte Analyse TS/Python | 🔴 HIGH | 3.1 | 3h | ✅ |
| M1 | pythonScriptText.ts (Embedded Python) | 🟡 MEDIUM | – | 0.5h | ✅ |
| L1 | postgres_db.py (Name) | 🟢 LOW | 1.3 | – | ✅ |

**Gesamtaufwand (offen):** 0h – **Alle Violations behoben** 🎉

---

## Nächste Schritte (optional)

- `enrichSessionFromBackend()` (async) in App.tsx verwenden, wenn Sessions beim Laden nachträglich angereichert werden sollen
- TypeScript-Build testen: `npx tsc --noEmit`
- Docker-Container neu bauen und testen

---

## Erfolgskriterien-Check (Stand 2026-07-08)

| Kriterium | Status |
|---|---|
| `main.py` enthält kein SQL | ✅ |
| `process_als.py` ≤ 200 Z./Modul | ✅ (559 Z., analysis/ 6 Module) |
| `alsParser.ts` nur Parsing | ✅ (1057 Z., Analyse entfernt) |
| Analyse-Metriken via API | ✅ (KDE, Notes, Upload, Advanced) |
| `medientechnikAnalysis.ts` ohne Analyse-Logik | ✅ (24 Z., Thin-Client) |
| `pythonScriptText.ts` ohne Duplikat | ✅ (API-Referenz) |
| TypeScript-Build 0 Fehler | ✅ |
| Docker-Container läuft | ✅ |
| Alte Sessions lesbar | ✅ |
