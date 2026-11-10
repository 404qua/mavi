import * as Cesium from "cesium";
import { createMapMarker } from "./mapMarkers";
import { Viewport } from "./viewport";
import { route, cancelFinder, ClearCurrentPath } from "./router.js";

const viewer = await Viewport;

let startButton = document.getElementById("start-position-select");
let endButton = document.getElementById("end-position-select");

export const navigationPossibleStates = {
	NotSelecting: "notSelecting",
	StartSelecting: "startSelecting",
	EndSelecting: "endSelecting",
};

export let navigationSelectorState = navigationPossibleStates.NotSelecting;

let markers = {
	start: {
		longitude: undefined,
		latitude: undefined,
		marker: undefined,
		label: document.getElementById("start-position-text"),
	},
	end: {
		longitude: undefined,
		latitude: undefined,
		marker: undefined,
		label: document.getElementById("end-position-text"),
	},
};

function clearMarker(markerName) {
	if (!markers[markerName].marker) {
		return;
	}

	if (cancelCurrentSelecting) {
		cancelCurrentSelecting();
	}

	markers[markerName].marker.show = false;
	markers[markerName].longitude = undefined;
	markers[markerName].latitude = undefined;
	markers[markerName].label.innerHTML = "Select";

	viewer.scene.requestRender();
}

let cancelCurrentSelecting;

function startPickingMarker(markerName, stateRequired) {
	let marker;
	if (markers[markerName].marker) {
		marker = markers[markerName].marker;
	} else {
		marker = createMapMarker({
			longitude: 0,
			latitude: 0,
			text: markerName,
			color: markerName == "start" ? Cesium.Color.BLUE : Cesium.Color.RED,
			drawDistance: 999999999999999,
		});

		markers[markerName].marker = marker;
	}

	marker.show = false;

	const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

	let longitude;
	let latitude;

	function cancelSelecting() {
		handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
		handler.destroy();

		if (navigationSelectorState == stateRequired) {
			let currentItem = markers[markerName];

			if (longitude != null) {
				currentItem.longitude = longitude;
				currentItem.latitude = latitude;

				currentItem.label.innerHTML =
					Cesium.Math.toDegrees(currentItem.longitude).toFixed(5) +
					"<b>°E</b>&nbsp;" +
					Cesium.Math.toDegrees(currentItem.latitude).toFixed(5) +
					"<b>°N</b>";
			} else {
				currentItem.label.innerHTML = "Select";
			}

			navigationSelectorState = navigationPossibleStates.NotSelecting;
		}

		if (markers[markerName].longitude != null) {
			marker.show = true;
			marker.position = Cesium.Cartesian3.fromRadians(
				markers[markerName].longitude,
				markers[markerName].latitude,
				1000,
			);
		} else {
			marker.show = true;
		}

		viewer.scene.requestRender();

		cancelCurrentSelecting = null;
	}

	cancelCurrentSelecting = cancelSelecting;

	handler.setInputAction((movement) => {
		if (navigationSelectorState != stateRequired) {
			cancelSelecting();
		}

		const cartesian = viewer.camera.pickEllipsoid(
			movement.endPosition,
			viewer.scene.globe.ellipsoid,
		);

		markers[markerName].label.innerHTML = "...";

		if (cartesian) {
			marker.show = true;
			const carto = Cesium.Cartographic.fromCartesian(cartesian);
			marker.position = Cesium.Cartesian3.fromRadians(
				carto.longitude,
				carto.latitude,
				1000,
			);
			viewer.scene.requestRender();

			longitude = carto.longitude;
			latitude = carto.latitude;
		} else {
			if (marker.show == true) {
				marker.show = false;

				longitude = undefined;
				latitude = undefined;

				viewer.scene.requestRender();
			}
		}
	}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

	handler.setInputAction(() => {
		cancelSelecting();
	}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

startButton.addEventListener("click", () => {
	if (cancelCurrentSelecting) {
		cancelCurrentSelecting();
	}

	navigationSelectorState = navigationPossibleStates.StartSelecting;

	startPickingMarker("start", navigationPossibleStates.StartSelecting);
});

endButton.addEventListener("click", () => {
	if (cancelCurrentSelecting) {
		cancelCurrentSelecting();
	}

	navigationSelectorState = navigationPossibleStates.EndSelecting;

	startPickingMarker("end", navigationPossibleStates.EndSelecting);
});

function updateUI(text, progress) {
	console.log(text, progress);
}

export { cancelFinder };

function formatTelemetry(result) {
	if (!result) return null;
	const lengthKm = result.lengthCm != null ? +(result.lengthCm / 100000).toFixed(2) : null;
	const costEqKm = result.costCm != null ? +(result.costCm / 100000).toFixed(2) : null;
	const totalSec = result.stats?.ms != null ? +(result.stats.ms / 1000).toFixed(2) : null;

	return {
		success: true,
		distance: lengthKm != null ? `${lengthKm.toLocaleString()} km` : "N/A",
		difficultyScore: costEqKm != null ? `${costEqKm.toLocaleString()} eq-km` : "N/A",
		nodesExplored: result.stats?.expanded?.toLocaleString() ?? "0",
		totalTime: totalSec != null ? `${totalSec}s` : "N/A",
		waypointsCount: result.vertexCount ?? 0,
		rawResult: result,
	};
}

function formatNullResponse(reason, details = {}) {
	return {
		success: false,
		result: null,
		reason: reason || "No route found",
		message: "Pathfinder could not find a traversable path between the selected coordinates.",
		details,
	};
}

let clearStartButton = document.getElementById("clear-start-position-select");
let clearEndButton = document.getElementById("clear-end-position-select");

clearStartButton.addEventListener("click", () => {
	clearMarker("start");
	ClearCurrentPath();
});
clearEndButton.addEventListener("click", () => {
	clearMarker("end");
	ClearCurrentPath();
});

document.getElementById("find-path-button").addEventListener("click", async () => {
	if (markers.start.longitude == null || markers.start.latitude == null) {
		console.warn("[Pathfinder] Start position is not selected!");
		return;
	}

	if (markers.end.longitude == null || markers.end.latitude == null) {
		console.warn("[Pathfinder] End position is not selected!");
		return;
	}

	cancelFinder();

	const startCoords = {
		lat: Cesium.Math.toDegrees(markers.start.latitude),
		lon: Cesium.Math.toDegrees(markers.start.longitude),
	};
	const endCoords = {
		lat: Cesium.Math.toDegrees(markers.end.latitude),
		lon: Cesium.Math.toDegrees(markers.end.longitude),
	};

	updateUI("Snapping positions to terrain", 5);

	try {
		const result = await route(startCoords, endCoords, {
			silent: true,
			updateUI,
			onProgress: (p) => {
				updateUI(p.statusText, p.progress);
			},
		});

		if (result) {
			const telemetry = formatTelemetry(result);
			console.log("[Pathfinder] Telemetry:", telemetry);
			updateUI("Route complete", 100);
		} else {
			const nullResponse = formatNullResponse("Route unavailable", {
				start: startCoords,
				end: endCoords,
			});
			console.warn("[Pathfinder] Route returned null:", nullResponse);
			updateUI("Route unavailable", 0);
		}
	} catch (error) {
		if (error.name === "AbortError" || error.message === "aborted") {
			console.log("[Pathfinder] Search cancelled.");
			updateUI("Search cancelled", 0);
		} else {
			const errorResponse = formatNullResponse("Search failed with error", {
				error: error.message,
				start: startCoords,
				end: endCoords,
			});
			console.error("[Pathfinder] Search error:", errorResponse);
			updateUI("Search failed", 0);
		}
	}
});
