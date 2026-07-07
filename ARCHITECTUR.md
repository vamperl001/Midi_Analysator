# MIDI Analysator — Architekturregeln

Version: 1.0 (IST-Stand Juli 2026)

Diese Datei beschreibt die tatsächliche Architektur des Projekts,
dokumentiert Abweichungen vom Ideal und definiert die Migrationsstrategie.

---

## Projektziel

Analyse von MIDI-Daten aus einem halben Jahr Musikunterricht:

- **>1.300.000 MIDI-Events**
- **~44 Sessions** (6–9 Stunden Unterricht)
- **~75 Schüler** (Schlagzeug via E-Drums)
- **2 Spieler gleichzeitig** (Lehrer Klavier + Schüler Schlagzeug)
- **Zeitraum:** Januar – Juni 2026

Das Projekt läuft als Docker-Container auf einem privaten Linux-Server,
ist nicht öffentlich erreichbar und dient als Master-Bewerbung Medientechnik.

---

## Architektur (IST)

```
┌─────────────────────────────────────────────────────┐
│                   Browser (React SPA)                │
│  App.tsx · SvgCharts · AdvancedCharts · Calendar     │
│  ProgressionChart · CreativeVisualizer · SessionComp │
│  StudentProgress                                     │
│                                                      │
│  ⚠ Enthält Analyse-Logik (alsParser.ts,              │
│    medientechnikAnalysis.ts, CreativeVisualizer)      │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (fetch)
                       ▼
┌─────────────────────────────────────────────────────┐
│              FastAPI (Python) :80                    │
│  main.py · /api/upload · /api/analyze               │
│  /sessions (CRUD) · /schedule · /api/axinio/*       │
│                                                      │
│  ⚠ Enthält SQL in Route-Handlern                     │
│  ⚠ Vermischt Controller + Repository                 │
└──────┬───────────────────────────────┬──────────────┘
       │                               │
       ▼                               ▼
┌─────────────────┐         ┌──────────────────────┐
│  Analysis Engine │         │  process_als.py      │
│  (process_als.py)│         │  midi parsing         │
│  timing · swing   │         │  grid fitting         │
│  key · style      │         │  teacher/student      │
│  focus score      │         │  focus score          │
└─────────────────┘         └──────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│              Repository Layer (kein separater)       │
│  main.py (embedded SQL) · supabase_db.py             │
│                                                      │
│  ⚠ SQL ist NICHT isoliert – liegt in main.py         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  SQLite (/data/sessions.db)                          │
│  Keine Analyse, keine Geschäftslogik                 │
└─────────────────────────────────────────────────────┘
```

---

## Ist die Vorlage erfüllt?

| Regel | Status |
|---|---|
| React nur Darstellung | ❌ **Verletzt** — `alsParser.ts` analysiert MIDI, `CreativeVisualizer.tsx` berechnet Jitter |
| FastAPI kein SQL | ❌ **Verletzt** — `main.py` hat SQL in Routes |
| Separater Repository Layer | ❌ **Fehlt** — SQL in `main.py` + `postgres_db.py` |
| Analysis Engine in Python | ⚠️ **Teilweise** — Analyse ist auf Frontend (TypeScript) UND Backend (Python) verteilt |
| Klare Trennung Parser/Analysis | ❌ **Verletzt** — `alsParser.ts` mischt Parsen + Analyse in einer Datei |
| Keine Analyse in React | ❌ **Verletzt** — `analyzeSessionMidiStats()`, `enrichSessionWithAdvancedMetrics()`, Jitter |
| Analyse-Module einzeln | ❌ **Nicht umgesetzt** — alles in `process_als.py` (720 Zeilen) |

---

## Dateistruktur (IST)

```
/
├── src/                          # FRONTEND (React + TypeScript)
│   ├── App.tsx                   # Hauptkomponente, State, Routing
│   ├── alsParser.ts              # ⚠️ PARSER + ANALYSE (1500 Zeilen)
│   ├── medientechnikAnalysis.ts   # Advanced Metrics (clientseitig)
│   ├── backendApi.ts             # REST-API-Client (ehem. firebase.ts)
│   ├── theme.ts                  # Zentrale Farbkonstanten
│   ├── types.ts                  # TypeScript-Datenmodelle
│   ├── pythonScriptText.ts       # Python-Code als String (Embedded)
│   ├── index.css / main.tsx      # Einstiegspunkte
│   └── components/
│       ├── SvgCharts.tsx          # SVG-Charts mit Inline-KDE
│       ├── AdvancedCharts.tsx     # Recharts-Charts (Advanced)
│       ├── ProgressionChart.tsx   # Lernkurve über Zeit
│       ├── CreativeVisualizer.tsx # Jitter via medientechnikAnalysis
│       ├── CalendarView.tsx       # Monats-Übersicht
│       ├── SessionComparison.tsx  # Side-by-Side-Vergleich
│       ├── StudentProgress.tsx    # Einzelschüler-Ansicht
│       ├── CountUp.tsx            # Animierter Zähler
│       └── CustomResponsiveContainer.tsx
│
├── backend/                      # BACKEND (Python FastAPI)
│   ├── main.py                   # ⚠️ Controller + SQL + Repo
│   ├── process_als.py            # Analysis Engine (720 Zeilen)
│   ├── postgres_db.py            # DB-Layer (asyncpg, ehem. supabase_db.py)
│   ├── config.py                 # DB-Konfiguration
│   └── requirements.txt
│
├── Dockerfile                    # Multi-Stage (Node Build → Python Serve)
├── docker-compose.yml            # midi_app :8090 → :80
├── docs/
│   ├── entwicklungsprozess.md    # Projektdokumentation
│   └── roadmap.md                # Migrationsfahrplan
├── ARCHITECTUR.md                # diese Datei
├── index.html                    # SPA-Einstieg
├── package.json / tsconfig.json / vite.config.ts
└── metadata.json
```

---

## Datenfluss (IST)

```
Datei-Upload (.als / .mid / .band / Audio)
│
├── .mid → POST /api/upload → process_midi_file() → analyze_notes()
│         ← JSON mit avgDriftMs, swing, notes
│         → enrichSessionWithAdvancedMetrics() (CLIENT-SEITIG)
│
├── .als → parseAlsFile() (CLIENT) → POST /api/analyze → analyze_notes()
│         ← JSON mit avgDriftMs, swing, notes
│         → enrichSessionWithAdvancedMetrics() (CLIENT-SEITIG)
│
└── .band/Audio → parseAlsFile() (CLIENT, komplett)
                → analyzeSessionMidiStats() (CLIENT-SEITIG)
                → enrichSessionWithAdvancedMetrics() (CLIENT-SEITIG)
                         │
                         ▼
                   loadedFiles[] (React State)
                         │
                         ▼
              ┌──────────────────────┐
              │  Save to Cloud?       │──→ POST /sessions → SQLite
              │  Load from DB?        │←── GET /sessions → SQLite
              │  Select session       │──→ lazy load notes
              └──────────────────────┘
                         │
                         ▼
              Charts & Visualisierungen
              (SvgCharts, AdvancedCharts,
               ProgressionChart, CreativeVisualizer)
```

---

## Analyse-Module (IST vs SOLL)

| Modul | IST (wo?) | SOLL (wo?) |
|---|---|---|
| Timing/Grid | `alsParser.ts:721` + `process_als.py:300` | `analysis/timing.py` |
| Swing | `alsParser.ts:327` + `process_als.py:360` | `analysis/swing.py` |
| Velocity Spread | `medientechnikAnalysis.ts:330` | `analysis/velocity.py` |
| Polyphonie | `medientechnikAnalysis.ts:280` | `analysis/polyphony.py` |
| Sliding Tempo | `medientechnikAnalysis.ts:190` | `analysis/tempo.py` |
| Pedalanalyse | `medientechnikAnalysis.ts:80` | `analysis/pedal.py` |
| Teacher/Student Split | `alsParser.ts:380` + `process_als.py:400` | `analysis/separation.py` |
| Focus Score | `alsParser.ts:1380` + `process_als.py:410` | `analysis/focus.py` |
| Style Classification | `alsParser.ts:306` + `process_als.py:325` | `analysis/style.py` |
| Key Detection | `alsParser.ts:470` + `process_als.py:372` | `analysis/key.py` |
| KDE (Gaussglocke) | `SvgCharts.tsx:249` | `analysis/statistics.py` |
| Jitter | `CreativeVisualizer.tsx` → `medientechnikAnalysis.ts` | `analysis/timing.py` |

---

## Bekannte Architektur-Verstöße

### 1. Analyse in React-Komponenten
- **`CreativeVisualizer.tsx:97-112`** — Jitter-Berechnung (stdDev, diffSum) direkt im useEffect
- **`SvgCharts.tsx:249-271`** — KDE/Gaussian-Kernel in der Komponente
- **`App.tsx:626-633`** — avgDriftMs-Neuberechnung bei Velocity-Filter

### 2. Analyse-Logik im Frontend vs Backend
- `analyzeSessionMidiStats()` existiert in **TypeScript** (`alsParser.ts:259`)
- `analyze_notes()` existiert in **Python** (`process_als.py:285`)
- Beide tun dasselbe — doppelte Wartung

### 3. SQL in FastAPI-Controllern
Sämtliche SQL-Statements liegen direkt in `main.py` — kein Repository-Layer.

### 4. `alsParser.ts` — Parser + Analyse in einer Datei
- Parsing: `.als` XML, `.mid`, `.band` (Zip), Audio
- Analyse: Grid-Fitting, Drift, BPM-Schätzung, Swing, Teacher/Student-Split, Style, Key, Focus Score
- **→ 1500 Zeilen, gemischte Verantwortung**

### 5. `postgres_db.py` — Irreführender Name
- Enthält asyncpg-Code (PostgreSQL), kein Supabase-spezifischer Code

---

## Migrationsstrategie

### Phase 1 (Sofort — bereits umgesetzt)
- [x] `ARCHITECTUR.md` erstellt (diese Datei)
- [x] `firebase.ts` → `backendApi.ts` umbenannt
- [x] `supabase_db.py` → `postgres_db.py` umbenannt
- [x] Jitter-Berechnung aus `CreativeVisualizer.tsx` in `medientechnikAnalysis.ts` verschoben

### Phase 2 (Kurzfristig)
- [ ] SQL aus `main.py` in Repository-Layer extrahieren (`backend/repository/sqlite_repo.py`)
- [ ] `main.py` ruft nur noch Repo-Methoden auf, kein SQL mehr
- [ ] `process_als.py` in Module aufteilen: `analysis/timing.py`, `analysis/swing.py`, `analysis/key.py`, etc.

### Phase 3 (Mittelfristig)
- [ ] `analyzeSessionMidiStats()` (TypeScript) durch API-Aufruf ersetzen
- [ ] `medientechnikAnalysis.ts` durch API-Endpoints ersetzen
- [ ] `alsParser.ts` auf reines Parsing reduzieren
- [ ] KDE/Jitter aus React-Komponenten in API verschieben

---

## Caching-Regel

Aufwändige Analysen (Sliding-Tempo-Fourier, Pedalanalyse) werden in der DB gespeichert:

- `sliding_tempo_json` — Fourier-Analyse
- `pedal_analysis_json` — Sustain-Pedal-Timing
- `velocity_spread_json` — Dynamik-Spreizung
- `polyphony_json` — Akkorddichte
- `chart_data_json` — Histogramme (optional)

Wird dieselbe Session erneut analysiert → vorhandene Ergebnisse verwenden.

---

## Entwicklung

```bash
# Bauen & Starten
docker compose up -d --build

# Logs
docker logs midi_app

# Healthcheck
curl localhost:8090/health

# Browser
open http://localhost:8090
# Hard Refresh: Strg+F5 (Chrome) / Cmd+Shift+R (Mac)
```

---

## Grundprinzip (angestrebt)

```
Parser importiert      → alsParser.ts (reduziert auf Parsing)
Repository lädt Daten  → backend/repository/sqlite_repo.py
Analysis Engine analysiert → backend/analysis/*.py
FastAPI liefert aus     → backend/main.py (nur Routing)
React zeigt an         → src/ (nur Darstellung + API-Calls)
```

**Aktuell noch nicht erreicht — aber dokumentiert und als Ziel definiert.**
