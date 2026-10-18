import { Viewport } from "./viewport";
import * as Cesium from "cesium";


function getLengthOfLine(points) {
	let length = 0;

	let segmentLengths = []

	for (let i = 0; i < points.length - 1; i++) {
		let geodesic = new Cesium.EllipsoidGeodesic(
			Cesium.Cartographic.fromCartesian(points[i]),
			Cesium.Cartographic.fromCartesian(points[i + 1]),
		)

		length += geodesic.surfaceDistance;
		segmentLengths[i] = geodesic.surfaceDistance;
	}

	return [length, segmentLengths]
}

let viewport = await Viewport

let currentPath = null;


export function AddPathLine(points) {
	const withHeights = [];
	for (let i = 0; i < points.length; i += 2) {
		withHeights.push(points[i], points[i + 1], 5000);
	}
	let pointsInCartesian = Cesium.Cartesian3.fromDegreesArrayHeights(withHeights);
	let animatedPoints = [pointsInCartesian[0], pointsInCartesian[0]];

	let path = viewport.entities.add({
		polyline: {
			positions: new Cesium.CallbackProperty(() => animatedPoints, false),
			width: 16,
			arcType: Cesium.ArcType.GEODESIC,
			clampToGround: false,
			granularity: Cesium.Math.toRadians(0.1),
			material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.CYAN),
		}
	});



	function getLineInBetween(points, totalLength, progress, segmentDistances) {
		let lengthToTravel = totalLength * progress;

		let lines = []

		let geodesic = null;
		let geodesicIdx = -1;

		for (let i = 0; i < points.length - 1; i++) {
			lengthToTravel = Math.max(lengthToTravel, 0)

			let segmentLength = segmentDistances[i];

			let lenthFraction = lengthToTravel / segmentLength;

			let cartesianArrayIndex = i;

			lines.push(pointsInCartesian[cartesianArrayIndex])
			lengthToTravel -= segmentLength * Cesium.Math.clamp(lenthFraction, 0, 1);

			if (lenthFraction > 1) {
				if (!(i + 1 < points.length - 1)) {
					lines.push(pointsInCartesian[(cartesianArrayIndex) + 1])
				}
				continue
			}

			if (lenthFraction == 1) {
				lines.push(pointsInCartesian[(cartesianArrayIndex) + 1])
				break
			}


			if (geodesicIdx != i) {
				geodesic = new Cesium.EllipsoidGeodesic(
					Cesium.Cartographic.fromCartesian(pointsInCartesian[i]),
					Cesium.Cartographic.fromCartesian(pointsInCartesian[i + 1]),
				)
				geodesicIdx = i;
			}


			let interpolatedGeodesicPosition = geodesic.interpolateUsingFraction(lenthFraction)

			lines.push(
				Cesium.Cartesian3.fromRadians(
					interpolatedGeodesicPosition.longitude,
					interpolatedGeodesicPosition.latitude,
					interpolatedGeodesicPosition.height
				)
			)
			break
		}

		return lines;
	}

	let animationStartTime_ms = performance.now()

	let [totalPathLength, segmentDistances] = getLengthOfLine(pointsInCartesian)
	console.log(totalPathLength)
	let animationLengthSeconds = totalPathLength / 5000000 / 2


	function animatePath(time_ms) {
		let animationProgress = Cesium.EasingFunction.CUBIC_OUT(Cesium.Math.clamp(((time_ms - animationStartTime_ms) / 1000) / animationLengthSeconds, 0, 1));

		animatedPoints = getLineInBetween(pointsInCartesian, totalPathLength, animationProgress, segmentDistances)


		viewport.scene.requestRender();

		if (animationProgress < 1) {
			requestAnimationFrame(animatePath)
			return
		}

		path.polyline._positions = new Cesium.ConstantProperty(pointsInCartesian);
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

document.getElementById("randomizePath").addEventListener("mouseup", () => {
	console.log("test")

	ReplaceCurrentPath(
		[
			-75.1641667, 39.9522221,
			60.0060, 40.7128,
			60.0589, 88.3601,
		]
	)
})
