import { searchMarsFeatures } from "../lib/utils/markerSearch";
import { getJson } from "../lib/utils/getJson";
import { NormalFlyTo } from "./planet/camera/camera";
import { UpdateDom } from "./planet/waypoints/HTMLUpdater";

export let features = await getJson("data/mars_features.json");

const searchBox = document.getElementById("search_box");
const searchResults = document.getElementById("search_results");

function resetSearch() {
	searchResults.innerHTML = "";
}

function updateSearch() {
	if (searchBox.value == "") {
		resetSearch();
		return;
	}

	searchResults.innerHTML = "";
	searchMarsFeatures(searchBox.value, 15, 0.6).forEach((index) => {
		let result = document.createElement("div");
		result.classList.add("search__result");

		result.innerHTML = features[index].name;

		result.addEventListener("click", () => {
			let height = 27000000 / 4;

			switch (features[index].importance) {
				case 0:
					height = 1500000 / 3;
					break;
				case 1:
					height = 3500000 / 3;
					break;
				case 2:
					height = 7500000 / 3;
					break;
			}

			NormalFlyTo({
				longitude: features[index].longitude,
				latitude: features[index].latitude,
				height: height,
			});

			UpdateDom(index);
		});

		searchResults.appendChild(result);
	});
}

searchBox.addEventListener("input", updateSearch);
searchBox.parentElement.addEventListener("reset", resetSearch);

