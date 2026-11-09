import * as Cesium from "cesium";
import { Viewport } from "../viewport";

const viewer = await Viewport;

let limitEvent = null;

let cameraLimited = false;

let _scrollOffset = 0;

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
	cameraLimited = true;

	controller.enableCollisionDetection = false;
	controller.enableTilt = false;
	controller.enableZoom = false;
	viewer.scene.globe.depthTestAgainstTerrain = true;

	controller.maximumZoomDistance = 22000;
	controller.minimumZoomDistance = -7100;
	controller.zoomFactor = 10;

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
				controller.maximumZoomDistance - 20000,
			) - 200,
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
		let height = cameraPosition.height;

		if (controller.enableInputs) {
			height = Cesium.Math.clamp(
				height,
				controller.minimumZoomDistance,
				controller.maximumZoomDistance,
			);
		}

		if (lon !== cameraPosition.longitude || lat !== cameraPosition.latitude || height !== cameraPosition.height) {
			camera.setView({
				destination: Cesium.Cartesian3.fromRadians(
					lon,
					lat,
					height,
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
	cameraLimited = false;

	viewer.camera.flyHome(1.5);

	controller.maximumZoomDistance = cameraMaximumZoomDistance;
	controller.minimumZoomDistance = cameraMinimumZoomDistance;
	controller.zoomFactor = cameraZoomFactor;

	viewer.scene.globe.depthTestAgainstTerrain = false;

	controller.enableCollisionDetection = true;
	controller.enableTilt = true;
	controller.enableZoom = true;

	BOUNDS.north = undefined;
	BOUNDS.south = undefined;
	BOUNDS.east = undefined;
	BOUNDS.west = undefined;
}

viewer.scene.canvas.addEventListener("wheel", (e) => {
	e.preventDefault();
	_scrollOffset = e.deltaY > 0 ? -1 : 1;

	if (cameraLimited && controller.enableInputs) {
		if (_scrollOffset > 0) {
			viewer.camera.zoomIn(500);
			viewer.scene.requestRender();
		} else if (_scrollOffset < 0) {
			viewer.camera.zoomOut(500);
			viewer.scene.requestRender();
		}
	}

	_scrollOffset = 0;
}, { passive: false });

