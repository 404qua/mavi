import { SetCameraLimits, ReleaseCameraLimits } from "./camera/limit";
import { getJson } from "../../lib/utils/getJson";
import { updateFirstPersonCameraEnabled, updateCameraMode } from "./camera/camera";
import { CleanUpFirstPersonTransition } from "./camera/firstPersonCamera/firstPersonCamera";
import { DisableHighresImagery, EnableHighresImagery } from "./imagery";
import { LOCAL_VIEW_MODES } from "./enums";
import { DisableSiteMarkers, EnableSiteMarkers } from "./localViewMarkers";

const LocalViewData = await getJson("data/localFeatures/feature_classes.json");

const cameraNormalModeElement = document.querySelector('input[name="camera"][value="normal"]');

export let CurrentLocalView = LOCAL_VIEW_MODES.Global;

function SetLocalViewMode(mode) {
	if (!(mode in LOCAL_VIEW_MODES)) {
		console.log("Local view mode doesn't exist: " + mode);
	}

	if (CurrentLocalView == LOCAL_VIEW_MODES[mode]) {
		return;
	}

	if (!(cameraNormalModeElement.checked)) {
		cameraNormalModeElement.checked = true;
		updateCameraMode();
		updateFirstPersonCameraEnabled();
		CleanUpFirstPersonTransition();
	}

	CurrentLocalView = LOCAL_VIEW_MODES[mode];

	if (CurrentLocalView == LOCAL_VIEW_MODES.Global) {
		DisableHighresImagery();
		ReleaseCameraLimits();
		DisableSiteMarkers();
		return;
	}

	SetCameraLimits(LocalViewData.sites[CurrentLocalView].hirise_footprint.bounds);
	EnableHighresImagery(CurrentLocalView);
	EnableSiteMarkers(CurrentLocalView);
}

document.getElementsByName("missionSites").forEach((e) => {
	if (e.checked == true) {
		SetLocalViewMode(e.value);
	}

	e.addEventListener("input", () => {
		SetLocalViewMode(e.value);
	});
});
