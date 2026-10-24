import { Viewport } from "../viewport";
import * as Cesium from "cesium";
import { getJson } from "../../../lib/utils/getJson";

let viewer = await Viewport;

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

const textDrawdistanceScale = 0.5;
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

	let scaleByDistance = new Cesium.NearFarScalar(Math.max(drawDistance * textDrawdistanceScale, 600000), 1, drawDistance, 0.4);
	let labelGap = 14;

	let waypointHeight = Math.max((waypointOffset + elevation), 0)

	viewer.entities.add({
		position: Cesium.Cartesian3.fromDegrees(longitude, latitude, waypointHeight),

		properties: {
			hoverable: true,
			featureId: id,
			elevation: elevation,
		},

		billboard: {
			image: image,
			pixelOffset: new Cesium.Cartesian2(0, -labelGap),
			verticalOrigin: Cesium.VerticalOrigin.CENTER,
			scale: .75,
			disableDepthTestDistance: undefined,
			distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, drawDistance),
			scaleByDistance: scaleByDistance,
			// heightReference: Cesium.HeightReference.RELATIVE_TO_TERRAIN,
			heightReference: Cesium.HeightReference.NONE,
		},

		label: {
			text: text,
			pixelOffset: new Cesium.Cartesian2(0, labelGap),
			font: "bold 14px Play",
			fillColor: color,
			outlineWidth: 3,
			scale: 0.85,
			showBackground: true,
			backgroundColor: Cesium.Color.BLACK.withAlpha(0.05),
			outlineColor: Cesium.Color.BLACK.withAlpha(0.2),
			style: Cesium.LabelStyle.FILL,
			verticalOrigin: Cesium.VerticalOrigin.CENTER,
			disableDepthTestDistance: undefined,
			distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, drawDistance / 2),
			scaleByDistance: scaleByDistance,
			// heightReference: Cesium.HeightReference.RELATIVE_TO_TERRAIN,
			heightReference: Cesium.HeightReference.NONE,
		},

	});
}

export let features = await getJson("data/mars_features.json");

features.forEach((e, i) => {
	createWaypoint(e.name, e.longitude, e.latitude, e.importance, i, e.elevation)
})
