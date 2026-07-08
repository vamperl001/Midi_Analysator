import math
import numpy as np

from typing import Any


def estimate_grid(times: np.ndarray) -> float:
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


def gaussian_kde(data: list[float], num_points: int = 200) -> list[dict[str, float]]:
    n = len(data)
    if n < 2:
        return []
    arr = np.array(data, dtype=np.float64)
    min_x = float(np.min(arr))
    max_x = float(np.max(arr))
    mean = float(np.mean(arr))
    std = float(np.std(arr))
    h = 1.06 * std * (n ** -0.2)
    bandwidth = max(h, 1.5)
    step = (max_x - min_x) / num_points if max_x > min_x else 1.0
    inv_nh = 1.0 / (n * bandwidth)
    sqrt2pi = math.sqrt(2.0 * math.pi)
    result = []
    for i in range(num_points + 1):
        x = min_x + i * step
        diffs = (x - arr) / bandwidth
        sum_val = float(np.sum(np.exp(-0.5 * diffs * diffs)))
        result.append({"x": round(x, 2), "y": round(sum_val * inv_nh, 6)})
    return result
