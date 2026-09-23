import * as THREE from "three";

const viewport = document.getElementById("viewport")

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
const viewportCanvas = viewport.appendChild(renderer.domElement);

const resizeObserver = new ResizeObserver(() => {
	const w = viewport.clientWidth;
	const h = viewport.clientHeight;
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	renderer.setSize(w, h);
});

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material)

let MOUSE_DOWN = false;
let MOUSE_BUTTON_ = false;

scene.add(mesh)

camera.position.z = 5

camera.rotation.order = 'YXZ'

renderer.setAnimationLoop((time) => {
	renderer.render(scene, camera);

	camera.position.set(0, 0, 0)
	camera.rotation.x = THREE.MathUtils.degToRad(-45)
	camera.rotation.y = THREE.MathUtils.degToRad(time / 100)

	camera.translateZ(10)
});

viewport.addEventListener("contextmenu", (e) => {
	e.preventDefault();
})

viewport.addEventListener("mousedown", (e) => {
	e.preventDefault();
	MOUSE_DOWN = true;
})


window.addEventListener("mouseup", (e) => {
	e.preventDefault();
	MOUSE_DOWN = false;
})


resizeObserver.observe(viewport);
