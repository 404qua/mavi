import { StartFirstPersonCamera, StopFirstPersonCamera } from "./firstPersonCamera/firstPersonCamera";
import "./zoom.js";

let CameraMode = document.querySelector('input[name="camera"]:checked').value

function updateFirstPersonCameraEnabled() {
	if (CameraMode == "firstPersonCamera") {
		StartFirstPersonCamera()
	} else {
		StopFirstPersonCamera()
	}
}

const allCameraRadios = document.querySelectorAll('input[name="camera"]');

allCameraRadios.forEach(radio => {
	radio.addEventListener('input', (e) => {
		if (CameraMode == e.target.value) return
		CameraMode = e.target.value;

		updateFirstPersonCameraEnabled()
	});
});

updateFirstPersonCameraEnabled()

