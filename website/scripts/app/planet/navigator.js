import * as Cesium from "cesium";
import { createMapMarker } from "./mapMarkers";
import { Viewport } from "./viewport";

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

let clearStartButton = document.getElementById("clear-start-position-select");
let clearEndButton = document.getElementById("clear-end-position-select");

clearStartButton.addEventListener("click", () => {
	clearMarker("start");
});
clearEndButton.addEventListener("click", () => {
	clearMarker("end");
});

document.getElementById("find-path-button").addEventListener("click", () => {
	if (!(markers.start.longitude && markers.start.latitude)) {
		console.log("Start is not set!");
	}

	if (!(markers.end.longitude && markers.end.latitude)) {
		console.log("End is not set!");
		return;
	}

	console.log(
		"Start",
		"\n",
		"	" + "lon:" + markers.start.longitude,
		"\n",
		"	" + "lat:" + markers.start.latitude,
		"\n",
		"end",
		"\n",
		"	" + "lon:" + markers.end.longitude,
		"\n",
		"	" + "lat:" + markers.end.latitude,
	);
});
