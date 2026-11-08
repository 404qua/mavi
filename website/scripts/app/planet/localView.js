import { SetCameraLimits, ReleaseCameraLimits } from "./camera/limit";
import { getJson } from "../../lib/utils/getJson";
import { updateFirstPersonCameraEnabled, updateCameraMode } from "./camera/camera";
import { CleanUpFirstPersonTransition } from "./camera/firstPersonCamera/firstPersonCamera";

const LocalViewData = await getJson("data/localFeatures/feature_classes.json");

const cameraNormalModeElement = document.querySelector('input[name="camera"][value="normal"]')

export const LOCAL_VIEW_MODES = Object.freeze({
	Global: "global",
	AP_1: "AP-1",
	AP_8: "AP-8",
	AP_9: "AP-9"
});

export let CurrentLocalView = LOCAL_VIEW_MODES.Global;

function SetLocalViewMode(mode) {
	if (!(mode in LOCAL_VIEW_MODES)) {
		console.log("Local view mode doesn't exist: " + mode);
	}

	if (CurrentLocalView == LOCAL_VIEW_MODES[mode]) {
		return;
	}

	if (!(cameraNormalModeElement.checked)){
		cameraNormalModeElement.checked = true;
		updateCameraMode();
		updateFirstPersonCameraEnabled();
		CleanUpFirstPersonTransition();
	}

	CurrentLocalView = LOCAL_VIEW_MODES[mode];

	if (CurrentLocalView == LOCAL_VIEW_MODES.Global) {
		ReleaseCameraLimits();
		return;
	}

	SetCameraLimits(LocalViewData.sites[CurrentLocalView].hirise_footprint.bounds);
}

document.getElementsByName("missionSites").forEach((e) => {
	if (e.checked == true) {
		SetLocalViewMode(e.value);
	}

	e.addEventListener("input", () => {
		SetLocalViewMode(e.value);
	});
});
