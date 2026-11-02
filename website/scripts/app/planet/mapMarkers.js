import * as Cesium from "cesium"
import { Viewport } from "./viewport";
const viewer = await Viewport

const textDrawdistanceScale = 0.5;

export function createMapMarker(
	{
		longitude,
		latitude,
		height = 1000,
		image = undefined,
		text = "",
		color = Cesium.Color.WHITE,
		hoverable = false,
		elevation = 0,
		pixelOffset = 0,
		drawDistance = 50000000,
		id,
	}
) {

	let scaleByDistance = new Cesium.NearFarScalar(Math.max(drawDistance * textDrawdistanceScale, 600000), 1, drawDistance, 0.4);

	return viewer.entities.add({
		position: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),

		properties: {
			hoverable: hoverable,
			elevation: elevation,
			featureId: id,
		},

		billboard: {
			image: image,
			pixelOffset: new Cesium.Cartesian2(0, -pixelOffset),
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
			pixelOffset: new Cesium.Cartesian2(0, pixelOffset),
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
