cat > mars-geographic.prj <<'EOF'
PROJCRS["Mars Equirectangular",
    BASEGEODCRS["Mars",
        DATUM["Mars",
            ELLIPSOID["Mars",3396190,169.8944472236118,
                LENGTHUNIT["metre",1]]]],
    CONVERSION["Equirectangular",
        METHOD["Equidistant Cylindrical"],
        PARAMETER["Latitude of 1st standard parallel",0,
            ANGLEUNIT["degree",0.0174532925199433]],
        PARAMETER["Longitude of natural origin",0,
            ANGLEUNIT["degree",0.0174532925199433]],
        PARAMETER["False easting",0,
            LENGTHUNIT["metre",1]],
        PARAMETER["False northing",0,
            LENGTHUNIT["metre",1]]],
    CS[Cartesian,2],
        AXIS["easting",east,
            ORDER[1],
            LENGTHUNIT["metre",1]],
        AXIS["northing",north,
            ORDER[2],
            LENGTHUNIT["metre",1]]]
]
EOF


gdal_translate \
    marsHeight.tiff \
    marsHeight_deg.tif \
    -a_srs mars-geographic.prj \
    -a_ullr -180 90 180 -90


gdal_translate \
    marsHeight_deg.tif \
    marsHeight_tiled.tif \
    -co TILED=YES \
    -co BLOCKXSIZE=512 \
    -co BLOCKYSIZE=512 \
    -co COMPRESS=DEFLATE \
    -co PREDICTOR=2 \
    -co BIGTIFF=YES


gdaladdo \
    -r average \
    marsHeight_tiled.tif \
    2 4 8 16 32 64 128
