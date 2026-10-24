import * as Cesium from "cesium"
import { Viewport } from "../../viewport";
import { PhysicsTick, ResetPhysicsValues, CartographicPosition, normal, north, right } from "./physics";
import { combine } from "../../../../lib/utils/math/planet";
import { StartInputChecking, StopInputChecking } from "./input";

const viewer = await Viewport

let lookDirection = { x: 0, y: 0 }
let lookSensitivity = 0.08;

let cameraSwitchStartedTime = 0;
let cameraValuesCache = {}
let cameraFlyToCache = {}
let cameraMode = null;
const maxLerp = 2000;
const cameraOffset = 5000

let cameraUpdateEventListener = null;
let stopFovUpdate = () => { };

function lerpNumberValue(a, b, t) {
	if (t >= 1) return b
	return a + ((b - a) * t)
}

const horiz = new Cesium.Cartesian3();
const viewDir = new Cesium.Cartesian3();
const viewUp = new Cesium.Cartesian3();

let cameraSwitchCooldown = false;

function updateCamera(delta) {
	PhysicsTick(delta, lookDirection)

	let terrainHeight = viewer.scene.globe.getHeight(CartographicPosition);
	if (!Cesium.defined(terrainHeight)) {
		terrainHeight = 0;
	}
	// terrainHeight = Math.max(terrainHeight, -2400)

	const cameraPos = Cesium.Cartesian3.fromRadians(CartographicPosition.longitude, CartographicPosition.latitude, terrainHeight + cameraOffset);
	let now = Cesium.getTimestamp();
	let lerpTime = now - cameraValuesCache.time;

	let lerpValue;

	if (lerpTime < maxLerp) {
		lerpValue = Cesium.EasingFunction.CUBIC_IN_OUT(Cesium.Math.clamp((now - cameraValuesCache.time) / maxLerp, 0, 1));
	} else {
		lerpValue = 1
	}

	if (lerpValue < 1) {
		Cesium.Cartesian3.lerp(cameraValuesCache.cartographicCartesain3, cameraPos, lerpValue, cameraPos)
	}

	viewer.camera.frustum.fov = lerpNumberValue(cameraValuesCache.fov, Cesium.Math.toRadians(40), lerpValue);

	lerpValue = lerpValue ** 4;

	// ---- AI START: orientation from our own frame ----
	const yaw = Cesium.Math.toRadians(lookDirection.x);
	const pitch = Cesium.Math.toRadians(lookDirection.y);
	combine(north, Math.cos(yaw), right, Math.sin(yaw), horiz);
	combine(horiz, Math.cos(pitch), normal, Math.sin(pitch), viewDir);
	combine(normal, Math.cos(pitch), horiz, -Math.sin(pitch), viewUp);
	// ---- AI END ----

	viewer.camera.setView({
		destination: cameraPos,
		orientation: lerpValue < 1
			? {
				heading: lerpNumberValue(cameraValuesCache.headingRad, Cesium.Math.toRadians(lookDirection.x), lerpValue),
				pitch: lerpNumberValue(cameraValuesCache.pitchRad, Cesium.Math.toRadians(lookDirection.y), lerpValue ** 4),
				roll: lerpNumberValue(cameraValuesCache.rollRad, 0, lerpValue)
			}  // your intro animation, untouched
			: { direction: viewDir, up: viewUp }
	});
}

export function StartFirstPersonCamera() {
	let lastTime = Cesium.getTimestamp();
	cameraMode = "firstPerson";

	ResetPhysicsValues();
	StartInputChecking();

	cameraValuesCache.cartographic = viewer.camera.positionCartographic.clone();

	cameraValuesCache.cartographicCartesain3 = Cesium.Cartesian3.fromRadians(
		cameraValuesCache.cartographic.longitude,
		cameraValuesCache.cartographic.latitude,
		cameraValuesCache.cartographic.height
	);

	cameraValuesCache.headingRad = viewer.camera.heading;
	cameraValuesCache.pitchRad = viewer.camera.pitch;
	cameraValuesCache.rollRad = viewer.camera.roll;

	cameraValuesCache.direction = viewer.camera.direction.clone();
	cameraValuesCache.up = viewer.camera.up.clone();

	stopFovUpdate();
	cameraValuesCache.fov = viewer.camera.frustum.fov;

	cameraValuesCache.time = lastTime;

	if (cameraSwitchCooldown == false) {
		cameraFlyToCache.cartographicCartesain3 = cameraValuesCache.cartographicCartesain3
		cameraFlyToCache.headingRad = cameraValuesCache.headingRad
		cameraFlyToCache.pitchRad = cameraValuesCache.pitchRad
		cameraFlyToCache.rollRad = cameraValuesCache.rollRad
		cameraFlyToCache.fov = cameraValuesCache.fov

		cameraSwitchCooldown = true;
	}

	viewer.scene.screenSpaceCameraController.enableInputs = false;
	viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
	viewer.scene.globe.depthTestAgainstTerrain = true;

	lookDirection = { x: 0, y: 0 }

	// ---- AI START: init frame ----
	const lat0 = CartographicPosition.latitude;
	const lon0 = CartographicPosition.longitude;
	Cesium.Cartesian3.fromElements(
		Math.cos(lat0) * Math.cos(lon0), Math.cos(lat0) * Math.sin(lon0), Math.sin(lat0), normal);
	Cesium.Cartesian3.fromElements(
		-Math.sin(lat0) * Math.cos(lon0), -Math.sin(lat0) * Math.sin(lon0), Math.cos(lat0), north);
	// ---- AI END ----

	cameraUpdateEventListener = viewer.scene.preRender.addEventListener(() => {
		const now = Cesium.getTimestamp();
		const deltaTime = (now - lastTime) / 1000;
		lastTime = now;

		updateCamera(deltaTime);
	});
}

export function StopFirstPersonCamera() {
	cameraMode = "normal";
	StopInputChecking();

	viewer.scene.screenSpaceCameraController.enableInputs = true;

	viewer.scene.globe.depthTestAgainstTerrain = false;

	cameraSwitchStartedTime = Cesium.getTimestamp();

	if (cameraUpdateEventListener) {
		cameraUpdateEventListener(); // stops the camera update

		let distanceCartesian3 = new Cesium.Cartesian3();
		Cesium.Cartesian3.subtract(viewer.camera.position, cameraFlyToCache.cartographicCartesain3, distanceCartesian3);
		let distance = Cesium.Cartesian3.magnitude(distanceCartesian3);
		let duration = distance / 5000000;

		let startTime = Cesium.getTimestamp();
		let lastFov = viewer.camera.frustum.fov;

		function updateFov() {
			let now = Cesium.getTimestamp();

			let t = Cesium.EasingFunction.CUBIC_IN_OUT(((now - startTime) / 1000) / duration);

			if (t >= 1) {
				viewer.scene.preRender.removeEventListener(updateFov);
				viewer.camera.frustum.fov = cameraFlyToCache.fov;
				return
			}

			viewer.camera.frustum.fov = lastFov + ((cameraFlyToCache.fov - lastFov) * t);
		}

		viewer.scene.preRender.addEventListener(updateFov);

		stopFovUpdate = () => {
			viewer.scene.preRender.removeEventListener(updateFov);
		};

		viewer.camera.flyTo({
			destination: cameraFlyToCache.cartographicCartesain3,
			duration: duration,
			easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
			orientation: {
				heading: cameraFlyToCache.headingRad,
				pitch: cameraFlyToCache.pitchRad,
				roll: cameraFlyToCache.rollRad
			},
			complete: () => {
				if (cameraMode == "normal") {
					cameraSwitchCooldown = false;
					viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
				}
			}
		});

		cameraUpdateEventListener = null;
	}

}

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

let MOUSE_DOWN = false;
let mousePosition = new Cesium.Cartesian2(0, 0);

handler.setInputAction((movement) => {
	if (!MOUSE_DOWN) return
	lookDirection.x -= (movement.endPosition.x - mousePosition.x) * lookSensitivity
	lookDirection.y += (movement.endPosition.y - mousePosition.y) * lookSensitivity

	lookDirection.x = lookDirection.x % 360
	lookDirection.y = Cesium.Math.clamp(lookDirection.y, -85, 85)

	mousePosition.x = movement.endPosition.x
	mousePosition.y = movement.endPosition.y
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

handler.setInputAction((movement) => {
	MOUSE_DOWN = true;
	mousePosition = movement.position;
}, Cesium.ScreenSpaceEventType.LEFT_DOWN)

handler.setInputAction(() => {
	MOUSE_DOWN = false;
}, Cesium.ScreenSpaceEventType.LEFT_UP)

