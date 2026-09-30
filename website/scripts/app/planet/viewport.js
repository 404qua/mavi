import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
const CONFIG = {
    marsRadius: 3396190.0,
    collisionClearance: 100000.0,

    terrainUrl: "https://marswalk-terrain.pages.dev/",
    imageryUrl: "https://marswalk-imagery.pages.dev/",
    maxImageryLevel: 6,
    maxTerrainHeight: 21241.0,

    initialCamera: {
        longitude: 0,
        latitude: 0,
        height: 9000000.0
    },

    terrain: {
        cacheSize: 300
    },

    imagery: {
        levelZeroTilesX: 2,
        levelZeroTilesY: 1,
        tileWidth: 1024,
        tileHeight: 1024
    },

    terrainSse: {
        far: 16.0,
        midFar: 10.0,
        mid: 6.0,
        near: 2.0
    },

    imageryPrefetch: {
        delay: 400,

        thresholds: {
            level4: 3000000.0,
            level5: 1000000.0,
            level6: 200000.0
        }
    },

    diagnostics: {
        disableTerrainHorizonCulling: true
    }
};

function getCameraImageryTile(viewer, level) {
    const cartographic = viewer.camera.positionCartographic;

    if (!cartographic) {
        return null;
    }

    const longitude = Cesium.Math.toDegrees(cartographic.longitude);
    const latitude = Cesium.Math.toDegrees(cartographic.latitude);
    const tilesX = 2 ** (level + 1);
    const tilesY = 2 ** level;

    let normalizedLongitude = longitude;

    if (normalizedLongitude >= 180.0) {
        normalizedLongitude = -180.0;
    }
    if (normalizedLongitude < -180.0) {
        normalizedLongitude = 180.0;
    }

    let x = Math.floor((normalizedLongitude + 180.0) / 360.0 * tilesX);
    let y = Math.floor((90.0 - latitude) / 180.0 * tilesY);

    x = Math.max(0, Math.min(tilesX - 1, x));
    y = Math.max(0, Math.min(tilesY - 1, y));

    return { x, y };
}

function getImageryTileUrl(level, x, y) {
    const tilesX = 2 ** (level + 1);
    const tilesY = 2 ** level;

    x = (x % tilesX + tilesX) % tilesX;

    if (y < 0 || y >= tilesY) {
        return null;
    }

    return CONFIG.imageryUrl + level + "/" + x + "/" + y + ".png";
}

function getImageryWarmLevel(cameraHeight) {
    if (cameraHeight < CONFIG.imageryPrefetch.thresholds.level6) {
        return 6;
    }
    if (cameraHeight < CONFIG.imageryPrefetch.thresholds.level5) {
        return 5;
    }
    if (cameraHeight < CONFIG.imageryPrefetch.thresholds.level4) {
        return 4;
    }

    return null;
}

function disableTerrainHorizonCulling(globe) {
    const surface = globe._surface;
    const tileProvider = surface && surface._tileProvider;

    if (!tileProvider || typeof tileProvider.computeTileVisibility !== "function") {
        throw new Error("Could not access terrain tile visibility");
    }

    const originalComputeTileVisibility = tileProvider.computeTileVisibility;
    const horizonMethod = "isScaledSpacePointVisiblePossiblyUnderEllipsoid";

    tileProvider.computeTileVisibility = function(tile, frameState, occluders) {
        if (!occluders || !occluders.ellipsoid) {
            return originalComputeTileVisibility.call(this, tile, frameState, occluders);
        }

        const ellipsoidOccluder = occluders.ellipsoid;
        const hadOwnProperty = Object.prototype.hasOwnProperty.call(
            ellipsoidOccluder,
            horizonMethod
        );
        const originalHorizonMethod = ellipsoidOccluder[horizonMethod];

        ellipsoidOccluder[horizonMethod] = function() {
            return true;
        };

        try {
            return originalComputeTileVisibility.call(
                this,
                tile,
                frameState,
                occluders
            );
        } finally {
            if (hadOwnProperty) {
                ellipsoidOccluder[horizonMethod] = originalHorizonMethod;
            } else {
                delete ellipsoidOccluder[horizonMethod];
            }
        }
    };
}

function configureTerrain(scene, viewer) {
    scene.globe.maximumScreenSpaceError = CONFIG.terrainSse.near;
    scene.globe.preloadAncestors = true;
    scene.globe.preloadSiblings = false;
    scene.globe.tileCacheSize = CONFIG.terrain.cacheSize;
    scene.globe.depthTestAgainstTerrain = true;

    let currentSse = CONFIG.terrainSse.near;

    function updateTerrainLOD() {
        const cartographic = viewer.camera.positionCartographic;

        if (!cartographic) {
            return;
        }

        const height = cartographic.height;
        let sse;

        if (height > 3000000.0) {
            sse = CONFIG.terrainSse.far;
        } else if (height > 1000000.0) {
            sse = CONFIG.terrainSse.midFar;
        } else if (height > 300000.0) {
            sse = CONFIG.terrainSse.mid;
        } else {
            sse = CONFIG.terrainSse.near;
        }

        if (sse === currentSse) {
            return;
        }

        currentSse = sse;
        scene.globe.maximumScreenSpaceError = sse;
    }

    viewer.camera.percentageChanged = 0.01;
    viewer.camera.changed.addEventListener(updateTerrainLOD);
    updateTerrainLOD();
}

class ImageryPrefetcher {
    constructor(viewer) {
        this.viewer = viewer;
        this.timer = null;
        this.controller = null;
        this.sequence = 0;
        this.warmed = new Set();
    }

    cancel() {
        this.sequence += 1;

        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.controller !== null) {
            this.controller.abort();
            this.controller = null;
        }
    }

    scheduleZoomIn() {
        this.cancel();

        const sequence = this.sequence;

        this.timer = setTimeout(async () => {
            this.timer = null;

            if (sequence !== this.sequence) {
                return;
            }

            await this.run(sequence);
        }, CONFIG.imageryPrefetch.delay);
    }

    async warmTile(level, x, y, url, signal) {
        const tileKey = `${level}/${x}/${y}`;

        if (this.warmed.has(tileKey)) {
            return;
        }

        this.warmed.add(tileKey);

        try {
            await fetch(url, {
                mode: "cors",
                credentials: "omit",
                cache: "force-cache",
                signal
            });
        } catch (error) {
            this.warmed.delete(tileKey);

            if (error.name === "AbortError") {
                throw error;
            }
        }
    }

    async run(sequence) {
        const cartographic = this.viewer.camera.positionCartographic;

        if (!cartographic) {
            return;
        }

        const level = getImageryWarmLevel(cartographic.height);

        if (level === null) {
            return;
        }

        const cameraTile = getCameraImageryTile(this.viewer, level);

        if (!cameraTile) {
            return;
        }

        const url = getImageryTileUrl(level, cameraTile.x, cameraTile.y);

        if (!url) {
            return;
        }

        this.controller = new AbortController();

        const signal = this.controller.signal;

        try {
            if (sequence !== this.sequence) {
                return;
            }

            await this.warmTile(level, cameraTile.x, cameraTile.y, url, signal);
        } catch (error) {
            if (error.name !== "AbortError") {
                console.warn("Imagery prefetch failed:", error);
            }
        } finally {
            if (this.controller !== null) {
                this.controller = null;
            }
        }
    }

    handleWheel(event) {
        if (event.deltaY >= 0) {
            return;
        }

        this.scheduleZoomIn();
    }
}

async function loadTerrain(marsEllipsoid) {
    return Cesium.CesiumTerrainProvider.fromUrl(CONFIG.terrainUrl, {
        ellipsoid: marsEllipsoid
    });
}

async function main() {
    const marsEllipsoid = new Cesium.Ellipsoid(CONFIG.marsRadius, CONFIG.marsRadius, CONFIG.marsRadius);

    Cesium.Ellipsoid.default = marsEllipsoid;

    const terrainProvider = await loadTerrain(marsEllipsoid);

    const globe = new Cesium.Globe(marsEllipsoid);
    globe.baseColor = Cesium.Color.PERU;
    globe.atmosphereHueShift = 0.5;
    globe.atmosphereSaturationShift = -0.2;
    globe.atmosphereBrightnessShift = -0.4;

    const viewer = new Cesium.Viewer(
        "viewport",
        {
            baseLayer: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            animation: false,
            timeline: false,
            fullscreenButton: false,
            creditContainer: document.createElement("div"),
            globe,
            terrainProvider,
            scene3DOnly: true,
            msaaSamples: 1,

            contextOptions: {
                webgl: {
                    powerPreference: "high-performance"
                }
            }
        }
    );

    if (CONFIG.diagnostics.disableTerrainHorizonCulling) {
        disableTerrainHorizonCulling(globe);
    }

    const scene = viewer.scene;

    const tilingScheme = new Cesium.GeographicTilingScheme({
        ellipsoid: marsEllipsoid,
        numberOfLevelZeroTilesX: CONFIG.imagery.levelZeroTilesX,
        numberOfLevelZeroTilesY: CONFIG.imagery.levelZeroTilesY
    });

    const imageryProvider = new Cesium.UrlTemplateImageryProvider({
        url: CONFIG.imageryUrl + "{z}/{x}/{y}.png",
        tilingScheme,
        tileWidth: CONFIG.imagery.tileWidth,
        tileHeight: CONFIG.imagery.tileHeight,
        minimumLevel: 0,
        maximumLevel: CONFIG.maxImageryLevel,
        ellipsoid: marsEllipsoid,
        credit: "NASA / USGS Mars Viking MDIM 2.1"
    });

    viewer.imageryLayers.addImageryProvider(imageryProvider);

    const base = CONFIG.imageryUrl + "skybox/";

    scene.skyBox = new Cesium.SkyBox({
        sources: {
            positiveX: base + "tycho2t3_80_px.jpg",
            negativeX: base + "tycho2t3_80_mx.jpg",
            positiveY: base + "tycho2t3_80_py.jpg",
            negativeY: base + "tycho2t3_80_my.jpg",
            positiveZ: base + "tycho2t3_80_pz.jpg",
            negativeZ: base + "tycho2t3_80_mz.jpg"
        }
    });

    const controller = scene.screenSpaceCameraController;
    controller.maximumZoomDistance = CONFIG.marsRadius * 10.0;
    controller.enableCollisionDetection = true;
    controller.minimumCollisionTerrainHeight = CONFIG.collisionClearance;
    controller.minimumZoomDistance = 100000;

    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            CONFIG.initialCamera.longitude,
            CONFIG.initialCamera.latitude,
            CONFIG.initialCamera.height,
            marsEllipsoid
        )
    });

    scene.fog.enabled = true;
    scene.fog.screenSpaceErrorFactor = 4.0;

    scene.skyAtmosphere = new Cesium.SkyAtmosphere(scene.globe.ellipsoid);
    scene.skyAtmosphere.hueShift = 0.5;
    scene.skyAtmosphere.saturationShift = -0.2;
    scene.skyAtmosphere.brightnessShift = -0.4;
    scene.skyAtmosphere.atmosphereRayleighCoefficient = new Cesium.Cartesian3(1.0e-6, 4.0e-6, 6.0e-6);
    scene.skyAtmosphere.atmosphereRayleighScaleHeight = 10000.0;
    scene.skyAtmosphere.atmosphereMieScaleHeight = 1000.0;

    const prefetcher = new ImageryPrefetcher(viewer);

    viewer.canvas.addEventListener("wheel", event => {
        prefetcher.handleWheel(event);
    }, {
        passive: true
    });

    configureTerrain(scene, viewer);
}

main().catch(error => {
    console.error("Mars viewer failed:", error);
});