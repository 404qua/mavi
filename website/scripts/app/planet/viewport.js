import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

let resolveViewport
export let Viewport = new Promise((resolve) => {
	resolveViewport = resolve;
})

async function main() {
	const marsEllipsoid = Cesium.Ellipsoid.WGS84;
	const MarsRadius = marsEllipsoid.maximumRadius;

	Cesium.RequestScheduler.maximumRequests = 100;
	Cesium.RequestScheduler.maximumRequestsPerServer = 16;

	Cesium.Ellipsoid.default = marsEllipsoid;

	const globe = new Cesium.Globe(marsEllipsoid);
	globe.baseColor = Cesium.Color.PERU;
	globe.maximumScreenSpaceError = 16;
	globe.tileCacheSize = 300;
	globe.showGroundAtmosphere = false;

	const terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
		"https://marswalk-terrain.pages.dev/",
		{ ellipsoid: marsEllipsoid },
	);

	let viewer = new Cesium.Viewer("viewport", {
		baseLayer: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		sceneModePicker: false,
		navigationHelpButton: false,
		selectionIndicator: false,
		infoBox: false,
		animation: false,
		timeline: false,
		terrainProvider: terrainProvider,
		fullscreenButton: false,
		creditContainer: document.createElement("div"),
		contextOptions: { webgl: { powerPreference: "high-performance" } },
		globe: globe,
		// mapMode2D: Cesium.MapMode2D.ROTATE,
		// sceneMode: Cesium.SceneMode.SCENE2D,
	});

	viewer.scene.globe.depthTestAgainstTerrain = false;


	const scene = viewer.scene;

	scene.msaaSamples = 4;

	const tilingScheme = new Cesium.GeographicTilingScheme({
		ellipsoid: marsEllipsoid,
	});

	const imageryProvider = new Cesium.UrlTemplateImageryProvider({
		url: "https://marswalk-imagery.pages.dev/" + "{z}/{x}/{y}.png",
		tilingScheme,
		minimumLevel: 0,
		maximumLevel: 6,
		ellipsoid: marsEllipsoid,
		credit: "NASA / USGS Mars Viking MDIM 2.1",
	});

	const baseImageLayer =
		viewer.imageryLayers.addImageryProvider(imageryProvider);
	baseImageLayer.brightness = 0.85;
	baseImageLayer.contrast = 1.1;

	const HIRISE_BASE = "https://marswalk-hirise.pages.dev/"; // your new project URL

const hiriseSites = [
  { name: "AP-1", rect: [-157.99526, 39.67076, -157.82808, 39.94840] },
  { name: "AP-8", rect: [-158.79728, 40.66435, -158.64621, 40.80712] },
  { name: "AP-9", rect: [-156.74207, 39.89370, -156.58295, 40.15565] },
];

function addHiriseLayer(site, product, maxLevel, minLevel = 9, alpha = 1.0) {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: `${HIRISE_BASE}${site.name}-${product}/{z}/{x}/{y}.png`,
    tilingScheme: new Cesium.GeographicTilingScheme({
      ellipsoid: marsEllipsoid,
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1,
    }),
    rectangle: Cesium.Rectangle.fromDegrees(...site.rect),
    tileWidth: 1024,
    tileHeight: 1312,
    hasAlphaChannel: true,
    enablePickFeatures: false,
    minimumLevel: minLevel,
    maximumLevel: maxLevel,
    ellipsoid: marsEllipsoid,
    credit: "NASA / JPL / University of Arizona (HiRISE)",
  });
  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.alpha = alpha;
  return layer;
}

for (const site of hiriseSites) {
  addHiriseLayer(site, "MRGB", 14);              // colour, 0.5 m/px
  addHiriseLayer(site, "RED", 15, 15, 1.0);      // greyscale detail, only at the closest zoom
}


	const base = "https://marswalk-imagery.pages.dev/" + "skybox/";

	scene.skyBox = new Cesium.SkyBox({
		sources: {
			positiveX: base + "tycho2t3_80_px.jpg",
			negativeX: base + "tycho2t3_80_mx.jpg",
			positiveY: base + "tycho2t3_80_py.jpg",
			negativeY: base + "tycho2t3_80_my.jpg",
			positiveZ: base + "tycho2t3_80_pz.jpg",
			negativeZ: base + "tycho2t3_80_mz.jpg",
		},
	});

	const controller = scene.screenSpaceCameraController;
	controller.maximumZoomDistance = MarsRadius * 10.0;
	controller.enableCollisionDetection = true;
	controller.minimumZoomDistance = MarsRadius / 1000 + 10;

	scene.verticalExaggeration = 1.87;

	scene.fog.enabled = false;
	scene.requestRenderMode = true;
	scene.maximumRenderTimeChange = Infinity;

	scene.skyAtmosphere = new Cesium.SkyAtmosphere(scene.globe.ellipsoid);
	scene.skyAtmosphere.hueShift = 0.5;
	scene.skyAtmosphere.saturationShift = -0.2;
	scene.skyAtmosphere.brightnessShift = -0.4;
	scene.skyAtmosphere.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
		1.0e-6,
		4.0e-6,
		6.0e-6,
	);
	scene.skyAtmosphere.atmosphereRayleighScaleHeight = 10000.0;
	scene.skyAtmosphere.atmosphereMieScaleHeight = 1000.0;

	scene.globe.preloadAncestors = true;
	scene.globe.preloadSiblings = true;
	scene.globe.depthTestAgainstTerrain = false;

	let sseSettings = {
		veryClose: 2.0,
		close: 8.0,
		far: 16.0,
		veryFar: 32.0,
	}

	let currentSse = sseSettings.far;

	function updateTerrainLOD() {
		const cartographic = viewer.camera.positionCartographic;

		if (!cartographic) {
			return;
		}

		const height = cartographic.height;
		let sse;

		if (height > 5000000.0) {
			sse = sseSettings.veryFar;
		} else if (height > 1000000.0) {
			sse = sseSettings.far;
		} else if (height > 300000.0) {
			sse = sseSettings.close;
		} else {
			sse = sseSettings.veryClose;
		}

		if (sse === currentSse) {
			return;
		}

		currentSse = sse;
		scene.globe.maximumScreenSpaceError = sse;
	}

	resolveViewport(viewer)

	viewer.camera.percentageChanged = 0.01;
	viewer.camera.changed.addEventListener(updateTerrainLOD);
	updateTerrainLOD();
}

main().catch((err) => console.error("Mars viewer failed:", err));
