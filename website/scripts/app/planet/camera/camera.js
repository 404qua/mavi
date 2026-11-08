import { StartFirstPersonCamera, StopFirstPersonCamera } from "./firstPersonCamera/firstPersonCamera";
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

allCameraRadios.forEach((radio) => {
	radio.addEventListener("input", (e) => {
		if (CameraMode == e.target.value) return;
		CameraMode = e.target.value;

		updateFirstPersonCameraEnabled();
	});
});

updateFirstPersonCameraEnabled();
