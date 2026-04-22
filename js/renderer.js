import * as THREE from 'three';
import * as CONST from './constants.js';

/* ===== THREE SETUP ===== */
export const scene = new THREE.Scene();

(function(){
    const c = document.createElement('canvas'); c.width = 2; c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0,   '#1a3a5c');
    g.addColorStop(0.3, '#4a90d9');
    g.addColorStop(0.55,'#87CEEB');
    g.addColorStop(0.75,'#b8e4f0');
    g.addColorStop(1,   '#e8f4e8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;
})();

const FOG_COLOR = 0x9dd4e8;
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0018);

export const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 350);
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
export const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(20, 50, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 1; sc.far = 180;
scene.add(sun);

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

/* ===== VOXEL HELPERS ===== */
export function makeVoxelMesh(voxels) {
    const s = CONST.V * 0.92;
    const geo = new THREE.BoxGeometry(s, s, s);
    const mat = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, voxels.length);
    mesh.castShadow = true;
    const d = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < voxels.length; i++) {
        const vx = voxels[i];
        d.position.set(vx.x, vx.y, vx.z);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        c.setRGB(vx.r, vx.g, vx.b);
        mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
}

export function addBox(x1, y1, z1, x2, y2, z2, col, arr) {
    for (let x = x1; x < x2; x += CONST.V)
    for (let y = y1; y < y2; y += CONST.V)
    for (let z = z1; z < z2; z += CONST.V)
        arr.push({x, y, z, ...col});
}

/* ===== CAR MODEL ===== */
export function buildCar(bc, ac) {
    const v = [];
    const wc = {r: 0.18, g: 0.18, b: 0.18};
    addBox(-1, 0.3, -1.8, 1, 0.85, 1.8, bc, v);
    addBox(-0.85, 0.85, 0.6, 0.85, 1.05, 1.75, bc, v);
    addBox(-0.7, 0.85, -0.5, 0.7, 1.35, 0.65, ac, v);
    addBox(-0.9, 1.0, -1.65, 0.9, 1.08, -1.5, ac, v);
    addBox(-1.2, 0.0, 1.05, -0.85, 0.42, 1.7, wc, v);
    addBox( 0.85, 0.0, 1.05, 1.2, 0.42, 1.7, wc, v);
    addBox(-1.2, 0.0, -1.7, -0.85, 0.42, -1.05, wc, v);
    addBox( 0.85, 0.0, -1.7, 1.2, 0.42, -1.05, wc, v);
    const hl = {r: 1, g: 1, b: 0.85};
    addBox(-0.75, 0.5, 1.75, -0.45, 0.7, 1.85, hl, v);
    addBox( 0.45, 0.5, 1.75, 0.75, 0.7, 1.85, hl, v);
    const tl = {r: 1, g: 0.25, b: 0.25};
    addBox(-0.75, 0.5, -1.85, -0.45, 0.7, -1.75, tl, v);
    addBox( 0.45, 0.5, -1.85, 0.75, 0.7, -1.75, tl, v);
    return v;
}

/* ===== BALL MODEL ===== */
export function buildBall() {
    const v = [];
    const r = CONST.BR;
    for (let x = -r; x <= r; x += CONST.V)
    for (let y = -r; y <= r; y += CONST.V)
    for (let z = -r; z <= r; z += CONST.V) {
        if (x*x + y*y + z*z <= r*r) {
            const ck = (Math.round(x/CONST.V) + Math.round(y/CONST.V) + Math.round(z/CONST.V)) & 1;
            v.push({x, y, z, r: 1, g: ck ? 0.92 : 0.82, b: ck ? 0.55 : 0.35});
        }
    }
    return v;
}

/* ===== ARENA ===== */
export function createArena() {
    /* floor */
    const floorGeo = new THREE.PlaneGeometry(CONST.AW, CONST.AL, 1, 1);
    const floorMat = new THREE.MeshLambertMaterial({color: 0xA8E6CF});
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI/2; floor.position.y = 0.01; floor.receiveShadow = true;
    scene.add(floor);

    /* ground plane beyond */
    const groundGeo = new THREE.PlaneGeometry(800, 800, 1, 1);
    const groundMat = new THREE.MeshLambertMaterial({color: 0x5a9e4b});
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI/2; ground.position.y = -0.05; ground.receiveShadow = true;
    scene.add(ground);

    /* field markings */
    const lm = new THREE.MeshBasicMaterial({color: 0xffffff});
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.2, CONST.AL), lm);
    cl.rotation.x = -Math.PI/2; cl.position.y = 0.02; scene.add(cl);
    const cc = new THREE.Mesh(new THREE.RingGeometry(13.5, 13.7, 48), new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide}));
    cc.rotation.x = -Math.PI/2; cc.position.y = 0.02; scene.add(cc);

    const wm = new THREE.MeshLambertMaterial({color: 0xFFB3BA, transparent: true, opacity: 0.25, side: THREE.DoubleSide});
    const gm = new THREE.MeshLambertMaterial({color: 0xFFEAA7, transparent: true, opacity: 0.35, side: THREE.DoubleSide});
    const wt = 0.8;
    const R = CONST.RAMP_RADIUS;

    /* side walls with curved ramps */
    function sideWall(xSign) {
        const x = xSign * CONST.AW / 2;
        const wallLen = CONST.AL + CONST.GD * 2;
        const wallH = CONST.AH - R;

        /* vertical wall above ramp */
        const swg = new THREE.BoxGeometry(wt, wallH, wallLen);
        const wall = new THREE.Mesh(swg, wm);
        wall.position.set(x + xSign * wt/2, wallH/2 + R, 0);
        wall.castShadow = true;
        scene.add(wall);

        /* quarter-cylinder ramp — axis along Z, cross-section in X-Y */
        const thetaStart = xSign < 0 ? Math.PI : 3 * Math.PI / 2;
        const rampGeo = new THREE.CylinderGeometry(R, R, wallLen, 32, 1, true, thetaStart, Math.PI/2);
        const ramp = new THREE.Mesh(rampGeo, wm);
        ramp.castShadow = true;
        ramp.position.set(x - xSign * R, R, 0);
        ramp.rotation.set(-Math.PI/2, 0, 0);
        scene.add(ramp);
    }
    sideWall(-1);
    sideWall(1);

    /* ceiling */
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(CONST.AW + wt*2, wt, CONST.AL + CONST.GD*2), wm);
    ceil.position.set(0, CONST.AH + wt/2, 0);
    scene.add(ceil);

    /* end walls with goals */
    function endWall(zSign) {
        const z = zSign * CONST.AL / 2;
        const lsw = CONST.AW/2 - CONST.GW/2;
        const wallH = CONST.AH - R;

        /* left section */
        const lsg = new THREE.BoxGeometry(lsw, wallH, wt);
        const ls = new THREE.Mesh(lsg, wm);
        ls.position.set(-CONST.AW/2 + lsw/2, wallH/2 + R, z - zSign * wt/2);
        ls.castShadow = true; scene.add(ls);

        /* right section */
        const rs = new THREE.Mesh(lsg, wm);
        rs.position.set(CONST.AW/2 - lsw/2, wallH/2 + R, z - zSign * wt/2);
        rs.castShadow = true; scene.add(rs);

        /* top section */
        const tsg = new THREE.BoxGeometry(CONST.GW, wallH - CONST.GH, wt);
        const ts = new THREE.Mesh(tsg, wm);
        ts.position.set(0, CONST.GH + (wallH - CONST.GH)/2 + R, z - zSign * wt/2);
        ts.castShadow = true; scene.add(ts);

        /* quarter-cylinder ramp — axis along X, cross-section in Y-Z */
        const thetaStart = zSign < 0 ? Math.PI : Math.PI / 2;
        const rampGeo = new THREE.CylinderGeometry(R, R, CONST.AW, 32, 1, true, thetaStart, Math.PI/2);
        const ramp = new THREE.Mesh(rampGeo, wm);
        ramp.castShadow = true;
        ramp.position.set(0, R, z - zSign * R);
        ramp.rotation.set(0, 0, Math.PI/2);
        scene.add(ramp);

        /* goal box */
        const gz = z + zSign * CONST.GD/2;
        const bg = new THREE.BoxGeometry(CONST.GW + wt*2, CONST.GH, wt);
        const bm = new THREE.Mesh(bg, gm);
        bm.position.set(0, CONST.GH/2, gz + zSign * CONST.GD/2);
        scene.add(bm);

        const sg = new THREE.BoxGeometry(wt, CONST.GH, CONST.GD);
        const sl = new THREE.Mesh(sg, gm);
        sl.position.set(-CONST.GW/2 - wt/2, CONST.GH/2, gz);
        scene.add(sl);
        const sr = new THREE.Mesh(sg, gm);
        sr.position.set(CONST.GW/2 + wt/2, CONST.GH/2, gz);
        scene.add(sr);

        const tg = new THREE.BoxGeometry(CONST.GW + wt*2, wt, CONST.GD);
        const tp = new THREE.Mesh(tg, gm);
        tp.position.set(0, CONST.GH + wt/2, gz);
        scene.add(tp);
    }
    endWall(-1);
    endWall(1);
}

/* ===== SCENERY ===== */
export function createScenery() {
    const trunkGeo = new THREE.BoxGeometry(1.2, 4, 1.2);
    const trunkMat = new THREE.MeshLambertMaterial({color: 0x8B5E3C});
    const canopyGeo = new THREE.BoxGeometry(4, 3.5, 4);
    const canopyMat = new THREE.MeshLambertMaterial({color: 0x2E7D32});
    const canopy2Geo = new THREE.BoxGeometry(3, 2.5, 3);

    const trees = [
        {x: -70, z: -80}, {x: 70, z: -80}, {x: -70, z: 80}, {x: 70, z: 80},
        {x: -90, z: -40}, {x: 90, z: -40}, {x: -90, z: 40}, {x: 90, z: 40},
        {x: -55, z: -110}, {x: 55, z: -110}, {x: -55, z: 110}, {x: 55, z: 110},
        {x: -110, z: 0}, {x: 110, z: 0},
        {x: -100, z: -70}, {x: 100, z: -70}, {x: -100, z: 70}, {x: 100, z: 70},
        {x: 0, z: -120}, {x: 0, z: 120},
        {x: -120, z: -30}, {x: 120, z: 30}, {x: -30, z: 100}, {x: 30, z: -100},
    ];
    trees.forEach(p => {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(p.x, 2, p.z);
        trunk.castShadow = true;
        scene.add(trunk);
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.set(p.x, 5.5, p.z);
        canopy.castShadow = true;
        scene.add(canopy);
        const top = new THREE.Mesh(canopy2Geo, canopyMat);
        top.position.set(p.x, 8, p.z);
        top.castShadow = true;
        scene.add(top);
    });

    const standGeo = new THREE.BoxGeometry(CONST.AW * 0.8, 8, 6);
    const standMat = new THREE.MeshLambertMaterial({color: 0x888888});
    const standL = new THREE.Mesh(standGeo, standMat);
    standL.position.set(0, 4, -CONST.AL/2 - 12);
    standL.castShadow = true; standL.receiveShadow = true;
    scene.add(standL);
    const standR = new THREE.Mesh(standGeo, standMat);
    standR.position.set(0, 4, CONST.AL/2 + 12);
    standR.castShadow = true; standR.receiveShadow = true;
    scene.add(standR);

    const specGeo = new THREE.BoxGeometry(1.2, 1.8, 1.2);
    const specColors = [0xe53935, 0x1E88E5, 0xFDD835, 0x43A047, 0xFF6F00, 0x8E24AA, 0xffffff];
    const rowCount = 3, colCount = 30;
    specColors.forEach(color => {
        const mat = new THREE.MeshLambertMaterial({color});
        const count = rowCount * colCount;
        const mesh = new THREE.InstancedMesh(specGeo, mat, count);
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (const side of [-1, 1]) {
            const baseZ = side * (CONST.AL/2 + 12);
            for (let row = 0; row < rowCount; row++) {
                for (let col = 0; col < Math.floor(colCount / 2); col++) {
                    if (idx >= count) break;
                    const x = (col - colCount/4) * 2.8 + (Math.random() - 0.5) * 0.4;
                    const y = 8.5 + row * 2.2 + (Math.random() - 0.5) * 0.3;
                    const z = baseZ + side * (1 + row * 1.8);
                    dummy.position.set(x, y, z);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(idx++, dummy.matrix);
                }
            }
        }
        mesh.count = idx;
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
    });
}

/* ===== GOAL CLARITY ===== */
export function createGoalIndicators() {
    /* goal lights */
    const redLight = new THREE.PointLight(0xff6b6b, 1.5, 40);
    redLight.position.set(0, CONST.GH + 5, -CONST.AL/2);
    scene.add(redLight);

    const blueLight = new THREE.PointLight(0x74b9ff, 1.5, 40);
    blueLight.position.set(0, CONST.GH + 5, CONST.AL/2);
    scene.add(blueLight);

    /* field arrows pointing to red goal (AI side, z = -AL/2) */
    const arrowGeo = new THREE.ConeGeometry(1.2, 2.5, 4);
    arrowGeo.rotateX(-Math.PI/2); /* point along -Z */
    const arrowMat = new THREE.MeshBasicMaterial({color: 0xff6b6b, transparent: true, opacity: 0.45});
    const arrows = [];
    for (const z of [20, 10, 0, -10, -20]) {
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.position.set(0, 0.3, z);
        scene.add(arrow);
        arrows.push(arrow);
    }
    return arrows;
}

/* ===== MESH UPDATES ===== */
export function updateCarMesh(car, mesh) {
    mesh.position.copy(car.pos);
    if (car.onWall && car.surfaceNormal) {
        const up = car.surfaceNormal.clone().multiplyScalar(-1);
        const fwdVec = new THREE.Vector3(Math.sin(car.rot), 0, Math.cos(car.rot));
        fwdVec.sub(up.clone().multiplyScalar(fwdVec.dot(up))).normalize();
        const right = new THREE.Vector3().crossVectors(up, fwdVec).normalize();
        const actualFwd = new THREE.Vector3().crossVectors(right, up).normalize();
        const matrix = new THREE.Matrix4().makeBasis(right, up, actualFwd.negate());
        mesh.quaternion.setFromRotationMatrix(matrix);
    } else if (car.isFlipping && car.flipTimer > 0) {
        const progress = 1 - car.flipTimer / CONST.F_DUR;
        const angle = progress * Math.PI * 2;
        const e = new THREE.Euler(0, car.rot, 0, 'YXZ');
        mesh.setRotationFromEuler(e);
        if (car.flipType === 'front') mesh.rotateX(angle);
        else if (car.flipType === 'back') mesh.rotateX(-angle);
        else if (car.flipType === 'left') mesh.rotateZ(angle);
        else if (car.flipType === 'right') mesh.rotateZ(-angle);
    } else {
        mesh.rotation.set(0, car.rot, 0);
    }
}

export function updateBallMesh(ballMesh, ball) {
    ballMesh.position.copy(ball.pos);
    const speed = Math.sqrt(ball.vel.x*ball.vel.x + ball.vel.z*ball.vel.z);
    if (speed > 0.1) {
        const axis = new THREE.Vector3(-ball.vel.z, 0, ball.vel.x).normalize();
        const angle = speed * (1/60) / CONST.BR;
        ballMesh.rotateOnWorldAxis(axis, angle);
    }
}

/* ===== CAMERA ===== */
const camOffset = new THREE.Vector3(0, 12, -24);
const camLookOffset = new THREE.Vector3(0, 2, 15);
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();

export function updateCamera(player, ball, dt) {
    const off = camOffset.clone().applyAxisAngle(new THREE.Vector3(0,1,0), player.rot);
    const desired = player.pos.clone().add(off);
    camPos.lerp(desired, 1 - Math.pow(0.01, dt));

    const lookOff = camLookOffset.clone().applyAxisAngle(new THREE.Vector3(0,1,0), player.rot);
    const desiredTarget = player.pos.clone().add(lookOff);
    desiredTarget.lerp(ball.pos, 0.12);
    camTarget.lerp(desiredTarget, 1 - Math.pow(0.005, dt));

    camera.position.copy(camPos);
    camera.lookAt(camTarget);
}

export function initCameraPosition(player) {
    camPos.copy(player.pos.clone().add(camOffset.clone().applyAxisAngle(new THREE.Vector3(0,1,0), player.rot)));
    camTarget.copy(player.pos);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
}

/* ===== BALL INDICATOR ===== */
export function updateBallArrow(ballPos) {
    const arrow = document.getElementById('ball-arrow');
    if (!arrow) return;
    const pos = ballPos.clone().project(camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;

    const margin = 50;
    const offLeft = x < margin;
    const offRight = x > window.innerWidth - margin;
    const offTop = y < margin;
    const offBottom = y > window.innerHeight - margin;

    if (!offLeft && !offRight && !offTop && !offBottom) {
        arrow.style.display = 'none';
        return;
    }

    arrow.style.display = 'block';
    const cx = Math.max(margin, Math.min(window.innerWidth - margin, x));
    const cy = Math.max(margin, Math.min(window.innerHeight - margin, y));
    arrow.style.left = cx + 'px';
    arrow.style.top = cy + 'px';

    const dx = x - window.innerWidth / 2;
    const dy = y - window.innerHeight / 2;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    arrow.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
}
