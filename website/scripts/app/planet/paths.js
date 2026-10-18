import { Viewport } from "./viewport";
import * as Cesium from "cesium";

function getLengthBetweenTwoPoints(points1, points2) {
	return Math.sqrt(
		Math.pow(points1[0] - points2[0], 2) +
		Math.pow(points1[1] - points2[1], 2)
	)
}

function getLengthOfLine(points) {
	let length = 0;

	for (let i = 0; i < points.length - 2; i = i + 2) {
		length += getLengthBetweenTwoPoints([points[i], points[i + 1]], [points[i + 2], points[i + 3]])
	}

	return length
}

let viewport = await Viewport

let currentPath = null;

export function AddPathLine(points) {
	let pointsInCartesian = Cesium.Cartesian3.fromDegreesArray(points);
	let animatedPoints = [pointsInCartesian[0], pointsInCartesian[0]];

	let path = viewport.entities.add({
		polyline: {
			positions: new Cesium.CallbackProperty(() => animatedPoints, false),
			width: 24,
			arcType: Cesium.ArcType.GEODESIC,
			clampToGround: false,
			material: new Cesium.ColorMaterialProperty(Cesium.Color.CYAN),
		}
	});


	function lerp(start, goal, t) {
		return start + ((goal - start) * t)
	}

	function lerpBetweenTwo3DPoints(point1, point2, t) {
		return {
			x: lerp(point1.x, point2.x, t),
			y: lerp(point1.y, point2.y, t),
			z: lerp(point1.z, point2.z, t),
		}
	}

	function getLineInBetween(points, totalLength, progress) {
		let lengthToTravel = totalLength * progress;

		let lines = []

		for (let i = 0; i < points.length - 2; i = i + 2) {
			lengthToTravel = Math.max(lengthToTravel, 0)

			let segmentLength = getLengthBetweenTwoPoints([points[i], points[i + 1]], [points[i + 2], points[i + 3]])

			let lenthFraction = lengthToTravel / segmentLength;

			let cartesianArrayIndex = i / 2;

			lines.push(pointsInCartesian[cartesianArrayIndex])
			lengthToTravel -= segmentLength * Cesium.Math.clamp(lenthFraction, 0, 1);

			if (lenthFraction > 1) {
				if (!(i + 2 < points.length - 2)) {
					lines.push(pointsInCartesian[(cartesianArrayIndex) + 1])
				}
				continue
			}

			if (lenthFraction == 1) {
				lines.push(pointsInCartesian[(cartesianArrayIndex) + 1])
				break
			}

			lines.push(lerpBetweenTwo3DPoints(
				pointsInCartesian[cartesianArrayIndex],
				pointsInCartesian[(cartesianArrayIndex) + 1],
				lenthFraction
			))
			break
		}

		return lines;
	}

	let animationStartTime_ms = performance.now()

	let totalPathLength = getLengthOfLine(points)
	let animationLengthSeconds = totalPathLength / 10

	function animatePath(time_ms) {
		let animationProgress = Cesium.Math.clamp(((time_ms - animationStartTime_ms) / 1000) / animationLengthSeconds, 0, 1)

		animatedPoints = getLineInBetween(points, totalPathLength, animationProgress)

		if (animationProgress < 1) {
			requestAnimationFrame(animatePath)
			return
		}

		path.polyline.positions = new Cesium.ConstantProperty(pointsInCartesian);
	}

	requestAnimationFrame(animatePath)

	return path

}

export function ReplaceCurrentPath(points) {
	let newPath = AddPathLine(points)

	if (currentPath) {
		viewport.entities.remove(currentPath)
	}

	currentPath = newPath
}

ReplaceCurrentPath(
	[
		-75.1641667, 39.9522221,
		60.0060, 40.7128,
		60.0589, 88.3601,
	]
)
