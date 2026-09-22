import "./scripts/app/sliders.js";

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const container = document.getElementById("viewport");
async function loadShader(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.text();
}

const [vertexShader, fragmentShader] = await Promise.all([
  loadShader("./shaders/earth.vert"),
  loadShader("./shaders/earth.frag"),
]);

const materialEarth = new THREE.ShaderMaterial({
  vertexShader: vertexShader,
  fragmentShader: fragmentShader,
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.lights,
    THREE.UniformsLib.fog, // optional, only if you use fog
  ]),
  lights: true,
});

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// Camera
const camera = new THREE.PerspectiveCamera(
  60,
  container.clientWidth / container.clientHeight,
  0.1,
  1000,
);
camera.position.set(3, 2, 5);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.enablePan = false;
controls.offse

// Mesh

const radius = 1;

const geometry = new THREE.SphereGeometry(radius, 360,180);

const cube = new THREE.Mesh(geometry, materialEarth);
scene.add(cube);

const light = new THREE.AmbientLight(0x404040, 12);
scene.add(light);

// Lights
const dirLight1 = new THREE.DirectionalLight(0xffffff, 2);
dirLight1.position.set(3, 5, 2);
scene.add(dirLight1);

// Resize
window.addEventListener("resize", () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// Loop
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
