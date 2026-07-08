import numpy as np

from typing import Any


def compute_focus_score(notes: list[dict[str, Any]], avg_drift_ms: float) -> float:
    if not notes:
        return 0.0
    drifts = [abs(n.get('gridOffsetMs', 0)) for n in notes]
    drift_score = max(0, 100 - np.mean(drifts) * 2)
    vel_std = np.std([n['velocity'] for n in notes])
    vel_score = max(0, 100 - vel_std * 2)
    return round(drift_score * 0.6 + vel_score * 0.4, 1)
