#!/usr/bin/env python3
"""Deterministically normalize the fictitious USAi fixture source catalog."""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    source = json.loads(args.source.read_text())
    output = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": source["availableModels"],
        "recommendations": source["recommendedModels"],
    }
    # Write LF on every platform: the committed snapshot is byte-compared, and
    # Path.write_text defaults to os.linesep translation on Windows (CRLF).
    args.out.write_text(json.dumps(output, indent=2) + "\n", newline="\n")


if __name__ == "__main__":
    main()
