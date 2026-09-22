uniform float uTime;

varying vec2 vUv;

vec3 rand(vec3 n) {
    return fract(sin(n * 12.9898) * 43758.5453123);
}

void main() {
	vUv = uv;	
	vec3 pos = position;
	pos = pos + ((normal * rand(pos) * 0.1));

	gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
