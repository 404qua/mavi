import * as Cesium from "cesium";
import { marsEllipsoid, Viewport } from "./viewport";
import { LOCAL_VIEW_MODES } from "./enums.js";
import { getJson } from "../../lib/utils/getJson.js";
import {
	WEATHER_LAYERS,
	getWeatherLayerLinks,
	displayWeatherRangeImage,
	displayRangeImage,
} from "./weatherLayers.js";
import { getCurrentWeatherSelections } from "../monthInput.js";
import { MINERAL_DATA_LAYERS } from "./mineralLayers.js";

export { getWeatherLayerLinks, displayWeatherRangeImage, WEATHER_LAYERS };

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

const ICE_RANGE_IMAGES = Object.freeze({
	ice1: "icons/SWIM4MIM_Ci_0_1_range.svg",
	ice2: "icons/SWIM4MIM_Ci_1_5_range.svg",
	ice3: "icons/SWIM4MIM_Ci_5_range.svg",
});

for (const layer in imageryLayers) {
	imageryLayers[layer].show = false;
	viewer.imageryLayers.raiseToTop(imageryLayers[layer]);
}

let currentWeatherImageryLayer = null;
let currentWeatherRequestId = 0;
let currentMineralImageryLayer = null;
let currentMineralRequestId = 0;

async function setMineralLayer(layerType) {
	const requestId = ++currentMineralRequestId;
	const layer = MINERAL_DATA_LAYERS[layerType];
	displayRangeImage(layer.rangeImageLink, true);

	try {
		const provider = await Cesium.SingleTileImageryProvider.fromUrl(layer.imageLink, {
			rectangle: Cesium.Rectangle.fromDegrees(-180.0, -90.0, 180.0, 90.0),
			ellipsoid: marsEllipsoid,
		});

		if (requestId !== currentMineralRequestId) return;
		if (currentMineralImageryLayer) {
			viewer.imageryLayers.remove(currentMineralImageryLayer, true);
		}

		currentMineralImageryLayer = viewer.imageryLayers.addImageryProvider(provider);
		currentMineralImageryLayer.alpha = 0.85;
		viewer.imageryLayers.raiseToTop(currentMineralImageryLayer);
	} catch (err) {
		console.error("Failed to load mineral imagery layer:", layer.imageLink, err);
	}
}

function clearMineralLayer() {
	currentMineralRequestId++;
	if (currentMineralImageryLayer) {
		viewer.imageryLayers.remove(currentMineralImageryLayer, true);
		currentMineralImageryLayer = null;
	}
}

/**
 * Loads and displays a single-tile equirectangular weather layer on Mars globe,
 * and updates the corresponding range image.
 */
export async function setWeatherLayer(layerType, dropdownValues = null) {
	const requestId = ++currentWeatherRequestId;
	const filters = dropdownValues || getCurrentWeatherSelections();
	const links = getWeatherLayerLinks(layerType, filters);

	// Display the 2nd image link (range / legend colorbar) at appropriate spots
	displayWeatherRangeImage(links.rangeImageLink, true);

	try {
		const provider = await Cesium.SingleTileImageryProvider.fromUrl(links.imageLink, {
			rectangle: Cesium.Rectangle.fromDegrees(-180.0, -90.0, 180.0, 90.0),
			ellipsoid: marsEllipsoid,
		});

		// Stale request guard
		if (requestId !== currentWeatherRequestId) {
			return links;
		}

		if (currentWeatherImageryLayer) {
			viewer.imageryLayers.remove(currentWeatherImageryLayer, true);
		}

		currentWeatherImageryLayer = viewer.imageryLayers.addImageryProvider(provider);
		currentWeatherImageryLayer.alpha = 0.85;
		viewer.imageryLayers.raiseToTop(currentWeatherImageryLayer);
	} catch (err) {
		console.error("Failed to load weather imagery layer:", links.imageLink, err);
	}

	return links;
}

export function clearWeatherLayer() {
	currentWeatherRequestId++;
	if (currentWeatherImageryLayer) {
		viewer.imageryLayers.remove(currentWeatherImageryLayer, true);
		currentWeatherImageryLayer = null;
	}
	displayWeatherRangeImage(null, false);
}

export async function updateLayer(layerType) {
	const isWeather = layerType in WEATHER_LAYERS;
	const isMineral = layerType in MINERAL_DATA_LAYERS;
	const isIce = layerType === LAYER_TYPES.ice1 || layerType === LAYER_TYPES.ice2 || layerType === LAYER_TYPES.ice3;
	const isSurface = layerType === LAYER_TYPES.surface;

	if (!isWeather && !isMineral && !isIce && !isSurface) {
		console.log("No functionality for layer type: " + layerType);
		return;
	}
	if (!isMineral) {
		clearMineralLayer();
	}

	if (layerType === currentLayer) {
		if (isWeather) {
			await setWeatherLayer(layerType);
		} else if (isMineral) {
			await setMineralLayer(layerType);
		}
		return;
	}

	if (currentLayer in imageryLayers) {
		imageryLayers[currentLayer].show = false;
	}
	if (isSurface) {
		clearWeatherLayer();
		changeBaseBrightness(baseBrightness);
	} else if (isIce) {
		clearWeatherLayer();
		imageryLayers[layerType].show = true;
		changeBaseBrightness(0.3);
		displayRangeImage(ICE_RANGE_IMAGES[layerType], true);
	} else if (isMineral) {
		clearWeatherLayer();
		changeBaseBrightness(0.3);
		await setMineralLayer(layerType);
	} else if (isWeather) {
		changeBaseBrightness(0.15);
		await setWeatherLayer(layerType);
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

document.addEventListener("weather-filter-change", async () => {
	if (currentLayer in WEATHER_LAYERS) {
		await setWeatherLayer(currentLayer);
	}
});
