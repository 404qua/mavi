import * as THREE from "three";

const viewport = document.getElementById("viewport")

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);

const ambientLight = new THREE.AmbientLight(0xFFFFFF, 1);
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0xFFFFFF, 10,100);
pointLight.position.set(0,3,3)
scene.add(pointLight);

const renderer = new THREE.WebGLRenderer({
	antialias: true,
});
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
viewport.appendChild(renderer.domElement);

const resizeObserver = new ResizeObserver(() => {
	const w = viewport.clientWidth;
	const h = viewport.clientHeight;
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	renderer.setSize(w, h);
});

const PLANET_RADIUS_IN_METER = 3389.5;
const PLANET_RADIUS_IN_UNIT = 1;

const geometry = new THREE.SphereGeometry(1,100,100);
const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material)

let MOUSE_DOWN = false;

scene.add(mesh)

let CAMERA_ROTATION = {
	x: -45,
	y: 0,
}

let CAMERA_DISTANCE = 10;

let MOUSE_POSITION = {
	x: -45,
	y: 0,
}

camera.position.z = 5
camera.rotation.order = 'YXZ'

renderer.setAnimationLoop(() => {
	renderer.render(scene, camera);

	camera.position.set(0, 0, 0)
	camera.rotation.x = THREE.MathUtils.degToRad(CAMERA_ROTATION.x)
	camera.rotation.y = THREE.MathUtils.degToRad(CAMERA_ROTATION.y)

	camera.translateZ(CAMERA_DISTANCE)
});

viewport.addEventListener("contextmenu", (e) => {
	e.preventDefault();
})

viewport.addEventListener("mousedown", (e) => {
	e.preventDefault();
	MOUSE_DOWN = true;
})

viewport.addEventListener("wheel", (e) => {
	e.preventDefault()
	CAMERA_DISTANCE += e.deltaY/100
	CAMERA_DISTANCE = THREE.MathUtils.clamp(CAMERA_DISTANCE,2,15)
})

window.addEventListener("mouseup", (e) => {
	e.preventDefault();
	MOUSE_DOWN = false;
})

window.addEventListener("mousemove", (e) => {
	if (!MOUSE_DOWN) return

	CAMERA_ROTATION.y += (MOUSE_POSITION.x - e.clientX)
	CAMERA_ROTATION.y = CAMERA_ROTATION.y%360

	CAMERA_ROTATION.x += (MOUSE_POSITION.y - e.clientY)
	CAMERA_ROTATION.x = THREE.MathUtils.clamp(CAMERA_ROTATION.x,-90,90)

	MOUSE_POSITION.x = e.clientX
	MOUSE_POSITION.y = e.clientY
})

resizeObserver.observe(viewport);
