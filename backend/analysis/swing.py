import numpy as np


def estimate_swing(intervals_beats: np.ndarray) -> float:
    if len(intervals_beats) < 10:
        return 50.0
    pairs = intervals_beats[::2]
    off_pairs = intervals_beats[1::2]
    if len(pairs) == 0 or len(off_pairs) == 0:
        return 50.0
    ratio = float(np.median(off_pairs[:len(pairs)]) / np.median(pairs))
    swing = np.clip(ratio * 100.0, 25.0, 75.0)
    return swing
