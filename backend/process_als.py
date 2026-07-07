import gzip
import io
import json
import math
import re
import uuid
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import mido


NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']


def note_name(key: float) -> str:
    k = round(key)
    return f"{NOTE_NAMES[k % 12]}{k // 12 - 1}"


def extract_file_datetime(file_path: str) -> tuple[str, str, int]:
    # YYYY-MM-DD
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', file_path)
    if m:
        y, mon, d = m.group(1), m.group(2), m.group(3)
        try:
            dt = datetime(int(y), int(mon), int(d))
            return f"{y}-{mon}-{d}", '14:00', (dt.weekday() + 1) % 7
        except ValueError:
            pass

    # DD.MM.YYYY or YYYY.MM.DD
    m = re.search(r'(\d{4})[._](\d{2})[._](\d{2})', file_path)
    if m:
        a, b, c = m.group(1), m.group(2), m.group(3)
        # Could be YYYY.MM.DD or DD.MM.YYYY
        if int(a) > 100:
            y, mon, d = a, b, c
        else:
            d, mon, y = a, b, c
        try:
            dt = datetime(int(y), int(mon), int(d))
            return f"{y}-{mon}-{d}", '14:00', (dt.weekday() + 1) % 7
        except ValueError:
            pass

    # DD.MM.YY
    m = re.search(r'(\d{2})[._](\d{2})[._](\d{2})', file_path)
    if m:
        d, mon, y = m.group(1), m.group(2), m.group(3)
        y_full = 2000 + int(y) if int(y) < 50 else 1900 + int(y)
        try:
            dt = datetime(y_full, int(mon), int(d))
            return f"{y_full}-{mon}-{d}", '14:00', (dt.weekday() + 1) % 7
        except ValueError:
            pass

    # DD.MM (no year, use 2026)
    m = re.search(r'(?:^|[^\d])(\d{2})[._](\d{2})(?:[._]|[^\d]|$)', file_path)
    if m:
        d, mon = m.group(1), m.group(2)
        try:
            dt = datetime(2026, int(mon), int(d))
            return f"2026-{mon}-{d}", '14:00', (dt.weekday() + 1) % 7
        except ValueError:
            # month > 12 → try MM.DD
            try:
                dt = datetime(2026, int(d), int(mon))
                return f"2026-{d}-{mon}", '14:00', (dt.weekday() + 1) % 7
            except ValueError:
                pass

    today = datetime.now()
    return today.strftime('%Y-%m-%d'), '14:00', (today.weekday() + 1) % 7


def parse_als(file_bytes: bytes) -> list[dict]:
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(file_bytes)) as f:
            xml_str = f.read().decode('utf-8', errors='replace')
    except Exception:
        xml_str = file_bytes.decode('utf-8', errors='replace')
    xml_str = re.sub(r'^\ufeff', '', xml_str)
    root = ET.fromstring(xml_str)
    
    tempo = 120.0
    for ann in root.iter('Manual'):
        v = ann.get('Value') or ann.get('value')
        if v:
            try:
                t = float(v)
                if t > 1.0:
                    tempo = t
            except ValueError:
                pass
    
    notes: list[dict] = []
    
    for track in root.iter('MidiTrack'):
        track_on = True
        for to in track.iter('TrackOn'):
            v = to.get('Value') or to.get('value')
            if v and v.lower() == 'false':
                track_on = False
        if not track_on:
            continue
        
        track_name = 'MIDI Track'
        for name_el in track.iter('Name'):
            eff = name_el.find('EffectiveName')
            if eff is not None:
                track_name = eff.get('Value') or eff.get('value') or track_name
            else:
                track_name = name_el.get('Value') or name_el.get('value') or track_name
        
        for clip in track.iter('MidiClip'):
            disabled = False
            for d in clip.iter('Disabled'):
                v = d.get('Value') or d.get('value')
                if v and v.lower() == 'true':
                    disabled = True
            if disabled:
                continue
            
            def _get_val(el, tag):
                for child in el.iter(tag):
                    v = child.get('Value') or child.get('value')
                    if v is not None:
                        return v
                return None
            
            current_start_str = _get_val(clip, 'CurrentStart')
            current_end_str = _get_val(clip, 'CurrentEnd')
            clip_start_str = _get_val(clip, 'Start')
            
            current_start = float(current_start_str) if current_start_str else None
            current_end = float(current_end_str) if current_end_str else None
            clip_start = float(clip_start_str) if clip_start_str else 0.0
            
            is_session = current_start is None or current_start < -10000
            if is_session:
                current_start = None
                current_end = None
            
            loop_on = False
            loop_start = 0.0
            loop_end = 4.0
            loop_len = 4.0
            for loop in clip.iter('Loop'):
                for child in loop:
                    tag = child.tag.lower()
                    if tag == 'loopon':
                        v = child.get('Value') or child.get('value')
                        if v:
                            loop_on = v.lower() == 'true'
                    elif tag == 'start':
                        v = child.get('Value') or child.get('value')
                        if v:
                            loop_start = float(v)
                    elif tag == 'end':
                        v = child.get('Value') or child.get('value')
                        if v:
                            loop_end = float(v)
                loop_len = loop_end - loop_start
            
            clip_duration = (current_end - current_start) if current_start is not None and current_end is not None else None
            
            for kt in clip.iter('KeyTrack'):
                key = None
                for mk in kt.iter('MidiKey'):
                    v = mk.get('Value') or mk.get('value')
                    if v:
                        key = int(v)
                if key is None:
                    for k_el in kt.iter('Key'):
                        v = k_el.get('Value') or k_el.get('value')
                        if v:
                            key = int(v)
                if key is None:
                    continue
                
                for note_el in kt.iter('MidiNoteEvent'):
                    time_attr = _get_val(note_el, 'Time')
                    dur_attr = _get_val(note_el, 'Duration')
                    vel_attr = _get_val(note_el, 'Velocity')
                    
                    if not time_attr:
                        continue
                    
                    internal_time = float(time_attr)
                    duration = float(dur_attr) if dur_attr else 0.25
                    velocity = float(vel_attr) if vel_attr else 100
                    
                    def add_note(t, d, v, k, tn):
                        notes.append({
                            'key': float(k),
                            'noteName': note_name(k),
                            'velocity': v,
                            'time': round(t, 6),
                            'duration': round(d, 6),
                            'trackName': tn,
                        })
                    
                    if current_start is not None and current_end is not None:
                        if loop_on and internal_time >= loop_start and internal_time < loop_end:
                            loop_start_in_clip = loop_end - clip_start
                            loop_note_offset = internal_time - loop_start
                            if loop_len > 0.001:
                                max_cycles = min(10000, int(clip_duration / loop_len) + 2)
                                for cycle in range(max_cycles):
                                    r = loop_start_in_clip + cycle * loop_len + loop_note_offset
                                    if r >= clip_duration:
                                        break
                                    if r >= 0:
                                        add_note(current_start + r, duration, velocity, key, track_name)
                        elif internal_time < loop_start:
                            r = internal_time - clip_start
                            if r >= 0 and clip_duration and r < clip_duration:
                                add_note(current_start + r, duration, velocity, key, track_name)
                        else:
                            r = internal_time - clip_start
                            if clip_duration and r >= 0 and r < clip_duration:
                                add_note(current_start + r, duration, velocity, key, track_name)
                    else:
                        add_note(internal_time, duration, velocity, key, track_name)
    
    return notes, tempo


def parse_midi(file_bytes: bytes) -> tuple[list[dict], float]:
    mid = mido.MidiFile(file=io.BytesIO(file_bytes))
    tempo = 120.0
    notes: list[dict] = []
    tick_time = 0
    abs_time = 0.0
    
    for msg in mid:
        abs_time += msg.time
        if msg.type == 'set_tempo':
            tempo = mido.tempo2bpm(msg.tempo)
        elif msg.type == 'note_on' and msg.velocity > 0:
            t = (abs_time * tempo / mid.ticks_per_beat) / 60.0 if mid.ticks_per_beat else abs_time
            notes.append({
                'key': float(msg.note),
                'noteName': note_name(msg.note),
                'velocity': float(msg.velocity),
                'time': round(t, 6),
                'duration': 0.25,
                'trackName': msg.track or 'MIDI',
            })
    
    return notes, tempo


def analyze_notes(notes: list[dict], nominal_tempo: float) -> dict[str, Any]:
    if not notes:
        return {
            'estimatedBpm': nominal_tempo,
            'avgDriftMs': 0.0,
            'swingFactor16th': 50.0,
            'estimatedKey': 'Unbekannt',
            'styleCategory': 'Melodisch',
            'structureCategory': 'Klassisches Stück',
            'notes': [],
        }
    
    times = np.array([n['time'] for n in notes], dtype=np.float64)
    velocities = np.array([n['velocity'] for n in notes], dtype=np.float64)
    
    times_sec = times * (60.0 / nominal_tempo)
    start_time = times_sec[0]
    relative_times = times_sec - start_time
    
    best_bpm = nominal_tempo
    best_score = -1.0
    for bpm in np.arange(60.0, 160.5, 0.5):
        g = 15.0 / bpm
        nearest = np.round(relative_times / g) * g
        dist = np.abs(relative_times - nearest)
        sigma = 0.022
        scores = np.exp(-(dist * dist) / (2.0 * sigma * sigma))
        scores[0] = 0.0
        score = float(np.sum(scores))
        center_factor = math.exp(-((bpm - 95.0) ** 2) / (2.0 * 40.0 * 40.0))
        adj = score * (0.8 + 0.2 * center_factor)
        if adj > best_score:
            best_score = adj
            best_bpm = bpm
    
    estimated_bpm = round(best_bpm, 1)
    
    grid = _estimate_grid(times)
    ms_per_beat = 60000.0 / estimated_bpm
    bpm_ratio = estimated_bpm / nominal_tempo
    
    adjusted_notes = []
    for n in notes:
        played_beats = n['time'] * bpm_ratio
        nearest_grid = round(played_beats / grid) * grid
        grid_offset = played_beats - nearest_grid
        adjusted_notes.append({
            **n,
            'time': round(played_beats, 4),
            'gridOffset': round(grid_offset, 4),
            'gridOffsetMs': round(grid_offset * ms_per_beat, 2),
            'nearestGrid': round(nearest_grid, 4),
        })
    
    drifts = np.abs([n['gridOffsetMs'] for n in adjusted_notes])
    avg_drift = float(np.mean(drifts))
    
    sorted_times = sorted(set(times_sec.tolist()))
    intervals = np.diff(sorted_times)
    if len(intervals) > 0:
        beats_per_sec = estimated_bpm / 60.0
        intervals_beats = intervals * beats_per_sec
        swing = _estimate_swing(intervals_beats)
    else:
        swing = 50.0
    
    key = _estimate_key(notes)
    style, structure = _classify_style(notes, avg_drift, len(notes))
    
    return {
        'estimatedBpm': estimated_bpm,
        'avgDriftMs': round(avg_drift, 2),
        'swingFactor16th': round(swing, 1),
        'estimatedKey': key,
        'styleCategory': style,
        'structureCategory': structure,
        'notes': adjusted_notes,
    }


def _estimate_grid(times: np.ndarray) -> float:
    if len(times) < 5:
        return 0.25
    sorted_t = np.sort(times)
    intervals = np.diff(sorted_t)
    intervals = intervals[(intervals > 0.01) & (intervals < 4.0)]
    if len(intervals) < 3:
        return 0.25
    candidates = [0.0625, 0.125, 0.1875, 0.25, 0.375, 0.5]
    best_g = 0.25
    best_n = 0
    for g in candidates:
        ratios = np.round(intervals / g)
        mask = (ratios >= 1) & (np.abs(intervals - ratios * g) < g * 0.12)
        n = int(np.sum(mask))
        if n > best_n:
            best_n = n
            best_g = g
    return best_g


def _estimate_swing(intervals_beats: np.ndarray) -> float:
    if len(intervals_beats) < 10:
        return 50.0
    pairs = intervals_beats[::2]
    off_pairs = intervals_beats[1::2]
    if len(pairs) == 0 or len(off_pairs) == 0:
        return 50.0
    ratio = float(np.median(off_pairs[:len(pairs)]) / np.median(pairs))
    swing = np.clip(ratio * 100.0, 25.0, 75.0)
    return swing


def _estimate_key(notes: list[dict]) -> str:
    if not notes:
        return 'Unbekannt'
    keys = np.array([round(n['key']) % 12 for n in notes])
    hist = np.zeros(12, dtype=np.float64)
    for k in range(12):
        hist[k] = float(np.sum(keys == k))
    if np.max(hist) == 0:
        return 'C-Dur'
    major_profiles = {
        0: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
        5: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    }
    minor_profiles = {
        9: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
        2: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    }
    best_corr = -1
    best_key = 'C-Dur'
    for root, profile in {**major_profiles, **minor_profiles}.items():
        rolled = np.roll(hist, root)
        corr = float(np.corrcoef(rolled, profile)[0, 1]) if np.std(profile) > 0 else 0
        if corr > best_corr:
            best_corr = corr
            best_key = f"{NOTE_NAMES[root]}-Dur" if root in major_profiles else f"{NOTE_NAMES[root]}-Moll"
    return best_key


def _classify_style(notes: list[dict], avg_drift: float, note_count: int) -> tuple[str, str]:
    if note_count < 10:
        return 'Melodisch', 'Klassisches Stück'
    velocities = [n['velocity'] for n in notes]
    avg_vel = np.mean(velocities)
    vel_std = np.std(velocities)
    style = 'Melodisch' if avg_vel > 60 else 'Harmonisch'
    structure = 'Improvisation' if avg_drift > 30 or vel_std > 35 else 'Klassisches Stück'
    return style, structure


def separate_teacher_student(notes: list[dict]) -> dict:
    teacher = [n for n in notes if n['key'] < 60]
    student = [n for n in notes if n['key'] >= 60]
    t_drift = np.mean([abs(n.get('gridOffsetMs', 0)) for n in teacher]) if teacher else 0.0
    s_drift = np.mean([abs(n.get('gridOffsetMs', 0)) for n in student]) if student else 0.0
    return {
        'teacherNoteCount': len(teacher),
        'studentNoteCount': len(student),
        'teacherAvgDriftMs': round(float(t_drift), 2),
        'studentAvgDriftMs': round(float(s_drift), 2),
    }


def compute_focus_score(notes: list[dict], avg_drift_ms: float) -> float:
    if not notes:
        return 0.0
    drifts = [abs(n.get('gridOffsetMs', 0)) for n in notes]
    drift_score = max(0, 100 - np.mean(drifts) * 2)
    vel_std = np.std([n['velocity'] for n in notes])
    vel_score = max(0, 100 - vel_std * 2)
    return round(drift_score * 0.6 + vel_score * 0.4, 1)


def process_file(file_bytes: bytes, file_name: str) -> dict[str, Any]:
    ext = Path(file_name).suffix.lower()
    if ext in ('.mid', '.midi'):
        return process_midi_file(file_bytes, file_name)
    if ext in ('.band', '.zip'):
        return process_band_file(file_bytes, file_name)
    raise ValueError(f"Unsupported file type: {ext}")


def process_midi_file(file_bytes: bytes, file_name: str) -> dict[str, Any]:
    raw_notes, tempo = parse_midi(file_bytes)
    return _analyze_and_build(file_name, raw_notes, tempo)


def process_band_file(file_bytes: bytes, file_name: str) -> dict[str, Any]:
    return _process_zip(file_bytes, file_name)


def _process_zip(file_bytes: bytes, file_name: str) -> dict[str, Any]:
    all_notes: list[dict] = []
    global_tempo = 120.0
    
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
        for name in zf.namelist():
            if name.lower().endswith('.mid') or name.lower().endswith('.midi'):
                data = zf.read(name)
                notes, tempo = parse_midi(data)
                all_notes.extend(notes)
                global_tempo = tempo
    
    date_str, time_str, weekday = extract_file_datetime(file_name)
    
    if not all_notes:
        analysis = {
            'estimatedBpm': global_tempo,
            'avgDriftMs': 0.0,
            'swingFactor16th': 50.0,
            'estimatedKey': 'Unbekannt',
            'styleCategory': 'Melodisch',
            'structureCategory': 'Klassisches Stück',
        }
        analysis_notes = []
        teacher_student = {'teacherNoteCount': 0, 'studentNoteCount': 0, 'teacherAvgDriftMs': 0.0, 'studentAvgDriftMs': 0.0}
        focus_score = 0.0
        avg_vel = 0.0
    else:
        analysis = analyze_notes(all_notes, global_tempo)
        analysis_notes = analysis['notes']
        teacher_student = separate_teacher_student(analysis_notes)
        focus_score = compute_focus_score(analysis_notes, analysis['avgDriftMs'])
        avg_vel = float(np.mean([n['velocity'] for n in all_notes]))
    
    return {
        'fileName': file_name,
        'date': date_str,
        'time': time_str,
        'weekday': weekday,
        'tempo': analysis['estimatedBpm'],
        'notesCount': len(all_notes),
        'avgVelocity': round(avg_vel, 1),
        'avgDriftMs': analysis['avgDriftMs'],
        'swingFactor16th': analysis['swingFactor16th'],
        'estimatedKey': analysis['estimatedKey'],
        'styleCategory': analysis['styleCategory'],
        'structureCategory': analysis['structureCategory'],
        'focusScore': focus_score,
        'teacherStudentSplit': teacher_student,
        'notes': analysis_notes,
    }


def _analyze_and_build(file_name: str, raw_notes: list[dict], tempo: float) -> dict[str, Any]:
    analysis = analyze_notes(raw_notes, tempo)
    analysis_notes = analysis['notes']

    date_str, time_str, weekday = extract_file_datetime(file_name)

    teacher_student = separate_teacher_student(analysis_notes) if analysis_notes else {'teacherNoteCount': 0, 'studentNoteCount': 0, 'teacherAvgDriftMs': 0.0, 'studentAvgDriftMs': 0.0}
    focus_score = compute_focus_score(analysis_notes, analysis['avgDriftMs']) if analysis_notes else 0.0

    avg_vel = float(np.mean([n['velocity'] for n in raw_notes])) if raw_notes else 0

    return {
        'fileName': file_name,
        'date': date_str,
        'time': time_str,
        'weekday': weekday,
        'tempo': analysis['estimatedBpm'],
        'notesCount': len(raw_notes),
        'avgVelocity': round(avg_vel, 1),
        'avgDriftMs': analysis['avgDriftMs'],
        'swingFactor16th': analysis['swingFactor16th'],
        'estimatedKey': analysis['estimatedKey'],
        'styleCategory': analysis['styleCategory'],
        'structureCategory': analysis['structureCategory'],
        'focusScore': focus_score,
        'teacherStudentSplit': teacher_student,
        'notes': analysis_notes,
    }


def save_to_db(db_path: str, result: dict[str, Any]) -> str:
    import sqlite3
    
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    conn = sqlite3.connect(db_path)
    
    existing = conn.execute(
        "SELECT id FROM sessions WHERE file_name = ?", (result['fileName'],)
    ).fetchone()
    
    notes_json = json.dumps(result['notes'], default=str)
    ts_json = json.dumps(result.get('teacherStudentSplit', {}), default=str)
    chart_json = json.dumps(compute_chart_data(result['notes']), default=str)
    
    row = (
        result['date'],
        result['time'],
        result['weekday'],
        result['tempo'],
        result['estimatedBpm'] if 'estimatedBpm' in result else result['tempo'],
        result['notesCount'],
        result['avgVelocity'],
        result['avgDriftMs'],
        result['swingFactor16th'],
        result['estimatedKey'] or 'Unbekannt',
        result['styleCategory'] or 'Melodisch',
        result['structureCategory'] or 'Klassisches Stück',
        result.get('focusScore', 0) or 0,
        ts_json,
        '{}',
        '{}',
        '[]',
        '{}',
        notes_json,
        chart_json,
        now,
    )
    
    if existing:
        conn.execute("""UPDATE sessions SET
            session_date=?, session_time=?, session_weekday=?,
            tempo=?, estimated_bpm=?, notes_count=?,
            avg_velocity=?, avg_drift_ms=?, avg_swing=?, estimated_key=?,
            style_category=?, structure_category=?, focus_score=?,
            teacher_student_json=?, velocity_spread_json=?, polyphony_json=?,
            sliding_tempo_json=?, pedal_analysis_json=?, notes_json=?,
            chart_data_json=?, created_at=?
            WHERE file_name=?""", (*row, result['fileName']))
        session_id = existing['id']
        created = False
    else:
        conn.execute("""INSERT INTO sessions (
            id, file_name, session_date, session_time, session_weekday,
            tempo, estimated_bpm, notes_count,
            avg_velocity, avg_drift_ms, avg_swing, estimated_key,
            style_category, structure_category, focus_score,
            teacher_student_json, velocity_spread_json, polyphony_json,
            sliding_tempo_json, pedal_analysis_json, notes_json,
            chart_data_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (session_id, result['fileName'], *row))
        created = True
    
    conn.commit()
    conn.close()
    return session_id


def compute_chart_data(notes: list[dict]) -> dict:
    """Pre-compute chart data from raw notes (avoids sending raw notes to browser)."""
    import numpy as np
    if not notes:
        return _empty_chart_data()

    offsets = np.array([n["gridOffsetMs"] for n in notes], dtype=np.float64)
    velocities = np.array([n["velocity"] for n in notes], dtype=np.float64)
    times = np.array([n["time"] for n in notes], dtype=np.float64)
    keys = np.array([n.get("key", 60) for n in notes], dtype=np.int32)

    total = len(notes)

    # Bass (<=59) vs Treble (>=60) split
    bass_mask = keys <= 59
    treble_mask = keys >= 60

    def _grid_hist(arr):
        bins = np.arange(-50, 52, 2)
        cnt, _ = np.histogram(arr, bins=bins)
        return [{"lower": round(float(bins[i]), 2), "upper": round(float(bins[i+1]), 2), "count": int(cnt[i])} for i in range(len(cnt))]

    def _vel_hist(arr):
        bins = np.arange(0, 136, 8)
        cnt, _ = np.histogram(arr, bins=bins)
        return [{"lower": int(bins[i]), "upper": int(bins[i+1]), "count": int(cnt[i])} for i in range(len(cnt))]

    grid_hist = _grid_hist(offsets)
    grid_bass = _grid_hist(offsets[bass_mask]) if np.any(bass_mask) else _zero_grid_hist()
    grid_treble = _grid_hist(offsets[treble_mask]) if np.any(treble_mask) else _zero_grid_hist()
    vel_hist = _vel_hist(velocities)

    # Note density per bar, capped at 512 bars
    max_bar = min(int(np.max(times) / 4) + 1, 512)
    bar_counts = np.zeros(max_bar, dtype=np.int32)
    for t in times:
        bar = int(t / 4)
        if bar < max_bar:
            bar_counts[bar] += 1
    note_density = [{"bar": int(i), "count": int(bar_counts[i])} for i in range(len(bar_counts))]

    # Key distribution (piano roll heatmap)
    unique_keys, key_counts = np.unique(keys, return_counts=True)
    key_dist = {int(k): int(c) for k, c in zip(unique_keys, key_counts)}

    # Stats
    mean = float(np.mean(offsets))
    std = float(np.std(offsets))
    median = float(np.median(offsets))
    early = int(np.sum(offsets < -1.5))
    late = int(np.sum(offsets > 1.5))
    early_pct = round(early / total * 100)
    late_pct = round(late / total * 100)
    tight = int(np.sum(np.abs(offsets) <= 1.5))
    tight_pct = round(tight / total * 100)
    m3 = float(np.mean((offsets - mean) ** 3))
    skewness = round(m3 / (std ** 3), 2) if std > 0.001 else 0
    bass_count = int(np.sum(bass_mask))
    bass_pct = round(bass_count / total * 100) if total > 0 else 0

    # 16th-note grid heatmap (avg velocity & drift per 16th position)
    positions_16th = np.floor((times * 4) % 16).astype(np.int32)
    sixteenth_grid = []
    sub_names = ["1", "e", "+", "d"]
    for pos in range(16):
        mask = positions_16th == pos
        cnt = int(np.sum(mask))
        avg_vel = float(np.mean(velocities[mask])) if cnt > 0 else 0
        avg_drift = float(np.mean(offsets[mask])) if cnt > 0 else 0
        sixteenth_grid.append({
            "position": pos,
            "beat": pos // 4 + 1,
            "sub": sub_names[pos % 4],
            "avgVelocity": round(avg_vel, 1),
            "avgDrift": round(avg_drift, 2),
            "count": cnt,
        })

    return {
        "gridOffsetHistogram": grid_hist,
        "gridOffsetBassHistogram": grid_bass,
        "gridOffsetTrebleHistogram": grid_treble,
        "velocityHistogram": vel_hist,
        "noteDensity": note_density,
        "keyDistribution": key_dist,
        "sixteenthGrid": sixteenth_grid,
        "stats": {
            "mean": round(mean, 2),
            "std": round(std, 2),
            "median": round(median, 2),
            "earlyPercent": early_pct,
            "latePercent": late_pct,
            "tightPercent": tight_pct,
            "skewness": skewness,
            "bassPct": bass_pct,
            "totalNotes": total,
        },
    }


def _zero_grid_hist():
    bins = list(range(-50, 52, 2))
    return [{"lower": float(bins[i]), "upper": float(bins[i+1]), "count": 0} for i in range(len(bins) - 1)]


def _empty_chart_data():
    return {
        "gridOffsetHistogram": _zero_grid_hist(),
        "gridOffsetBassHistogram": _zero_grid_hist(),
        "gridOffsetTrebleHistogram": _zero_grid_hist(),
        "velocityHistogram": [{"lower": i, "upper": i+8, "count": 0} for i in range(0, 128, 8)],
        "noteDensity": [],
        "keyDistribution": {},
        "sixteenthGrid": [{"position": i, "beat": i//4+1, "sub": ["1","e","+","d"][i%4], "avgVelocity": 0, "avgDrift": 0, "count": 0} for i in range(16)],
        "stats": {"mean": 0, "std": 0, "median": 0, "earlyPercent": 0, "latePercent": 0, "tightPercent": 0, "skewness": 0, "bassPct": 0, "totalNotes": 0},
    }
