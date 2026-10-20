import * as Cesium from "cesium";

import { Viewport } from "./viewport";

let viewer = await Viewport

let velocity = { x: 0, y: 0 }
let acceleration = .0016;
let decceleration = 0.9;
let friction = .0004;
let pressedKeys = { up: 0, down: 0, right: 0, left: 0 }

let position = { x: 0, y: 0 }
let lookDirection = { x: 0, y: 0 }
let lookSensitivity = 0.08;

window.addEventListener('keydown', (event) => {
	switch (event.key) {
		case 'ArrowUp':
			pressedKeys.up = 1;
			break;
		case 'ArrowDown':
			pressedKeys.down = 1;
			break;
		case 'ArrowLeft':
			pressedKeys.left = 1;
			break;
		case 'ArrowRight':
			pressedKeys.right = 1;
			break;
	}
});

window.addEventListener('keyup', (event) => {
	switch (event.key) {
		case 'ArrowUp':
			pressedKeys.up = 0;
			break;
		case 'ArrowDown':
			pressedKeys.down = 0;
			break;
		case 'ArrowLeft':
			pressedKeys.left = 0;
			break;
		case 'ArrowRight':
			pressedKeys.right = 0;
			break;
	}
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startPhysicsSimulation() {

	let shouldRunSim = true;

	function stopSim() {
		shouldRunSim = false
	}

	while (shouldRunSim) {

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

		Cesium.Cartesian2.multiplyByScalar(moveDirection, acceleration, moveDirection);

		Cesium.Cartesian2.add(velocity, moveDirection, velocity);

		Cesium.Cartesian2.multiplyByScalar(velocity, decceleration, velocity);

		let velocityMagnitude = Cesium.Cartesian2.magnitude(velocity)
		if (velocityMagnitude > 0) {
			let frictionDirection = new Cesium.Cartesian2();
			Cesium.Cartesian2.normalize(velocity, frictionDirection)
			Cesium.Cartesian2.multiplyByScalar(frictionDirection, -Math.min(friction, velocityMagnitude), frictionDirection);

			Cesium.Cartesian2.add(velocity, frictionDirection, velocity);
		}

		let precision = 16
		let round = (10 ** (precision))

		velocity.x = Math.floor(Number(velocity.x.toFixed(precision + 1)) * round) / round;
		velocity.y = Math.floor(Number(velocity.y.toFixed(precision + 1)) * round) / round;

		position.y += velocity.y

		const cosLat = Math.max(Math.cos(Cesium.Math.toRadians(position.y)), 1e-3);
		position.x += velocity.x / cosLat;


		const worldPos = Cesium.Cartesian3.fromDegrees(position.x, position.y, 0);
		const cartographicPos = Cesium.Cartographic.fromCartesian(worldPos);

		let terrainHeight = viewer.scene.globe.getHeight(cartographicPos);

		let cameraOffset = 10000

		if (!(Cesium.defined(terrainHeight))) {
			terrainHeight = cameraOffset
		}

		const cameraPos = Cesium.Cartesian3.fromDegrees(position.x, position.y, terrainHeight + cameraOffset);

		viewer.camera.setView({
			destination: cameraPos,
			orientation: {
				heading: Cesium.Math.toRadians(lookDirection.x),
				pitch: Cesium.Math.toRadians(lookDirection.y),
				roll: 0.0
			}
		});

		await sleep(16)
	}

	return stopSim
}

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

let MOUSE_DOWN = false;
let mousePosition = new Cesium.Cartesian2(0, 0);

handler.setInputAction((movement) => {
	if (!MOUSE_DOWN) return
	lookDirection.x -= (movement.endPosition.x - mousePosition.x) * lookSensitivity
	lookDirection.y += (movement.endPosition.y - mousePosition.y) * lookSensitivity

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

viewer.scene.screenSpaceCameraController.enableInputs = false;

startPhysicsSimulation();
