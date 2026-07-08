import numpy as np

from typing import Any

NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']


def estimate_key(notes: list[dict[str, Any]]) -> str:
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
