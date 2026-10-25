"""
Generate Cesium-compatible XYZ tiles from a Mars
equirectangular GeoTIFF.

Designed for full-globe 2:1 equirectangular Mars maps using a 2×1
base grid (matches Cesium.GeographicTilingScheme defaults).

Source assumptions (validated at startup):
    - 2:1 aspect ratio
    - Origin (-180, 90), span 360° × 180°
    - Geographic lat/lon (any datum — no reprojection is performed)
    - Mars ellipsoid (radius 3396190 m) — used only for a warning check

Output layout (XYZ, y=0 = north):
    {out}/{z}/{x}/{y}.png
    z: min-zoom..max-zoom
    x: 0 .. 2^(z+1) - 1
    y: 0 .. 2^z   - 1

Usage:
    python mars_tiler.py baseMap_tiled.tif ./imagery --max-zoom 3
    python mars_tiler.py baseMap_tiled.tif ./imagery --max-zoom 6 --jobs 8
"""

from __future__ import annotations
import argparse
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import NamedTuple
from osgeo import gdal

gdal.UseExceptions()
PAD = 4

# ---------------------------------------------------------------------------
# Source validation
# ---------------------------------------------------------------------------

class SourceInfo(NamedTuple):
    path: Path
    width: int
    height: int


def validate_source(path: Path) -> SourceInfo:
    ds = gdal.Open(str(path), gdal.GA_ReadOnly)
    if ds is None:
        sys.exit(f"ERROR: cannot open source '{path}'")

    w, h = ds.RasterXSize, ds.RasterYSize
    if w != 2 * h:
        sys.exit(
            f"ERROR: source must be 2:1 (got {w}x{h}, ratio {w/h:.4f})."
        )

    gt = ds.GetGeoTransform()
    origin_x, px_w, _, origin_y, _, px_h = gt

    if abs(origin_x + 180.0) > 1e-4 or abs(origin_y - 90.0) > 1e-4:
        sys.exit(
            f"ERROR: origin must be (-180, 90); got ({origin_x}, {origin_y})."
        )

    lon_span = px_w * w
    lat_span = abs(px_h) * h
    if abs(lon_span - 360.0) > 1e-4 or abs(lat_span - 180.0) > 1e-4:
        sys.exit(
            f"ERROR: source must span exactly 360° × 180°; "
            f"got {lon_span}° × {lat_span}°."
        )

    wkt = ds.GetProjection()
    if "3396190" not in wkt and "Mars" not in wkt:
        print(
            "WARNING: source CRS does not mention Mars radius 3396190. "
            "Continuing, but verify this is Mars data.",
            file=sys.stderr,
        )

    ds = None
    return SourceInfo(path=path, width=w, height=h)

def tile_grid(z: int) -> tuple[int, int]:
    """(tiles_x, tiles_y) for zoom z under a 2×1 base grid."""
    return (2 ** (z + 1), 2 ** z)


def tile_window_padded(
    x: int, y: int, z: int, src_w: int, src_h: int, scheme: str
):
    """
    Returns (x0, y0, w, h, pl, pt, cw, ch):
        (x0, y0, w, h) = padded source window
        (pl, pt)       = padding added on left/top (source pixels)
        (cw, ch)       = true (unpadded) tile size in source pixels
    """
    tiles_x, tiles_y = tile_grid(z)

    x0 = (x * src_w) // tiles_x
    x1 = ((x + 1) * src_w) // tiles_x

    y_idx = y if scheme == "xyz" else (tiles_y - 1 - y)
    y0 = (y_idx * src_h) // tiles_y
    y1 = ((y_idx + 1) * src_h) // tiles_y

    px0 = max(0, x0 - PAD)
    py0 = max(0, y0 - PAD)
    px1 = min(src_w, x1 + PAD)
    py1 = min(src_h, y1 + PAD)

    return (px0, py0, px1 - px0, py1 - py0,
            x0 - px0, y0 - py0, x1 - x0, y1 - y0)

def _render_one(job):
    src_path, out_path, win, tile_size = job
    x0, y0, w, h, pl, pt, cw, ch = win

    ds = gdal.Open(str(src_path), gdal.GA_ReadOnly)
    try:
        render_w = int(round(tile_size * w / cw))
        render_h = int(round(tile_size * h / ch))

        tmp = gdal.Translate(
            "",
            ds,
            format="MEM",
            srcWin=[x0, y0, w, h],
            width=render_w,
            height=render_h,
            resampleAlg=gdal.GRA_Bilinear,
        )

        crop_x = int(round(pl * render_w / w))
        crop_y = int(round(pt * render_h / h))

        out = gdal.Translate(
            str(out_path),
            tmp,
            format="PNG",
            srcWin=[crop_x, crop_y, tile_size, tile_size],
            creationOptions=["ZLEVEL=6"],
        )
        out = None
    finally:
        ds = None
    return out_path

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("source", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--tile-size", type=int, default=1024)
    p.add_argument("--min-zoom", type=int, default=0)
    p.add_argument("--max-zoom", type=int, default=3)
    p.add_argument("--scheme", choices=["xyz", "tms"], default="xyz",
                   help="y=0 north (xyz, default) or south (tms)")
    p.add_argument("--jobs", type=int, default=1,
                   help="Parallel worker processes")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    info = validate_source(args.source)

    ppd = info.width / 360.0
    print(f"Source: {info.path}")
    print(f"  Size:              {info.width} × {info.height} px")
    print(f"  Pixels per degree: {ppd:.4f}")
    print(f"  Tile size:         {args.tile_size} × {args.tile_size}")
    print(f"  Edge padding:      {PAD} source px per side")
    print(f"  Zoom range:        {args.min_zoom}..{args.max_zoom}")
    print(f"  Scheme:            {args.scheme}")
    print()

    jobs = []
    for z in range(args.min_zoom, args.max_zoom + 1):
        tx, ty = tile_grid(z)
        win_w = info.width // tx
        win_h = info.height // ty
        ratio = win_w / args.tile_size
        print(f"Zoom {z:2d}: {tx:4d} × {ty:<4d} = {tx*ty:6d} tiles "
              f"({win_w}×{win_h} src → {args.tile_size}², {ratio:.3f}×)")

        for x in range(tx):
            out_dir = args.output / str(z) / str(x)
            out_dir.mkdir(parents=True, exist_ok=True)
            for y in range(ty):
                win = tile_window_padded(
                    x, y, z, info.width, info.height, args.scheme
                )
                jobs.append((info.path, out_dir / f"{y}.png",
                             win, args.tile_size))

    print(f"\nTotal tiles: {len(jobs)}\n")

    if args.jobs > 1:
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(_render_one, j) for j in jobs]
            for i, f in enumerate(as_completed(futures), 1):
                f.result()
                if i % 25 == 0 or i == len(jobs):
                    print(f"  {i}/{len(jobs)} rendered")
    else:
        for i, j in enumerate(jobs, 1):
            _render_one(j)
            if i % 25 == 0 or i == len(jobs):
                print(f"  {i}/{len(jobs)} rendered")

    out_root = args.output.resolve()
    print(f"\nDone → {out_root}")
    print()
    print("Cesium config:")
    print(f"""
    Cesium.Ellipsoid.default = Cesium.Ellipsoid.MARS;

    const tilingScheme = new Cesium.GeographicTilingScheme({{
        numberOfLevelZeroTilesX: 2,
        numberOfLevelZeroTilesY: 1,
        ellipsoid: Cesium.Ellipsoid.MARS,
    }});

    const provider = new Cesium.UrlTemplateImageryProvider({{
        url: '{out_root}/{{z}}/{{x}}/{{y}}.png',
        tilingScheme,
        tileWidth: {args.tile_size},
        tileHeight: {args.tile_size},
        minimumLevel: {args.min_zoom},
        maximumLevel: {args.max_zoom},
    }});
""".rstrip())
    return 0


if __name__ == "__main__":
    sys.exit(main())