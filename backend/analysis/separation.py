import numpy as np

from typing import Any


def separate_teacher_student(notes: list[dict[str, Any]]) -> dict:
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
