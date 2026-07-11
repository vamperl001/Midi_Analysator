# MIDI Analyse — Halbes Jahr Musikunterricht

**Metriken-gestützte Fortschrittsanalyse von 75+ Schlagzeug-Schülern im Einzelunterricht**

Ein webbasiertes Analyse-Tool, das MIDI-Noten aus Ableton Live Projekten (.als, .mid) extrahiert und mit über 20 Metriken das rhythmische und musikalische Profil von **75+ Schlagzeug-Schülern** über ein **halbes Jahr** vermisst. Der Lehrer begleitet die Schüler am Klavier — daher enthält der Datensatz sowohl Schüler- als auch Lehrer-Daten.

> **Status:** Produktiv | **Backend:** Python FastAPI + SQLite (~600MB, 46 Sessions) | **Frontend:** React + TypeScript + Vite + D3.js | **Laufzeit:** Docker (Port 8090)

---

## Über das Projekt

**Erstentwurf:** Google AI Studio  
**Weiterentwicklung:** Eigenes Backend + React SPA

**Fragestellung:** *Lässt sich der Fortschritt von Schlagzeug-Schülern in den ersten sechs Monaten Unterricht objektiv anhand von MIDI-Daten messen?*

Die Aufnahmen entstanden in drei verschiedenen Räumen mit unterschiedlichen Keyboards:
- **Raum 1 (Hauptraum):** Casio Piano — ca. 3,5 Tage/Woche, der Großteil der Daten
- **Raum 2:** Yamaha Piano — sporadisch
- **Raum 3:** Casio Piano — sporadisch

Der Lehrer (Autor) spielt Klavierbegleitung zu den Schlagzeug-Übungen der Schüler. Daher enthalten die MIDI-Daten sowohl die **Lehrer-Noten (Klavier)** als auch die **Schüler-Noten (Schlagzeug)**.

### Datengrundlage
- **~75+ Schüler** (variable Teilnehmerzahl)
- **>1,3 Millionen MIDI-Noten**
- **46 Sessions** á **6–9 Stunden**, unterteilt in 30/45-Minuten-Slots
- **Zeitraum:** Januar – Juni 2026
- **Aufnahme-Setup:** Ableton Live (MIDI-Aufnahme über Casio/Yamaha Digitalpianos)

### Zukunftsplanung
Verknüpfung der MIDI-Daten mit:
- **Unterrichtsmitschnitten** (Audio/Video)
- **OneNote-Unterrichtsnotizen**
- **RAG-System** für individuelle Fortschrittsauswertung

---

## Analysen

| Metrik | Beschreibung |
|---|---|---|
| **Timing Drift** | Abweichung jeder Note vom nächstgelegenen Grid (1/16tel) in ms |
| **Swing Factor** | Verhältnis der Achtel-Offbeats zum Grid |
| **Tempo / BPM** | Geschätztes Tempo aus Notenabständen |
| **Drift Histogram** | Verteilung der Drift-Werte über alle Noten (D3.js) |
| **Velocity Spread** | Anschlagsdynamik (laut/leise) über die Zeit |
| **Polyphony** | Gleichzeitige Noten (Griffgröße, Mehrstimmigkeit) |
| **Focus Score** | Gewichteter Qualitätsindex aus Drift, Velocity, Polyphonie |
| **Sliding Tempo** | Tempo-Entwicklung innerhalb einer Session |
| **Style Classification** | Kategorisierung (melodisch/rhythmisch/polyphon/hybrid) |
| **Pedal Analysis** | Nutzung des Sustain-Pedals |
| **Teacher/Student Split** | Noten-Trennung per Pitch-Heuristik (key < 60 = Lehrer, >= 60 = Schüler) |
| **Spuranalyse** | Track-übergreifender Mikrotiming-Vergleich |
| **Kalenderansicht** | Tägliche Drift-Entwicklung als Heatmap |
| **Trend Chart** | Metrik-Entwicklung über alle Sessions (D3.js) |
| **Session Comparison** | Side-by-Side Vergleich zweier Sessions |
| **Einzelschüler-Ansicht** | Fortschritt pro Schüler mit Lehrer/Schüler-Drift |
| **Schüler-Filter** | Filtere Sessions per weekday-Rotation auf einen Schüler |
| **Spuren-Filter** | Analysiere nur Noten einer bestimmten Spur |

---

## Architektur

```
┌───────────────────────────────────────────┐
│              Browser (SPA)                 │
│  React · TypeScript · Recharts · D3.js    │
│  Framer Motion · tailwindcss               │
│  ┌─────────────────────────────────────┐   │
│  │ D3DriftHistogram · D3TrendChart    │   │
│  │ AdvancedCharts · CalendarView       │   │
│  │ ProgressionChart · StudentProgress  │   │
│  │ SessionComparison · SvgCharts       │   │
│  └─────────────────────────────────────┘   │
└───────────────────┬───────────────────────┘
                    │ HTTP REST (fetch)
┌───────────────────▼───────────────────────┐
│         Python FastAPI Backend :80         │
│  · /sessions (CRUD, lazy-loaded notes)     │
│  · /api/analyze (KDE, Jitter, Advanced)    │
│  · /api/upload (server-side .mid/.als)     │
│  · /schedule (Stundenplan CRUD)            │
│  · /api/axinio/* (Proxy zu axinio.app)     │
│  · /api/chart-data (Histogramme, Trends)   │
│  Repository-Layer: sqlite_repo.py          │
│  Analyse-Module: timing, swing, key,       │
│    style, separation, focus, jitter        │
└───────┬───────────────────────────────────┘
        │
┌───────▼───────────────────────────────────┐
│  SQLite (Docker-Volume /data/sessions.db)  │
│  46 Sessions · >1,3 Mio Noten · ~600 MB   │
└────────────────────────────────────────────┘
```

**Container (Docker):** Single-Container (Python FastAPI serviert API + React-SPA statische Dateien). Kein nginx.

---

## Datenhaltung

| Aspekt | Lösung |
|---|---|---|
| Datenbank | SQLite (Docker-Volume `/data/sessions.db`, ~600MB) |
| Backup | `/srv/docker/backup.sh` – rotation (max 5), inkl. DB + Source |
| Lazy-Loading | `notes_json`, `sliding_tempo_json`, `pedal_analysis_json` werden nur bei Auswahl geladen |
| Notifications | OCI ARM Checker sendet E-Mail bei freier Kapazität (msmtp → smtp.mail.de) |

---

## Entwicklungsetappen

1. **Prototyp** — Google AI Studio (erster Entwurf)
2. **Firebase** — Datenmodell + erste Metriken (zu teuer, 1MB-Limit)
3. **Eigenes Backend** — Python FastAPI + SQLite + Docker
4. **Supabase** — Testweise PostgreSQL-Migration (für Cloud-Deployment evaluiert)
5. **SQLite-Rückkehr** + Backend-Optimierung (JSON-Spalten aus list_sessions entfernt, ~0.5s Response)
6. **D3.js-Migration** — Handgezeichnete SVGs durch D3-Komponenten ersetzt, ~140 Zeilen Dead Code entfernt
7. **OCS White-Screen Fix** — `Math.min(...largeArray)`-Call-Stack-Overflow in D3-KDE-Funktion behoben
8. **Filterausbau** — Schüler-Filter (per weekday-Rotation), Spuren-Filter (Track-Auswahl in Charts)
9. **OCI ARM Notification** — E-Mail-Benachrichtigung bei freier ARM-Kapazität via msmtp + mail.de SMTP

---

## Lizenz

Projektarbeit, eingereicht im Rahmen einer Master-Bewerbung Medientechnik.
