/*
 * Rapier physics implementation for Voxel Kick.
 * Uses trimesh colliders for quarter-pipe ramp walls.
 */

import * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import * as C from './constants.js';

/* ===== HELPERS ===== */

function fwd(rot) {
    return new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
}

/**
 * Build an extruded trimesh collider for a wall+ramp.
 *
 * The cross-section is a closed polygon in the (axisCoord, Y) plane:
 *   - inner ground point → arc along quarter-cylinder → wall top → inner top → close
 * Then extruded perpendicular to that plane over the given half-length.
 *
 * @param {number} sign    +1 for right/front wall, -1 for left/back
 * @param {'x'|'z'} axis   which horizontal axis the wall is perpendicular to
 * @param {number} halfLength  half-length of extrusion (arena extent along wall)
 */
function buildWallRampTrimesh(sign, axis, halfLength) {
    const R = C.RAMP_RADIUS;
    const segs = 20;
    const wallPos = axis === 'x' ? sign * C.AW / 2 : sign * C.AL / 2;
    const cx = wallPos - sign * R;   // cylinder centre along axis
    const cy = R;                     // cylinder centre Y

    // Arc angles (ground → wall):
    //   +sign walls: 3PI/2 → 2PI   (e.g. right wall arc goes from (cx,0) up to (wallPos,R))
    //   -sign walls: PI → 3PI/2    (e.g. left wall arc goes from (cx,0) up to (wallPos,R))
    const startA = sign > 0 ? 3 * Math.PI / 2 : Math.PI;
    const endA   = sign > 0 ? 2 * Math.PI      : 3 * Math.PI / 2;

    // Cross-section polygon (axisCoord, Y)
    const cs = [];
    cs.push([cx, 0]);                                       // inner ground
    for (let i = 0; i <= segs; i++) {                       // arc
        const a = startA + (i / segs) * (endA - startA);
        cs.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    cs.push([wallPos, C.AH]);                               // wall top
    cs.push([cx, C.AH]);                                    // inner top

    return extrudeCrossSection(cs, axis, halfLength);
}

/**
 * Build an end-wall trimesh that leaves a goal opening in the centre.
 * Same cross-section as a full wall but extruded only over the two
 * flanking sections (left and right of the goal gap).
 */
function buildEndWallTrimesh(zSign) {
    const R = C.RAMP_RADIUS;
    const segs = 20;
    const wallZ = zSign * C.AL / 2;
    const cx = wallZ - zSign * R;
    const cy = R;
    const startA = zSign > 0 ? 3 * Math.PI / 2 : Math.PI;
    const endA   = zSign > 0 ? 2 * Math.PI      : 3 * Math.PI / 2;

    // Cross-section in (Z, Y) plane
    const cs = [];
    cs.push([cx, 0]);
    for (let i = 0; i <= segs; i++) {
        const a = startA + (i / segs) * (endA - startA);
        cs.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    cs.push([wallZ, C.AH]);
    cs.push([cx, C.AH]);

    // Two sections flanking the goal opening
    const sideW = (C.AW - C.GW) / 2;
    const results = [];
    for (const xCentre of [-C.AW / 2 + sideW / 2, C.AW / 2 - sideW / 2]) {
        // Extrude cross-section along X around xCentre
        const { vertices, indices } = extrudeCrossSection(cs, 'z', sideW / 2);
        // Offset x vertices to centre around xCentre instead of origin
        for (let i = 0; i < vertices.length; i += 3) {
            vertices[i] += xCentre;
        }
        results.push({ vertices, indices });
    }
    return results;
}

/**
 * Extrude a 2D cross-section polygon into a 3D trimesh.
 * Cross-section is in the (axisCoord, Y) plane.
 * axis='x' → extrude along Z,  axis='z' → extrude along X.
 *
 * Returns { vertices: Float32Array, indices: Uint32Array }.
 */
function extrudeCrossSection(cs, axis, halfLen) {
    const n = cs.length;
    const verts = new Float32Array(n * 2 * 3);

    for (let i = 0; i < n; i++) {
        const [a, b] = cs[i];
        const fi = i * 3;
        const bi = (n + i) * 3;
        if (axis === 'x') {
            // front face z = +halfLen, back face z = -halfLen
            verts[fi] = a; verts[fi + 1] = b; verts[fi + 2] =  halfLen;
            verts[bi] = a; verts[bi + 1] = b; verts[bi + 2] = -halfLen;
        } else {
            // front face x = +halfLen, back face x = -halfLen
            verts[fi] =  halfLen; verts[fi + 1] = b; verts[fi + 2] = a;
            verts[bi] = -halfLen; verts[bi + 1] = b; verts[bi + 2] = a;
        }
    }

    const idx = [];
    // Front face (CCW)
    for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
    // Back face (reversed)
    for (let i = 1; i < n - 1; i++) idx.push(n, n + i + 1, n + i);
    // Side faces
    for (let i = 0; i < n - 1; i++) {
        idx.push(i, i + 1, n + i + 1);
        idx.push(i, n + i + 1, n + i);
    }

    return { vertices: verts, indices: new Uint32Array(idx) };
}

/* ===== INIT ===== */

export async function initPhysics() {
    await RAPIER.init({});
    const world = new RAPIER.World({ x: 0, y: C.GRAV, z: 0 });

    /* ---------- Floor ---------- */
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.AW / 2 + 5, 0.5, C.AL / 2 + C.GD * 2 + 5)
            .setTranslation(0, -0.5, 0)
            .setRestitution(0.3)
            .setFriction(0.7)
    );

    /* ---------- Side walls (left / right) ---------- */
    for (const sign of [+1, -1]) {
        const { vertices, indices } = buildWallRampTrimesh(sign, 'x', (C.AL + C.GD * 2) / 2);
        world.createCollider(
            RAPIER.ColliderDesc.trimesh(vertices, indices)
                .setRestitution(C.W_REST)
                .setFriction(0.8)
        );
    }

    /* ---------- End walls (front / back) with goal openings ---------- */
    for (const zSign of [+1, -1]) {
        const sections = buildEndWallTrimesh(zSign);
        for (const { vertices, indices } of sections) {
            world.createCollider(
                RAPIER.ColliderDesc.trimesh(vertices, indices)
                    .setRestitution(C.W_REST)
                    .setFriction(0.8)
            );
        }

        /* Goal box */
        const goalZ = zSign * (C.AL / 2 + C.GD / 2);
        // Back wall of goal
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(C.GW / 2 + 0.5, C.GH / 2, 0.5)
                .setTranslation(0, C.GH / 2, zSign * (C.AL / 2 + C.GD))
                .setRestitution(C.W_REST).setFriction(0.8)
        );
        // Left side
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.5, C.GH / 2, C.GD / 2)
                .setTranslation(-C.GW / 2 - 0.5, C.GH / 2, goalZ)
                .setRestitution(C.W_REST).setFriction(0.8)
        );
        // Right side
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.5, C.GH / 2, C.GD / 2)
                .setTranslation(C.GW / 2 + 0.5, C.GH / 2, goalZ)
                .setRestitution(C.W_REST).setFriction(0.8)
        );
        // Top
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(C.GW / 2 + 0.5, 0.5, C.GD / 2)
                .setTranslation(0, C.GH + 0.5, goalZ)
                .setRestitution(C.W_REST).setFriction(0.8)
        );
    }

    /* ---------- Ceiling ---------- */
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.AW / 2 + 1, 0.5, C.AL / 2 + C.GD + 1)
            .setTranslation(0, C.AH + 0.5, 0)
            .setRestitution(C.W_REST)
            .setFriction(0.5)
    );

    /* ---------- Cars ---------- */
    const playerBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setCanSleep(false)
            .enabledRotations(false, true, false)
            .setLinearDamping(0)
            .setAngularDamping(10)
            .setTranslation(0, C.CHY, 30)
    );
    const pq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    playerBody.setRotation({ x: pq.x, y: pq.y, z: pq.z, w: pq.w }, true);

    const aiBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setCanSleep(false)
            .enabledRotations(false, true, false)
            .setLinearDamping(0)
            .setAngularDamping(10)
            .setTranslation(0, C.CHY, -30)
    );

    const playerCol = world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.CHX, C.CHY, C.CHZ)
            .setMass(C.C_MASS).setRestitution(0.2).setFriction(0.8),
        playerBody
    );
    const aiCol = world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.CHX, C.CHY, C.CHZ)
            .setMass(C.C_MASS).setRestitution(0.2).setFriction(0.8),
        aiBody
    );

    /* ---------- Ball ---------- */
    const ballBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setCanSleep(false)
            .setTranslation(0, C.BR, 0)
            .setLinearDamping(0.05)
            .setAngularDamping(0.3)
    );
    const ballCol = world.createCollider(
        RAPIER.ColliderDesc.ball(C.BR)
            .setMass(C.BL_MASS).setRestitution(C.B_REST).setFriction(0.9),
        ballBody
    );

    return { world, playerBody, playerCol, aiBody, aiCol, ballBody, ballCol };
}

/* ===== CAR INPUT ===== */

export function applyCarInput(body, collider, input, dt, carState, world) {
    const pos = body.translation();
    const lv = body.linvel();
    const rq = body.rotation();
    const yaw = Math.atan2(
        2 * (rq.w * rq.y + rq.x * rq.z),
        1 - 2 * (rq.y * rq.y + rq.z * rq.z)
    );
    carState.pos.set(pos.x, pos.y, pos.z);
    carState.vel.set(lv.x, lv.y, lv.z);
    carState.rot = yaw;

    // Ground detection
    carState.onGround = pos.y <= C.CHY + 0.3;

    // Steering
    const steer = input.steerAnalog !== undefined
        ? input.steerAnalog
        : (input.left ? 1 : input.right ? -1 : 0);
    const speed = Math.sqrt(lv.x * lv.x + lv.z * lv.z);
    const fwdVec = fwd(carState.rot);
    const fwdSpeed = carState.vel.dot(fwdVec);
    let effectiveSteer = steer;
    if (fwdSpeed < -0.5) effectiveSteer *= -1;
    const turnFactor = Math.max(0.35, 1.0 - speed / (C.C_MAX * 0.55));
    carState.rot += effectiveSteer * C.C_TURN * turnFactor * dt;

    const newQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), carState.rot);
    body.setRotation({ x: newQuat.x, y: newQuat.y, z: newQuat.z, w: newQuat.w }, true);

    // Acceleration
    const accDir = new THREE.Vector3();
    if (input.forward)  accDir.add(fwd(carState.rot));
    if (input.backward) accDir.sub(fwd(carState.rot));

    if (accDir.lengthSq() > 0) {
        carState.accelRamp = Math.min(1, carState.accelRamp + dt / 0.25);
    } else {
        carState.accelRamp = Math.max(0, carState.accelRamp - dt / 0.125);
    }

    let accMag = C.C_ACC * carState.accelRamp;
    if (input.boost && carState.boost > 0 && input.forward) {
        accMag = C.B_ACC * carState.accelRamp;
        carState.boost = Math.max(0, carState.boost - C.B_DRAIN);
    } else {
        carState.boost = Math.min(C.B_MAX, carState.boost + C.B_REGEN);
    }

    if (accDir.lengthSq() > 0) {
        accDir.normalize();
        body.applyImpulse({
            x: accDir.x * accMag * dt * C.C_MASS,
            y: 0,
            z: accDir.z * accMag * dt * C.C_MASS
        }, true);
    }

    // Jump
    if (input.jump) {
        if (carState.onGround && !carState.jumpHeld) {
            body.applyImpulse({ x: 0, y: C.J_VEL * C.C_MASS, z: 0 }, true);
            carState.onGround = false;
            carState.canFlip = true;
            carState.jumpHeld = true;
        } else if (carState.canFlip && !carState.jumpHeld) {
            carState.canFlip = false;
            carState.isFlipping = true;
            carState.flipTimer = C.F_DUR;
            carState.flipHit = true;
            const ff = fwd(carState.rot);
            if (input.forward)       body.applyImpulse({ x:  ff.x * C.F_VEL * C.C_MASS, y: C.F_VEL * C.C_MASS * 0.35, z:  ff.z * C.F_VEL * C.C_MASS }, true);
            else if (input.backward) body.applyImpulse({ x: -ff.x * C.F_VEL * C.C_MASS, y: C.F_VEL * C.C_MASS * 0.35, z: -ff.z * C.F_VEL * C.C_MASS }, true);
            else                     body.applyImpulse({ x: 0, y: C.J_VEL * C.C_MASS * 0.3, z: 0 }, true);
            carState.jumpHeld = true;
        }
    } else {
        if (carState.jumpHeld && !carState.onGround && lv.y > 0 && carState.canFlip) {
            body.setLinvel({ x: lv.x, y: lv.y * C.J_CUT, z: lv.z }, true);
        }
        carState.jumpHeld = false;
    }

    // Flip timer
    if (carState.flipTimer > 0) {
        carState.flipTimer -= dt;
        if (carState.flipTimer <= 0) { carState.isFlipping = false; carState.flipHit = false; }
    }

    // Speed cap
    const vel = body.linvel();
    const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (hSpeed > C.C_MAX) {
        const s = C.C_MAX / hSpeed;
        body.setLinvel({ x: vel.x * s, y: vel.y, z: vel.z * s }, true);
    }

    // Friction
    const friction = carState.onGround ? 0.975 : 0.985;
    const dampFactor = Math.exp(Math.log(friction) * dt * 60);
    const v = body.linvel();
    body.setLinvel({ x: v.x * dampFactor, y: v.y, z: v.z * dampFactor }, true);
}

/* ===== WORLD STEP ===== */

export function stepWorld(world, dt) {
    world.timestep = dt;
    world.step();
}

/* ===== STATE SYNC ===== */

export function syncBodyToState(body, stateObj) {
    const p = body.translation();
    const v = body.linvel();
    stateObj.pos.set(p.x, p.y, p.z);
    stateObj.vel.set(v.x, v.y, v.z);
}

/* ===== GOALS ===== */

export function checkGoals(ballBody, pScore, aScore, goalCD) {
    if (goalCD.v > 0) return false;
    const p = ballBody.translation();
    if (p.z < -C.AL / 2 - 1 && Math.abs(p.x) < C.GW / 2 && p.y < C.GH) {
        pScore.v++; goalCD.v = C.GOAL_CD; return true;
    }
    if (p.z > C.AL / 2 + 1 && Math.abs(p.x) < C.GW / 2 && p.y < C.GH) {
        aScore.v++; goalCD.v = C.GOAL_CD; return true;
    }
    return false;
}

/* ===== RESET ===== */

export function resetAll(playerBody, aiBody, ballBody, playerState, aiState, ballState) {
    playerBody.setTranslation({ x: 0, y: C.CHY, z: 30 }, true);
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const pq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    playerBody.setRotation({ x: pq.x, y: pq.y, z: pq.z, w: pq.w }, true);

    aiBody.setTranslation({ x: 0, y: C.CHY, z: -30 }, true);
    aiBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    aiBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);

    ballBody.setTranslation({ x: 0, y: C.BR, z: 0 }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

    for (const s of [playerState, aiState]) {
        s.vel.set(0, 0, 0);
        s.boost = C.B_MAX;
        s.onGround = true;
        s.canFlip = false;
        s.isFlipping = false;
        s.flipHit = false;
        s.flipTimer = 0;
        s.accelRamp = 0;
        s.jumpHeld = false;
        s.onWall = false;
    }
    playerState.pos.set(0, C.CHY, 30);
    playerState.rot = Math.PI;
    aiState.pos.set(0, C.CHY, -30);
    aiState.rot = 0;
    ballState.pos.set(0, C.BR, 0);
    ballState.vel.set(0, 0, 0);
    ballState.angVel.set(0, 0, 0);
}

/* ===== GROUND DETECTION ===== */

export function getOnGround(body, collider, world) {
    const p = body.translation();
    return p.y <= C.CHY + 0.3;
}

export function isBallOnGround(ballBody, world) {
    const p = ballBody.translation();
    return p.y <= C.BR + 0.3;
}
