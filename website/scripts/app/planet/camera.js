import * as Cesium from "cesium";

import { Viewport } from "./viewport";

let viewer = await Viewport

let velocity = { x: 0, y: 0 }
let acceleration = 300000;
let decceleration = 0.994;
let friction = 80000;
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

// ---- AI START: helpers ----
const EARTH_RADIUS = 6378137;

const normal = new Cesium.Cartesian3();   // unit vector for where we are
const north = new Cesium.Cartesian3();    // reference "forward" tangent, carried along as we move
const right = new Cesium.Cartesian3();
const moveDir = new Cesium.Cartesian3();
const axis = new Cesium.Cartesian3();
const kxv = new Cesium.Cartesian3();
const tmp = new Cesium.Cartesian3();
const horiz = new Cesium.Cartesian3();
const viewDir = new Cesium.Cartesian3();
const viewUp = new Cesium.Cartesian3();
const cartoScratch = new Cesium.Cartographic();

// out = a*sa + b*sb
function combine(a, sa, b, sb, out) {
	out.x = a.x * sa + b.x * sb;
	out.y = a.y * sa + b.y * sb;
	out.z = a.z * sa + b.z * sb;
}

// Rodrigues rotation of v around unit axis k, in place
function rotate(v, k, c, s) {
	Cesium.Cartesian3.cross(k, v, kxv);
	const kdv = Cesium.Cartesian3.dot(k, v) * (1 - c);
	v.x = v.x * c + kxv.x * s + k.x * kdv;
	v.y = v.y * c + kxv.y * s + k.y * kdv;
	v.z = v.z * c + kxv.z * s + k.z * kdv;
}
// ---- AI END ----

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

	// ---- AI START: movement ----
	const speed = Cesium.Cartesian2.magnitude(velocity);
	if (speed < 0.01) {
		velocity.x = 0;
		velocity.y = 0;
	} else {
		Cesium.Cartesian3.cross(north, normal, right);
		combine(right, velocity.x / speed, north, velocity.y / speed, moveDir);

		Cesium.Cartesian3.cross(normal, moveDir, axis);
		const angle = speed * delta / EARTH_RADIUS;
		const c = Math.cos(angle), s = Math.sin(angle);
		rotate(normal, axis, c, s);
		rotate(north, axis, c, s);

		// fix floating point drift
		Cesium.Cartesian3.normalize(normal, normal);
		Cesium.Cartesian3.multiplyByScalar(normal, Cesium.Cartesian3.dot(north, normal), tmp);
		Cesium.Cartesian3.subtract(north, tmp, north);
		Cesium.Cartesian3.normalize(north, north);
	}
	Cesium.Cartesian3.cross(north, normal, right);

	const carto = cartoScratch;
	carto.longitude = Math.atan2(normal.y, normal.x);
	carto.latitude = Math.asin(Cesium.Math.clamp(normal.z, -1, 1));
	carto.height = 0;
	position.x = Cesium.Math.toDegrees(carto.longitude);
	position.y = Cesium.Math.toDegrees(carto.latitude);
	// ---- AI END ----

	let terrainHeight = viewer.scene.globe.getHeight(carto);
	if (!Cesium.defined(terrainHeight)) {
		terrainHeight = cameraOffset;
	}

	const cameraPos = Cesium.Cartesian3.fromRadians(
		carto.longitude, carto.latitude, terrainHeight + cameraOffset
	);

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
			? { heading: AnimatedHeading, pitch: AnimatedPitch, roll: AnimatedRoll }  // your intro animation, untouched
			: { direction: viewDir, up: viewUp }
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

	// ---- AI START: init frame ----
	const lat0 = Cesium.Math.toRadians(position.y);
	const lon0 = Cesium.Math.toRadians(position.x);
	Cesium.Cartesian3.fromElements(
		Math.cos(lat0) * Math.cos(lon0), Math.cos(lat0) * Math.sin(lon0), Math.sin(lat0), normal);
	Cesium.Cartesian3.fromElements(
		-Math.sin(lat0) * Math.cos(lon0), -Math.sin(lat0) * Math.sin(lon0), Math.cos(lat0), north);
	// ---- AI END ----

	cameraValuesCache.direction = viewer.camera.direction.clone();
	cameraValuesCache.up = viewer.camera.up.clone();

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
