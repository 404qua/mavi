import { features } from "./waypointCreator";

let hiddenClassName = "pfi-disabled"

let pfi_name = document.getElementById("pfi__name")
let pfi_group__description = document.getElementById("pfi_group__description")
let pfi__description = document.getElementById("pfi__description")
let pfi_group__origin = document.getElementById("pfi_group__origin")
let pfi__origin = document.getElementById("pfi__origin")
let pfi_group__additional_info = document.getElementById("pfi_group__additional_info")
let pfi__additional_info = document.getElementById("pfi__additional_info")
let pfi_group__type = document.getElementById("pfi_group__type")
let pfi__type = document.getElementById("pfi__type")
let pfi_group__diameter = document.getElementById("pfi_group__diameter")
let pfi__diameter = document.getElementById("pfi__diameter")
let pfi_group__lon_lat = document.getElementById("pfi_group__lon-lat")
let pfi__lon = document.getElementById("pfi__lon")
let pfi__lat = document.getElementById("pfi__lat")
let pfi_group__image = document.getElementById("pfi_group__image")
let pfi__img = document.getElementById("pfi__img")

function toggleElement(element, visible) {
	if (visible == true) {
		element.classList.remove(hiddenClassName)
	} else {
		element.classList.add(hiddenClassName)
	}
}

export function UpdateDom(arrayIndex) {
	let requiredFeature = features[arrayIndex];
	console.log(requiredFeature);

	pfi_name.innerHTML = requiredFeature.name

	function singleValueGroupPair(value, valueElement, groupElement) {
		if (value == null || value == "N/A") {
			toggleElement(groupElement, false)
		} else {
			toggleElement(groupElement, true)
			valueElement.innerHTML = value;
		}
	}

	singleValueGroupPair(requiredFeature.description, pfi__description, pfi_group__description);
	singleValueGroupPair(requiredFeature.origin, pfi__origin, pfi_group__origin);
	singleValueGroupPair(requiredFeature.additional_info, pfi__additional_info, pfi_group__additional_info);

	singleValueGroupPair(requiredFeature.longitude, pfi__lon, pfi_group__lon_lat);
	singleValueGroupPair(requiredFeature.latitude, pfi__lat, pfi_group__lon_lat);

	singleValueGroupPair(requiredFeature.type, pfi__type, pfi_group__type);
	singleValueGroupPair(requiredFeature.diameter, pfi__diameter, pfi_group__diameter);


	if (requiredFeature.image == null) {
		toggleElement(pfi_group__image, false)
	} else {

		toggleElement(pfi_group__image, true)
		pfi__img.src = requiredFeature.image;
	}
}
