/*
 * Rapier physics implementation for Voxel Kick.
 * Replaces hand-rolled physics with @dimforge/rapier3d-compat.
 */

import * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import * as C from './constants.js';

/* ===== HELPERS ===== */

function fwd(rot) {
    return new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
}

/**
 * Build an array of 3D points tracing a quarter-circle arc
 * that transitions from ground to wall.
 *
 * For a RIGHT wall (x = +AW/2):
 *   cylinder centre = (AW/2 - R, R)
 *   arc from angle PI (ground level, x = cx - R, y = 0)
 *            to angle 3PI/2 (wall level, x = AW/2, y = R)
 *
 * Returns points in CCW order to form a convex polygon cross-section.
 */
function rampArcPoints(sign, axis) {
    // axis = 'x' for side walls, 'z' for end walls
    // sign = +1 for right/front wall, -1 for left/back wall
    const R = C.RAMP_RADIUS;
    const halfA = axis === 'x' ? C.AW / 2 : C.AL / 2;
    const cx = halfA - R; // distance from origin to cylinder centre along axis

    // For right wall: arc from PI to 3PI/2
    // For left wall:  arc from PI/2 to PI
    // Points are in the axis-Y plane (axis, y)
    const segments = 12;
    const points = [];

    // Start point: ground level at the base of the ramp
    // right wall: ground extends from x=0 to x=cx, y=0
    // We need a polygon that forms the ramp shape:
    // vertex at (0, 0), then along arc, then up the wall

    // Ground-level vertex (inner edge of ramp base)
    points.push({ x: 0, y: 0 }); // relative to wall position

    // Arc points: for right wall, from angle PI to 3PI/2
    // At angle PI: point is at (cx - R, R + 0) = (cx - R, 0) relative to cylinder center
    // In absolute: (cx + R*cos(angle), R + R*sin(angle))
    // At PI: (cx - R, 0) — ground level
    // At 3PI/2: (cx, R) — wall level

    const startAngle = sign > 0 ? Math.PI : Math.PI / 2;
    const endAngle = sign > 0 ? 3 * Math.PI / 2 : Math.PI;

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = startAngle + t * (endAngle - startAngle);
        const px = cx + R * Math.cos(angle); // position along axis
        const py = R + R * Math.sin(angle);  // height
        // Store relative to wall line (x=0 = wall surface)
        const relAxis = sign > 0 ? (halfA - px) : (px - (-halfA));
        points.push({ x: -relAxis * sign, y: py });
    }

    // Wall top vertex
    points.push({ x: 0, y: C.AH });

    // Inner corner at top
    points.push({ x: -(halfA) * sign, y: C.AH });

    // Inner corner at ground
    points.push({ x: -(halfA) * sign, y: 0 });

    return points;
}

/**
 * Create a convex polygon collider for a wall+ramp cross-section,
 * extruded along the wall's length.
 */
function createRampWallCollider(world, sign, axis, length) {
    // Build the convex hull vertices for the cross-section
    // We'll approximate with a polyline of cuboids instead,
    // since Rapier convex polygon needs careful vertex ordering.

    // Actually, let's use a simpler approach: create multiple cuboid
    // segments that follow the quarter-circle curve.

    const R = C.RAMP_RADIUS;
    const halfA = axis === 'x' ? C.AW / 2 : C.AL / 2;
    const cx = halfA - R;
    const wallThick = 0.5; // half-thickness of each segment

    // Create segments along the arc
    const segments = 12;
    const startAngle = sign > 0 ? Math.PI : Math.PI / 2;
    const endAngle = sign > 0 ? 3 * Math.PI / 2 : Math.PI;

    for (let i = 0; i < segments; i++) {
        const t0 = i / segments;
        const t1 = (i + 1) / segments;
        const a0 = startAngle + t0 * (endAngle - startAngle);
        const a1 = startAngle + t1 * (endAngle - startAngle);

        // Centre of this segment
        const aMid = (a0 + a1) / 2;
        const segCx = cx + R * Math.cos(aMid);
        const segCy = R + R * Math.sin(aMid);

        // Segment dimensions
        const segLen = R * Math.abs(a1 - a0); // arc length
        const segThick = 1.0; // thickness of ramp surface

        // Normal direction at midpoint (pointing inward toward arena)
        const nx = -Math.cos(aMid) * sign;
        const ny = -Math.sin(aMid);

        // Position: on the arc surface, offset inward by half thickness
        const posX = segCx + nx * segThick * 0.5;
        const posY = segCy + ny * segThick * 0.5;

        // Rotation: angle of the surface normal
        const rotAngle = Math.atan2(-nx, ny); // angle from vertical

        if (axis === 'x') {
            // Side wall: segment extends along Z
            const desc = RAPIER.ColliderDesc.cuboid(segThick / 2, segLen / 2, length / 2)
                .setTranslation(sign > 0 ? (halfA - posX) * sign + halfA - (halfA - posX) : posX, posY, 0)
                .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rotAngle * sign))
                .setRestitution(C.W_REST)
                .setFriction(0.8);
            world.createCollider(desc);
        } else {
            // End wall: segment extends along X
            const desc = RAPIER.ColliderDesc.cuboid(length / 2, segLen / 2, segThick / 2)
                .setTranslation(0, posY, sign > 0 ? (halfA - posX) * sign + halfA - (halfA - posX) : posX)
                .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotAngle * sign))
                .setRestitution(C.W_REST)
                .setFriction(0.8);
            world.createCollider(desc);
        }
    }

    // Flat wall above ramp
    const wallH = C.AH - R;
    const wallY = R + wallH / 2;
    if (axis === 'x') {
        const desc = RAPIER.ColliderDesc.cuboid(wallThick, wallH / 2, length / 2)
            .setTranslation(sign * halfA, wallY, 0)
            .setRestitution(C.W_REST)
            .setFriction(0.8);
        world.createCollider(desc);
    } else {
        const desc = RAPIER.ColliderDesc.cuboid(length / 2, wallH / 2, wallThick)
            .setTranslation(0, wallY, sign * halfA)
            .setRestitution(C.W_REST)
            .setFriction(0.8);
        world.createCollider(desc);
    }
}

/* ===== INIT ===== */

export async function initPhysics() {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: C.GRAV, z: 0 });

    /* ---------- Floor ---------- */
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.AW / 2 + 2, 0.5, C.AL / 2 + C.GD * 2 + 2)
            .setTranslation(0, -0.5, 0)
            .setRestitution(0.3)
            .setFriction(0.7)
    );

    /* ---------- Side walls with ramps ---------- */
    // Right wall ramp (+X)
    buildRampSegments(world, +1, 'x', C.AL + C.GD * 2);
    // Left wall ramp (-X)
    buildRampSegments(world, -1, 'x', C.AL + C.GD * 2);

    /* ---------- End walls with goal openings ---------- */
    // Front wall (+Z) — two sections flanking the goal + section above goal
    buildEndWallWithGoal(world, +1);
    // Back wall (-Z)
    buildEndWallWithGoal(world, -1);

    /* ---------- Ceiling ---------- */
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.AW / 2 + 1, 0.5, C.AL / 2 + C.GD + 1)
            .setTranslation(0, C.AH + 0.5, 0)
            .setRestitution(C.W_REST)
            .setFriction(0.5)
    );

    /* ---------- Cars ---------- */
    const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setCanSleep(false)
        .enabledRotations(false, true, false)  // only Y rotation
        .setLinearDamping(0)
        .setAngularDamping(10);

    const playerBody = world.createRigidBody(
        carBodyDesc.setTranslation({ x: 0, y: C.CHY, z: 30 })
    );
    playerBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    // Set yaw rotation via quaternion for Math.PI (facing backward)
    const pq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    playerBody.setRotation({ x: pq.x, y: pq.y, z: pq.z, w: pq.w }, true);

    const aiBody = world.createRigidBody(
        carBodyDesc.setTranslation({ x: 0, y: C.CHY, z: -30 })
    );

    const carColDesc = RAPIER.ColliderDesc.cuboid(C.CHX, C.CHY, C.CHZ)
        .setMass(C.C_MASS)
        .setRestitution(0.2)
        .setFriction(0.8);
    const playerCol = world.createCollider(carColDesc, playerBody);
    const aiCol = world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.CHX, C.CHY, C.CHZ)
            .setMass(C.C_MASS)
            .setRestitution(0.2)
            .setFriction(0.8),
        aiBody
    );

    /* ---------- Ball ---------- */
    const ballBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setCanSleep(false)
            .setTranslation({ x: 0, y: C.BR, z: 0 })
            .setLinearDamping(0.05)
            .setAngularDamping(0.3)
    );
    const ballCol = world.createCollider(
        RAPIER.ColliderDesc.ball(C.BR)
            .setMass(C.BL_MASS)
            .setRestitution(C.B_REST)
            .setFriction(0.9),
        ballBody
    );

    return { world, playerBody, playerCol, aiBody, aiCol, ballBody, ballCol };
}

/**
 * Build ramp segments for a side wall (X-axis walls).
 * Creates cuboid segments that follow the quarter-circle from floor to wall.
 */
function buildRampSegments(world, xSign, axis, length) {
    const R = C.RAMP_RADIUS;
    const halfA = axis === 'x' ? C.AW / 2 : C.AL / 2;
    const cx = halfA - R;  // cylinder centre distance from origin
    const segments = 16;
    const thick = 1.2;     // half-thickness of each ramp segment

    // Arc from ground to wall level
    // Right wall: angles from PI (ground) to 3PI/2 (wall)
    // Left wall: angles from PI/2 (wall) to PI (ground)
    const startAngle = xSign > 0 ? Math.PI : Math.PI / 2;
    const endAngle = xSign > 0 ? 3 * Math.PI / 2 : Math.PI;

    for (let i = 0; i < segments; i++) {
        const t0 = i / segments;
        const t1 = (i + 1) / segments;
        const a0 = startAngle + t0 * (endAngle - startAngle);
        const a1 = startAngle + t1 * (endAngle - startAngle);
        const aMid = (a0 + a1) / 2;
        const dAngle = Math.abs(a1 - a0);

        // Position on arc at midpoint
        const arcX = cx + R * Math.cos(aMid);
        const arcY = R + R * Math.sin(aMid);

        // Surface tangent length
        const segLen = R * dAngle;

        // Surface normal at midpoint (pointing toward arena interior)
        const nx = -Math.cos(aMid);
        const ny = -Math.sin(aMid);

        // Offset position inward by half thickness
        const posX = arcX + nx * thick * 0.3;
        const posY = arcY + ny * thick * 0.3;

        // Rotation angle of this segment (surface tilt)
        // The surface tangent direction is perpendicular to the normal
        const surfAngle = Math.atan2(ny, nx) - Math.PI / 2; // tangent angle

        if (axis === 'x') {
            // Side wall: extends along Z
            const desc = RAPIER.ColliderDesc.cuboid(thick, segLen / 2, length / 2)
                .setTranslation(posX * (xSign > 0 ? 1 : 1), posY, 0)
                .setRestitution(C.W_REST)
                .setFriction(0.8);
            // Rotate around Z to match surface tilt
            if (Math.abs(surfAngle) > 0.01) {
                const q = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0, 0, xSign), surfAngle
                );
                desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
            }
            world.createCollider(desc);
        } else {
            // End wall: extends along X
            const desc = RAPIER.ColliderDesc.cuboid(length / 2, segLen / 2, thick)
                .setTranslation(0, posY, posX)
                .setRestitution(C.W_REST)
                .setFriction(0.8);
            if (Math.abs(surfAngle) > 0.01) {
                const q = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(xSign, 0, 0), surfAngle
                );
                desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
            }
            world.createCollider(desc);
        }
    }

    // Flat wall section above the ramp
    const wallH = C.AH - R;
    const wallY = R + wallH / 2;
    if (axis === 'x') {
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.5, wallH / 2, length / 2)
                .setTranslation(xSign * halfA, wallY, 0)
                .setRestitution(C.W_REST)
                .setFriction(0.8)
        );
    } else {
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(length / 2, wallH / 2, 0.5)
                .setTranslation(0, wallY, xSign * halfA)
                .setRestitution(C.W_REST)
                .setFriction(0.8)
        );
    }
}

/**
 * Build end wall with goal opening.
 * Creates ramp segments + flat wall sections with a gap for the goal.
 */
function buildEndWallWithGoal(world, zSign) {
    const R = C.RAMP_RADIUS;
    const halfL = C.AL / 2;
    const cz = halfL - R;

    // Ramp segments along the end wall — full width but we'll skip
    // the goal area and add separate flat wall sections flanking the goal.
    const segments = 16;
    const thick = 1.2;
    const startAngle = zSign > 0 ? Math.PI : Math.PI / 2;
    const endAngle = zSign > 0 ? 3 * Math.PI / 2 : Math.PI;

    // Ramp — only create segments where NOT in the goal opening
    // Goal opening is at x = [-GW/2, GW/2], y = [0, GH]
    // The ramp is at y < R, so it's always below GH (GH=15, R=30)
    // We need to split the ramp into left-of-goal, right-of-goal sections
    // Actually for simplicity, create the full ramp and let the ball pass
    // through the gap above the ramp where the goal opening is.
    // The ramp only goes up to y=R=30, and the goal top is at GH=15,
    // so the ramp is actually TALLER than the goal opening.
    // We need to leave a gap in both the ramp AND the flat wall above.

    // Simpler approach: create the ramp and wall as full width,
    // then add goal box colliders BEHIND the wall that catch the ball.
    // The ball will enter through the goal opening (no collider there).

    // Ramp segments — full width of arena
    for (let i = 0; i < segments; i++) {
        const t0 = i / segments;
        const t1 = (i + 1) / segments;
        const a0 = startAngle + t0 * (endAngle - startAngle);
        const a1 = startAngle + t1 * (endAngle - startAngle);
        const aMid = (a0 + a1) / 2;
        const dAngle = Math.abs(a1 - a0);

        const arcZ = cz + R * Math.cos(aMid);
        const arcY = R + R * Math.sin(aMid);
        const segLen = R * dAngle;

        const nx = -Math.cos(aMid);
        const ny = -Math.sin(aMid);
        const posX = arcZ + nx * thick * 0.3;
        const posY = arcY + ny * thick * 0.3;
        const surfAngle = Math.atan2(ny, nx) - Math.PI / 2;

        // Left section: x from -AW/2 to -GW/2
        const leftW = (C.AW - C.GW) / 2;
        const leftCx = -C.AW / 2 + leftW / 2;

        // Right section: x from GW/2 to AW/2
        const rightCx = C.AW / 2 - leftW / 2;

        // Create left and right ramp segments (skip goal opening width)
        for (const cx of [leftCx, rightCx]) {
            const desc = RAPIER.ColliderDesc.cuboid(leftW / 2, segLen / 2, thick)
                .setTranslation(cx, posY, posX)
                .setRestitution(C.W_REST)
                .setFriction(0.8);
            if (Math.abs(surfAngle) > 0.01) {
                const q = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(zSign, 0, 0), surfAngle
                );
                desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
            }
            world.createCollider(desc);
        }
    }

    // Flat wall above ramp — left and right of goal
    const wallH = C.AH - R;
    const wallY = R + wallH / 2;
    const sideW = (C.AW - C.GW) / 2;

    world.createCollider(
        RAPIER.ColliderDesc.cuboid(sideW / 2, wallH / 2, 0.5)
            .setTranslation(-C.AW / 2 + sideW / 2, wallY, zSign * halfL)
            .setRestitution(C.W_REST)
            .setFriction(0.8)
    );
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(sideW / 2, wallH / 2, 0.5)
            .setTranslation(C.AW / 2 - sideW / 2, wallY, zSign * halfL)
            .setRestitution(C.W_REST)
            .setFriction(0.8)
    );

    // Wall section above goal opening
    const aboveH = C.AH - C.GH;
    if (aboveH > 0) {
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(C.GW / 2, aboveH / 2, 0.5)
                .setTranslation(0, C.GH + aboveH / 2, zSign * halfL)
                .setRestitution(C.W_REST)
                .setFriction(0.8)
        );
    }

    /* Goal box — behind the wall opening */
    const goalZ = zSign * (halfL + C.GD / 2);

    // Back of goal
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.GW / 2 + 0.5, C.GH / 2, 0.5)
            .setTranslation(0, C.GH / 2, zSign * (halfL + C.GD))
            .setRestitution(C.W_REST)
            .setFriction(0.8)
    );

    // Left side of goal
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, C.GH / 2, C.GD / 2)
            .setTranslation(-C.GW / 2 - 0.5, C.GH / 2, goalZ)
            .setRestitution(C.W_REST)
            .setFriction(0.8)
    );

    // Right side of goal
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, C.GH / 2, C.GD / 2)
            .setTranslation(C.GW / 2 + 0.5, C.GH / 2, goalZ)
            .setRestitution(C.W_REST)
            .setFriction(0.8)
    );

    // Top of goal
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(C.GW / 2 + 0.5, 0.5, C.GD / 2)
            .setTranslation(0, C.GH + 0.5, goalZ)
            .setRestitution(C.W_REST)
            .setFriction(0.8)
    );
}

/* ===== CAR INPUT ===== */

export function applyCarInput(body, collider, input, dt, carState, world) {
    // Read current state from body
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

    // Update body rotation
    const newQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), carState.rot
    );
    body.setRotation({ x: newQuat.x, y: newQuat.y, z: newQuat.z, w: newQuat.w }, true);

    // Acceleration direction
    const accDir = new THREE.Vector3();
    if (input.forward) accDir.add(fwdVec);
    if (input.backward) accDir.sub(fwdVec);

    // Gradual acceleration ramp
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
            // Aerial flip
            carState.canFlip = false;
            carState.isFlipping = true;
            carState.flipTimer = C.F_DUR;
            carState.flipHit = true;
            const ff = fwd(carState.rot);
            const rr = new THREE.Vector3(Math.cos(carState.rot), 0, -Math.sin(carState.rot));
            let flipImpulse = { x: 0, y: C.J_VEL * C.C_MASS * 0.3, z: 0 };
            if (input.forward) flipImpulse = { x: ff.x * C.F_VEL * C.C_MASS, y: C.F_VEL * C.C_MASS * 0.35, z: ff.z * C.F_VEL * C.C_MASS };
            else if (input.backward) flipImpulse = { x: -ff.x * C.F_VEL * C.C_MASS, y: C.F_VEL * C.C_MASS * 0.35, z: -ff.z * C.F_VEL * C.C_MASS };
            body.applyImpulse(flipImpulse, true);
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
        if (carState.flipTimer <= 0) {
            carState.isFlipping = false;
            carState.flipHit = false;
        }
    }

    // Speed cap
    const vel = body.linvel();
    const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (hSpeed > C.C_MAX) {
        const s = C.C_MAX / hSpeed;
        body.setLinvel({ x: vel.x * s, y: vel.y, z: vel.z * s }, true);
    }

    // Friction (damping)
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
    // Player scores in back goal (z < -AL/2)
    if (p.z < -C.AL / 2 - 1 && Math.abs(p.x) < C.GW / 2 && p.y < C.GH) {
        pScore.v++;
        goalCD.v = C.GOAL_CD;
        return true;
    }
    // AI scores in front goal (z > +AL/2)
    if (p.z > C.AL / 2 + 1 && Math.abs(p.x) < C.GW / 2 && p.y < C.GH) {
        aScore.v++;
        goalCD.v = C.GOAL_CD;
        return true;
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

    // Reset state objects
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
