import { StartFirstPersonCamera, StopFirstPersonCamera } from "./firstPersonCamera/firstPersonCamera";
import { BOUNDS } from "./limit";
import "./zoom.js";

let CameraMode;

export function updateCameraMode() {
	CameraMode = document.querySelector('input[name="camera"]:checked').value;
}

updateCameraMode();

export function updateFirstPersonCameraEnabled() {
	if (CameraMode == "firstPersonCamera") {
		StartFirstPersonCamera();
	} else {
		StopFirstPersonCamera();
	}
}

const allCameraRadios = document.getElementsByName('camera');


const normalMode = document.querySelector('input[name="camera"][value="normal"]');

allCameraRadios.forEach((radio) => {
	radio.addEventListener("input", (e) => {
		if (CameraMode == e.target.value) return;

		if (e.target.value == "firstPersonCamera" && BOUNDS.north != undefined) {
			normalMode.checked = true;
			return;
		}

		CameraMode = e.target.value;

		updateFirstPersonCameraEnabled();
	});
});

updateFirstPersonCameraEnabled();
