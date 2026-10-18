import { Viewport } from "./viewport";
import * as Cesium from "cesium";

let viewport = await Viewport

const currentPath = null;

export function AddPathLine(points) {
	return viewport.entities.add({
		polyline: {
			positions: Cesium.Cartesian3.fromDegreesArray(points),
			width: 16,
			clampToGround: true,
			material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.CYAN),
		}
	});

}

export function ReplaceCurrentPath(points) {
	let newPath = AddPathLine(points)

	if (staticLine) {
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
