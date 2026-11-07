import * as Cesium from "cesium";
import { marsEllipsoid, Viewport } from "./viewport";

const viewer = await Viewport;

const tilingScheme = new Cesium.GeographicTilingScheme({
	ellipsoid: marsEllipsoid,
});
function addImageryLayer(link, maxlevel, minLevel = 0) {
	const imageryProvider = new Cesium.UrlTemplateImageryProvider({
		url: link + "{z}/{x}/{y}.png",
		tilingScheme,
		minimumLevel: minLevel,
		maximumLevel: maxlevel,
		ellipsoid: marsEllipsoid,
		credit: "NASA / USGS Mars Viking MDIM 2.1",
	});

	return viewer.imageryLayers.addImageryProvider(imageryProvider);
}

const baseImageLayer = addImageryLayer(
	"https://marswalk-imagery.pages.dev/",
	6,
);

const baseBrightness = 0.85;

baseImageLayer.brightness = baseBrightness;
baseImageLayer.contrast = 1.1;

const LAYER_TYPES = Object.freeze({
	surface: "surface",
	ice1: "ice1",
	ice2: "ice2",
	ice3: "ice3",
});

let currentLayer = LAYER_TYPES.surface;

const imageryLayers = {
	ice1: addImageryLayer("https://marswalk-imagery.pages.dev/ice/SWIM4MIM_Ci_0_1/", 4),
	ice2: addImageryLayer("https://marswalk-imagery.pages.dev/ice/SWIM4MIM_Ci_1_5/", 4),
	ice3: addImageryLayer("https://marswalk-imagery.pages.dev/ice/SWIM4MIM_Ci_5/", 4),
};

for (const layer in imageryLayers) {
	imageryLayers[layer].show = false;
}

function updateLayer(layerType) {
	if (!(layerType in LAYER_TYPES)) {
		console.log("No functionality for layer type: " + layerType);
		return;
	}

	if (layerType == currentLayer) {
		return;
	}

	if (layerType == LAYER_TYPES.surface) {
		imageryLayers[currentLayer].show = false;
		baseImageLayer.brightness = baseBrightness;
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

		baseImageLayer.brightness = 0.1;
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
