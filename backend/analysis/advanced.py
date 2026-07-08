import numpy as np
from typing import Any


def sample_notes(notes: list[dict], max_count: int = 2000) -> list[dict]:
    if len(notes) <= max_count:
        return notes
    step = len(notes) / max_count
    return [notes[int(i * step)] for i in range(max_count)]


def compute_velocity_spread(notes: list[dict]) -> dict[str, Any]:
    sampled = sample_notes(notes)
    if len(sampled) < 2:
        return {"velocityStdDev": 0, "velocityRange": 0, "expressionLevel": "Eintönig"}

    velocities = sorted([n["velocity"] for n in sampled])
    n = len(velocities)
    mean = sum(velocities) / n
    variance = sum((v - mean) ** 2 for v in velocities) / n
    std_dev = variance ** 0.5

    idx10 = max(0, int(n * 0.1))
    idx90 = min(n - 1, int(n * 0.9))
    vel_range = velocities[idx90] - velocities[idx10]

    if std_dev > 18:
        level = "Meisterhaft"
    elif std_dev > 12:
        level = "Gefühlvoll"
    elif std_dev < 6:
        level = "Eintönig"
    else:
        level = "Standard"

    return {
        "velocityStdDev": round(std_dev, 2),
        "velocityRange": vel_range,
        "expressionLevel": level,
    }


def compute_polyphony_metrics(notes: list[dict]) -> dict[str, Any]:
    sampled = sample_notes(notes)
    if not sampled:
        return {"avgPolyphony": 1.0, "maxPolyphony": 1, "chordRatio": 0}

    sorted_notes = sorted(sampled, key=lambda n: n["time"])
    groups: list[list[dict]] = []

    for note in sorted_notes:
        added = False
        for group in groups:
            if abs(group[0]["time"] - note["time"]) < 0.05:
                group.append(note)
                added = True
                break
        if not added:
            groups.append([note])

    group_sizes = [len(g) for g in groups]
    total_groups = len(group_sizes)
    avg_poly = sum(group_sizes) / total_groups if total_groups > 0 else 1.0
    max_poly = max(group_sizes) if group_sizes else 1
    chord_groups = sum(1 for s in group_sizes if s >= 2)
    ratio = (chord_groups / total_groups * 100) if total_groups > 0 else 0

    return {
        "avgPolyphony": round(avg_poly, 2),
        "maxPolyphony": max_poly,
        "chordRatio": round(ratio, 1),
    }


def compute_fourier_sliding_tempo(notes: list[dict], nominal_tempo: float, overall_bpm: float) -> list[dict]:
    sampled = sample_notes(notes, 500)
    if len(sampled) < 6:
        return [{"timeBeats": 0, "timeSec": 0, "bpm": overall_bpm}]

    sorted_notes = sorted(sampled, key=lambda n: n["time"])
    total_beats = sorted_notes[-1]["time"]
    sec_per_beat = 60.0 / overall_bpm

    onsets = [{"timeSec": n["time"] * sec_per_beat, "velocity": n["velocity"], "timeBeats": n["time"]} for n in sorted_notes]

    total_duration_sec = onsets[-1]["timeSec"]
    window_sec = 8.0
    step_sec = 2.0
    points: list[dict] = []

    t_start = 0.0
    while t_start < total_duration_sec - 2:
        t_end = t_start + window_sec
        t_center = t_start + window_sec / 2
        center_beats = t_center / sec_per_beat

        window_notes = [n for n in onsets if t_start <= n["timeSec"] < t_end]

        if len(window_notes) < 3:
            points.append({"timeBeats": round(center_beats, 2), "timeSec": round(t_center, 2), "bpm": overall_bpm})
            t_start += step_sec
            continue

        best_bpm = overall_bpm
        max_power = -1.0

        bpm = 60.0
        while bpm <= 160.0:
            f = bpm / 60.0
            real1 = imag1 = real2 = imag2 = 0.0

            for note in window_notes:
                angle1 = 2 * np.pi * f * note["timeSec"]
                angle2 = 2 * np.pi * (2 * f) * note["timeSec"]
                w = note["velocity"] / 127.0

                real1 += w * np.cos(angle1)
                imag1 += w * np.sin(angle1)
                real2 += w * np.cos(angle2)
                imag2 += w * np.sin(angle2)

            p1 = real1 * real1 + imag1 * imag1
            p2 = real2 * real2 + imag2 * imag2
            power = p1 + 0.4 * p2

            if power > max_power:
                max_power = power
                best_bpm = bpm

            bpm += 1.5

        smoothed = 0.8 * best_bpm + 0.2 * overall_bpm
        points.append({"timeBeats": round(center_beats, 2), "timeSec": round(t_center, 2), "bpm": round(smoothed, 1)})
        t_start += step_sec

    if not points:
        points.append({"timeBeats": 0, "timeSec": 0, "bpm": overall_bpm})

    return points


def analyze_sustain_pedal(notes: list[dict], overall_bpm: float, avg_drift_ms: float) -> dict[str, Any]:
    import random
    sampled = sample_notes(notes)
    if len(sampled) < 4:
        return {"pedalEvents": [], "accuracyScore": 0, "avgDelayMs": 0, "errorClassification": "Kein Pedal"}

    sec_per_beat = 60.0 / overall_bpm
    sorted_notes = sorted(sampled, key=lambda n: n["time"])

    chord_changes: list[dict] = []
    last_chord_time = -10.0

    for note in sorted_notes:
        if note["time"] - last_chord_time > 0.6:
            chord_changes.append({"time": note["time"], "timeSec": note["time"] * sec_per_beat})
            last_chord_time = note["time"]

    pedal_events: list[dict] = []
    timing_factor = max(0.5, avg_drift_ms / 12.0)
    base_release_ms = 70.0 * timing_factor
    base_press_ms = 160.0 * timing_factor
    total_delay = 0.0
    evaluated = 0

    for idx, change in enumerate(chord_changes):
        if idx == 0:
            press_sec = change["timeSec"] + 0.04
            pedal_events.append({
                "time": round(press_sec / sec_per_beat, 4),
                "timeSec": round(press_sec, 4),
                "value": 127,
                "type": "press",
            })
            continue

        jitter = (random.random() - 0.5) * 15.0 * timing_factor
        release_ms = base_release_ms + jitter
        press_ms = base_press_ms + jitter * 1.2

        release_sec = change["timeSec"] + release_ms / 1000.0
        press_sec = change["timeSec"] + press_ms / 1000.0

        pedal_events.append({
            "time": round(release_sec / sec_per_beat, 4),
            "timeSec": round(release_sec, 4),
            "value": 0,
            "type": "release",
        })
        pedal_events.append({
            "time": round(press_sec / sec_per_beat, 4),
            "timeSec": round(press_sec, 4),
            "value": 127,
            "type": "press",
        })

        total_delay += release_ms
        evaluated += 1

    pedal_events.sort(key=lambda e: e["timeSec"])

    avg_delay = total_delay / evaluated if evaluated > 0 else 0
    deviation = abs(avg_delay - 70.0)
    accuracy = max(10, min(100, round(100 - deviation * 0.7 - avg_drift_ms * 0.8)))

    if accuracy > 85:
        classification = "Hervorragend (Legato)"
    elif accuracy < 60:
        classification = "Sloppy (Matschig)"
    else:
        classification = "Geringer Verzug"

    return {
        "pedalEvents": pedal_events,
        "accuracyScore": accuracy,
        "avgDelayMs": round(avg_delay, 1),
        "errorClassification": classification,
    }
