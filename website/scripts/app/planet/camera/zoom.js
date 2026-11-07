import { Viewport } from "../viewport";

const viewer = await Viewport;

const zoomIn = document.getElementById("zoom-in");
const zoomOut = document.getElementById("zoom-out");

const maxZoomOffset = 500000;

zoomIn.addEventListener("click", () => {
	viewer.camera.zoomIn(
		Math.max(
			Math.min(
				1000000,
				viewer.camera.positionCartographic.height - maxZoomOffset,
			),
			0,
		),
	);
});

zoomOut.addEventListener("click", () => {
	viewer.camera.zoomOut(
		Math.max(
			Math.min(
				1000000,
				Math.max(viewer.camera.positionCartographic.height, 250000),
			),
			0,
		),
	);
});
