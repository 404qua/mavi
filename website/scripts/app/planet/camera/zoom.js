import { Viewport } from "../viewport";
import { BOUNDS } from "./limit";

const viewer = await Viewport;

const zoomIn = document.getElementById("zoom-in");
const zoomOut = document.getElementById("zoom-out");

const maxZoomOffset = 12000;

zoomIn.addEventListener("click", () => {
	let lowestZoom = BOUNDS.north != undefined ? 1000 : 1000000;
	let maxZoom = BOUNDS.north != undefined ? -7000 : maxZoomOffset;

	viewer.camera.zoomIn(
		Math.max(
			Math.min(
				lowestZoom,
				viewer.camera.positionCartographic.height - maxZoom,
			),
			0,
		),
	);
});

zoomOut.addEventListener("click", () => {
	let lowestZoom = BOUNDS.north != undefined ? 2000 : 1000000;
	let maxZoom = BOUNDS.north != undefined ? 2000 : 250000;

	viewer.camera.zoomOut(
		Math.max(
			Math.min(
				lowestZoom,
				Math.max(viewer.camera.positionCartographic.height, maxZoom),
			),
			0,
		),
	);
});


export function SetZoomEnabled(enabled) {
	if (enabled == true) {
		zoomIn.classList.remove("disabled");
		zoomOut.classList.remove("disabled");
	} else {
		zoomIn.classList.add("disabled");
		zoomOut.classList.add("disabled");
	}
}
