import * as THREE from 'three';

const AIR_DENSITY = 1.225;
const GRAVITY = 9.81;
const AERO_TO_SIMULATION_SCALE = 0.046;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clipMultiplier = placement => placement === 'both' ? 2 : 1;

function windDirectionVector(direction, speed) {
  if (direction === 'left') return new THREE.Vector3(0, 0, speed);
  if (direction === 'right') return new THREE.Vector3(0, 0, -speed);
  return new THREE.Vector3(speed, 0, 0);
}

export function createFlightPhysics(settings, seed = 1337) {
  const wingArea = settings.wingArea ?? 0.03;
  const clipCount = settings.clipCount ?? 1;
  const clipPlacement = settings.clipPlacement ?? 'body';
  const totalClips = clipCount * clipMultiplier(clipPlacement);
  const mass = 0.005 + totalClips * 0.00045;
  const cg = clipCount === 0 ? 37 : 37 - totalClips * (45 - settings.clipPosition) * 0.11;
  const stability = clamp(1 - Math.abs(cg - 30) / 24, 0.35, 1);
  const noseHeavy = clamp((30 - cg) / 13, -0.75, 0.75);
  const asymmetry = clipPlacement === 'left' ? 1 : clipPlacement === 'right' ? -1 : 0;
  const presetSideLoad = asymmetry * clipCount * 4.5;
  const startSpeed = 5.8 + settings.throwPower * 0.12;
  const angle = THREE.MathUtils.degToRad(settings.throwAngle);
  const windBase = windDirectionVector(settings.windDirection, settings.wind);
  const gustStrength = settings.gustStrength ?? 0.35;
  const turbulence = settings.turbulence ?? 0.2;
  const gustDelay = settings.gustDelay ?? 1.1;
  const softness = settings.wingSoftness ?? 0.25;
  const randomPhase = (seed % 997) / 997 * Math.PI * 2;
  const position = new THREE.Vector3(0, 1.35, 0);
  const velocity = new THREE.Vector3(startSpeed * Math.cos(angle), startSpeed * Math.sin(angle), 0);
  const attitude = { pitch: angle, roll: 0, yaw: 0 };
  const angularVelocity = { pitch: 0, roll: 0, yaw: 0 };
  const wingFlex = { left: 0, right: 0, leftRate: 0, rightRate: 0 };
  const points = [];
  const events = [];
  let elapsed = 0;
  let peak = position.y;
  let stalledFor = 0;
  let done = false;
  let cause = '穩定飛行';
  let lastForces = {
    airSpeed: startSpeed, windSpeed: windBase.length(), lift: 0, drag: 0,
    liftVector: new THREE.Vector3(), dragVector: new THREE.Vector3(),
    relativeVelocity: velocity.clone(), wind: windBase.clone(), angleOfAttack: settings.throwAngle,
    stalled: false, gust: 0
  };

  const addEvent = (time, label, detail, tone) => {
    if (!events.some(event => event.label === label)) events.push({ time, label, detail, tone });
  };
  const sample = () => ({
    x: position.x, y: Math.max(0, position.y), z: position.z, t: elapsed,
    cgX: 1.6 - cg * 0.03,
    pitch: attitude.pitch, roll: attitude.roll, yaw: attitude.yaw,
    lift: lastForces.lift, drag: lastForces.drag,
    speed: velocity.length(), airSpeed: lastForces.airSpeed,
    windSpeed: lastForces.windSpeed, gust: lastForces.gust,
    angleOfAttack: lastForces.angleOfAttack, stalled: lastForces.stalled,
    liftVector: lastForces.liftVector.toArray(), dragVector: lastForces.dragVector.toArray(),
    windVector: lastForces.wind.toArray(),
    flexLeft: wingFlex.left, flexRight: wingFlex.right
  });
  points.push(sample());

  function step(dt) {
    if (done) return { done, point: points.at(-1), state: api };
    const tick = Math.min(dt, 1 / 30);
    const timeSinceGust = elapsed - gustDelay;
    const gustPulse = timeSinceGust < 0 ? 0 : Math.exp(-timeSinceGust * 1.05) * Math.sin(timeSinceGust * 4.2);
    const turbulentWave = Math.sin(elapsed * 5.2 + randomPhase) * 0.65
      + Math.sin(elapsed * 10.8 + randomPhase * 0.7) * 0.35;
    const weatherTurbulence = settings.weather === 'typhoon' ? 1 : settings.weather === 'rain' ? 0.45 : 0.18;
    const weatherGust = turbulentWave * weatherTurbulence;
    const gust = gustPulse * gustStrength * Math.abs(settings.wind)
      + weatherGust * turbulence * Math.abs(settings.wind);
    const gustVector = windDirectionVector(settings.windDirection, gust);
    const wind = windBase.clone().add(gustVector);
    const relativeVelocity = velocity.clone().sub(wind);
    const airSpeed = Math.max(0.05, relativeVelocity.length());
    const horizontalSpeed = Math.max(0.05, Math.hypot(relativeVelocity.x, relativeVelocity.z));
    const flightPathAngle = Math.atan2(relativeVelocity.y, horizontalSpeed);
    const angleOfAttack = THREE.MathUtils.radToDeg(attitude.pitch - flightPathAngle);
    const absoluteAoA = Math.abs(angleOfAttack);
    const stalled = absoluteAoA > 32 || airSpeed < 1.6 || (settings.throwAngle > 25 && elapsed < 0.55);
    const liftCoefficient = stalled
      ? 0.13 + 0.12 * Math.exp(-Math.max(0, absoluteAoA - 32) * 0.05)
      : clamp(0.42 + angleOfAttack * 0.055, 0.08, 1.1);
    const dragCoefficient = (0.16 + 0.075 * liftCoefficient ** 2) * (stalled ? 2.8 : 1);
    const dynamicPressure = 0.5 * AIR_DENSITY * airSpeed * airSpeed;
    const forceScale = AERO_TO_SIMULATION_SCALE * wingArea;
    const liftMagnitude = dynamicPressure * forceScale * liftCoefficient / mass * stability * (settings.goal === 'high' ? 1.04 : 1);
    const dragMagnitude = dynamicPressure * forceScale * dragCoefficient / mass;
    const horizontalRelative = new THREE.Vector3(relativeVelocity.x, 0, relativeVelocity.z).normalize();
    const dragVector = relativeVelocity.clone().normalize().multiplyScalar(-dragMagnitude);
    const liftDirection = new THREE.Vector3(
      -horizontalRelative.x * Math.sin(flightPathAngle), Math.cos(flightPathAngle),
      -horizontalRelative.z * Math.sin(flightPathAngle)
    ).normalize();
    const liftVector = liftDirection.applyAxisAngle(new THREE.Vector3(1, 0, 0), attitude.roll).multiplyScalar(liftMagnitude);
    const sideForce = new THREE.Vector3(0, 0, wind.z * 0.055 + gustVector.z * 0.12);
    const acceleration = liftVector.clone().add(dragVector).add(sideForce).add(new THREE.Vector3(0, -GRAVITY, 0));
    acceleration.y -= noseHeavy * 2.2;
    velocity.addScaledVector(acceleration, tick);
    velocity.x = Math.max(-1.2, velocity.x);
    position.addScaledVector(velocity, tick);

    const sideLoad = wind.z * airSpeed * wingArea / mass + presetSideLoad;
    const targetRoll = clamp(sideLoad * 0.0014 + asymmetry * 0.24, -0.8, 0.8);
    angularVelocity.roll += ((targetRoll - attitude.roll) * 1.4 * stability - angularVelocity.roll * (1.1 + stability)) * tick;
    attitude.roll += angularVelocity.roll * tick;
    const pitchTarget = clamp(flightPathAngle + THREE.MathUtils.degToRad(4 - noseHeavy * 7), -0.38, 0.48);
    const stallNoseDown = stalled ? -1.3 : 0;
    angularVelocity.pitch += ((pitchTarget - attitude.pitch) * (0.8 + stability * 1.5)
      - angularVelocity.pitch * (0.7 + stability * 1.9) + stallNoseDown) * tick;
    attitude.pitch = clamp(attitude.pitch + angularVelocity.pitch * tick, -1.1, 0.9);
    const yawTarget = clamp(-attitude.roll * 0.5 + sideLoad * 0.00032, -0.75, 0.75);
    angularVelocity.yaw += ((yawTarget - attitude.yaw) * (0.55 + stability * 0.55) - angularVelocity.yaw * 1.1) * tick;
    attitude.yaw = clamp(attitude.yaw + angularVelocity.yaw * tick, -1.2, 1.2);

    const leftTarget = clamp((sideLoad * 0.0008 + attitude.roll * 0.12) * softness, -0.38, 0.38);
    const rightTarget = clamp((-sideLoad * 0.0008 - attitude.roll * 0.12) * softness, -0.38, 0.38);
    wingFlex.leftRate += ((leftTarget - wingFlex.left) * 28 - wingFlex.leftRate * 6) * tick;
    wingFlex.rightRate += ((rightTarget - wingFlex.right) * 28 - wingFlex.rightRate * 6) * tick;
    wingFlex.left += wingFlex.leftRate * tick;
    wingFlex.right += wingFlex.rightRate * tick;

    elapsed += tick;
    peak = Math.max(peak, position.y);
    if (stalled) stalledFor += tick;
    else stalledFor = Math.max(0, stalledFor - tick * 1.8);
    lastForces = {
      airSpeed, windSpeed: wind.length(), lift: liftVector.length(), drag: dragVector.length(),
      liftVector, dragVector, relativeVelocity, wind, angleOfAttack, stalled, gust
    };
    if (stalled && !events.some(event => event.label === '失速')) {
      addEvent(elapsed, '失速', '迎角過大或速度不足，升力下降、機頭開始下沉', 'danger');
    }
    if (Math.abs(attitude.roll) > 0.52 && !events.some(event => event.label === '大幅側傾')) {
      addEvent(elapsed, '大幅側傾', '左右受力不平衡，飛機正在傾斜', 'warning');
    }
    if (Math.abs(attitude.roll) < 0.14 && Math.abs(angularVelocity.roll) < 0.2
      && events.some(event => event.label === '大幅側傾') && !events.some(event => event.label === '恢復平衡')) {
      addEvent(elapsed, '恢復平衡', '機翼受力和重心使飛機逐漸回正', 'peak');
    }
    if (Math.abs(settings.wind) > 0.1 && gustStrength > 0.01 && elapsed >= gustDelay && elapsed - tick < gustDelay) {
      addEvent(elapsed, '陣風來襲', '風場突然增強，觀察姿態與受力變化', 'wind');
    }
    if (stalledFor > 0.45) cause = '失速後下墜';
    if (stalledFor > 1.4 && stability < 0.6) cause = '重心不穩且持續失速';
    if (position.y <= 0 || elapsed >= 12 || (position.x > 110 && position.y < 0.2)) {
      position.y = Math.max(0, position.y);
      done = true;
      addEvent(elapsed, cause, cause === '穩定飛行' ? '飛機完成飛行' : '受力與姿態變化造成飛行失控', cause === '穩定飛行' ? 'peak' : 'danger');
    }
    points.push(sample());
    return { done, point: points.at(-1), state: api };
  }

  function finish() {
    const last = points.at(-1);
    const windEvent = events.find(event => ['失速', '重心不穩且持續失速', '陣風來襲'].includes(event.label));
    const verdict = windEvent?.detail ?? (settings.windDirection !== 'front' && Math.abs(last.z) > 1
      ? '側風使飛機側偏 ' + Math.abs(last.z).toFixed(1) + ' 公尺。'
      : '配重和翼面在這次風場下維持飛行。');
    return {
      points, distance: last.x, peak, airtime: last.t, deviation: last.z,
      cg, stability, verdict, events: events.map(event => ({ ...event, progress: event.time / Math.max(last.t, 0.01) })),
      cause, settings: { ...settings }, seed
    };
  }

  const api = {
    step, finish,
    get done() { return done; },
    get time() { return elapsed; },
    get events() { return events; },
    get state() { return { position, velocity, attitude, angularVelocity, wingFlex, forces: lastForces, stalled, cause }; },
    get latestPoint() { return points.at(-1); }
  };
  return api;
}
