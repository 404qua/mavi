export const WEATHER_LAYERS = Object.freeze({
	tsurf: { label: "Surface Temperature", kind: "dynamic" },
	psurf: { label: "Surface Pressure", kind: "dynamic" },
	dust_tau_monthly: { label: "Dust Optical Depth (Monthly)", kind: "dynamic" },
	dust_tau_daily: { label: "Dust Optical Depth (Daily)", kind: "dynamic" },
	wind_stress: { label: "Surface Wind Stress", kind: "dynamic" },
	sensible_heat_flux: { label: "Sensible Heat Flux", kind: "dynamic" },
	surface_solar: { label: "Solar Flux, Surface", kind: "dynamic" },
	surface_solar_reflected: { label: "Solar Flux, Surface Reflected", kind: "dynamic" },
	toa_solar: { label: "Solar Flux, Top of Atmosphere", kind: "dynamic" },
	toa_solar_reflected: { label: "Solar Flux, Top of Atmosphere Reflected", kind: "dynamic" },
	surface_thermal_ir: { label: "Thermal IR, Surface", kind: "dynamic" },
	toa_thermal_ir: { label: "Thermal IR, Top of Atmosphere", kind: "dynamic" },
	tsurf_rms: { label: "Surface Temperature Variability", kind: "dynamic" },
	psurf_rms: { label: "Surface Pressure Variability", kind: "dynamic" },
	albedo: { label: "Albedo", kind: "static" },
	roughness: { label: "Roughness", kind: "static" },
	thermal_inertia: { label: "Thermal Inertia", kind: "static" },
});

export const BASE_LAYERS_URL = "https://marswalk-layers.pages.dev/whetherLayers";

/**
 * returns the 2 image links (globe overlay image + scale/range legend) for given layer
 *
 * @param {string} layerKey - e.g. "tsurf", "psurf", "dust_tau_daily", etc.
 * @param {Object} [dropdownValues={}] - Dropdown selections from .monthInput
 * @param {number|string} [dropdownValues.season=0] - Season / Ls month index (0 to 11)
 * @param {number|string} [dropdownValues.time=0] - Hour index (0 to 11), clock hour (0 to 24), or "mean"
 * @param {number|string} [dropdownValues.condition=0] - Condition index (0=Typical, 1=Cold, 2=Warm, 3=Storm)
 * @returns {{ imageLink: string, rangeImageLink: string, layerKey: string, isStatic: boolean }}
 */
export function getWeatherLayerLinks(layerKey, dropdownValues = {}) {
	const rangeImageLink = `${BASE_LAYERS_URL}/ranges/${layerKey}.png`;
	const isStatic = WEATHER_LAYERS[layerKey]?.kind === "static";

	if (isStatic) {
		return {
			imageLink: `${BASE_LAYERS_URL}/static-${layerKey}.png`,
			rangeImageLink,
			layerKey,
			isStatic: true,
		};
	}

	const seasonNum = Number(dropdownValues.season ?? 0);
	const season = Math.max(0, Math.min(11, isNaN(seasonNum) ? 0 : seasonNum));

	let hour = dropdownValues.time ?? 0;
	if (hour !== "mean") {
		const hourNum = Number(hour);
		if (isNaN(hourNum)) {
			hour = 0;
		} else if (hourNum > 11) {
			hour = hourNum === 0 ? 11 : Math.max(0, Math.min(11, Math.floor(hourNum / 2) - 1));
		} else {
			hour = Math.max(0, Math.min(11, hourNum));
		}
	}

	let condNum = Number(dropdownValues.condition ?? 0);
	let condition = Math.max(0, Math.min(3, isNaN(condNum) ? 0 : condNum));

	if (condition === 3 && season < 6) {
		condition = 0;
	}

	const imageLink = `${BASE_LAYERS_URL}/ls${season}-time${hour}-${layerKey}-cond${condition}.png`;

	return {
		imageLink,
		rangeImageLink,
		layerKey,
		isStatic: false,
	};
}


const hudContainer = document.getElementById("weather-legend-hud");
const hudImg = document.getElementById("weather-legend-hud-img");
export function displayWeatherRangeImage(rangeImageLink, isVisible = true) {
	if (!isVisible || !rangeImageLink) {
		if (hudContainer) hudContainer.classList.add("disabled");
		return;
	}

	if (hudContainer && hudImg) {
		hudImg.src = rangeImageLink;
		if (hudContainer) hudContainer.classList.remove("disabled");
	}
}
