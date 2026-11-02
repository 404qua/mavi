import * as Cesium from "cesium";
import { getJson } from "../../../lib/utils/getJson";
import { createMapMarker } from "../mapMarkers";

function createWapointImage(svg) {
	return new Promise((resolve, reject) => {

		const canvasSize = 64;
		const padding = 8;
		const imageSize = canvasSize - (padding * 2) - 16;

		let canvas = document.createElement("canvas");
		canvas.width = canvasSize;
		canvas.height = canvasSize;

		let ctx = canvas.getContext("2d");

		let color = "#00000005"
		let outlineColor = "#ffffff08"
		let borderWidth = 2
		let borderRadius = 4

		ctx.beginPath();
		ctx.fillStyle = color;
		ctx.strokeStyle = outlineColor;
		let totalPadding = padding + (borderWidth / 2)
		ctx.roundRect(totalPadding, totalPadding, canvasSize - (totalPadding * 2), canvasSize - (totalPadding * 2), borderRadius)
		ctx.lineWidth = borderWidth;
		// ctx.stroke();
		ctx.fill();


		const svgLoader = new Image();

		svgLoader.onload = () => {
			let imagePosition = (canvasSize - imageSize) / 2
			ctx.drawImage(svgLoader, imagePosition, imagePosition, imageSize, imageSize);
			resolve(canvas.toDataURL("image/png"))
		}

		svgLoader.onerror = () => {
			reject(new Error(`Failed to load icon: ${svg}`));
		}

		svgLoader.src = svg;
	})
}

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

	let color = Cesium.Color.KHAKI
	let image = iconImageData.star

	switch (importance) {
		case 0:
			drawDistance = 750000
			color = Cesium.Color.GRAY
			image = iconImageData.circle
			break;
		case 1:
			drawDistance = 1600000
			color = Cesium.Color.CORNFLOWERBLUE

			image = iconImageData.triangle
			break;
		case 2:
			drawDistance = 5000000
			color = Cesium.Color.CRIMSON

			image = iconImageData.fourstar
			break;
	}

	let labelGap = 14;

	let waypointHeight = Math.max((waypointOffset + elevation), 0)

	createMapMarker(
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
