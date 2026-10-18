import { Viewport } from "./viewport";
import * as Cesium from "cesium";

let viewport = await Viewport;

function createWaypoint(text, longitude, latitude, importance) {
	let drawDistance = 27000000;

	let color = Cesium.Color.YELLOW

	switch (importance) {
		case 0:
			drawDistance = 750000
			color = Cesium.Color.GRAY
			break;
		case 1:
			drawDistance = 1600000
			color = Cesium.Color.BLUE
			break;
		case 2:
			drawDistance = 5000000
			color = Cesium.Color.RED
			break;
	}

	viewport.entities.add({
		position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 15000),
		label: {
			eyeOffset: new Cesium.Cartesian3(0, 0, -1000),
			heightReference: Cesium.HeightReference.RELATIVE_TO_TERRAIN,
			text: text,
			font: "14px Source Sans 3",
			fillColor: color,
			outlineWidth: 3,
			showBackground: false,
			outline: Cesium.Color.BLACK.withAlpha(0.4),
			style: Cesium.LabelStyle.FILL_AND_OUTLINE,
			verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
			disableDepthTestDistance: 100000,
			distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, drawDistance)
		},
	});
}


async function getJson(url) {
	let i = 1
	while (true) {
		try {
			let response = await fetch(url);
			if (!response.ok) {
				throw new Error(response.status);
			}

			const json = await response.json();

			return json;
		} catch (error) {
			console.error(error);
			await new Promise((resolve) =>
				setTimeout(resolve, 200 * Math.pow(2, i)),
			);

			i++
		}
	}
}

let features = await getJson("/data/mars_features.json");

features.forEach((e) => {
	createWaypoint(e.name, e.longitude, e.latitude, e.importance)
})

