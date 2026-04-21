import * as THREE from 'three';
import * as CONST from './constants.js';

/* ===== FIXED TIMESTEP ===== */
export class FixedTimestep {
    constructor(step = 1/60, maxSteps = 5) {
        this.step = step;
        this.maxSteps = maxSteps;
        this.accumulator = 0;
    }
    update(dt, callback) {
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= this.step && steps < this.maxSteps) {
            callback(this.step);
            this.accumulator -= this.step;
            steps++;
        }
        return steps;
    }
}

/* ===== GLOBAL STATE (injected from game.js) ===== */
let _player, _ai, _ball, _pScore, _aScore, _goalCD;

export function setPhysicsState(player, ai, ball, pScoreRef, aScoreRef, goalCDRef) {
    _player = player;
    _ai = ai;
    _ball = ball;
    _pScore = pScoreRef;
    _aScore = aScoreRef;
    _goalCD = goalCDRef;
}

/* ===== HELPERS ===== */
export function fwd(rot) {
    return new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
}

function fwdOnWall(rot, normal) {
    const base = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
    base.sub(normal.clone().multiplyScalar(base.dot(normal))).normalize();
    return base;
}

/* per-second friction rates for timestep independence */
const C_GFRI_PER_SEC = Math.log(CONST.C_GFRI) / Math.log(1/60);
const C_AFRI_PER_SEC = Math.log(CONST.C_AFRI) / Math.log(1/60);
const BA_FRI_PER_SEC = Math.log(CONST.BA_FRI) / Math.log(1/60);
const BG_FRI_PER_SEC = Math.log(CONST.BG_FRI) / Math.log(1/60);

function getWallNormal(pos) {
    const margin = CONST.CHX + 0.8;
    if (pos.x > CONST.AW/2 - margin)  return new THREE.Vector3(-1, 0, 0);
    if (pos.x < -CONST.AW/2 + margin) return new THREE.Vector3( 1, 0, 0);
    if (pos.z > CONST.AL/2 - margin)  return new THREE.Vector3( 0, 0,-1);
    if (pos.z < -CONST.AL/2 + margin) return new THREE.Vector3( 0, 0, 1);
    return null;
}

/* ===== CAR PHYSICS ===== */
export function updateCar(c, input, dt) {
    const f = fwd(c.rot);
    const right = new THREE.Vector3(Math.cos(c.rot), 0, -Math.sin(c.rot));

    /* steering */
    const steer = (input.steerAnalog !== undefined) ? input.steerAnalog
                  : (input.left ? 1 : input.right ? -1 : 0);

    const speed = Math.sqrt(c.vel.x*c.vel.x + c.vel.z*c.vel.z);
    const fwdSpeed = c.vel.dot(f);

    let effectiveSteer = steer;
    /* reverse steering flip */
    if (fwdSpeed < -0.5) effectiveSteer *= -1;
    /* speed-sensitive steering */
    const turnFactor = Math.max(0.35, 1.0 - speed / (CONST.C_MAX * 0.55));
    c.rot += effectiveSteer * CONST.C_TURN * turnFactor * dt;

    /* acceleration direction */
    const accDir = new THREE.Vector3();
    if (input.forward)  accDir.add(f);
    if (input.backward) accDir.sub(f);

    /* gradual acceleration ramp */
    if (accDir.lengthSq() > 0) {
        c.accelRamp = Math.min(1, c.accelRamp + dt / CONST.ACCEL_RAMP_T);
    } else {
        c.accelRamp = Math.max(0, c.accelRamp - dt / (CONST.ACCEL_RAMP_T * 0.5));
    }

    let accMag = CONST.C_ACC * c.accelRamp;
    if (input.boost && c.boost > 0 && input.forward) {
        accMag = CONST.B_ACC * c.accelRamp;
        c.boost = Math.max(0, c.boost - CONST.B_DRAIN);
    } else {
        c.boost = Math.min(CONST.B_MAX, c.boost + CONST.B_REGEN);
    }

    if (accDir.lengthSq() > 0) {
        accDir.normalize().multiplyScalar(accMag * dt);
        c.vel.add(accDir);
    }

    /* wall detection */
    const wallNormal = getWallNormal(c.pos);
    const onWall = wallNormal !== null && c.pos.y > 2.5;
    c.onWall = onWall;
    if (onWall) c.surfaceNormal = wallNormal;

    /* gravity / wall gravity */
    if (onWall) {
        c.vel.addScaledVector(wallNormal, CONST.GRAV * 0.35 * dt);
    } else {
        c.vel.y += CONST.GRAV * dt;
    }

    /* friction — timestep independent */
    const fricExp = Math.exp((c.onGround ? C_GFRI_PER_SEC : C_AFRI_PER_SEC) * dt);
    c.vel.x *= fricExp;
    c.vel.z *= fricExp;

    /* clamp horizontal speed AFTER all velocity changes */
    const hSpeed = Math.sqrt(c.vel.x*c.vel.x + c.vel.z*c.vel.z);
    if (hSpeed > CONST.C_MAX) {
        const s = CONST.C_MAX / hSpeed;
        c.vel.x *= s; c.vel.z *= s;
    }

    /* jump / flip */
    if (input.jump) {
        if (c.onGround && !c.jumpHeld) {
            c.vel.y = CONST.J_VEL;
            c.onGround = false;
            c.canFlip = true;
            c.jumpHeld = true;
        } else if (c.canFlip && !c.jumpHeld) {
            c.canFlip = false;
            c.isFlipping = true;
            c.flipTimer = CONST.F_DUR;
            c.flipHit = true;

            const ff = fwd(c.rot);
            const rr = new THREE.Vector3(Math.cos(c.rot), 0, -Math.sin(c.rot));
            if (input.forward)       { c.flipType = 'front'; c.vel.addScaledVector(ff,  CONST.F_VEL); c.vel.y += CONST.F_VEL * 0.35; }
            else if (input.backward) { c.flipType = 'back';  c.vel.addScaledVector(ff, -CONST.F_VEL); c.vel.y += CONST.F_VEL * 0.35; }
            else if (input.left)     { c.flipType = 'left';  c.vel.addScaledVector(rr,  CONST.F_VEL); c.vel.y += CONST.F_VEL * 0.35; }
            else if (input.right)    { c.flipType = 'right'; c.vel.addScaledVector(rr, -CONST.F_VEL); c.vel.y += CONST.F_VEL * 0.35; }
            else                     { c.flipType = 'up';    c.vel.y += CONST.J_VEL * 0.8; }
            c.jumpHeld = true;
        } else if (c.onWall && !c.jumpHeld) {
            /* jump off wall */
            const n = c.surfaceNormal || new THREE.Vector3(0, 1, 0);
            c.vel.addScaledVector(n, CONST.J_VEL * 1.2);
            c.onWall = false;
            c.jumpHeld = true;
        }
    } else {
        if (c.jumpHeld && !c.onGround && !c.onWall && c.vel.y > 0 && c.canFlip) {
            c.vel.y *= CONST.J_CUT;
        }
        c.jumpHeld = false;
    }

    /* flip timer */
    if (c.flipTimer > 0) {
        c.flipTimer -= dt;
        if (c.flipTimer <= 0) { c.isFlipping = false; c.flipHit = false; }
    }

    /* integrate */
    c.pos.addScaledVector(c.vel, dt);

    /* ground / wall collision */
    const cr = Math.max(CONST.CHX, CONST.CHZ);

    if (c.pos.y - CONST.CHY < 0) {
        const wasAir = !c.onGround;
        c.pos.y = CONST.CHY;
        c.vel.y = 0;
        c.onGround = true;
        c.canFlip = false;
        c.isFlipping = false;
        c.flipHit = false;
        if (wasAir) c.accelRamp = 0;
    }

    /* walls — bounce only if not wall-riding */
    if (!c.onWall) {
        if (c.pos.x - cr < -CONST.AW/2) { c.pos.x = -CONST.AW/2 + cr; c.vel.x *= -0.3; }
        if (c.pos.x + cr >  CONST.AW/2) { c.pos.x =  CONST.AW/2 - cr; c.vel.x *= -0.3; }
        if (c.pos.y + CONST.CHY > CONST.AH) { c.pos.y = CONST.AH - CONST.CHY; c.vel.y *= -0.3; }
        if (c.pos.z - cr < -CONST.AL/2) { c.pos.z = -CONST.AL/2 + cr; c.vel.z *= -0.3; }
        if (c.pos.z + cr >  CONST.AL/2) { c.pos.z =  CONST.AL/2 - cr; c.vel.z *= -0.3; }
    } else {
        /* soft wall clamp while wall-riding */
        if (c.pos.x < -CONST.AW/2 + cr) { c.pos.x = -CONST.AW/2 + cr; }
        if (c.pos.x >  CONST.AW/2 - cr) { c.pos.x =  CONST.AW/2 - cr; }
        if (c.pos.z < -CONST.AL/2 + cr) { c.pos.z = -CONST.AL/2 + cr; }
        if (c.pos.z >  CONST.AL/2 - cr) { c.pos.z =  CONST.AL/2 - cr; }
        if (c.pos.y + CONST.CHY > CONST.AH) { c.pos.y = CONST.AH - CONST.CHY; c.vel.y *= -0.3; }
    }
}

/* ===== BALL PHYSICS ===== */
export function updateBallPhysics(dt) {
    const r = CONST.BR;

    /* gravity */
    _ball.vel.y += CONST.GRAV * dt;

    /* air friction */
    const baFric = Math.exp(BA_FRI_PER_SEC * dt);
    _ball.vel.x *= baFric;
    _ball.vel.y *= baFric;
    _ball.vel.z *= baFric;

    _ball.pos.addScaledVector(_ball.vel, dt);

    /* ground */
    if (_ball.pos.y - r < 0) {
        _ball.pos.y = r;
        _ball.vel.y = -_ball.vel.y * CONST.B_REST;
        const bgFric = Math.exp(BG_FRI_PER_SEC * dt);
        _ball.vel.x *= bgFric;
        _ball.vel.z *= bgFric;
        if (Math.abs(_ball.vel.y) < 0.3) _ball.vel.y = 0;
        const hSpd = Math.sqrt(_ball.vel.x**2 + _ball.vel.z**2);
        if (hSpd < 0.15) { _ball.vel.x = 0; _ball.vel.z = 0; }
    }

    /* ceiling */
    if (_ball.pos.y + r > CONST.AH) {
        _ball.pos.y = CONST.AH - r;
        _ball.vel.y = -_ball.vel.y * CONST.W_REST;
        if (Math.abs(_ball.vel.y) < 0.3) _ball.vel.y = 0;
    }

    /* side walls with curved ramp */
    sideWallBall(-1); // left
    sideWallBall( 1); // right

    /* end walls with goal openings */
    endWallBall(-1);
    endWallBall( 1);

    /* angular velocity for visual rolling */
    _ball.angVel.set(-_ball.vel.z / r, 0, _ball.vel.x / r);
}

function sideWallBall(xSign) {
    const r = CONST.BR;
    const R = CONST.RAMP_RADIUS;
    const wallX = xSign * CONST.AW / 2;
    const cx = wallX - xSign * R;   // cylinder center x
    const cy = R;                   // cylinder center y

    /* only check near ramp region */
    if (_ball.pos.y > R * 2.5) {
        /* flat wall collision high up */
        if (xSign < 0 && _ball.pos.x - r < wallX) {
            _ball.pos.x = wallX + r;
            _ball.vel.x = -_ball.vel.x * CONST.W_REST;
        }
        if (xSign > 0 && _ball.pos.x + r > wallX) {
            _ball.pos.x = wallX - r;
            _ball.vel.x = -_ball.vel.x * CONST.W_REST;
        }
        return;
    }

    /* curved ramp collision */
    const dx = _ball.pos.x - cx;
    const dy = _ball.pos.y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const target = R - r;
    if (dist < target && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        _ball.pos.x = cx + nx * target;
        _ball.pos.y = cy + ny * target;
        const vDotN = _ball.vel.x * nx + _ball.vel.y * ny;
        if (vDotN < 0) {
            _ball.vel.x -= (1 + CONST.W_REST) * vDotN * nx;
            _ball.vel.y -= (1 + CONST.W_REST) * vDotN * ny;
        }
    }
}

function endWallBall(zSign) {
    const r = CONST.BR;
    const R = CONST.RAMP_RADIUS;
    const wallZ = zSign * CONST.AL / 2;
    const cz = wallZ - zSign * R;
    const cy = R;

    /* goal opening check */
    const inGoalX = Math.abs(_ball.pos.x) < CONST.GW/2;
    const inGoalY = _ball.pos.y < CONST.GH;

    if (_ball.pos.y > R * 2.5) {
        /* flat wall high up */
        const pastLine = zSign < 0 ? _ball.pos.z - r < wallZ : _ball.pos.z + r > wallZ;
        if (pastLine && (!inGoalX || !inGoalY)) {
            if (zSign < 0) { _ball.pos.z = wallZ + r; _ball.vel.z = -_ball.vel.z * CONST.W_REST; }
            else           { _ball.pos.z = wallZ - r; _ball.vel.z = -_ball.vel.z * CONST.W_REST; }
        }
        return;
    }

    /* curved ramp */
    const dz = _ball.pos.z - cz;
    const dy = _ball.pos.y - cy;
    const dist = Math.sqrt(dz*dz + dy*dy);
    const target = R - r;
    if (dist < target && dist > 0.001) {
        /* if inside goal opening, let it through unless hitting goal box */
        if (inGoalX && inGoalY) {
            goalBoxCollision(zSign);
            return;
        }
        const nz = dz / dist;
        const ny = dy / dist;
        _ball.pos.z = cz + nz * target;
        _ball.pos.y = cy + ny * target;
        const vDotN = _ball.vel.z * nz + _ball.vel.y * ny;
        if (vDotN < 0) {
            _ball.vel.z -= (1 + CONST.W_REST) * vDotN * nz;
            _ball.vel.y -= (1 + CONST.W_REST) * vDotN * ny;
        }
    }
}

function goalBoxCollision(zSign) {
    const r = CONST.BR;
    const goalZ = zSign < 0 ? -CONST.AL/2 - CONST.GD : CONST.AL/2 + CONST.GD;
    const gz = zSign < 0 ? -CONST.AL/2 - CONST.GD/2 : CONST.AL/2 + CONST.GD/2;
    const wt = 0.8;

    if (zSign < 0 && _ball.pos.z - r < goalZ) { _ball.pos.z = goalZ + r; _ball.vel.z = -_ball.vel.z * CONST.W_REST; }
    if (zSign > 0 && _ball.pos.z + r > goalZ) { _ball.pos.z = goalZ - r; _ball.vel.z = -_ball.vel.z * CONST.W_REST; }
    if (_ball.pos.x - r < -CONST.GW/2) { _ball.pos.x = -CONST.GW/2 + r; _ball.vel.x = -_ball.vel.x * CONST.W_REST; }
    if (_ball.pos.x + r >  CONST.GW/2) { _ball.pos.x =  CONST.GW/2 - r; _ball.vel.x = -_ball.vel.x * CONST.W_REST; }
    if (_ball.pos.y + r > CONST.GH)    { _ball.pos.y = CONST.GH - r;    _ball.vel.y = -_ball.vel.y * CONST.W_REST; }
}

/* ===== CAR-BALL COLLISION ===== */
export function carBallCollision(car, carMesh) {
    const local = _ball.pos.clone().sub(car.pos);
    const cosR = Math.cos(-car.rot), sinR = Math.sin(-car.rot);
    const lx = local.x * cosR - local.z * sinR;
    const lz = local.x * sinR + local.z * cosR;
    const ly = local.y;

    const cx = Math.max(-CONST.CHX, Math.min(CONST.CHX, lx));
    const cy = Math.max(-CONST.CHY, Math.min(CONST.CHY, ly));
    const cz = Math.max(-CONST.CHZ, Math.min(CONST.CHZ, lz));

    const dx = lx - cx, dy = ly - cy, dz = lz - cz;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    if (dist < CONST.BR && dist > 0.001) {
        let nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const cosR2 = Math.cos(car.rot), sinR2 = Math.sin(car.rot);
        const wnx = nx * cosR2 - nz * sinR2;
        const wnz = nx * sinR2 + nz * cosR2;
        const wny = ny;
        const normal = new THREE.Vector3(wnx, wny, wnz);

        const overlap = CONST.BR - dist;
        _ball.pos.addScaledVector(normal, overlap * 1.05);

        const relVel = car.vel.clone().sub(_ball.vel);
        const velAlong = relVel.dot(normal);
        if (velAlong <= 0) return;

        const e = 0.85;
        const j = -(1 + e) * velAlong / (1/CONST.C_MASS + 1/CONST.BL_MASS);
        let impulse = -j;
        if (car.flipHit) impulse *= CONST.F_MULT;

        _ball.vel.addScaledVector(normal, impulse / CONST.BL_MASS);
        car.vel.addScaledVector(normal, -impulse / CONST.C_MASS);
    }
}

/* ===== CAR-CAR COLLISION ===== */
export function carCarCollision() {
    const dist = _player.pos.distanceTo(_ai.pos);
    const minD = 3.6;
    if (dist < minD && dist > 0.01) {
        const n = _ai.pos.clone().sub(_player.pos).normalize();
        const overlap = minD - dist;
        _player.pos.addScaledVector(n, -overlap / 2);
        _ai.pos.addScaledVector(n, overlap / 2);
        const relVel = _player.vel.clone().sub(_ai.vel);
        const va = relVel.dot(n);
        if (va > 0) {
            _player.vel.addScaledVector(n, -va * 0.5);
            _ai.vel.addScaledVector(n, va * 0.5);
        }
    }
}

/* ===== GOALS ===== */
export function checkGoals() {
    if (_goalCD.v > 0) return;
    if (_ball.pos.z < -CONST.AL/2 - 1 && Math.abs(_ball.pos.x) < CONST.GW/2 && _ball.pos.y < CONST.GH) {
        _pScore.v++; _goalCD.v = CONST.GOAL_CD;
        return true;
    }
    if (_ball.pos.z > CONST.AL/2 + 1 && Math.abs(_ball.pos.x) < CONST.GW/2 && _ball.pos.y < CONST.GH) {
        _aScore.v++; _goalCD.v = CONST.GOAL_CD;
        return true;
    }
    return false;
}

export function resetPositions() {
    _ball.pos.set(0, CONST.BR, 0); _ball.vel.set(0, 0, 0); _ball.angVel.set(0, 0, 0);
    _player.pos.set(0, CONST.CHY, 30); _player.vel.set(0, 0, 0); _player.rot = Math.PI;
    _player.onGround = true; _player.canFlip = false; _player.isFlipping = false; _player.flipHit = false; _player.accelRamp = 0; _player.onWall = false;
    _ai.pos.set(0, CONST.CHY, -30); _ai.vel.set(0, 0, 0); _ai.rot = 0;
    _ai.onGround = true; _ai.canFlip = false; _ai.isFlipping = false; _ai.flipHit = false; _ai.accelRamp = 0; _ai.onWall = false;
}
