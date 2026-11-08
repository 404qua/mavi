import * as Cesium from "cesium";
import { Viewport } from "../viewport";

const viewer = await Viewport;

let limitEvent = null;

const controller = viewer.scene.screenSpaceCameraController;
const cameraMinimumZoomDistance = controller.minimumZoomDistance;
const cameraMaximumZoomDistance = controller.maximumZoomDistance;
const cameraZoomFactor = controller.zoomFactor;

export const BOUNDS = {
	north: undefined,
	south: undefined,
	east: undefined,
	west: undefined,
};

export function SetCameraLimits({ north, south, east, west }) {
	if (limitEvent) {
		limitEvent();
	}

	controller.maximumZoomDistance = 50000;
	controller.minimumZoomDistance = 1000;
	controller.zoomFactor = 1;

	viewer.scene.requestRender();

	north = Cesium.Math.toRadians(north);
	south = Cesium.Math.toRadians(south);
	east = Cesium.Math.toRadians(east);
	west = Cesium.Math.toRadians(west);

	BOUNDS.north = north;
	BOUNDS.south = south;
	BOUNDS.east = east;
	BOUNDS.west = west;

	let camera = viewer.scene.camera;

	let averageLon = (east + west) / 2;
	let averageLat = (north + south) / 2;

	let cameraAnimating = true;

	camera.flyTo({
		destination: Cesium.Cartesian3.fromRadians(
			averageLon,
			averageLat,
			Cesium.Math.clamp(
				camera.positionCartographic.height,
				controller.minimumZoomDistance,
				controller.maximumZoomDistance,
			)-200,
		),

		duration: 1,

		complete: () => {
			cameraAnimating = false;
		},
	});

	limitEvent = viewer.scene.preRender.addEventListener(() => {
		if (cameraAnimating == true) {
			return;
		}

		let cameraPosition = camera.positionCartographic;

		const lon = Cesium.Math.clamp(cameraPosition.longitude, west, east);
		const lat = Cesium.Math.clamp(cameraPosition.latitude, south, north);

		if (lon !== cameraPosition.longitude || lat !== cameraPosition.latitude) {
			camera.setView({
				destination: Cesium.Cartesian3.fromRadians(
					lon,
					lat,
					cameraPosition.height,
				),
				orientation: {
					heading: camera.heading,
					pitch: camera.pitch,
					roll: camera.roll,
				},
			});
		}
	});
}

export function ReleaseCameraLimits() {
	if (limitEvent) {
		limitEvent();
	}

	viewer.camera.flyHome(1.5);

	controller.maximumZoomDistance = cameraMaximumZoomDistance;
	controller.minimumZoomDistance = cameraMinimumZoomDistance;
	controller.zoomFactor = cameraZoomFactor;

	BOUNDS.north = undefined;
	BOUNDS.south = undefined;
	BOUNDS.east = undefined;
	BOUNDS.west = undefined;
}
