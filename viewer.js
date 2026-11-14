// Kolye ucu STL'i için döndürülebilir metal görüntüleyici (three.js).
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { STLLoader } from "./vendor/STLLoader.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-30, 40, 60);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(28, 4 / 3, 1, 2000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * 0.15;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.addEventListener("change", () => { dirty = true; });

  // Baskıdan çıkan titanyum: mat gri, hafif pürüzlü
  const material = new THREE.MeshStandardMaterial({ color: 0xb4b7bd, metalness: 1, roughness: 0.38 });
  let mesh = null, dirty = true, radius = 30;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // modelin tamamı hem yatay hem dikey görüş alanına sığsın
    const vfov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hfov = Math.atan(Math.tan(vfov) * camera.aspect);
    const dist = (radius * 1.12) / Math.sin(Math.min(vfov, hfov));
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (!dir.lengthSq()) dir.set(0, 0, 1);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.minDistance = dist * 0.25; controls.maxDistance = dist * 1.6;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);

  renderer.setAnimationLoop(() => {
    if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false; }
  });

  async function load(url) {
    const geo = await new STLLoader().loadAsync(url);
    geo.center();
    geo.computeBoundingSphere();
    radius = geo.boundingSphere.radius;
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    mesh = new THREE.Mesh(geo, material);
    scene.add(mesh);
    controls.target.set(0, 0, 0);
    camera.position.set(radius * 0.35, -radius * 0.1, radius);   // hafif yandan: tel kalınlığı görünsün
    resize();
  }

  return { load, resize };
}
