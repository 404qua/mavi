import * as Cesium from "cesium";
import { marsEllipsoid, Viewport } from "./viewport";
import { LOCAL_VIEW_MODES } from "./enums.js";
import { getJson } from "../../lib/utils/getJson.js";


const LocalViewData = await getJson("data/localFeatures/feature_classes.json");

const viewer = await Viewport;

const tilingScheme = new Cesium.GeographicTilingScheme({
	ellipsoid: marsEllipsoid,
});

function addImageryLayer(link, maxlevel, minLevel = 0, rectangle = undefined, level = undefined) {
	const imageryProvider = new Cesium.UrlTemplateImageryProvider({
		url: link + "{z}/{x}/{y}.png",
		tilingScheme,
		minimumLevel: minLevel,
		maximumLevel: maxlevel,
		ellipsoid: marsEllipsoid,
		rectangle: rectangle,
		credit: "NASA / USGS Mars Viking MDIM 2.1",
	});

	return viewer.imageryLayers.addImageryProvider(imageryProvider, level);
}

const baseImageLayer = addImageryLayer(
	"https://marswalk-imagery.pages.dev/",
	6, 0
);

const highresImageryLayers = {};

highresImageryLayers[LOCAL_VIEW_MODES.AP_1] = "https://marswalk-hirise.pages.dev/AP-1-MRGB/";
highresImageryLayers[LOCAL_VIEW_MODES.AP_8] = "https://marswalk-hirise.pages.dev/AP-8-MRGB/";
highresImageryLayers[LOCAL_VIEW_MODES.AP_9] = "https://marswalk-hirise.pages.dev/AP-9-MRGB/";

let currentHighresLayer = null;

export function DisableHighresImagery() {
	if (currentHighresLayer) {
		viewer.imageryLayers.remove(currentHighresLayer, true);
	}

	currentHighresLayer = null;
}

export function EnableHighresImagery(MODE) {
	DisableHighresImagery();
	const requiredBounds = LocalViewData.sites[MODE].hirise_footprint.bounds;
	currentHighresLayer = addImageryLayer(
		highresImageryLayers[MODE],
		14, 9,
		Cesium.Rectangle.fromDegrees(
			requiredBounds.west,
			requiredBounds.south,
			requiredBounds.east,
			requiredBounds.north
		),
		1
	);

	currentHighresLayer.brightness = baseImageLayer.brightness;
}

const baseBrightness = 0.85;

function changeBaseBrightness(brightness) {
	baseImageLayer.brightness = brightness;
	if (currentHighresLayer) {
		currentHighresLayer.brightness = baseImageLayer.brightness;
	}
}

changeBaseBrightness(baseBrightness);
baseImageLayer.contrast = 1.1;

const LAYER_TYPES = Object.freeze({
	surface: "surface",
	ice1: "ice1",
	ice2: "ice2",
	ice3: "ice3",
});

let currentLayer = LAYER_TYPES.surface;

const imageryLayers = {
	ice1: addImageryLayer(
		"https://marswalk-imagery.pages.dev/ice/SWIM4MIM_Ci_0_1/",
		4,
	),
	ice2: addImageryLayer(
		"https://marswalk-imagery.pages.dev/ice/SWIM4MIM_Ci_1_5/",
		4,
	),
	ice3: addImageryLayer(
		"https://marswalk-imagery.pages.dev/ice/SWIM4MIM_Ci_5/",
		4,
	),
};

for (const layer in imageryLayers) {
	imageryLayers[layer].show = false;
	viewer.imageryLayers.raiseToTop(imageryLayers[layer]);
}

function updateLayer(layerType) {
	// there is a bug here with the LAYER_TYPES and layerType,
	// but it doesn't do anything because in LAYER_TYPES name=value
	if (!(layerType in LAYER_TYPES)) {
		console.log("No functionality for layer type: " + layerType);
		return;
	}

	if (layerType == currentLayer) {
		return;
	}

	if (layerType == LAYER_TYPES.surface) {
		imageryLayers[currentLayer].show = false;
		changeBaseBrightness(baseBrightness);
	}

	if (
		layerType == LAYER_TYPES.ice1 ||
		layerType == LAYER_TYPES.ice2 ||
		layerType == LAYER_TYPES.ice3
	) {
		if (currentLayer != LAYER_TYPES.surface) {
			imageryLayers[currentLayer].show = false;
		}

		imageryLayers[layerType].show = true;

		changeBaseBrightness(0.1);
	}

	currentLayer = layerType;
}

const layerOptionElements = document.getElementsByName("imageryLayers");

layerOptionElements.forEach((e) => {
	if (e.checked == true) {
		updateLayer(e.value);
	}

	e.addEventListener("input", () => {
		updateLayer(e.value);
	});
});
