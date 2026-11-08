import "./viewport.js";
import "./waypoints/waypoint.js"
import "./paths.js";
import "./camera/camera.js"
import "./navigator.js"
import "./imagery.js"
import "./localView.js"

import { route, snapCandidates, findPath, findPathDetailed } from "./router.js";

// Expose to window for web console access
window.route = route;
window.snapCandidates = snapCandidates;
window.findPath = findPath;
window.findPathDetailed = findPathDetailed;
