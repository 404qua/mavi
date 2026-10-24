import { Viewport } from "./viewport";
import * as Cesium from "cesium";

import { getLineInBetween, getLengthOfLine } from "../../lib/utils/math/planet";

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

	let animationStartTime_ms = performance.now()

	let [totalPathLength, segmentDistances] = getLengthOfLine(pointsInCartesian)
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
	if (currentPath) {
		viewport.entities.remove(currentPath)
	}

	currentPath = AddPathLine(points)
}

document.getElementById("randomizePath").addEventListener("click", () => {
	let random = () => (Math.random() - 0.5) * 2;

	let [x, y] = [90, 180]

	ReplaceCurrentPath(
		[
			random() * x, random() * y,
			random() * x, random() * y,
			random() * x, random() * y,
			random() * x, random() * y,
			random() * x, random() * y,
			random() * x, random() * y,
		]
	)
})
