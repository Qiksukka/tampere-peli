#!/usr/bin/env python3
"""Simplify Tampere open-data polygons into compact SVG-ready JSON."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "districts.json"

# Urban Tampere: drop Teisko / Kämmenniemi / Nurmi-Sorila so the map is playable.
NORTH_PLANNING = {"TEISKO", "KÄMMENNIEMI", "NURMI-SORILA"}
NORTH_STATS = {
    "VIITAPOHJA",
    "KÄMMENNIEMI",
    "TERÄLAHTI",
    "VELAATTA",
    "POLSO",
    "SORILA",
    "AITONIEMI",
    "NURMI",
}

EASY_IDS = [
    "kyttala",
    "finlayson",
    "nalkala-ratina",
    "tammela",
    "tampella-lapinniemi",
    "amuri",
    "hatanpaa",
    "nekala",
    "petsamo",
    "pyynikki",
    "kaleva",
    "pispala",
    "kalevanharju",
    "kissanmaa",
]
EASY_PICK = 10

LAT0 = 61.498
LON0 = 23.76
KX = 111_320.0 * math.cos(math.radians(LAT0))
KY = 110_540.0
PAD = 28
TARGET_W = 1000.0
SIMPLIFY_M = 28.0  # metres, Douglas-Peucker
MIN_RING_PTS = 8


def slug(name: str) -> str:
    s = name.lower().replace("ä", "a").replace("ö", "o").replace("å", "a")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"\s*\([^)]*\)\s*", " ", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def nice_name(raw: str) -> str:
    s = re.sub(r"\s*\(([IVXLCDM]+)\)\s*", "", raw).strip()
    bits = []
    for word in s.split(" "):
        bits.append("-".join(part.capitalize() for part in word.split("-") if part))
    return " ".join(bits)


def walk_coords(geom):
    t = geom["type"]
    c = geom["coordinates"]
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return c
    raise ValueError(t)


def project(lon: float, lat: float) -> tuple[float, float]:
    return (lon - LON0) * KX, (LAT0 - lat) * KY


def ring_bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def dist2(a, b):
    dx, dy = a[0] - b[0], a[1] - b[1]
    return dx * dx + dy * dy


def perp_dist(p, a, b):
    ax, ay = b[0] - a[0], b[1] - a[1]
    if ax == 0 and ay == 0:
        return math.sqrt(dist2(p, a))
    t = ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / (ax * ax + ay * ay)
    t = max(0.0, min(1.0, t))
    return math.hypot(p[0] - (a[0] + t * ax), p[1] - (a[1] + t * ay))


def douglas_peucker(pts, eps):
    if len(pts) <= MIN_RING_PTS:
        return pts
    closed = pts[0] == pts[-1]
    work = pts[:-1] if closed else pts[:]

    def rec(points):
        if len(points) < 3:
            return points
        a, b = points[0], points[-1]
        idx, best = 0, -1.0
        for i in range(1, len(points) - 1):
            d = perp_dist(points[i], a, b)
            if d > best:
                idx, best = i, d
        if best > eps:
            left = rec(points[: idx + 1])
            right = rec(points[idx:])
            return left[:-1] + right
        return [a, b]

    simplified = rec(work)
    if closed:
        if simplified[0] != simplified[-1]:
            simplified.append(simplified[0])
    return simplified if len(simplified) >= 4 else pts


def area_centroid(ring):
    # ring in projected metres; ignore closing duplicate
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    a *= 0.5
    if abs(a) < 1e-6:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return 0.0, (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return abs(a), cx / (6 * a), cy / (6 * a)


def to_path(polygons, sx, sy, ox, oy) -> str:
    parts = []
    for poly in polygons:
        for ring in poly:
            if len(ring) < 4:
                continue
            cmds = []
            for i, (x, y) in enumerate(ring):
                px = round((x - ox) * sx, 2)
                py = round((y - oy) * sy, 2)
                cmds.append(("M" if i == 0 else "L") + f"{px},{py}")
            parts.append(" ".join(cmds) + " Z")
    return " ".join(parts)


def process(raw_path: Path, skip_names: set[str]):
    data = json.loads(raw_path.read_text())
    features = []
    for feat in data["features"]:
        name = feat["properties"]["NIMI"]
        if name in skip_names:
            continue
        polys = []
        for poly in walk_coords(feat["geometry"]):
            rings = []
            for ring in poly:
                proj = [project(lon, lat) for lon, lat in ring]
                proj = douglas_peucker(proj, SIMPLIFY_M)
                if len(proj) >= 4:
                    rings.append(proj)
            if rings:
                polys.append(rings)
        if not polys:
            continue
        # centroid/area from outer rings
        total_a = 0.0
        cx = cy = 0.0
        for poly in polys:
            a, x, y = area_centroid(poly[0])
            total_a += a
            cx += x * a
            cy += y * a
        if total_a <= 0:
            continue
        features.append(
            {
                "id": slug(name),
                "name": nice_name(name),
                "raw": name,
                "polys": polys,
                "cx": cx / total_a,
                "cy": cy / total_a,
                "area": total_a,
            }
        )
    features.sort(key=lambda f: f["name"])
    return features


def fit(all_features):
    xs, ys = [], []
    for f in all_features:
        for poly in f["polys"]:
            for ring in poly:
                for x, y in ring:
                    xs.append(x)
                    ys.append(y)
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    w, h = maxx - minx, maxy - miny
    sx = (TARGET_W - 2 * PAD) / w
    sy = sx
    height = h * sy + 2 * PAD
    ox, oy = minx, miny
    return sx, sy, ox, oy, TARGET_W, height


def packed(features, sx, sy, ox, oy):
    out = []
    for f in features:
        path = to_path(f["polys"], sx, sy, ox - PAD / sx, oy - PAD / sy)
        out.append(
            {
                "id": f["id"],
                "name": f["name"],
                "path": path,
                "cx": round((f["cx"] - ox) * sx + PAD, 2),
                "cy": round((f["cy"] - oy) * sy + PAD, 2),
                "area": round(f["area"], 1),
            }
        )
    return out


def svg_xy(lon, lat, sx, sy, ox, oy):
    x, y = project(lon, lat)
    return round((x - ox) * sx + PAD, 2), round((y - oy) * sy + PAD, 2)


def line_path(points, sx, sy, ox, oy):
    cmds = []
    for i, (lon, lat) in enumerate(points):
        px, py = svg_xy(lon, lat, sx, sy, ox, oy)
        cmds.append(("M" if i == 0 else "L") + f"{px},{py}")
    return " ".join(cmds)


def ring_path(ring, sx, sy, ox, oy):
    cmds = []
    for i, (lon, lat) in enumerate(ring):
        px, py = svg_xy(lon, lat, sx, sy, ox, oy)
        cmds.append(("M" if i == 0 else "L") + f"{px},{py}")
    return " ".join(cmds) + " Z"


# North→south through the isthmus, Näsijärvi to Pyhäjärvi.
KOSKI_LINE = [
    (23.7543, 61.5062),
    (23.7561, 61.5050),
    (23.7570, 61.5042),
    (23.7580, 61.5033),
    (23.7594, 61.5026),
    (23.7612, 61.5021),
    (23.7624, 61.5004),
    (23.7629, 61.5000),
    (23.7638, 61.4983),
    (23.7643, 61.4966),
    (23.7648, 61.4957),
    (23.7644, 61.4944),
    (23.7615, 61.4928),
    (23.7584, 61.4911),
    (23.7587, 61.4902),
]

PLACES = [
    {"id": "nasinneula", "nameFi": "Näsinneula", "nameEn": "Näsinneula", "lon": 23.743288, "lat": 61.504969, "icon": "tower"},
    {"id": "pyynikki-tower", "nameFi": "Pyynikin näkötorni", "nameEn": "Pyynikki tower", "lon": 23.731964, "lat": 61.496378, "icon": "tower"},
    {"id": "asema", "nameFi": "Rautatieasema", "nameEn": "Railway station", "lon": 23.773858, "lat": 61.498237, "icon": "dot"},
    {"id": "nokia-arena", "nameFi": "Nokia Arena", "nameEn": "Nokia Arena", "lon": 23.773934, "lat": 61.493630, "icon": "dot"},
    {"id": "ratina", "nameFi": "Ratinan stadion", "nameEn": "Ratina stadium", "lon": 23.764130, "lat": 61.492757, "icon": "dot"},
    {"id": "tampere-talo", "nameFi": "Tampere-talo", "nameEn": "Tampere Hall", "lon": 23.782356, "lat": 61.495891, "icon": "dot"},
]

LAKE_LABELS = {
    "Näsijärvi": {"id": "nasijarvi", "nameFi": "Näsijärvi", "nameEn": "Näsijärvi", "lon": 23.742, "lat": 61.513},
    "Pyhäjärvi": {"id": "pyhajarvi", "nameFi": "Pyhäjärvi", "nameEn": "Pyhäjärvi", "lon": 23.718, "lat": 61.478},
}


def lake_features(sx, sy, ox, oy):
    src = ROOT / "data" / "lakes.json"
    if not src.exists():
        return []
    raw = json.loads(src.read_text())
    lakes = []
    for name, rings in raw.items():
        meta = LAKE_LABELS[name]
        paths = [ring_path(ring, sx, sy, ox, oy) for ring in rings if len(ring) >= 4]
        x, y = svg_xy(meta["lon"], meta["lat"], sx, sy, ox, oy)
        lakes.append(
            {
                "id": meta["id"],
                "nameFi": meta["nameFi"],
                "nameEn": meta["nameEn"],
                "paths": paths,
                "x": x,
                "y": y,
            }
        )
    return lakes


def path_viewbox(districts, pad=36):
    xs, ys = [], []
    for d in districts:
        nums = [float(n) for n in re.findall(r"-?\d+\.?\d*", d["path"])]
        xs.extend(nums[0::2])
        ys.extend(nums[1::2])
    minx, maxx, miny, maxy = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    return [round(minx, 2), round(miny, 2), round(maxx - minx, 2), round(maxy - miny, 2)]


def landmarks(sx, sy, ox, oy):
    waters = []
    koski_file = Path("/tmp/koski.json")
    if koski_file.exists():
        raw = json.loads(koski_file.read_text())
        waters = [ring_path(poly, sx, sy, ox, oy) for poly in raw.get("polys", []) if len(poly) >= 4]
    places = []
    for p in PLACES:
        x, y = svg_xy(p["lon"], p["lat"], sx, sy, ox, oy)
        places.append({k: p[k] for k in ("id", "nameFi", "nameEn", "icon")} | {"x": x, "y": y})
    koski_label = svg_xy(23.7618, 61.4996, sx, sy, ox, oy)
    return {
        "koski": {
            "path": line_path(KOSKI_LINE, sx, sy, ox, oy),
            "waters": waters,
            "nameFi": "Tammerkoski",
            "nameEn": "Tammerkoski",
            "x": koski_label[0],
            "y": koski_label[1],
        },
        "lakes": lake_features(sx, sy, ox, oy),
        "places": places,
    }


def main():
    planning = process(Path("/tmp/suunn.geojson"), NORTH_PLANNING)
    stats = process(Path("/tmp/tilasto.geojson"), NORTH_STATS)
    sx, sy, ox, oy, width, height = fit(planning + stats)

    easy = [d for d in packed(planning, sx, sy, ox, oy) if d["id"] in EASY_IDS]
    missing = [i for i in EASY_IDS if i not in {d["id"] for d in easy}]
    if missing:
        raise SystemExit(f"Easy ids not found: {missing}")

    payload = {
        "attribution": "Lähde: Tampereen kaupunki, suunnittelualueet ja tilastoalueet. CC BY 4.0. Maamerkit: OpenStreetMap, ODbL.",
        "viewBox": [0, 0, round(width, 2), round(height, 2)],
        "landmarks": landmarks(sx, sy, ox, oy),
        "levels": {
            "easy": {
                "labelFi": "Helppo",
                "labelEn": "Easy",
                "blurbFi": "Satunnainen kymmenikko kosken seudulta",
                "blurbEn": "Ten random districts around the rapids",
                "pick": EASY_PICK,
                "viewBox": path_viewbox(easy),
                "districts": easy,
            },
            "medium": {
                "labelFi": "Normaali",
                "labelEn": "Normal",
                "blurbFi": "Kaikki kaupunginosat",
                "blurbEn": "Every urban district",
                "districts": packed(planning, sx, sy, ox, oy),
            },
            "hard": {
                "labelFi": "Vaikea",
                "labelEn": "Hard",
                "blurbFi": "Tilastoalueet paloina",
                "blurbEn": "Statistical areas as pieces",
                "districts": packed(stats, sx, sy, ox, oy),
            },
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(
        f"wrote {OUT} ({OUT.stat().st_size} bytes) "
        f"easy={len(easy)} medium={len(payload['levels']['medium']['districts'])} "
        f"hard={len(payload['levels']['hard']['districts'])} "
        f"viewBox={payload['viewBox']}"
    )


if __name__ == "__main__":
    main()
