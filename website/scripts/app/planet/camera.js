import * as Cesium from "cesium";

import { Viewport } from "./viewport";

let viewer = await Viewport

let velocity = { x: 0, y: 0 }
let acceleration = 0.16;
let decceleration = 0.994;
let friction = 0.04;
let pressedKeys = { up: 0, down: 0, right: 0, left: 0 }

let position = { x: 0, y: 0 }
let lookDirection = { x: 0, y: 0 }
let lookSensitivity = 0.08;

window.addEventListener('keydown', (event) => {
	switch (event.key.toLowerCase()) {
		case 'arrowup':
		case 'w':
			pressedKeys.up = 1;
			break;
		case 'arrowdown':
		case 's':
			pressedKeys.down = 1;
			break;
		case 'arrowleft':
		case 'a':
			pressedKeys.left = 1;
			break;
		case 'arrowright':
		case 'd':
			pressedKeys.right = 1;
			break;
	}
});

window.addEventListener('keyup', (event) => {
	switch (event.key.toLowerCase()) {
		case 'arrowup':
		case 'w':
			pressedKeys.up = 0;
			break;
		case 'arrowdown':
		case 's':
			pressedKeys.down = 0;
			break;
		case 'arrowleft':
		case 'a':
			pressedKeys.left = 0;
			break;
		case 'arrowright':
		case 'd':
			pressedKeys.right = 0;
			break;
	}
});

let cameraValuesCache = {}
const maxLerp = 2000;
const cameraOffset = 5000

function physicsTick(delta) {
	const moveDirection = new Cesium.Cartesian2(pressedKeys.right - pressedKeys.left, pressedKeys.up - pressedKeys.down)

	if (Cesium.Cartesian2.magnitudeSquared(moveDirection) > 0) {
		let lookDirectionX = Cesium.Math.toRadians(-lookDirection.x);
		Cesium.Cartesian2.normalize(moveDirection, moveDirection);
		const lookCosX = Math.cos(lookDirectionX);
		const lookSinX = Math.sin(lookDirectionX);

		const resultantVector = new Cesium.Cartesian2(
			moveDirection.x * lookCosX - moveDirection.y * lookSinX,
			moveDirection.x * lookSinX + moveDirection.y * lookCosX
		);

		moveDirection.x = resultantVector.x;
		moveDirection.y = resultantVector.y;
	}

	Cesium.Cartesian2.multiplyByScalar(moveDirection, acceleration * delta, moveDirection);

	Cesium.Cartesian2.add(velocity, moveDirection, velocity);

	Cesium.Cartesian2.multiplyByScalar(velocity, (1 - decceleration) ** delta, velocity);

	let velocityMagnitude = Cesium.Cartesian2.magnitude(velocity)
	if (velocityMagnitude > 0) {
		let frictionDirection = new Cesium.Cartesian2();
		Cesium.Cartesian2.normalize(velocity, frictionDirection)
		Cesium.Cartesian2.multiplyByScalar(frictionDirection, (-Math.min(friction, velocityMagnitude)) * delta, frictionDirection);

		Cesium.Cartesian2.add(velocity, frictionDirection, velocity);
	}

	let precision = 16
	let round = (10 ** (precision))


	velocity.x = Math.floor(Number(velocity.x.toFixed(precision + 1)) * round) / round;
	velocity.y = Math.floor(Number(velocity.y.toFixed(precision + 1)) * round) / round;

	// position.y += velocity.y
	//
	// const cosLat = Math.max(Math.cos(Cesium.Math.toRadians(position.y)), 1e-3);
	// position.x += velocity.x / cosLat;

	// this is ai code and i have no idea how this sphere stuff works
	let speedInDegrees = Cesium.Cartesian2.magnitude(velocity);

	if (speedInDegrees > 0) {
		let bearingRad = Math.atan2(velocity.x, velocity.y);
		let bearingDeg = bearingRad * (180 / Math.PI);

		let distanceMeters = speedInDegrees * 111132.0;

		const EARTH_RADIUS = 6371000.0;
		let delta = distanceMeters / EARTH_RADIUS;

		let phi1 = position.y * (Math.PI / 180);
		let lambda1 = position.x * (Math.PI / 180);
		let theta = bearingDeg * (Math.PI / 180);

		let sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
		let phi2 = Math.asin(sinPhi2);

		let yComponent = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
		let xComponent = Math.cos(delta) - Math.sin(phi1) * sinPhi2;
		let lambda2 = lambda1 + Math.atan2(yComponent, xComponent);

		position.y = phi2 * (180 / Math.PI);
		position.x = (lambda2 * (180 / Math.PI) + 540) % 360 - 180;
	}
	// end of ai

	const worldPos = Cesium.Cartesian3.fromDegrees(position.x, position.y, 0);
	const cartographicPos = Cesium.Cartographic.fromCartesian(worldPos);

	let terrainHeight = viewer.scene.globe.getHeight(cartographicPos);

	if (!(Cesium.defined(terrainHeight))) {
		terrainHeight = cameraOffset
	}

	const cameraPos = Cesium.Cartesian3.fromDegrees(position.x, position.y, terrainHeight + cameraOffset);

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

	function lerpIntegerValue(a, b, t) {
		if (t >= 1) return b
		return a + ((b - a) * t)
	}

	viewer.camera.frustum.fov = lerpIntegerValue(cameraValuesCache.fov, Cesium.Math.toRadians(40), lerpValue);

	lerpValue = lerpValue ** 4;

	let AnimatedHeading = lerpIntegerValue(cameraValuesCache.headingRad, Cesium.Math.toRadians(lookDirection.x), lerpValue)
	let AnimatedPitch = lerpIntegerValue(cameraValuesCache.pitchRad, Cesium.Math.toRadians(lookDirection.y), lerpValue ** 4)
	let AnimatedRoll = lerpIntegerValue(cameraValuesCache.rollRad, 0, lerpValue)

	viewer.camera.setView({
		destination: cameraPos,
		orientation: {
			heading: AnimatedHeading,
			pitch: AnimatedPitch,
			roll: AnimatedRoll
		}
	});
}

let physicsEventListener = null;

function startPhysicsSimulation() {
	viewer.scene.screenSpaceCameraController.enableInputs = false;
	viewer.scene.globe.depthTestAgainstTerrain = true;

	velocity = { x: 0, y: 0 }
	pressedKeys = { up: 0, down: 0, right: 0, left: 0 }

	lookDirection = { x: 0, y: 0 }

	cameraValuesCache.cartographic = viewer.camera.positionCartographic.clone();

	cameraValuesCache.cartographicCartesain3 = Cesium.Cartesian3.fromRadians(
		cameraValuesCache.cartographic.longitude,
		cameraValuesCache.cartographic.latitude,
		cameraValuesCache.cartographic.height
	);

	cameraValuesCache.headingRad = viewer.camera.heading;
	cameraValuesCache.pitchRad = viewer.camera.pitch;
	cameraValuesCache.rollRad = viewer.camera.roll;

	position = { x: Cesium.Math.toDegrees(cameraValuesCache.cartographic.longitude), y: Cesium.Math.toDegrees(cameraValuesCache.cartographic.latitude) }

	cameraValuesCache.fov = viewer.camera.frustum.fov;

	let lastTime = Cesium.getTimestamp();

	cameraValuesCache.time = lastTime;

	physicsEventListener = viewer.scene.preRender.addEventListener(() => {
		const now = Cesium.getTimestamp();
		const deltaTime = (now - lastTime) / 1000;
		lastTime = now;

		physicsTick(deltaTime);
	});

	return
}

function stopPhysicsSimulation() {
	viewer.scene.screenSpaceCameraController.enableInputs = true;

	viewer.scene.globe.depthTestAgainstTerrain = false;

	if (physicsEventListener) {
		physicsEventListener();
		viewer.camera.flyTo({
			destination: cameraValuesCache.cartographicCartesain3,
			orientation: {
				heading: cameraValuesCache.headingRad,
				pitch: cameraValuesCache.pitchRad,
				roll: cameraValuesCache.rollRad
			}
		});

		viewer.camera.frustum.fov = cameraValuesCache.fov;
		physicsEventListener = null;
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


let toggleCheckbox = document.getElementById("firstPersonCameraToggle");

function updateFirstPersonCameraEnabled() {
	if (toggleCheckbox.checked == true) {
		if (physicsEventListener) return
		startPhysicsSimulation()
	} else {
		stopPhysicsSimulation()
	}
}

toggleCheckbox.addEventListener("input", () => {
	updateFirstPersonCameraEnabled();
})

updateFirstPersonCameraEnabled()
