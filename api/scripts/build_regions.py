"""Build app/data/regions.json from the official KMA grid Excel.

Source: 공공데이터포털 '기상청_단기예보 조회서비스' 참고문서
  기상청41_단기예보 조회서비스_오픈API활용가이드_격자_위경도(2610).xlsx
License: 공공누리 제1유형 (출처표시). Keeps only 시·도 and 시·군·구 rows.

Usage: uv run --with openpyxl python scripts/build_regions.py <path-to-xlsx>
"""

import json
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "regions.json"


def main(xlsx: str) -> None:
    wb = openpyxl.load_workbook(xlsx, read_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = next(rows)
    col = {name: i for i, name in enumerate(header) if name}

    regions = []
    for r in rows:
        if r[col["구분"]] != "kor":
            continue
        sido = (r[col["1단계"]] or "").strip()
        sigungu = (r[col["2단계"]] or "").strip()
        dong = (r[col["3단계"]] or "").strip()
        if not sido or dong or sido == "이어도":  # offshore station, not a residential region
            continue
        regions.append(
            {
                "code": str(r[col["행정구역코드"]]),
                "sido": sido,
                "sigungu": sigungu,
                "name": f"{sido} {sigungu}".strip(),
                "nx": int(r[col["격자 X"]]),
                "ny": int(r[col["격자 Y"]]),
                "lat": round(float(r[col["위도(초/100)"]]), 5),
                "lon": round(float(r[col["경도(초/100)"]]), 5),
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "기상청 단기예보 조회서비스 격자·위경도(2610), 공공누리 제1유형",
        "regions": regions,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(regions)} regions → {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
