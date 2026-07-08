import numpy as np

from typing import Any


def classify_style(notes: list[dict[str, Any]], avg_drift: float, note_count: int) -> tuple[str, str]:
    if note_count < 10:
        return 'Melodisch', 'Klassisches Stück'
    velocities = [n['velocity'] for n in notes]
    avg_vel = np.mean(velocities)
    vel_std = np.std(velocities)
    style = 'Melodisch' if avg_vel > 60 else 'Harmonisch'
    structure = 'Improvisation' if avg_drift > 30 or vel_std > 35 else 'Klassisches Stück'
    return style, structure
