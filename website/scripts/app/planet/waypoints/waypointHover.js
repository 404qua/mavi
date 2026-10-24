import { UpdateDom } from "./HTMLUpdater";
import * as Cesium from "cesium";
import { Viewport } from "../viewport";

let viewer = await Viewport;

let pickerDisplayBox = document.createElement("div");
pickerDisplayBox.classList.add("planet__waypoints__selection-box")
pickerDisplayBox.classList.add("planet__waypoints__disabled-normal");

let viewportElement = document.getElementById("viewport")
viewportElement.appendChild(pickerDisplayBox)

const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

let lastPicked

let cachedHoverValues = {};

let cancelHoverTimeout = null;
let updateCurrentHover = null;

function cancelHover() {
	if (lastPicked) {
		const lastlabel = lastPicked.id.label;
		const lastbillboard = lastPicked.id.billboard;

		lastbillboard.scaleByDistance = cachedHoverValues.billboard__scaleByDistance;
		lastlabel.scaleByDistance = cachedHoverValues.label__scaleByDistance;


		lastbillboard.disableDepthTestDistance = undefined;
		lastlabel.disableDepthTestDistance = undefined;

		lastbillboard.distanceDisplayCondition = cachedHoverValues.billboard__distanceDisplayCondition;
		lastlabel.distanceDisplayCondition = cachedHoverValues.label__distanceDisplayCondition;
	}

	pickerDisplayBox.classList.add("planet__waypoints__disabled-normal");

	lastPicked = null;
	updateCurrentHover = null;

	viewer.scene.requestRender();
}

function updateHover(movement) {
	const picked = viewer.scene.pick(movement.endPosition);

	if (!(Cesium.defined(picked) && picked.id instanceof Cesium.Entity && picked.id.position && picked.id.properties.hoverable)) {
		if (cancelHoverTimeout) clearTimeout(cancelHoverTimeout)
		cancelHoverTimeout = setTimeout(() => cancelHover(), 150)

		return
	}

	if (lastPicked?.id == picked.id) return

	if (lastPicked) {
		const lastlabel = lastPicked.id.label;
		const lastbillboard = lastPicked.id.billboard;

		lastbillboard.scaleByDistance = cachedHoverValues.billboard__scaleByDistance;
		lastlabel.scaleByDistance = cachedHoverValues.label__scaleByDistance;

		lastbillboard.distanceDisplayCondition = cachedHoverValues.billboard__distanceDisplayCondition;
		lastlabel.distanceDisplayCondition = cachedHoverValues.label__distanceDisplayCondition;
	}

	const time = viewer.clock.currentTime;
	if (!(picked.id.properties.hoverable.getValue(time) == true)) return

	const label = picked.id.label;
	const billboard = picked.id.billboard;

	if (!label) return;
	if (!billboard) return;

	cachedHoverValues.billboard__scaleByDistance = billboard.scaleByDistance;
	cachedHoverValues.label__scaleByDistance = label.scaleByDistance;

	cachedHoverValues.billboard__disableDepthTestDistance = billboard.disableDepthTestDistance;
	cachedHoverValues.label__disableDepthTestDistance = label.disableDepthTestDistance;

	billboard.scaleByDistance = undefined;
	label.scaleByDistance = undefined;

	billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
	label.disableDepthTestDistance = Number.POSITIVE_INFINITY;

	cachedHoverValues.billboard__distanceDisplayCondition = billboard.distanceDisplayCondition;
	cachedHoverValues.label__distanceDisplayCondition = label.distanceDisplayCondition;

	billboard.distanceDisplayCondition = undefined;
	label.distanceDisplayCondition = undefined;


	const font = label.font.getValue(time);
	measureCtx.font = font;

	const text = label.text.getValue(time);
	const scale = label.scale.getValue(time) ?? 1;

	const width = measureCtx.measureText(text).width * scale;

	updateCurrentHover = () => {
		const time = viewer.clock.currentTime;
		const world = picked.id._position.getValue(time);

		// const cartographic = Cesium.Cartographic.fromCartesian(world);

		// let terrainHeight = viewport.scene.globe.getHeight(cartographic);

		// if (!(Cesium.defined(terrainHeight))) {
		// 	cartographic.height += waypointOffset;
		// } else {
		// 	cartographic.height += terrainHeight;
		// }


		const pos = Cesium.SceneTransforms.worldToWindowCoordinates(
			viewer.scene,
			// Cesium.Cartesian3.fromRadians(
			// 	cartographic.longitude,
			// 	cartographic.latitude,
			// 	cartographic.height
			// )
			world,
		);

		if (!(pos)) return

		pickerDisplayBox.style.setProperty("--size-w", width + "px")
		pickerDisplayBox.style.setProperty("--size-h", 48 + "px")

		pickerDisplayBox.style.setProperty("--position-x", pos.x + "px")
		pickerDisplayBox.style.setProperty("--position-y", pos.y + "px")

		pickerDisplayBox.classList.remove("planet__waypoints__disabled-normal");

		return pickerDisplayBox
	}

	updateCurrentHover()

	if (!lastPicked) {
		pickerDisplayBox.classList.add("planet__waypoints__no_transition")
		requestAnimationFrame(() => {
			pickerDisplayBox.classList.remove("planet__waypoints__no_transition")
		})
	}

	viewer.scene.requestRender();

	lastPicked = picked
}

let hoverTimeout = null;

handler.setInputAction((movement) => {
	if (hoverTimeout) clearTimeout(hoverTimeout)

	hoverTimeout = setTimeout(() => {
		clearTimeout(hoverTimeout)
		updateHover(movement)
	}, 40)

}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);


handler.setInputAction(() => {
	if (!lastPicked) return

	const time = viewer.clock.currentTime;
	UpdateDom(lastPicked.id.properties.featureId.getValue(time))

}, Cesium.ScreenSpaceEventType.LEFT_CLICK);


const lastPos = new Cesium.Cartesian3();
const lastDir = new Cesium.Cartesian3();
const lastUp = new Cesium.Cartesian3();
let initialized = false;

const camera = viewer.camera;

viewer.scene.postRender.addEventListener(() => {

	const changed =
		!initialized ||
		!Cesium.Cartesian3.equalsEpsilon(camera.positionWC, lastPos, 0, 1e-2) || // 1 cm
		!Cesium.Cartesian3.equalsEpsilon(camera.directionWC, lastDir, 0, 1e-7) ||
		!Cesium.Cartesian3.equalsEpsilon(camera.upWC, lastUp, 0, 1e-7);

	if (!changed) return;

	Cesium.Cartesian3.clone(camera.positionWC, lastPos);
	Cesium.Cartesian3.clone(camera.directionWC, lastDir);
	Cesium.Cartesian3.clone(camera.upWC, lastUp);
	initialized = true;


	if (updateCurrentHover) {
		let pickerDisplayBox = updateCurrentHover()
		if (!(pickerDisplayBox)) return

		pickerDisplayBox.classList.add("planet__waypoints__no_transition")
		requestAnimationFrame(() => {
			pickerDisplayBox.classList.remove("planet__waypoints__no_transition")
		})
	}
});

viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
	Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
);
