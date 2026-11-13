"""고정한 공개 관측 자료에서 웹용 별·별자리 자료를 만든다."""
import argparse
import json
from pathlib import Path
from urllib.request import urlopen

COMMIT = "7e720a3de062059d4c5400a379146a601d9010e0"
BASE = f"https://raw.githubusercontent.com/ofrohn/d3-celestial/{COMMIT}/"
parser = argparse.ArgumentParser()
parser.add_argument("--source-dir", type=Path)
args = parser.parse_args()

def read(name):
    if args.source_dir:
        return (args.source_dir / Path(name).name).read_text()
    with urlopen(BASE + name, timeout=30) as response:
        return response.read().decode()

names = json.loads(read("data/starnames.json"))
stars = []
for feature in json.loads(read("data/stars.6.json"))["features"]:
    props = feature["properties"]
    identity = feature["id"]
    label = names.get(str(identity), {})
    ra, dec = feature["geometry"]["coordinates"]
    stars.append([identity, ra, dec, props["mag"], float(props["bv"]) if props["bv"] not in (None, "") else 0.6,
                  label.get("ko") or label.get("name") or ""])

constellations = {}
for feature in json.loads(read("data/constellations.json"))["features"]:
    identity = feature["id"]
    if identity in constellations:
        continue
    props = feature["properties"]
    constellations[identity] = {"id": identity, "name": props.get("ko") or props["name"],
                               "latin": props["name"], "center": feature["geometry"]["coordinates"],
                               "rank": int(props["rank"]), "lines": []}
for feature in json.loads(read("data/constellations.lines.json"))["features"]:
    constellations[feature["id"]]["lines"].extend(feature["geometry"]["coordinates"])

root = Path(__file__).resolve().parent.parent / "data"
root.mkdir(exist_ok=True)
payload = {"epoch": "J2000.0", "source": "XHIP / d3-celestial", "commit": COMMIT,
           "stars": stars, "constellations": list(constellations.values())}
(root / "sky.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
(root / "D3-CELESTIAL-LICENSE.txt").write_text(read("LICENSE"))
(root / "NOTICE.txt").write_text(f"""ASTRA night-sky data

Source: Olaf Frohn, d3-celestial
https://github.com/ofrohn/d3-celestial
Pinned source commit: {COMMIT}
License: BSD-3-Clause; see D3-CELESTIAL-LICENSE.txt.

Stellar coordinates, apparent magnitudes and B-V indices are from XHIP:
Anderson E., Francis C. (2012), An Extended Hipparcos Compilation,
VizieR V/137D, as converted to J2000 GeoJSON by d3-celestial.
Constellation names/line drawings and translations are from d3-celestial;
see that project's source credits for IAU, catalog and Stellarium inputs.

ASTRA retains the numerical star data and reduces the schema for web use.
The two separate Serpens line groups are combined into one of 88 constellations.
Data derivation script: scripts/prepare-sky-data.py
""")
print(f"별 {len(stars):,}개 / 별자리 {len(constellations)}개 / {(root / 'sky.json').stat().st_size:,} bytes")
