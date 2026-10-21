import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { createFlightPhysics } from './flightPhysics.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Brain, CheckCircle2, CloudRain, Crosshair, Eye, EyeOff, Gauge, Info, Pause, Play, Plane, Rewind, RotateCcw, Scale, Sparkles, StepForward, Sun, Wind } from 'lucide-react';
import './styles.css';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const WORLD_X_SCALE = 1.25;
const WORLD_Y_SCALE = 1.1;
const WORLD_Z_SCALE = 1.35;
const DEFAULT_WING_AREA = 0.03;
const WING_AREA_OPTIONS = [
  { value: 0.024, label: '小型', area: '0.024 m²' },
  { value: DEFAULT_WING_AREA, label: '中型', area: '0.030 m²' },
  { value: 0.036, label: '大型', area: '0.036 m²' }
];
const clipMultiplier = placement => placement === 'both' ? 2 : 1;

function getCg(settings) {
  if (settings.clipCount === 0) return 37;
  return 37 - settings.clipCount * clipMultiplier(settings.clipPlacement) * (45 - settings.clipPosition) * 0.11;
}

function makePlane() {
  const group = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: '#f8fbf8', roughness: 0.72, side: THREE.DoubleSide });
  const fold = new THREE.LineBasicMaterial({ color: '#92aaa1', transparent: true, opacity: 0.5 });
  const makeWing = (side) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(-4.6, side * 1.25);
    shape.lineTo(-3.2, side * 5.2);
    shape.lineTo(4.8, side * 0.55);
    shape.lineTo(5.35, 0);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, paper);
    return mesh;
  };
  const wingGroup = new THREE.Group();
  wingGroup.add(makeWing(1), makeWing(-1));

  const keelGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-4.5, 0, 0), new THREE.Vector3(5.35, 0, 0), new THREE.Vector3(-2.2, 0, -0.55), new THREE.Vector3(-4.5, 0, 0)
  ]);
  const keel = new THREE.Mesh(keelGeo, new THREE.MeshStandardMaterial({ color: '#dce9e3', side: THREE.DoubleSide }));
  keel.rotation.x = Math.PI / 2;
  group.add(keel);

  [-1, 1].forEach(side => {
    const crease = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3.9, side * 1.15, 0.02), new THREE.Vector3(4.95, side * 0.45, 0.02)
    ]);
    wingGroup.add(new THREE.Line(crease, fold));
  });
  group.add(wingGroup);
  group.rotation.x = -Math.PI / 2;
  const carrier = new THREE.Group();
  carrier.add(group);
  carrier.userData.paperModel = group;
  carrier.userData.wingGroup = wingGroup;
  return carrier;
}

function makeClip() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.38, -0.12, 0), new THREE.Vector3(-0.45, 0.14, 0),
    new THREE.Vector3(-0.2, 0.3, 0), new THREE.Vector3(0.35, 0.28, 0),
    new THREE.Vector3(0.48, 0.03, 0), new THREE.Vector3(0.28, -0.26, 0),
    new THREE.Vector3(-0.18, -0.24, 0), new THREE.Vector3(-0.28, -0.08, 0),
    new THREE.Vector3(0.2, 0.08, 0)
  ]);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 42, 0.035, 6, false),
    new THREE.MeshStandardMaterial({ color: '#354944', metalness: 0.78, roughness: 0.25 })
  );
}

function makeTree(height = 4.5, color = '#3f8b59') {
  const tree = new THREE.Group();
  tree.userData.isTree = true;
  tree.userData.swayPhase = height * 1.7;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.28, height * 0.42, 8),
    new THREE.MeshStandardMaterial({ color: '#806044', roughness: 1 })
  );
  trunk.position.y = height * 0.21;
  const crown = new THREE.Mesh(
    new THREE.IcosahedronGeometry(height * 0.3, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true })
  );
  crown.scale.set(1, 1.25, 1);
  crown.position.y = height * 0.68;
  tree.add(trunk, crown);
  tree.traverse(object => { if (object.isMesh) object.castShadow = true; });
  return tree;
}

function makeCar(color = '#d94f3d') {
  const car = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: '#243a3a', roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.75, 1.75), bodyMaterial);
  body.position.y = 0.65;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.55), dark);
  cabin.position.set(-0.25, 1.3, 0);
  car.add(body, cabin);
  [-1.25, 1.25].forEach(x => [-0.92, 0.92].forEach(z => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 14), dark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.36, z);
    car.add(wheel);
  }));
  car.traverse(object => { if (object.isMesh) object.castShadow = true; });
  return car;
}

function makeDistanceMarker(distance) {
  const marker = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8),
    new THREE.MeshStandardMaterial({ color: '#48665d', roughness: 0.9 })
  );
  pole.position.y = 0.75;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(248,252,249,0.96)';
  context.roundRect(8, 8, 240, 96, 18);
  context.fill();
  context.strokeStyle = '#48665d';
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = '#173d32';
  context.font = '700 48px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`${distance} m`, 128, 57);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  label.scale.set(2.4, 1.05, 1);
  label.position.y = 1.65;
  marker.add(pole, label);
  return marker;
}

function makeGrassTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#7fb373';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let seed = 94721;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const patchColors = ['#73a969', '#8cbd7d', '#679b60', '#95c687'];
  for (let index = 0; index < 1100; index += 1) {
    context.fillStyle = patchColors[Math.floor(random() * patchColors.length)];
    const size = 1 + random() * 2.4;
    context.fillRect(random() * 256, random() * 256, size, size);
  }
  const bladeColors = ['#4f8950', '#5f9858', '#a4cd8f'];
  context.lineWidth = 0.7;
  for (let index = 0; index < 850; index += 1) {
    const x = random() * 256;
    const y = random() * 256;
    context.strokeStyle = bladeColors[Math.floor(random() * bladeColors.length)];
    context.beginPath();
    context.moveTo(x, y + 2.5);
    context.lineTo(x + (random() - 0.5) * 2, y - 2 - random() * 3);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(32, 14);
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeWindStreaks(isMobile) {
  const count = isMobile ? 60 : 130;
  const bases = new Float32Array(count * 3);
  const positions = new Float32Array(count * 6);
  let seed = 13579;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let index = 0; index < count; index += 1) {
    bases[index * 3] = -18 + random() * 88;
    bases[index * 3 + 1] = 0.45 + random() * 8.5;
    bases[index * 3 + 2] = -18 + random() * 36;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: '#d5f2ef', transparent: true, opacity: 0, depthWrite: false });
  const streaks = new THREE.LineSegments(geometry, material);
  streaks.visible = false;
  streaks.frustumCulled = false;
  streaks.userData.bases = bases;
  streaks.userData.count = count;
  return streaks;
}

function updateWindStreaks(streaks, wind, windDirection, delta) {
  const strength = Math.abs(wind);
  if (strength < 0.05) {
    streaks.visible = false;
    return;
  }
  streaks.visible = true;
  streaks.material.opacity = clamp(0.14 + strength * 0.065, 0.14, 0.8);
  const directionX = windDirection === 'front' ? Math.sign(wind) : 0;
  const directionZ = windDirection === 'left' ? 1 : windDirection === 'right' ? -1 : 0;
  const speed = strength * (1.2 + strength * 0.22);
  const length = 0.35 + strength * 0.22;
  const bases = streaks.userData.bases;
  const positions = streaks.geometry.attributes.position.array;
  for (let index = 0; index < streaks.userData.count; index += 1) {
    const offset = index * 3;
    bases[offset] += directionX * speed * delta;
    bases[offset + 2] += directionZ * speed * delta;
    if (bases[offset] > 70) bases[offset] = -18;
    if (bases[offset] < -18) bases[offset] = 70;
    if (bases[offset + 2] > 20) bases[offset + 2] = -20;
    if (bases[offset + 2] < -20) bases[offset + 2] = 20;
    const vertex = index * 6;
    positions[vertex] = bases[offset];
    positions[vertex + 1] = bases[offset + 1];
    positions[vertex + 2] = bases[offset + 2];
    positions[vertex + 3] = bases[offset] - directionX * length;
    positions[vertex + 4] = bases[offset + 1] + Math.sin(index * 1.7) * 0.035 * strength;
    positions[vertex + 5] = bases[offset + 2] - directionZ * length;
  }
  streaks.geometry.attributes.position.needsUpdate = true;
}

function makeRainStreaks(isMobile) {
  const count = isMobile ? 80 : 200;
  const bases = new Float32Array(count * 3);
  const positions = new Float32Array(count * 6);
  let seed = 86421;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let index = 0; index < count; index += 1) {
    bases[index * 3] = -18 + random() * 88;
    bases[index * 3 + 1] = 0.3 + random() * 13;
    bases[index * 3 + 2] = -20 + random() * 40;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: '#c7e4ea', transparent: true, opacity: 0, depthWrite: false });
  const rain = new THREE.LineSegments(geometry, material);
  rain.visible = false;
  rain.frustumCulled = false;
  rain.userData.bases = bases;
  rain.userData.count = count;
  return rain;
}

function updateRainStreaks(rain, weather, wind, windDirection, delta) {
  if (weather === 'clear') {
    rain.visible = false;
    return;
  }
  const typhoon = weather === 'typhoon';
  rain.visible = true;
  rain.material.opacity = typhoon ? 0.62 : 0.38;
  const fallSpeed = typhoon ? 23 : 14;
  const slant = wind * (typhoon ? 0.16 : 0.08);
  const directionX = windDirection === 'front' ? 1 : 0;
  const directionZ = windDirection === 'left' ? 1 : windDirection === 'right' ? -1 : 0;
  const length = typhoon ? 1.7 : 0.9;
  const bases = rain.userData.bases;
  const positions = rain.geometry.attributes.position.array;
  for (let index = 0; index < rain.userData.count; index += 1) {
    const offset = index * 3;
    bases[offset] += directionX * wind * delta * (typhoon ? 0.72 : 0.25);
    bases[offset + 2] += directionZ * Math.abs(wind) * delta * (typhoon ? 0.72 : 0.25);
    bases[offset + 1] -= fallSpeed * delta;
    if (bases[offset + 1] < 0.15) bases[offset + 1] = 13;
    if (bases[offset] > 70) bases[offset] = -18;
    if (bases[offset] < -18) bases[offset] = 70;
    if (bases[offset + 2] > 20) bases[offset + 2] = -20;
    if (bases[offset + 2] < -20) bases[offset + 2] = 20;
    const vertex = index * 6;
    positions[vertex] = bases[offset];
    positions[vertex + 1] = bases[offset + 1];
    positions[vertex + 2] = bases[offset + 2];
    positions[vertex + 3] = bases[offset] - directionX * slant;
    positions[vertex + 4] = bases[offset + 1] + length;
    positions[vertex + 5] = bases[offset + 2] - directionZ * Math.abs(slant);
  }
  rain.geometry.attributes.position.needsUpdate = true;
}

function makeEnvironment() {
  const environment = new THREE.Group();
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 4.2),
    new THREE.MeshStandardMaterial({ color: '#7d8987', roughness: 1 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(32, 0.012, 12);
  environment.add(road);
  [-1.45, 1.45].forEach(z => {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(90, 0.025, 0.09), new THREE.MeshStandardMaterial({ color: '#eef1dc' }));
    stripe.position.set(32, 0.035, 12 + z);
    environment.add(stripe);
  });

  const car = makeCar();
  car.position.set(17 * WORLD_X_SCALE, 0, 12);
  car.rotation.y = Math.PI;
  environment.add(car);

  const rearRoad = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 3.6),
    new THREE.MeshStandardMaterial({ color: '#899391', roughness: 1 })
  );
  rearRoad.rotation.x = -Math.PI / 2;
  rearRoad.position.set(32, 0.01, -17.5);
  environment.add(rearRoad);
  const rearCar = makeCar('#3978b8');
  rearCar.scale.setScalar(0.78);
  rearCar.position.set(9.5 * WORLD_X_SCALE, 0, -17.5);
  environment.add(rearCar);

  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(6.2, 48),
    new THREE.MeshStandardMaterial({ color: '#6eb9c2', roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.9 })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.scale.x = 1.65;
  lake.position.set(27 * WORLD_X_SCALE, 0.018, -12);
  environment.add(lake);

  const treeData = [
    [4, -9, 3.8, '#3f8b59'], [8, -12, 4.8, '#347951'], [12, -8.5, 4.2, '#4b9660'],
    [18, -11, 5.1, '#367b4f'], [23, -8.8, 4.0, '#4f9560'], [29, -12, 5.4, '#35764d'],
    [35, -9, 4.7, '#438b58']
  ];
  treeData.forEach(([meters, z, height, color]) => {
    const tree = makeTree(height, color);
    tree.position.set(meters * WORLD_X_SCALE, 0, z);
    environment.add(tree);
  });

  [5, 10, 15, 20, 25, 30].forEach((distance, index) => {
    const marker = makeDistanceMarker(distance);
    marker.position.set(distance * WORLD_X_SCALE, 0, index % 2 ? -4.3 : -3.9);
    environment.add(marker);
  });

  const grassMaterial = new THREE.MeshStandardMaterial({ color: '#5f9d62', roughness: 1 });
  for (let index = 0; index < 24; index += 1) {
    const grass = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55 + (index % 3) * 0.12, 5), grassMaterial);
    const x = 2 + index * 2.15;
    grass.position.set(x, 0.28, index % 2 ? 4.3 + (index % 4) : -4.5 - (index % 3));
    environment.add(grass);
  }

  const flowerColors = ['#f3cf46', '#e96b68', '#f3f1ee'];
  for (let index = 0; index < 12; index += 1) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6), grassMaterial);
    stem.position.y = 0.275;
    const bloom = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshStandardMaterial({ color: flowerColors[index % flowerColors.length], roughness: 0.8 })
    );
    bloom.position.y = 0.58;
    const flower = new THREE.Group();
    flower.add(stem, bloom);
    flower.position.set(3 + index * 3.1, 0, index % 2 ? 4.8 : -5.2);
    environment.add(flower);
  }

  const startLine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 5.5), new THREE.MeshStandardMaterial({ color: '#f7faf4' }));
  startLine.position.set(0, 0.035, 0);
  environment.add(startLine);
  return environment;
}

function FlightScene({ settings, flightRequest, replayResult, onResult, onFlightState, onFlightEvent, onTelemetry, showForces, cameraMode, flightPaused, onPauseChange, stepRequest }) {
  const host = useRef(null);
  const sceneRef = useRef(null);
  const cameraModeRef = useRef(cameraMode);

  useEffect(() => {
    const el = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfeee8');
    scene.fog = new THREE.Fog('#dfeee8', 45, 120);
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.1, 180);
    camera.position.set(14, 9, 17);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(el.clientWidth < 760 ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = el.clientWidth >= 760;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 34;
    controls.target.set(2, 2.5, 0);

    const hemisphere = new THREE.HemisphereLight('#ffffff', '#789187', 2.3);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight('#fff6d6', 3.2);
    sun.position.set(-8, 14, 8);
    sun.castShadow = true;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 64),
      new THREE.MeshStandardMaterial({ map: makeGrassTexture(renderer), color: '#e5f0df', roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(60, 60, '#6f9683', '#86ae98');
    grid.position.y = 0.005;
    grid.position.x = 20;
    grid.material.transparent = true;
    grid.material.opacity = 0.28;
    scene.add(grid);
    const environment = makeEnvironment();
    scene.add(environment);
    const trees = [];
    environment.traverse(object => { if (object.userData.isTree) trees.push(object); });

    const plane = makePlane();
    plane.scale.setScalar(0.3);
    plane.position.set(0, 1.35 * WORLD_Y_SCALE, 0);
    plane.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
    scene.add(plane);

    const clips = new THREE.Group();
    plane.userData.paperModel.add(clips);
    const wingFlexGroups = { left: plane.userData.wingGroup.children[0], right: plane.userData.wingGroup.children[1] };

    const pathMaterial = new THREE.LineBasicMaterial({ color: '#e24e36', transparent: true, opacity: 0 });
    const pathLine = new THREE.Line(new THREE.BufferGeometry(), pathMaterial);
    scene.add(pathLine);
    const previousPathMaterial = new THREE.LineDashedMaterial({ color: '#596d66', dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0 });
    const previousPathLine = new THREE.Line(new THREE.BufferGeometry(), previousPathMaterial);
    scene.add(previousPathLine);

    const forceGroup = new THREE.Group();
    const forceArrows = {
      lift: new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, '#2185d0', 0.28, 0.15),
      weight: new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1, '#e44f39', 0.28, 0.15),
      thrust: new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, '#15966b', 0.28, 0.15),
      drag: new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(), 1, '#d49a23', 0.28, 0.15),
      wind: new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, '#35a7c5', 0.28, 0.15)
    };
    Object.values(forceArrows).forEach(arrow => forceGroup.add(arrow));
    forceGroup.visible = false;
    scene.add(forceGroup);
    const windStreaks = makeWindStreaks(el.clientWidth < 760);
    scene.add(windStreaks);
    const rainStreaks = makeRainStreaks(el.clientWidth < 760);
    scene.add(rainStreaks);
    sceneRef.current = {
      scene, camera, renderer, controls, plane, clips, pathLine, pathMaterial,
      previousPathLine, previousPathMaterial, forceGroup, forceArrows,
      windStreaks, rainStreaks, windSpeed: 0, windDirection: 'front', weather: 'clear',
      hemisphere, sun, ground, trees, wingFlexGroups, flightSimulation: null,
      paused: false, stepRequestId: 0,
      cameraGoal: camera.position.clone(), targetGoal: controls.target.clone(),
      isFlying: false, raf: 0, flightRaf: 0
    };

    const resize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const weatherLooks = {
      clear: { sky: new THREE.Color('#dfeee8'), ground: new THREE.Color('#e5f0df'), sun: 3.2, hemisphere: 2.3, roughness: 1 },
      rain: { sky: new THREE.Color('#a9bec2'), ground: new THREE.Color('#c6d7c0'), sun: 1.45, hemisphere: 1.6, roughness: 0.72 },
      typhoon: { sky: new THREE.Color('#5d7076'), ground: new THREE.Color('#91a997'), sun: 0.65, hemisphere: 1.05, roughness: 0.48 }
    };
    let previousFrame = performance.now();
    const animate = () => {
      const now = performance.now();
      const delta = Math.min(0.05, (now - previousFrame) / 1000);
      previousFrame = now;
      const state = sceneRef.current;
      updateWindStreaks(state.windStreaks, state.windSpeed, state.windDirection, delta);
      updateRainStreaks(state.rainStreaks, state.weather, state.windSpeed, state.windDirection, delta);
      const look = weatherLooks[state.weather];
      scene.background.lerp(look.sky, 0.035);
      scene.fog.color.lerp(look.sky, 0.035);
      state.ground.material.color.lerp(look.ground, 0.035);
      state.ground.material.roughness = THREE.MathUtils.lerp(state.ground.material.roughness, look.roughness, 0.04);
      state.sun.intensity = THREE.MathUtils.lerp(state.sun.intensity, look.sun, 0.04);
      state.hemisphere.intensity = THREE.MathUtils.lerp(state.hemisphere.intensity, look.hemisphere, 0.04);
      const swayStrength = state.weather === 'typhoon' ? 0.075 : state.weather === 'rain' ? 0.012 : 0;
      state.trees.forEach((tree, index) => {
        const windLean = state.weather === 'typhoon' ? state.windSpeed * 0.0035 : 0;
        const sway = windLean + Math.sin(now * 0.004 + tree.userData.swayPhase + index) * swayStrength;
        tree.rotation.z = THREE.MathUtils.lerp(tree.rotation.z, sway, 0.08);
      });
      if (sceneRef.current.cameraGoal) {
        camera.position.lerp(sceneRef.current.cameraGoal, 0.075);
        controls.target.lerp(sceneRef.current.targetGoal, 0.075);
      }
      controls.update();
      renderer.render(scene, camera);
      sceneRef.current.raf = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(sceneRef.current?.raf);
      cancelAnimationFrame(sceneRef.current?.flightRaf);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
    if (!sceneRef.current || sceneRef.current.isFlying) return;
    const { cameraGoal, targetGoal, controls } = sceneRef.current;
    controls.enabled = cameraMode === 'overview';
    if (cameraMode === 'side') {
      cameraGoal.set(7, 6.5, 22);
      targetGoal.set(4, 2, 0);
    } else if (cameraMode === 'follow') {
      cameraGoal.set(-4, 4.2, 8);
      targetGoal.set(2, 1.5, 0);
    } else {
      cameraGoal.set(11, 11, 22);
      targetGoal.set(6, 1.8, 0);
    }
  }, [cameraMode]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.forceGroup.visible = showForces && sceneRef.current.isFlying;
  }, [showForces, flightRequest.id]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const scale = Math.sqrt((settings.wingArea ?? DEFAULT_WING_AREA) / DEFAULT_WING_AREA);
    sceneRef.current.plane.userData.wingGroup.scale.setScalar(scale);
  }, [settings.wingArea]);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.windSpeed = settings.wind;
      sceneRef.current.windDirection = settings.windDirection;
    }
  }, [settings.wind, settings.windDirection]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const state = sceneRef.current;
    state.weather = settings.weather;
    const looks = {
      clear: { sky: '#dfeee8', ground: '#e5f0df', sun: 3.2, hemisphere: 2.3, roughness: 1 },
      rain: { sky: '#a9bec2', ground: '#c6d7c0', sun: 1.45, hemisphere: 1.6, roughness: 0.72 },
      typhoon: { sky: '#5d7076', ground: '#91a997', sun: 0.65, hemisphere: 1.05, roughness: 0.48 }
    };
    const look = looks[settings.weather];
    state.scene.background.set(look.sky);
    state.scene.fog.color.set(look.sky);
    state.ground.material.color.set(look.ground);
    state.ground.material.roughness = look.roughness;
    state.sun.intensity = look.sun;
    state.hemisphere.intensity = look.hemisphere;
  }, [settings.weather]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { clips } = sceneRef.current;
    clips.clear();
    const x = 4.9 - (settings.clipPosition / 100) * 9.4;
    const wingOffset = clamp(0.65 + (4.9 - x) * 0.35, 0.65, 3.4);
    const sides = settings.clipPlacement === 'both'
      ? [1, -1]
      : settings.clipPlacement === 'left'
        ? [1]
        : settings.clipPlacement === 'right'
          ? [-1]
          : [0];
    sides.forEach(side => {
      for (let i = 0; i < settings.clipCount; i += 1) {
        const clip = makeClip();
        const spread = (i - (settings.clipCount - 1) / 2) * 0.24;
        clip.position.set(x, side === 0 ? spread : side * wingOffset + spread, 0.11 + i * 0.025);
        clip.scale.setScalar(0.85);
        clips.add(clip);
      }
    });
  }, [settings.clipCount, settings.clipPosition, settings.clipPlacement]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.paused = flightPaused;
  }, [flightPaused]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state || state.stepRequestId === stepRequest.id) return;
    state.stepRequestId = stepRequest.id;
    if (!state.paused || !state.flightSimulation || state.flightSimulation.done) return;
    state.flightSimulation.step(1 / 30);
    renderFlightPoint(state, state.flightSimulation.latestPoint, onTelemetry);
    updateTrail(state, state.flightSimulation.latestPoint);
    while (state.lastSeenEventIndex < state.flightSimulation.events.length) {
      onFlightEvent(state.flightSimulation.events[state.lastSeenEventIndex]);
      state.lastSeenEventIndex += 1;
    }
    if (state.flightSimulation.done) {
      const result = state.flightSimulation.finish();
      state.lastResult = result;
      state.isFlying = false;
      state.flightSimulation = null;
      state.forceGroup.visible = false;
      state.controls.enabled = cameraModeRef.current === 'overview';
      onResult(result);
      onFlightState(false);
      onPauseChange(false);
      onFlightEvent({ label: result.cause, detail: result.verdict, tone: result.cause === '穩定飛行' ? 'peak' : 'danger' });
    }
  }, [stepRequest.id]);

  useEffect(() => {
    if (!sceneRef.current || flightRequest.id === 0) return;
    const isReplay = flightRequest.mode === 'replay' && Boolean(replayResult);
    const result = isReplay ? replayResult : null;
    onFlightState(true);
    onPauseChange(false);
    onFlightEvent(isReplay ? { label: '慢動作重播', detail: '觀察姿態與路徑變化', tone: 'replay' } : null);
    const state = sceneRef.current;
    const { plane, pathLine, pathMaterial, previousPathLine, previousPathMaterial,
      forceGroup, controls, cameraGoal, targetGoal } = state;
    state.controls = controls;
    cancelAnimationFrame(state.flightRaf);
    if (!isReplay && pathLine.geometry.getAttribute('position')) {
      previousPathLine.geometry.dispose();
      previousPathLine.geometry = pathLine.geometry.clone();
      previousPathLine.geometry.setDrawRange(0, Infinity);
      previousPathLine.computeLineDistances();
      previousPathMaterial.opacity = pathMaterial.opacity > 0 ? 0.58 : 0;
    }
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry();
    pathLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1600 * 3), 3));
    pathLine.geometry.setDrawRange(0, 1);
    pathMaterial.opacity = 0.8;
    forceGroup.visible = showForces;
    state.isFlying = true;
    state.paused = false;
    controls.enabled = false;
    state.lastTelemetryAt = 0;
    if (isReplay) {
      const coords = result.points.map(point => new THREE.Vector3(point.x * WORLD_X_SCALE, point.y * WORLD_Y_SCALE, point.z * WORLD_Z_SCALE));
      const curve = new THREE.CatmullRomCurve3(coords, false, 'centripetal', 0.35);
      const trail = curve.getPoints(Math.max(140, coords.length * 2));
      pathLine.geometry.setFromPoints(trail);
      const start = performance.now();
      const duration = Math.max(1600, result.airtime * 1900);
      let eventIndex = 0;
      const replayStep = now => {
        const progress = clamp((now - start) / duration, 0, 1);
        const index = Math.min(result.points.length - 1, Math.floor(progress * (result.points.length - 1)));
        const point = result.points[index];
        plane.position.copy(curve.getPoint(progress));
        plane.rotation.set(point.roll || 0, point.yaw || 0, point.pitch || 0);
        state.pathLine.geometry.setDrawRange(0, Math.max(2, Math.ceil(progress * trail.length)));
        updateForceArrows(state.forceArrows, forceGroup, point, plane.position);
        if ((point.t ?? 0) >= state.lastTelemetryAt) {
          state.lastTelemetryAt = (point.t ?? 0) + 0.08;
          onTelemetry(makeTelemetry(point));
        }
        while (eventIndex < result.events.length && progress >= result.events[eventIndex].progress) {
          onFlightEvent(result.events[eventIndex]);
          eventIndex += 1;
        }
        if (progress < 1) state.flightRaf = requestAnimationFrame(replayStep);
        else {
          state.isFlying = false;
          forceGroup.visible = false;
          controls.enabled = cameraModeRef.current === 'overview';
          onFlightState(false);
          onFlightEvent(null);
        }
      };
      state.flightRaf = requestAnimationFrame(replayStep);
    } else {
      const simulation = createFlightPhysics(settings, 1337);
      state.flightSimulation = simulation;
      state.lastSeenEventIndex = 0;
      const initialPoint = simulation.latestPoint;
      renderFlightPoint(state, initialPoint, onTelemetry);
      updateTrail(state, initialPoint);
      let accumulator = 0;
      let lastFrame = performance.now();
      const launchStep = now => {
        const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
        lastFrame = now;
        if (!state.paused) accumulator += delta;
        while (!state.paused && accumulator >= 1 / 60 && !simulation.done) {
          simulation.step(1 / 60);
          accumulator -= 1 / 60;
          const point = simulation.latestPoint;
          renderFlightPoint(state, point, onTelemetry);
          updateTrail(state, point);
          while (state.lastSeenEventIndex < simulation.events.length) {
            onFlightEvent(simulation.events[state.lastSeenEventIndex]);
            state.lastSeenEventIndex += 1;
          }
        }
        const point = simulation.latestPoint;
        if (cameraModeRef.current === 'follow') {
          cameraGoal.set(plane.position.x - 5.2, plane.position.y + 3.1, plane.position.z + 13);
          targetGoal.set(plane.position.x + 2.5, plane.position.y + 0.1, plane.position.z);
        } else if (cameraModeRef.current === 'side') {
          cameraGoal.set(plane.position.x + 8, Math.max(5.5, plane.position.y + 3.5), Math.max(24, plane.position.x * 1.25));
          targetGoal.set(plane.position.x + 1.5, Math.max(1.5, plane.position.y * 0.42), 0);
        } else {
          cameraGoal.set(Math.max(11, plane.position.x * 0.55), Math.max(10, plane.position.y + 7), Math.max(19, plane.position.x * 0.8));
          targetGoal.set(plane.position.x * 0.5, Math.max(1.2, plane.position.y * 0.35), 0);
        }
        if (simulation.done) {
          const finalResult = simulation.finish();
          state.lastResult = finalResult;
          state.flightSimulation = null;
          state.isFlying = false;
          forceGroup.visible = false;
          controls.enabled = cameraModeRef.current === 'overview';
          onResult(finalResult);
          onFlightState(false);
          onPauseChange(false);
          onFlightEvent({ label: finalResult.cause, detail: finalResult.verdict, tone: finalResult.cause === '穩定飛行' ? 'peak' : 'danger' });
          return;
        }
        state.flightRaf = requestAnimationFrame(launchStep);
      };
      state.flightRaf = requestAnimationFrame(launchStep);
    }
    return () => {
      cancelAnimationFrame(state.flightRaf);
      state.isFlying = false;
      state.flightSimulation = null;
      state.forceGroup.visible = false;
      onFlightState(false);
    };
  }, [flightRequest.id]);

  return <div className="scene" ref={host} aria-label="Suzanne 紙飛機 3D 飛行模擬畫面" />;
}

function makeTelemetry(point) {
  return {
    time: point.t ?? 0, speed: point.airSpeed ?? point.speed ?? 0,
    wind: point.windSpeed ?? 0, pitch: point.pitch ?? 0, roll: point.roll ?? 0,
    angleOfAttack: point.angleOfAttack ?? 0, lift: point.lift ?? 0,
    drag: point.drag ?? 0, stalled: Boolean(point.stalled)
  };
}

function updateForceArrows(forceArrows, forceGroup, point, position) {
  forceGroup.position.copy(position);
  forceArrows.lift.position.set(-0.18, 0.08, 0);
  forceArrows.weight.position.set(point.cgX ?? 0, 0, 0);
  forceArrows.thrust.position.set(-1.2, 0, 0);
  forceArrows.drag.position.set(0.05, 0.03, 0);
  forceArrows.wind.position.set(0, 0.12, 1.15);
  const lift = new THREE.Vector3(...(point.liftVector ?? [0, 1, 0]));
  const drag = new THREE.Vector3(...(point.dragVector ?? [-1, 0, 0]));
  const wind = new THREE.Vector3(...(point.windVector ?? [0, 0, 0]));
  forceArrows.lift.setDirection(lift.lengthSq() > 0.0001 ? lift.normalize() : new THREE.Vector3(0, 1, 0));
  forceArrows.lift.setLength(clamp((point.lift || 0) * 0.2, 0.22, 2.4), 0.24, 0.13);
  forceArrows.weight.setDirection(new THREE.Vector3(0, -1, 0));
  forceArrows.weight.setLength(1.4, 0.24, 0.13);
  forceArrows.thrust.setDirection(new THREE.Vector3(
    Math.cos(point.pitch || 0) * Math.cos(point.yaw || 0),
    Math.sin(point.pitch || 0),
    -Math.sin(point.yaw || 0)
  ).normalize());
  forceArrows.thrust.setLength(clamp((point.speed || 0) * 0.14, 0.25, 1.8), 0.24, 0.13);
  forceArrows.drag.setDirection(drag.lengthSq() > 0.0001 ? drag.normalize() : new THREE.Vector3(-1, 0, 0));
  forceArrows.drag.setLength(clamp((point.drag || 0) * 0.24, 0.22, 1.7), 0.24, 0.13);
  forceArrows.wind.visible = wind.lengthSq() > 0.001;
  if (forceArrows.wind.visible) {
    forceArrows.wind.setDirection(wind.normalize());
    forceArrows.wind.setLength(clamp((point.windSpeed || 0) * 0.13, 0.22, 1.8), 0.24, 0.13);
  }
}

function renderFlightPoint(state, point, onTelemetry) {
  const { plane, forceArrows, forceGroup, wingFlexGroups } = state;
  plane.position.set(point.x * WORLD_X_SCALE, point.y * WORLD_Y_SCALE, point.z * WORLD_Z_SCALE);
  plane.rotation.set(point.roll || 0, point.yaw || 0, point.pitch || 0);
  wingFlexGroups.left.rotation.z = point.flexLeft || 0;
  wingFlexGroups.right.rotation.z = point.flexRight || 0;
  updateForceArrows(forceArrows, forceGroup, point, plane.position);
  if (onTelemetry && (point.t ?? 0) >= (state.lastTelemetryAt ?? 0)) {
    state.lastTelemetryAt = (point.t ?? 0) + 0.08;
    onTelemetry(makeTelemetry(point));
  }
}

function updateTrail(state, point) {
  const positions = state.pathLine.geometry.attributes.position;
  const count = state.pathLine.geometry.drawRange.count;
  if (count >= positions.count) return;
  const offset = count * 3;
  positions.array[offset] = point.x * WORLD_X_SCALE;
  positions.array[offset + 1] = point.y * WORLD_Y_SCALE;
  positions.array[offset + 2] = point.z * WORLD_Z_SCALE;
  positions.needsUpdate = true;
  state.pathLine.geometry.setDrawRange(0, count + 1);
}

function Slider({ label, value, min, max, step = 1, unit, onChange }) {
  return (
    <label className="slider-row">
      <span>{label}<strong>{value}{unit}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

function App() {
  const [settings, setSettings] = useState({ goal: 'far', clipCount: 1, clipPosition: 22, clipPlacement: 'body', wingArea: DEFAULT_WING_AREA, throwAngle: 10, throwPower: 55, wind: 0, windDirection: 'front', gustStrength: 0.35, turbulence: 0.2, gustDelay: 1.1, wingSoftness: 0.25, weather: 'clear' });
  const [flightRequest, setFlightRequest] = useState({ id: 0, mode: 'launch' });
  const [result, setResult] = useState(null);
  const [previousResult, setPreviousResult] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [predictionFeedback, setPredictionFeedback] = useState(null);
  const [showForces, setShowForces] = useState(true);
  const [cameraMode, setCameraMode] = useState('side');
  const [isAnimating, setIsAnimating] = useState(false);
  const [flightEvent, setFlightEvent] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [flightPaused, setFlightPaused] = useState(false);
  const [stepRequest, setStepRequest] = useState({ id: 0 });
  const update = (key, value) => {
    setSettings(current => ({ ...current, [key]: value }));
    setPrediction(null);
    setPredictionFeedback(null);
  };
  const liveCg = getCg(settings);
  const cgText = `${liveCg.toFixed(0)}%`;
  const score = useMemo(() => result ? (settings.goal === 'far' ? result.distance : result.peak) : null, [result, settings.goal]);
  const comparison = result && previousResult ? {
    distance: result.distance - previousResult.distance,
    peak: result.peak - previousResult.peak,
    airtime: result.airtime - previousResult.airtime,
    deviation: Math.abs(result.deviation) - Math.abs(previousResult.deviation)
  } : null;

  const handleResult = next => {
    if (result) {
      setPreviousResult(result);
      const correct = prediction === 'farther'
        ? next.distance > result.distance + 0.01
        : prediction === 'higher'
          ? next.peak > result.peak + 0.01
          : next.airtime > result.airtime + 0.01;
      setPredictionFeedback(correct ? '預測正確！你找到了參數與飛行的關係。' : '結果和預測不同，觀察力量箭頭找找原因。');
      setPrediction(null);
    }
    setResult(next);
  };

  const launch = () => {
    if (isAnimating || (result && !prediction)) return;
    setFlightRequest(current => ({ id: current.id + 1, mode: 'launch' }));
  };

  const replay = () => {
    if (isAnimating || !result) return;
    setFlightRequest(current => ({ id: current.id + 1, mode: 'replay' }));
  };

  const setWindDirection = windDirection => {
    setSettings(current => ({
      ...current,
      windDirection,
      wind: windDirection === 'front' ? current.wind : Math.abs(current.wind) || 6
    }));
    setPrediction(null);
    setPredictionFeedback(null);
  };

  const setWeatherMode = weather => {
    setSettings(current => ({
      ...current,
      weather,
      wind: weather === 'typhoon' ? 10 : weather === 'clear' ? 0 : current.wind
    }));
    setPrediction(null);
    setPredictionFeedback(null);
  };

  const setClipFromPointer = (clientX, element) => {
    const rect = element.getBoundingClientRect();
    const position = clamp(5 + ((clientX - rect.left) / rect.width) * 70, 5, 75);
    update('clipPosition', Math.round(position));
  };

  const reset = () => {
    setSettings({ goal: 'far', clipCount: 1, clipPosition: 22, clipPlacement: 'body', wingArea: DEFAULT_WING_AREA, throwAngle: 10, throwPower: 55, wind: 0, windDirection: 'front', gustStrength: 0.35, turbulence: 0.2, gustDelay: 1.1, wingSoftness: 0.25, weather: 'clear' });
    setResult(null);
    setPreviousResult(null);
    setPrediction(null);
    setPredictionFeedback(null);
    setCameraMode('side');
    setIsAnimating(false);
    setFlightPaused(false);
    setTelemetry(null);
    setFlightRequest({ id: 0, mode: 'launch' });
    setFlightEvent(null);
  };

  return (
    <main className="app-shell">
      <FlightScene settings={settings} flightRequest={flightRequest} replayResult={result} onResult={handleResult} onFlightState={setIsAnimating} onFlightEvent={setFlightEvent} onTelemetry={setTelemetry} showForces={showForces} cameraMode={cameraMode} flightPaused={flightPaused} onPauseChange={setFlightPaused} stepRequest={stepRequest} />
      <header className="topbar">
        <div className="brand"><Plane size={22} /><span>Suzanne <b>飛行實驗室</b></span></div>
        <div className="record">世界紀錄機型 · 教學模擬</div>
        {isAnimating && <div className="flight-controls">
          <button className="force-toggle" aria-pressed={flightPaused} onClick={() => setFlightPaused(value => !value)}>{flightPaused ? <Play size={16} /> : <Pause size={16} />}{flightPaused ? '繼續' : '暫停'}</button>
          <button className="force-toggle" disabled={!flightPaused} onClick={() => setStepRequest(value => ({ id: value.id + 1 }))}><StepForward size={16} />單步</button>
        </div>}
        <button className="force-toggle" aria-pressed={showForces} onClick={() => setShowForces(value => !value)}>
          {showForces ? <Eye size={17} /> : <EyeOff size={17} />}受力
        </button>
        <button className="icon-button" onClick={reset} title="重設所有參數" aria-label="重設所有參數"><RotateCcw size={19} /></button>
      </header>

      {showForces && <div className="force-legend" aria-label="飛行力量圖例">
        <span><i className="lift-dot" />升力</span><span><i className="weight-dot" />重力</span>
        <span><i className="thrust-dot" />前進</span><span><i className="drag-dot" />阻力</span>
        <span><i className="wind-dot" />風力</span>
      </div>}

      <div className="view-modes" aria-label="觀看模式">
        <button className={cameraMode === 'side' ? 'active' : ''} onClick={() => setCameraMode('side')}>側視</button>
        <button className={cameraMode === 'follow' ? 'active' : ''} onClick={() => setCameraMode('follow')}>跟隨</button>
        <button className={cameraMode === 'overview' ? 'active' : ''} onClick={() => setCameraMode('overview')}>全景</button>
      </div>

      {flightEvent && <div className={`flight-event ${flightEvent.tone}`} role="status">
        <strong>{flightEvent.label}</strong><span>{flightEvent.detail}</span>
      </div>}

      <aside className={`control-panel ${isAnimating ? 'is-flying' : ''}`} aria-busy={isAnimating}>
        <div className="panel-head">
          <div><small>任務 01</small><h1>調整 Suzanne</h1></div>
          <Info size={19} />
        </div>

        <div className="segmented" aria-label="飛行目標">
          <button className={settings.goal === 'far' ? 'active' : ''} onClick={() => update('goal', 'far')}><Crosshair size={16} />飛更遠</button>
          <button className={settings.goal === 'high' ? 'active' : ''} onClick={() => update('goal', 'high')}><Sparkles size={16} />飛更高</button>
        </div>

        <section>
          <h2>迴紋針配重</h2>
          <div className="placement-options" aria-label="迴紋針放置區域">
            <button className={settings.clipPlacement === 'body' ? 'selected' : ''} onClick={() => update('clipPlacement', 'body')}>機身</button>
            <button className={settings.clipPlacement === 'left' ? 'selected' : ''} onClick={() => update('clipPlacement', 'left')}>左翼</button>
            <button className={settings.clipPlacement === 'right' ? 'selected' : ''} onClick={() => update('clipPlacement', 'right')}>右翼</button>
            <button className={settings.clipPlacement === 'both' ? 'selected' : ''} onClick={() => update('clipPlacement', 'both')}>左右對稱</button>
          </div>
          <div className="stepper-row"><span>{settings.clipPlacement === 'both' ? '每側數量' : '數量'}</span><div className="stepper"><button onClick={() => update('clipCount', clamp(settings.clipCount - 1, 0, 3))}>−</button><strong>{settings.clipCount}</strong><button onClick={() => update('clipCount', clamp(settings.clipCount + 1, 0, 3))}>＋</button></div></div>
          <Slider label="位置" value={settings.clipPosition} min={5} max={75} unit="%" onChange={v => update('clipPosition', v)} />
          <div className="plane-map"><span className="nose">機頭</span><div
            className="mini-plane"
            role="slider"
            tabIndex={0}
            aria-label="拖曳迴紋針位置"
            aria-valuemin={5}
            aria-valuemax={75}
            aria-valuenow={settings.clipPosition}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setClipFromPointer(e.clientX, e.currentTarget); }}
            onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setClipFromPointer(e.clientX, e.currentTarget); }}
            onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)}
            onKeyDown={e => {
              if (e.key === 'ArrowLeft') update('clipPosition', clamp(settings.clipPosition - 1, 5, 75));
              if (e.key === 'ArrowRight') update('clipPosition', clamp(settings.clipPosition + 1, 5, 75));
            }}
          >
            <span className="safe-zone" title="建議重心區" />
            <i className="clip-marker" style={{ left: `${((settings.clipPosition - 5) / 70) * 100}%` }} />
            <i className={`cg-marker ${liveCg < 23 || liveCg > 36 ? 'warning' : ''}`} style={{ left: `${liveCg}%` }} />
          </div><span>機尾</span></div>
          <div className={`cg-status ${liveCg < 23 || liveCg > 36 ? 'warning' : ''}`}>
            <Scale size={15} /><span>重心 {liveCg.toFixed(0)}%</span><strong>{liveCg < 23 ? '機頭偏重' : liveCg > 36 ? '機尾偏重' : '穩定區'}</strong>
          </div>
          <div className={`balance-status ${settings.clipPlacement === 'left' || settings.clipPlacement === 'right' ? 'warning' : ''}`}>
            <Crosshair size={15} /><span>左右平衡</span><strong>{settings.clipPlacement === 'left' ? '左側較重' : settings.clipPlacement === 'right' ? '右側較重' : '平衡'}</strong>
          </div>
        </section>

        <section>
          <h2>紙飛機大小</h2>
          <div className="wing-size-options" role="group" aria-label="翼面積大小">
            {WING_AREA_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={settings.wingArea === option.value ? 'selected' : ''}
                aria-pressed={settings.wingArea === option.value}
                onClick={() => update('wingArea', option.value)}
              >
                <strong>{option.label}</strong><span>{option.area}</span>
              </button>
            ))}
          </div>
          <p className="wing-area-note">翼面積增加會同時增加升力與阻力；這是簡化的飛行模型。</p>
        </section>

        <section>
          <h2>投擲設定</h2>
          <Slider label="仰角" value={settings.throwAngle} min={0} max={30} unit="°" onChange={v => update('throwAngle', v)} />
          <Slider label="力道" value={settings.throwPower} min={20} max={100} unit="%" onChange={v => update('throwPower', v)} />
          <h2 className="environment-title">風場實驗</h2>
          <Slider label="陣風強度" value={settings.gustStrength} min={0} max={1} step={0.05} unit="×" onChange={v => update('gustStrength', v)} />
          <Slider label="亂流程度" value={settings.turbulence} min={0} max={1} step={0.05} unit="×" onChange={v => update('turbulence', v)} />
          <Slider label="陣風出現時間" value={settings.gustDelay} min={0} max={5} step={0.25} unit=" s" onChange={v => update('gustDelay', v)} />
          <Slider label="機翼柔軟度" value={settings.wingSoftness} min={0} max={1} step={0.05} unit="×" onChange={v => update('wingSoftness', v)} />
          <p className="wind-note">翼面積和風速會改變氣動力；機翼彎曲目前是視覺上的彈性效果。</p>
          <Slider label="風速" value={settings.wind} min={settings.windDirection === 'front' ? -10 : 0} max={10} unit=" m/s" onChange={v => update('wind', v)} />
          <div className="wind-presets" aria-label="風速快速設定">
            {settings.windDirection === 'front' ? <>
              <button className={settings.wind === -6 ? 'selected' : ''} onClick={() => update('wind', -6)}>逆風 −6</button>
              <button className={settings.wind === 0 ? 'selected' : ''} onClick={() => update('wind', 0)}>無風</button>
              <button className={settings.wind === 6 ? 'selected' : ''} onClick={() => update('wind', 6)}>順風 ＋6</button>
            </> : <>
              <button className={settings.wind === 3 ? 'selected' : ''} onClick={() => update('wind', 3)}>微風 3</button>
              <button className={settings.wind === 6 ? 'selected' : ''} onClick={() => update('wind', 6)}>強風 6</button>
              <button className={settings.wind === 10 ? 'selected' : ''} onClick={() => update('wind', 10)}>烈風 10</button>
            </>}
          </div>
          <div className="wind-direction" aria-label="風向">
            <span>風向</span>
            <div>
              <button className={settings.windDirection === 'left' ? 'selected' : ''} onClick={() => setWindDirection('left')}>左側</button>
              <button className={settings.windDirection === 'front' ? 'selected' : ''} onClick={() => setWindDirection('front')}>正面</button>
              <button className={settings.windDirection === 'right' ? 'selected' : ''} onClick={() => setWindDirection('right')}>右側</button>
            </div>
          </div>
          {settings.windDirection !== 'front' && <p className="wind-note">側風使用風速的絕對值，會改變傾斜方向與落點。</p>}
          <h2 className="environment-title">環境</h2>
          <div className="weather-options" aria-label="環境模式">
            <button className={settings.weather === 'clear' ? 'selected' : ''} onClick={() => setWeatherMode('clear')}><Sun size={15} />晴天</button>
            <button className={settings.weather === 'rain' ? 'selected' : ''} onClick={() => setWeatherMode('rain')}><CloudRain size={15} />下雨</button>
            <button className={settings.weather === 'typhoon' ? 'selected' : ''} onClick={() => setWeatherMode('typhoon')}><Wind size={15} />颱風</button>
          </div>
          {settings.weather === 'typhoon' && <p className="typhoon-warning">颱風模式：強風 10 m/s、斜向暴雨、陣風亂流與不規則側翻。</p>}
        </section>

        {result && <section className="prediction-section">
          <h2><Brain size={15} />先預測，再試飛</h2>
          <div className="prediction-options">
            <button className={prediction === 'farther' ? 'selected' : ''} onClick={() => setPrediction('farther')}>距離增加</button>
            <button className={prediction === 'higher' ? 'selected' : ''} onClick={() => setPrediction('higher')}>高度增加</button>
            <button className={prediction === 'longer' ? 'selected' : ''} onClick={() => setPrediction('longer')}>滯空增加</button>
          </div>
          {predictionFeedback && <p className="prediction-feedback"><CheckCircle2 size={15} />{predictionFeedback}</p>}
        </section>}

        <div className="flight-actions">
          <button className="launch" disabled={isAnimating || Boolean(result && !prediction)} onClick={launch}><Plane size={20} />{isAnimating ? '飛行中…' : result && !prediction ? '請先選擇預測' : result ? '再次試飛' : '建立基準試飛'}</button>
          {result && <button className="replay" disabled={isAnimating} onClick={replay}><Rewind size={18} />慢動作重播</button>}
        </div>
      </aside>

      {isAnimating && telemetry && <section className="flight-hud" aria-live="polite" aria-label="飛行即時儀表">
        <strong>{flightPaused ? '已暫停' : '即時飛行'}</strong>
        <span>時間 {telemetry.time.toFixed(1)} s</span><span>空速 {telemetry.speed.toFixed(1)} m/s</span>
        <span>風速 {telemetry.wind.toFixed(1)} m/s</span><span>仰角 {(telemetry.pitch * 180 / Math.PI).toFixed(0)}°</span>
        <span>側傾 {(telemetry.roll * 180 / Math.PI).toFixed(0)}°</span><span>迎角 {telemetry.angleOfAttack.toFixed(0)}°</span>
        <span>升力 {telemetry.lift.toFixed(2)}</span><span>阻力 {telemetry.drag.toFixed(2)}</span>
        {telemetry.stalled && <b className="stall-indicator">失速中</b>}
      </section>}

      <section className="telemetry" aria-live="polite">
        <div><Gauge size={17} /><span>預估{settings.goal === 'far' ? '距離' : '高度'}</span><strong>{score === null ? '--' : score.toFixed(1)}<small> m</small></strong></div>
        <div><Wind size={17} /><span>滯空時間</span><strong>{result ? result.airtime.toFixed(1) : '--'}<small> s</small></strong></div>
        <div><Crosshair size={17} /><span>重心位置</span><strong>{cgText}</strong></div>
        <p>{comparison
          ? `和上次相比：距離 ${comparison.distance >= 0 ? '+' : ''}${comparison.distance.toFixed(1)} m，高度 ${comparison.peak >= 0 ? '+' : ''}${comparison.peak.toFixed(1)} m，側偏 ${comparison.deviation >= 0 ? '+' : ''}${comparison.deviation.toFixed(1)} m。`
          : result?.verdict ?? '先建立基準試飛，再修改一個參數並預測結果。'}</p>
      </section>

      <div className="hint">全景模式可拖曳旋轉 · 雙指縮放</div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
