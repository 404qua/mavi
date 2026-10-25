import json
import shutil
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from pymartini import Martini, rescale_positions
from quantized_mesh_encoder import Ellipsoid, encode


SOURCE = "marsHeight_tiled.tif"
OUTPUT_ROOT = Path("terrain")

MIN_LEVEL = 0
MAX_LEVEL = 6

GRID = 513
TILE_INTERVALS = GRID - 1

WEST = -180.0
EAST = 180.0
SOUTH = -90.0
NORTH = 90.0

MAX_ERROR = 10.0

MARS_RADIUS = 3396190.0

MARS = Ellipsoid(
    MARS_RADIUS,
    MARS_RADIUS,
)

MARTINI = Martini(GRID)


def level_dimensions(level):
    tiles_x = 2 ** (level + 1)
    tiles_y = 2 ** level

    intervals_x = (
        tiles_x * TILE_INTERVALS
    )

    intervals_y = (
        tiles_y * TILE_INTERVALS
    )

    return (
        tiles_x,
        tiles_y,
        intervals_x,
        intervals_y,
    )


def tile_bounds(
    level,
    x,
    y,
):
    (
        tiles_x,
        tiles_y,
        intervals_x,
        intervals_y,
    ) = level_dimensions(level)

    west = (
        WEST
        + (
            x
            * TILE_INTERVALS
            * (EAST - WEST)
            / intervals_x
        )
    )

    east = (
        WEST
        + (
            (x + 1)
            * TILE_INTERVALS
            * (EAST - WEST)
            / intervals_x
        )
    )

    south = (
        SOUTH
        + (
            y
            * TILE_INTERVALS
            * (NORTH - SOUTH)
            / intervals_y
        )
    )

    north = (
        SOUTH
        + (
            (y + 1)
            * TILE_INTERVALS
            * (NORTH - SOUTH)
            / intervals_y
        )
    )

    return (
        west,
        south,
        east,
        north,
    )


def tile_sample_coordinates(
    level,
    x,
    y,
):
    (
        tiles_x,
        tiles_y,
        intervals_x,
        intervals_y,
    ) = level_dimensions(level)

    col_indices = (
        x * TILE_INTERVALS
        + np.arange(
            GRID,
            dtype=np.int64,
        )
    )

    row_start = (
        tiles_y
        - y
        - 1
    ) * TILE_INTERVALS

    row_indices = (
        row_start
        + np.arange(
            GRID,
            dtype=np.int64,
        )
    )

    lons = (
        WEST
        + (
            col_indices.astype(
                np.float64
            )
            * (EAST - WEST)
            / intervals_x
        )
    )

    lats = (
        NORTH
        - (
            row_indices.astype(
                np.float64
            )
            * (NORTH - SOUTH)
            / intervals_y
        )
    )

    return (
        lons,
        lats,
    )


def contiguous_segments(
    columns,
):
    columns = np.unique(
        np.asarray(
            columns,
            dtype=np.int64,
        )
    )

    if len(columns) == 0:
        return []

    segments = []

    start = int(
        columns[0]
    )

    previous = int(
        columns[0]
    )

    for value in columns[1:]:
        value = int(value)

        if value != previous + 1:
            segments.append(
                (
                    start,
                    previous,
                )
            )

            start = value

        previous = value

    segments.append(
        (
            start,
            previous,
        )
    )

    return segments


def sample_tile(
    src,
    level,
    x,
    y,
):
    lons, lats = (
        tile_sample_coordinates(
            level,
            x,
            y,
        )
    )

    source_res_x = float(
        src.res[0]
    )

    source_res_y = abs(
        float(src.res[1])
    )

    x_pixel = (
        (lons - WEST)
        / source_res_x
        - 0.5
    )

    x0 = np.floor(
        x_pixel
    ).astype(
        np.int64
    )

    wx = (
        x_pixel
        - x0
    )

    x1 = (
        x0 + 1
    )

    x0 %= src.width
    x1 %= src.width

    y_pixel = (
        (NORTH - lats)
        / source_res_y
        - 0.5
    )

    y0 = np.floor(
        y_pixel
    ).astype(
        np.int64
    )

    wy = (
        y_pixel
        - y0
    )

    y1 = (
        y0 + 1
    )

    top_mask = (
        y0 < 0
    )

    if np.any(top_mask):
        y0[top_mask] = 0
        y1[top_mask] = 0
        wy[top_mask] = 0.0

    bottom_mask = (
        y1 >= src.height
    )

    if np.any(bottom_mask):
        y0[bottom_mask] = (
            src.height - 1
        )

        y1[bottom_mask] = (
            src.height - 1
        )

        wy[bottom_mask] = 0.0

    source_columns = np.concatenate(
        (
            x0,
            x1,
        )
    )

    unique_columns = np.unique(
        source_columns
    )

    row_min = int(
        min(
            y0.min(),
            y1.min(),
        )
    )

    row_max = int(
        max(
            y0.max(),
            y1.max(),
        )
    )

    row_count = (
        row_max
        - row_min
        + 1
    )

    sampled_source = np.empty(
        (
            row_count,
            len(unique_columns),
        ),
        dtype=np.float32,
    )

    for (
        start_col,
        end_col,
    ) in contiguous_segments(
        unique_columns
    ):
        width = (
            end_col
            - start_col
            + 1
        )

        block = src.read(
            1,
            window=Window(
                col_off=start_col,
                row_off=row_min,
                width=width,
                height=row_count,
            ),
        )

        destination_columns = np.arange(
            start_col,
            end_col + 1,
            dtype=np.int64,
        )

        local_indices = np.searchsorted(
            unique_columns,
            destination_columns,
        )

        sampled_source[
            :,
            local_indices,
        ] = block.astype(
            np.float32,
            copy=False,
        )

    x0_local = np.searchsorted(
        unique_columns,
        x0,
    )

    x1_local = np.searchsorted(
        unique_columns,
        x1,
    )

    y0_local = (
        y0
        - row_min
    )

    y1_local = (
        y1
        - row_min
    )

    horizontal0 = (
        sampled_source[
            y0_local[:, None],
            x0_local[None, :],
        ]
        * (
            1.0
            - wx[None, :]
        )
        +
        sampled_source[
            y0_local[:, None],
            x1_local[None, :],
        ]
        * wx[None, :]
    )

    horizontal1 = (
        sampled_source[
            y1_local[:, None],
            x0_local[None, :],
        ]
        * (
            1.0
            - wx[None, :]
        )
        +
        sampled_source[
            y1_local[:, None],
            x1_local[None, :],
        ]
        * wx[None, :]
    )

    return (
        horizontal0
        * (
            1.0
            - wy[:, None]
        )
        +
        horizontal1
        * wy[:, None]
    ).astype(
        np.float32
    )


def make_tile(
    src,
    level,
    x,
    y,
):
    bounds = tile_bounds(
        level,
        x,
        y,
    )

    terrain = sample_tile(
        src,
        level,
        x,
        y,
    )

    tile = MARTINI.create_tile(
        terrain
    )

    vertices, triangles = (
        tile.get_mesh(
            MAX_ERROR
        )
    )

    positions = rescale_positions(
        vertices,
        terrain,
        bounds=bounds,
        flip_y=True,
    )

    output = (
        OUTPUT_ROOT
        / str(level)
        / str(x)
        / f"{y}.terrain"
    )

    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with output.open(
        "wb"
    ) as handle:
        encode(
            handle,
            positions,
            triangles,
            bounds=bounds,
            ellipsoid=MARS,
        )

    return output


def prepare_output():
    if OUTPUT_ROOT.exists():
        shutil.rmtree(
            OUTPUT_ROOT
        )

    OUTPUT_ROOT.mkdir(
        parents=True
    )


def write_layer_json():
    available = []

    for level in range(
        MIN_LEVEL,
        MAX_LEVEL + 1,
    ):
        tiles_x = 2 ** (
            level + 1
        )

        tiles_y = 2 ** level

        available.append(
            [
                {
                    "startX": 0,
                    "startY": 0,
                    "endX": tiles_x - 1,
                    "endY": tiles_y - 1,
                }
            ]
        )

    layer = {
        "version": "1.0.0",
        "format": "quantized-mesh-1.0",
        "scheme": "tms",
        "projection": "EPSG:4326",
        "bounds": [
            WEST,
            SOUTH,
            EAST,
            NORTH,
        ],
        "minzoom": MIN_LEVEL,
        "maxzoom": MAX_LEVEL,
        "available": available,
        "tiles": [
            "{z}/{x}/{y}.terrain"
        ],
    }

    (
        OUTPUT_ROOT
        / "layer.json"
    ).write_text(
        json.dumps(
            layer,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def build_level(
    src,
    level,
):
    start = time.perf_counter()

    tiles_x = 2 ** (
        level + 1
    )

    tiles_y = 2 ** level

    total_tiles = (
        tiles_x
        * tiles_y
    )

    completed = 0

    print()
    print(
        f"Building L{level} "
        f"({tiles_x} x {tiles_y})"
    )

    for y in range(
        tiles_y
    ):
        for x in range(
            tiles_x
        ):
            output = make_tile(
                src,
                level,
                x,
                y,
            )

            completed += 1

            print(
                f"[{completed}/{total_tiles}] "
                f"L{level}/{x}/{y} "
                f"{output.stat().st_size / 1024:.1f} KiB"
            )

    elapsed = (
        time.perf_counter()
        - start
    )

    print(
        f"L{level} complete "
        f"in {elapsed:.2f} s"
    )


def main():
    prepare_output()

    start = time.perf_counter()

    with rasterio.open(
        SOURCE
    ) as src:
        for level in range(
            MIN_LEVEL,
            MAX_LEVEL + 1,
        ):
            build_level(
                src,
                level,
            )

    write_layer_json()

    elapsed = (
        time.perf_counter()
        - start
    )

    total_tiles = sum(
        (
            2 ** (level + 1)
            * 2 ** level
        )
        for level in range(
            MIN_LEVEL,
            MAX_LEVEL + 1,
        )
    )

    print()
    print(
        "L0-L6 generation complete"
    )

    print(
        "Tiles:",
        total_tiles
    )

    print(
        "Time:",
        f"{elapsed:.2f} s"
    )


if __name__ == "__main__":
    main()
