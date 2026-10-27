import { features } from "./waypointCreator";

let planet_feature_info = document.getElementById("planet-feature-info")
let planet_feature_info__close = document.getElementById("planet-feature-info__close")
let lastArray = null;

export function UpdateDom(arrayIndex) {
	planet_feature_info__close.checked = true;
	if (lastArray == arrayIndex) return
	lastArray = arrayIndex

	let requiredFeature = features[arrayIndex];

	planet_feature_info.innerHTML = `
		<h2>${requiredFeature.name}</h2>
		${(requiredFeature.description && requiredFeature.description != "N/A") ?
			`<hr>
		<p>${requiredFeature.description}</p>`
			: ""}
		${(requiredFeature.origin) ?
			`
	 	<hr class="hidden">

		<h3>Name Origin</h3>
		<hr>
		<p>${requiredFeature.origin}</p>`
			: ""}

		${(requiredFeature.additional_info) ?
			`
	 	<hr class="hidden">
	 	<p>${requiredFeature.additional_info}</p>
		`
			: ""}


		${(requiredFeature.type) ?
			`
	 	<hr class="hidden">
	 	<span>
	 		<b>Type: &nbsp;</b>
	 		<p>${requiredFeature.type}</p>
	 	</span>
		`
			: ""}

		${(requiredFeature.diameter) ?
			`
	 	<span>
	 		<b>Diameter: &nbsp;</b>
	 		<p>${requiredFeature.diameter}</p>
	 	</span>
		`
			: ""}

		${(requiredFeature.longitude && requiredFeature.latitude) ?
			`
	 	<span>
	 		<b>Longitude: &nbsp;</b>
	 		<p>${requiredFeature.latitude}</p>
	 	</span>
	 	<span>
	 		<b>Latitude: &nbsp;</b>
	 		<p>${requiredFeature.longitude}</p>
	 	</span>
		`
			: ""}

		${(requiredFeature.image) ?
			`

			<hr class="hidden">
			<hr class="hidden">
		<div id="pfi_group__image">
			<img src="${requiredFeature.image}">
			${(requiredFeature.image_source) ?
				`<p id="pfi__img_source"><b>Source:&nbsp;</b>${requiredFeature.image_source}</p>`
				: ""}
		</div
		`
			: ""}
	`
	let i = 0
	for (const el of planet_feature_info.children) {
		el.style.setProperty("--i", i)
		if (el.classList.contains("hidden") || el.tagName == "HR") continue
		i++
	}
}
