import { KeysPressed } from "./input";
import * as Cesium from "cesium";
import { combine } from "../../../../lib/utils/math/planet";
import { BOUNDS } from "../limit";

import { JoystickOutput } from "../../../joystick";

import { Viewport } from "../../viewport";

const viewer = await Viewport;

let velocity = { x: 0, y: 0 };
let acceleration = 300000;
let deceleration = 0.994;
let friction = 80000;

// ---- AI START: helpers ----
const EARTH_RADIUS = 6378137;

export const normal = new Cesium.Cartesian3(); // unit vector for where we are
export const north = new Cesium.Cartesian3(); // reference "forward" tangent, carried along as we move
export const right = new Cesium.Cartesian3();
const moveDir = new Cesium.Cartesian3();
const axis = new Cesium.Cartesian3();
const kxv = new Cesium.Cartesian3();
const tmp = new Cesium.Cartesian3();
export let CartographicPosition = new Cesium.Cartographic();

// Rodrigues rotation of v around unit axis k, in place
function rotate(v, k, c, s) {
	Cesium.Cartesian3.cross(k, v, kxv);
	const kdv = Cesium.Cartesian3.dot(k, v) * (1 - c);
	v.x = v.x * c + kxv.x * s + k.x * kdv;
	v.y = v.y * c + kxv.y * s + k.y * kdv;
	v.z = v.z * c + kxv.z * s + k.z * kdv;
}
// ---- AI END ----

export function ResetPhysicsValues() {
	velocity = { x: 0, y: 0 };
	Cesium.Cartographic.clone(
		viewer.camera.positionCartographic,
		CartographicPosition,
	);
	CartographicPosition.height = 0;
}

export function PhysicsTick(delta, lookDirection) {
	const keyboardMoveDirection = new Cesium.Cartesian2(
		KeysPressed.right - KeysPressed.left,
		KeysPressed.up - KeysPressed.down,
	);
	const moveDirection = keyboardMoveDirection.clone();

	let JoystickOutputDirection = { ...JoystickOutput };

	if (JoystickOutputDirection.inputEnabled) {
		moveDirection.x += JoystickOutputDirection.x;
		moveDirection.y += JoystickOutputDirection.y;
	}

	if (Math.abs(Cesium.Cartesian2.magnitude(moveDirection)) > 0) {
		let lookDirectionX = Cesium.Math.toRadians(-lookDirection.x);

		Cesium.Cartesian2.normalize(moveDirection, moveDirection);

		const lookCosX = Math.cos(lookDirectionX);
		const lookSinX = Math.sin(lookDirectionX);

		const resultantVector = new Cesium.Cartesian2(
			moveDirection.x * lookCosX - moveDirection.y * lookSinX,
			moveDirection.x * lookSinX + moveDirection.y * lookCosX,
		);

		moveDirection.x = resultantVector.x;
		moveDirection.y = resultantVector.y;
	}

	if (JoystickOutputDirection.inputEnabled) {
		if (Math.abs(Cesium.Cartesian2.magnitude(keyboardMoveDirection)) > 0) {
			Cesium.Cartesian2.normalize(keyboardMoveDirection, keyboardMoveDirection);
		}

		Cesium.Cartesian2.add(
			JoystickOutputDirection,
			keyboardMoveDirection,
			JoystickOutputDirection,
		);

		JoystickOutputDirection.x = Cesium.Math.clamp(
			JoystickOutputDirection.x,
			-1,
			1,
		);
		JoystickOutputDirection.y = Cesium.Math.clamp(
			JoystickOutputDirection.y,
			-1,
			1,
		);

		const JoystickStrength = Cesium.Cartesian2.distance(
			JoystickOutputDirection,
			{
				x: 0,
				y: 0,
			},
		);

		Cesium.Cartesian2.multiplyByScalar(
			moveDirection,
			JoystickStrength,
			moveDirection,
		);
	}

	Cesium.Cartesian2.multiplyByScalar(
		moveDirection,
		acceleration * delta,
		moveDirection,
	);

	Cesium.Cartesian2.add(velocity, moveDirection, velocity);

	Cesium.Cartesian2.multiplyByScalar(
		velocity,
		(1 - deceleration) ** delta,
		velocity,
	);

	let velocityMagnitude = Cesium.Cartesian2.magnitude(velocity);
	if (velocityMagnitude > 0) {
		let frictionDirection = new Cesium.Cartesian2();
		Cesium.Cartesian2.normalize(velocity, frictionDirection);
		Cesium.Cartesian2.multiplyByScalar(
			frictionDirection,
			-Math.min(friction, velocityMagnitude) * delta,
			frictionDirection,
		);

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
		const angle = (speed * delta) / EARTH_RADIUS;
		const c = Math.cos(angle),
			s = Math.sin(angle);
		rotate(normal, axis, c, s);
		rotate(north, axis, c, s);

		// fix floating point drift
		Cesium.Cartesian3.normalize(normal, normal);
		Cesium.Cartesian3.multiplyByScalar(
			normal,
			Cesium.Cartesian3.dot(north, normal),
			tmp,
		);
		Cesium.Cartesian3.subtract(north, tmp, north);
		Cesium.Cartesian3.normalize(north, north);
	}
	Cesium.Cartesian3.cross(north, normal, right);

	CartographicPosition;
	CartographicPosition.longitude = Math.atan2(normal.y, normal.x);
	CartographicPosition.latitude = Math.asin(Cesium.Math.clamp(normal.z, -1, 1));
	CartographicPosition.height = 0;

	if (BOUNDS.north != undefined) {
		const lon = CartographicPosition.longitude;
		const lat = CartographicPosition.latitude;

		const hitEast = lon > BOUNDS.east;
		const hitWest = lon < BOUNDS.west;
		const hitNorth = lat > BOUNDS.north;
		const hitSouth = lat < BOUNDS.south;

		if (hitEast || hitWest || hitNorth || hitSouth) {
			if ((hitEast && velocity.x > 0) || (hitWest && velocity.x < 0))
				velocity.x = 0;
			if ((hitNorth && velocity.y > 0) || (hitSouth && velocity.y < 0))
				velocity.y = 0;

			const clampedLon = Cesium.Math.clamp(lon, BOUNDS.west, BOUNDS.east);
			const clampedLat = Cesium.Math.clamp(lat, BOUNDS.south, BOUNDS.north);

			CartographicPosition.longitude = clampedLon;
			CartographicPosition.latitude = clampedLat;

			// sync internal state to the clamped position
			const cosLat = Math.cos(clampedLat);
			normal.x = cosLat * Math.cos(clampedLon);
			normal.y = cosLat * Math.sin(clampedLon);
			normal.z = Math.sin(clampedLat);

			Cesium.Cartesian3.multiplyByScalar(
				normal,
				Cesium.Cartesian3.dot(north, normal),
				tmp,
			);
			Cesium.Cartesian3.subtract(north, tmp, north);
			Cesium.Cartesian3.normalize(north, north);
			Cesium.Cartesian3.cross(north, normal, right);
		}
	}

	// ---- AI END ----
}
