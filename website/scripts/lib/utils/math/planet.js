import * as Cesium from "cesium";

export function getLengthOfLine(points) {
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


export function getLineInBetween(points, totalLength, progress, segmentDistances) {
	let lengthToTravel = totalLength * progress;

	let lines = []

	for (let i = 0; i < points.length - 1; i++) {
		lengthToTravel = Math.max(lengthToTravel, 0)

		let segmentLength = segmentDistances[i];

		let lenthFraction = lengthToTravel / segmentLength;

		let cartesianArrayIndex = i;

		lines.push(points[cartesianArrayIndex])
		lengthToTravel -= segmentLength * Cesium.Math.clamp(lenthFraction, 0, 1);

		if (lenthFraction > 1) {
			if (!(i + 1 < points.length - 1)) {
				lines.push(points[(cartesianArrayIndex) + 1])
			}
			continue
		}

		if (lenthFraction == 1) {
			lines.push(points[(cartesianArrayIndex) + 1])
			break
		}


		let geodesic = new Cesium.EllipsoidGeodesic(
			Cesium.Cartographic.fromCartesian(points[i]),
			Cesium.Cartographic.fromCartesian(points[i + 1]),
		)


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
