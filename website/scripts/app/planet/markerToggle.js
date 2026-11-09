import { SetWaypointsVisible } from "./waypoints/waypointCreator";
import { SetLocalViewMarkersVisible } from "./localViewMarkers";
import { Viewport } from "./viewport";

const viewer = await Viewport;

let toggleElement = document.getElementById("waypointsEnabled");

let lastValue = -1;

function SetMarkers() {
	if (lastValue == toggleElement.checked) return;

	lastValue = toggleElement.checked; 

	SetWaypointsVisible(toggleElement.checked);
	SetLocalViewMarkersVisible(toggleElement.checked);

	viewer.scene.requestRender();
}

toggleElement.addEventListener("input", () => {
	SetMarkers();
});

SetMarkers()


