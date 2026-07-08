/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const pythonScriptText = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ableton Live .als MIDI Timing & Drift Analyzer
-----------------------------------------------
Hinweis: Die aktuelle Analyse-Logik läuft serverseitig im Docker-Container.
Dieses Skript zeigt die ursprüngliche Standalone-Version.

Zum Herunterladen des aktuellen Backend-Codes:
  https://github.com/gregor/ableton-als-timing-analyzer/tree/main/backend

Siehe auch /api/analyze/advanced für die serverseitigen Metriken.
"""

import os
import sys
import json
import urllib.request

API_BASE = "http://localhost:8000"

def analyze_via_api(file_path: str) -> dict:
    """Reiche eine ALS-Datei zur Analyse ans Backend ein."""
    with open(file_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"{API_BASE}/api/upload?file_name={os.path.basename(file_path)}",
        data=data,
        headers={"Content-Type": "application/octet-stream"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python analyze.py <path-to-als-file>")
        sys.exit(1)
    result = analyze_via_api(sys.argv[1])
    print(json.dumps(result, indent=2, default=str))
`
