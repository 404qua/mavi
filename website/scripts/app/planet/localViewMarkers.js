import * as Cesium from "cesium";
import { getJson } from "../../lib/utils/getJson";
import { createMapMarker } from "./mapMarkers";
import { LOCAL_VIEW_MODES } from "./enums";
import { createWapointImage } from "../../lib/utils/createWaypointImage";

const ap1Unit = await getJson("data/localFeatures/ap1_units.geojson");
const ap8Unit = await getJson("data/localFeatures/ap8_units.geojson");
const ap9Unit = await getJson("data/localFeatures/ap9_units.geojson");

let shouldSiteBeVisible = true;

function polygonCentroid(polygon) {
	const ring = polygon[0]; // outer ring
	const pts = ring.slice();

	// Make sure the ring is closed
	const first = pts[0], last = pts[pts.length - 1];
	if (first[0] !== last[0] || first[1] !== last[1]) pts.push(first);

	// Shift to the first point to reduce floating-point error
	const [ox, oy] = pts[0];

	let area2 = 0; // twice the signed area
	let cx = 0;
	let cy = 0;

	for (let i = 0; i < pts.length - 1; i++) {
		const x0 = pts[i][0] - ox;
		const y0 = pts[i][1] - oy;
		const x1 = pts[i + 1][0] - ox;
		const y1 = pts[i + 1][1] - oy;

		const cross = x0 * y1 - x1 * y0;
		area2 += cross;
		cx += (x0 + x1) * cross;
		cy += (y0 + y1) * cross;
	}

	// Degenerate polygon (zero area): fall back to the average of the points
	if (area2 === 0) {
		const n = pts.length - 1;
		const sum = pts.slice(0, n).reduce(
			(acc, p) => [acc[0] + p[0], acc[1] + p[1]],
			[0, 0]
		);
		return [sum[0] / n, sum[1] / n];
	}

	return [ox + cx / (3 * area2), oy + cy / (3 * area2)]; // [lng, lat]
}

let currentSiteVisible = undefined;

const siteEntities = {};

function setSiteVisible(name, visible) {
	siteEntities[name].forEach(entity => {
		entity.show = visible;
	});
}

export function DisableSiteMarkers() {
	if (currentSiteVisible) {
		setSiteVisible(currentSiteVisible, false);
	}
}

export function EnableSiteMarkers(site) {
	if (currentSiteVisible) {
		setSiteVisible(currentSiteVisible, false);
	}

	if (shouldSiteBeVisible == true) {
		setSiteVisible(site, true);
	}

	currentSiteVisible = site;
}

let localWaypointIcon = await createWapointImage("icons/local.svg");

function createMarkersForSite(site, name) {
	siteEntities[name] = site.features.map(e => {
		const [lng, lat] = polygonCentroid(e.geometry.coordinates);

		return createMapMarker({
			longitude: lng,
			latitude: lat,
			text: e.properties.feature_class,
			color: Cesium.Color.WHITE,
			height: -7200,
			image: localWaypointIcon,
			pixelOffset: 14,
			drawDistance: 10000,
			nearDistance: -7000,
			// heightReference: Cesium.HeightReference.RELATIVE_TO_TERRAIN,
		});
	});

	setSiteVisible(name, false);
}

createMarkersForSite(ap1Unit, LOCAL_VIEW_MODES.AP_1);
createMarkersForSite(ap8Unit, LOCAL_VIEW_MODES.AP_8);
createMarkersForSite(ap9Unit, LOCAL_VIEW_MODES.AP_9);

export function SetLocalViewMarkersVisible(value) {
	if (shouldSiteBeVisible == value) {
		return;
	}

	shouldSiteBeVisible = value;
	if (currentSiteVisible) {
		setSiteVisible(currentSiteVisible, value);
	}
}
