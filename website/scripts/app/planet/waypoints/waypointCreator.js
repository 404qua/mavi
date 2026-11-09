import * as Cesium from "cesium";
import { getJson } from "../../../lib/utils/getJson";
import { createMapMarker } from "../mapMarkers";
import { Viewport } from "../viewport";
import { createWapointImage } from "../../../lib/utils/createWaypointImage";

const viewer = await Viewport

let wayPointList = [];

const iconPaths = {
	star: "icons/star.svg",
	fourstar: "icons/fourstar.svg",
	triangle: "icons/triangle.svg",
	circle: "icons/circle.svg",
}

const iconImageData = {
	star: await createWapointImage(iconPaths.star),
	fourstar: await createWapointImage(iconPaths.fourstar),
	triangle: await createWapointImage(iconPaths.triangle),
	circle: await createWapointImage(iconPaths.circle),
}

const waypointOffset = 5000;

function createWaypoint(text, longitude, latitude, importance, id, elevation) {
	let drawDistance = 27000000;

	let color = Cesium.Color.fromRgba(0xeeeeeeff)
	let image = iconImageData.star

	switch (importance) {
		case 0:
			drawDistance = 1500000
			// color = Cesium.Color.GAINSBORO
			image = iconImageData.circle
			break;
		case 1:
			drawDistance = 3500000

			// color = Cesium.Color.LIGHTBLUE

			image = iconImageData.triangle
			break;
		case 2:
			drawDistance = 7500000
			// color = Cesium.Color.LIGHTCORAL

			image = iconImageData.fourstar
			break;
	}

	let labelGap = 14;

	let waypointHeight = Math.max((waypointOffset + (elevation * viewer.scene.verticalExaggeration)), 0)

	wayPointList[id] = createMapMarker(
		{
			longitude: longitude,
			latitude: latitude,
			height: waypointHeight,
			image: image,
			text: text,
			color: color,
			elevation: elevation,
			pixelOffset: labelGap,
			drawDistance: drawDistance,
			hoverable: true,
			id: id,
		})
}

export let features = await getJson("data/mars_features.json");

features.forEach((e, i) => {
	createWaypoint(e.name, e.longitude, e.latitude, e.importance, i, e.elevation)
})

export function SetWaypointsVisible(visible) {
	wayPointList.forEach((e) => {
			e.show = visible
	})
}
