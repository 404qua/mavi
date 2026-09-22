uniform vec3 uColorA;
uniform vec3 uColorB;

varying vec2 vUv;

void main() {
  vec3 color = vec3(0,vUv.x,vUv.y);
  gl_FragColor = vec4(color, 1.0);
}
