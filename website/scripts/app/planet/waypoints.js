import { Viewport } from "./viewport";
import * as Cesium from "cesium";

let viewport = await Viewport;

const iconPaths = {
	star: "../../../icons/star.svg",
	fourstar: "../../../icons/fourstar.svg",
	triangle: "../../../icons/triangle.svg",
	circle: "../../../icons/circle.svg",
}

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

const iconImageData = {
	star: await createWapointImage(iconPaths.star),
	fourstar: await createWapointImage(iconPaths.fourstar),
	triangle: await createWapointImage(iconPaths.triangle),
	circle: await createWapointImage(iconPaths.circle),
}

const textDrawdistanceScale = 0.5;

function createWaypoint(text, longitude, latitude, importance, id) {
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

	viewport.entities.add({
		position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),

		properties: {
			hoverable: true,
			iconId: id,
		},

		billboard: {
			image: image, // Cesium natively accepts HTMLCanvasElement
			pixelOffset: new Cesium.Cartesian2(0, -labelGap),
			verticalOrigin: Cesium.VerticalOrigin.CENTER,
			scale: .75,
			disableDepthTestDistance: undefined,
			distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, drawDistance),
			scaleByDistance: scaleByDistance,

			// heightReference: Cesium.HeightReference.RELATIVE_TO_TERRAIN,
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
	createWaypoint(e.name, e.longitude, e.latitude, e.importance, e.id)
})

let pickerDisplayBox = document.createElement("div");

pickerDisplayBox.style.setProperty("--position-x", "200px")
pickerDisplayBox.style.setProperty("--position-y", "200px")
pickerDisplayBox.style.setProperty("--size-w", "400px")
pickerDisplayBox.style.setProperty("--size-h", "400px")
pickerDisplayBox.classList.add("planet__waypoints__selection-box")
pickerDisplayBox.classList.add("planet__waypoints__disabled-normal");

let viewportElement = document.getElementById("viewport")
viewportElement.appendChild(pickerDisplayBox)

const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

const handler = new Cesium.ScreenSpaceEventHandler(viewport.scene.canvas);
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

		lastbillboard.distanceDisplayCondition = cachedHoverValues.billboard__distanceDisplayCondition;
		lastlabel.distanceDisplayCondition = cachedHoverValues.label__distanceDisplayCondition;
	}

	pickerDisplayBox.classList.add("planet__waypoints__disabled-normal");

	lastPicked = null;
	updateCurrentHover = null;

	viewport.scene.requestRender();
}

function updateHover(movement) {
	const picked = viewport.scene.pick(movement.endPosition);

	if (!(Cesium.defined(picked) && picked.id instanceof Cesium.Entity && picked.id.position && picked.id.properties.hoverable)) {
		if (cancelHoverTimeout) clearTimeout(cancelHoverTimeout)
		cancelHoverTimeout = setTimeout(() => cancelHover(), 150)

		return
	}


	if (lastPicked == picked) return


	if (lastPicked) {
		const lastlabel = lastPicked.id.label;
		const lastbillboard = lastPicked.id.billboard;

		lastbillboard.scaleByDistance = cachedHoverValues.billboard__scaleByDistance;
		lastlabel.scaleByDistance = cachedHoverValues.label__scaleByDistance;

		lastbillboard.distanceDisplayCondition = cachedHoverValues.billboard__distanceDisplayCondition;
		lastlabel.distanceDisplayCondition = cachedHoverValues.label__distanceDisplayCondition;
	}

	const time = viewport.clock.currentTime;
	if (!(picked.id.properties.hoverable.getValue(time) == true)) return

	const label = picked.id.label;
	const billboard = picked.id.billboard;

	if (!label) return;
	if (!billboard) return;

	cachedHoverValues.billboard__scaleByDistance = billboard.scaleByDistance;
	cachedHoverValues.label__scaleByDistance = label.scaleByDistance;

	billboard.scaleByDistance = undefined;
	label.scaleByDistance = undefined;

	cachedHoverValues.billboard__distanceDisplayCondition = billboard.distanceDisplayCondition;
	cachedHoverValues.label__distanceDisplayCondition = label.distanceDisplayCondition;

	billboard.distanceDisplayCondition = undefined;
	label.distanceDisplayCondition = undefined;

	updateCurrentHover = () => {
		const time = viewport.clock.currentTime;

		const world = picked.id.position.getValue(time);
		const pos = Cesium.SceneTransforms.worldToWindowCoordinates(viewport.scene, world);

		if (!(pos)) return

		pickerDisplayBox.style.setProperty("--position-x", pos.x + "px")
		pickerDisplayBox.style.setProperty("--position-y", pos.y + "px")

		pickerDisplayBox.classList.remove("planet__waypoints__disabled-normal");

		return pickerDisplayBox
	}

	updateCurrentHover()

	const text = label.text.getValue(time);
	const font = label.font.getValue(time);
	const scale = label.scale.getValue(time) ?? 1;

	measureCtx.font = font;
	const width = measureCtx.measureText(text).width * scale;

	pickerDisplayBox.style.setProperty("--size-w", width + "px")
	pickerDisplayBox.style.setProperty("--size-h", 48 + "px")


	viewport.scene.requestRender();

	if (!lastPicked) {
		pickerDisplayBox.classList.add("planet__waypoints__no_transition")
		requestAnimationFrame(() => {
			pickerDisplayBox.classList.remove("planet__waypoints__no_transition")
		})
	}

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

	const time = viewport.clock.currentTime;
	console.log(lastPicked.id.properties.iconId.getValue(time))

}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

viewport.camera.changed.addEventListener(() => {
	if (updateCurrentHover) {
		let pickerDisplayBox = updateCurrentHover()
		if (!(pickerDisplayBox)) return

		pickerDisplayBox.classList.add("planet__waypoints__no_transition")
		requestAnimationFrame(() => {
			pickerDisplayBox.classList.remove("planet__waypoints__no_transition")
		})
	}
});

viewport.cesiumWidget.screenSpaceEventHandler.removeInputAction(
	Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
);
