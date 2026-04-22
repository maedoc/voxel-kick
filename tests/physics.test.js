import * as THREE from 'three';
import { getRampNormal, updateCar } from '../js/physics.js';
import * as CONST from '../js/constants.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; }
    else { failed++; console.error('FAIL:', msg); }
}

/* ===== getRampNormal geometry tests ===== */
console.log('--- getRampNormal geometry ---');

const R = CONST.RAMP_RADIUS;

/* Right wall ramp center: (AW/2 - R, R) */
const cxR = CONST.AW / 2 - R;
const cy = R;

/* Sample points on the right-wall ramp surface: arc 3π/2 → 2π */
for (const angle of [4.8, 5.2, 5.6]) {
    const x = cxR + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    const pos = new THREE.Vector3(x, y + CONST.CHY, 0);
    const n = getRampNormal(pos);
    assert(n !== null, `right wall ramp surface at angle ${angle.toFixed(2)} should return normal`);
    if (n) {
        assert(n.x < 0, `right wall normal should point left (toward center), got x=${n.x.toFixed(3)}`);
        assert(n.y > 0, `right wall normal should point up, got y=${n.y.toFixed(3)}`);
    }
}

/* Left wall ramp center: (-AW/2 + R, R) */
const cxL = -CONST.AW / 2 + R;
for (const angle of [3.3, 3.8, 4.3]) {
    const x = cxL + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    const pos = new THREE.Vector3(x, y + CONST.CHY, 0);
    const n = getRampNormal(pos);
    assert(n !== null, `left wall ramp surface at angle ${angle.toFixed(2)} should return normal`);
    if (n) {
        assert(n.x > 0, `left wall normal should point right (toward center), got x=${n.x.toFixed(3)}`);
        assert(n.y > 0, `left wall normal should point up, got y=${n.y.toFixed(3)}`);
    }
}

/* Front wall ramp center: (0, R, AL/2 - R) */
const czF = CONST.AL / 2 - R;
for (const angle of [4.8, 5.2, 5.6]) {
    const z = czF + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    const pos = new THREE.Vector3(0, y + CONST.CHY, z);
    const n = getRampNormal(pos);
    assert(n !== null, `front wall ramp surface should return normal`);
    if (n) {
        assert(n.z < 0, `front wall normal should point backward (toward center), got z=${n.z.toFixed(3)}`);
        assert(n.y > 0, `front wall normal should point up, got y=${n.y.toFixed(3)}`);
    }
}

/* Back wall ramp center: (0, R, -AL/2 + R) */
const czB = -CONST.AL / 2 + R;
for (const angle of [3.3, 3.8, 4.3]) {
    const z = czB + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    const pos = new THREE.Vector3(0, y + CONST.CHY, z);
    const n = getRampNormal(pos);
    assert(n !== null, `back wall ramp surface should return normal`);
    if (n) {
        assert(n.z > 0, `back wall normal should point forward (toward center), got z=${n.z.toFixed(3)}`);
        assert(n.y > 0, `back wall normal should point up, got y=${n.y.toFixed(3)}`);
    }
}

/* Points far from ramp should return null */
assert(getRampNormal(new THREE.Vector3(0, CONST.CHY, 0)) === null, 'center floor should not be on wall');
assert(getRampNormal(new THREE.Vector3(0, 50, 0)) === null, 'high up center should not be on wall');

/* ===== Car driving up wall test ===== */
console.log('--- car wall-ride simulation ---');

function makeCar(x, z) {
    return {
        pos: new THREE.Vector3(x, CONST.CHY, z),
        vel: new THREE.Vector3(),
        rot: 0,
        onGround: true, canFlip: false, isFlipping: false,
        flipTimer: 0, flipType: '', boost: CONST.B_MAX,
        jumpHeld: false, flipHit: false, accelRamp: 1,
        onWall: false, surfaceNormal: new THREE.Vector3(0, 1, 0)
    };
}

/* Drive toward right wall */
{
    const car = makeCar(CONST.AW / 2 - R - 5, 0);
    car.rot = Math.PI / 2; // facing +X
    let stepsOnWall = 0;
    for (let i = 0; i < 300; i++) {
        updateCar(car, { forward: true, jump: false }, 1 / 60);
        if (car.onWall) stepsOnWall++;
        if (stepsOnWall > 10) break;
    }
    assert(stepsOnWall > 10, `car driving at right wall should end up onWall (steps=${stepsOnWall})`);
    assert(car.pos.x > cxR, `car should be pushed onto right ramp, x=${car.pos.x.toFixed(2)} vs cx=${cxR}`);
}

/* Drive toward front wall */
{
    const car = makeCar(0, CONST.AL / 2 - R - 5);
    car.rot = 0; // facing +Z
    let stepsOnWall = 0;
    for (let i = 0; i < 300; i++) {
        updateCar(car, { forward: true, jump: false }, 1 / 60);
        if (car.onWall) stepsOnWall++;
        if (stepsOnWall > 10) break;
    }
    assert(stepsOnWall > 10, `car driving at front wall should end up onWall (steps=${stepsOnWall})`);
    assert(car.pos.z > czF, `car should be pushed onto front ramp, z=${car.pos.z.toFixed(2)} vs cz=${czF}`);
}

/* Drive toward left wall */
{
    const car = makeCar(-CONST.AW / 2 + R + 5, 0);
    car.rot = -Math.PI / 2; // facing -X
    let stepsOnWall = 0;
    for (let i = 0; i < 300; i++) {
        updateCar(car, { forward: true, jump: false }, 1 / 60);
        if (car.onWall) stepsOnWall++;
        if (stepsOnWall > 10) break;
    }
    assert(stepsOnWall > 10, `car driving at left wall should end up onWall (steps=${stepsOnWall})`);
    assert(car.pos.x < cxL, `car should be pushed onto left ramp, x=${car.pos.x.toFixed(2)} vs cx=${cxL}`);
}

/* Drive toward back wall */
{
    const car = makeCar(0, -CONST.AL / 2 + R + 5);
    car.rot = Math.PI; // facing -Z
    let stepsOnWall = 0;
    for (let i = 0; i < 300; i++) {
        updateCar(car, { forward: true, jump: false }, 1 / 60);
        if (car.onWall) stepsOnWall++;
        if (stepsOnWall > 10) break;
    }
    assert(stepsOnWall > 10, `car driving at back wall should end up onWall (steps=${stepsOnWall})`);
    assert(car.pos.z < czB, `car should be pushed onto back ramp, z=${car.pos.z.toFixed(2)} vs cz=${czB}`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
