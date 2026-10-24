import { StartFirstPersonCamera, StopFirstPersonCamera } from "./firstPersonCamera/firstPersonCamera";
let toggleCheckbox = document.getElementById("firstPersonCameraToggle");

let CameraMode = "normal"

function updateFirstPersonCameraEnabled() {
	if (toggleCheckbox.checked == true) {
		if (CameraMode == "firstPersonCamera") return
		CameraMode = "firstPersonCamera"
		StartFirstPersonCamera()
	} else {
		StopFirstPersonCamera()
		CameraMode = "normal"
	}
}

toggleCheckbox.addEventListener("input", () => {
	updateFirstPersonCameraEnabled();
})

updateFirstPersonCameraEnabled()

