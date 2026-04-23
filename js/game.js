import * as THREE from 'three';
import * as CONST from './constants.js';
import {
    initPhysics,
    applyCarInput,
    stepWorld,
    syncBodyToState,
    checkGoals,
    resetAll,
    getOnGround
} from './rapier-physics.js';
import { getPlayerInput } from './input.js';
import { setAIRefs, getAIInput } from './ai.js';
import {
    scene, camera, renderer, sun,
    makeVoxelMesh, buildCar, buildBall,
    createArena, createScenery, createGoalIndicators,
    updateCarMesh, updateBallMesh, updateCamera, initCameraPosition,
    updateBallArrow
} from './renderer.js';

/* ===== FIXED TIMESTEP ===== */
class FixedTimestep {
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

/* ===== GAME STATE ===== */
export const player = {
    pos: new THREE.Vector3(0, CONST.CHY, 30),
    vel: new THREE.Vector3(),
    rot: Math.PI,
    onGround: true, canFlip: false, isFlipping: false,
    flipTimer: 0, flipType: '', boost: CONST.B_MAX,
    jumpHeld: false, flipHit: false, accelRamp: 0,
    onWall: false, surfaceNormal: null
};

export const ai = {
    pos: new THREE.Vector3(0, CONST.CHY, -30),
    vel: new THREE.Vector3(),
    rot: 0,
    onGround: true, canFlip: false, isFlipping: false,
    flipTimer: 0, flipType: '', boost: CONST.B_MAX,
    jumpHeld: false, flipHit: false, accelRamp: 0,
    onWall: false, surfaceNormal: null
};

export const ball = {
    pos: new THREE.Vector3(0, CONST.BR, 0),
    vel: new THREE.Vector3(),
    angVel: new THREE.Vector3()
};

export const pScore = { v: 0 };
export const aScore = { v: 0 };
export let goalCD = { v: 0 };

let lastTime = 0;
const fixedStep = new FixedTimestep(1/60, 5);

/* ===== MESHES ===== */
let pCarMesh, aCarMesh, ballMesh;
let pShadow, aShadow, bShadow;
let goalArrows = [];

/* ===== PHYSICS REFS ===== */
let world, playerBody, aiBody, ballBody, playerCol, aiCol, ballCol;

/* ===== HUD ===== */
const boostFill = document.getElementById('boost-fill');
const pScoreEl  = document.getElementById('p-score');
const aScoreEl  = document.getElementById('a-score');
const goalOvEl  = document.getElementById('goal-overlay');

function updateHUD() {
    boostFill.style.width = (player.boost / CONST.B_MAX * 100) + '%';
    pScoreEl.textContent = pScore.v;
    aScoreEl.textContent = aScore.v;
}

function showGoal() {
    goalOvEl.style.display = 'block';
    resetAll(playerBody, aiBody, ballBody, player, ai, ball);
}

/* ===== INIT ===== */
export async function initGame() {
    createArena();
    createScenery();
    goalArrows = createGoalIndicators();

    pCarMesh = makeVoxelMesh(buildCar({r: 0.45, g: 0.73, b: 1}, {r: 0.35, g: 0.6, b: 0.9}));
    scene.add(pCarMesh);
    aCarMesh = makeVoxelMesh(buildCar({r: 1, g: 0.42, b: 0.42}, {r: 0.88, g: 0.33, b: 0.33}));
    scene.add(aCarMesh);
    ballMesh = makeVoxelMesh(buildBall());
    scene.add(ballMesh);

    /* shadows */
    const shGeo = new THREE.CircleGeometry(1.8, 16);
    const shMat = new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false});
    pShadow = new THREE.Mesh(shGeo, shMat); pShadow.rotation.x = -Math.PI/2; scene.add(pShadow);
    aShadow = new THREE.Mesh(shGeo, shMat); aShadow.rotation.x = -Math.PI/2; scene.add(aShadow);
    bShadow = new THREE.Mesh(shGeo.clone(), shMat); bShadow.rotation.x = -Math.PI/2; scene.add(bShadow);

    /* rapier physics */
    const phy = await initPhysics();
    world = phy.world;
    playerBody = phy.playerBody;
    aiBody = phy.aiBody;
    ballBody = phy.ballBody;
    playerCol = phy.playerCol;
    aiCol = phy.aiCol;
    ballCol = phy.ballCol;

    syncBodyToState(playerBody, player);
    syncBodyToState(aiBody, ai);
    syncBodyToState(ballBody, ball);

    setAIRefs(ball, player);
    initCameraPosition(player);
}

/* ===== MAIN LOOP ===== */
export function gameLoop(time) {
    requestAnimationFrame(gameLoop);
    const rawDt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (rawDt <= 0) return;

    /* goal cooldown */
    if (goalCD.v > 0) {
        goalCD.v -= rawDt;
        if (goalCD.v <= 0) goalOvEl.style.display = 'none';
    }

    /* fixed timestep physics */
    fixedStep.update(rawDt, (dt) => {
        applyCarInput(playerBody, playerCol, getPlayerInput(dt), dt, player, world);

        ai.onGround = getOnGround(aiBody, aiCol, world);
        const aiInput = getAIInput(ai, world);
        applyCarInput(aiBody, aiCol, aiInput, dt, ai, world);

        stepWorld(world, dt);

        syncBodyToState(playerBody, player);
        syncBodyToState(aiBody, ai);
        syncBodyToState(ballBody, ball);

        player.onGround = getOnGround(playerBody, playerCol, world);
        ai.onGround = getOnGround(aiBody, aiCol, world);

        if (checkGoals(ballBody, pScore, aScore, goalCD)) showGoal();
    });

    /* meshes */
    updateCarMesh(player, pCarMesh);
    updateCarMesh(ai, aCarMesh);
    updateBallMesh(ballMesh, ball);

    /* shadows */
    pShadow.position.set(player.pos.x, 0.02, player.pos.z);
    aShadow.position.set(ai.pos.x, 0.02, ai.pos.z);
    bShadow.position.set(ball.pos.x, 0.02, ball.pos.z);
    const ps = Math.max(0.3, 1 - (player.pos.y - CONST.CHY) / 15);
    pShadow.scale.setScalar(ps);
    const as = Math.max(0.3, 1 - (ai.pos.y - CONST.CHY) / 15);
    aShadow.scale.setScalar(as);
    const bs = Math.max(0.3, 1 - (ball.pos.y - CONST.BR) / 15);
    bShadow.scale.setScalar(bs * 1.2);

    /* pulse goal arrows */
    const t = time / 1000;
    goalArrows.forEach((arrow, i) => {
        const s = 1 + Math.sin(t * 3 + i * 0.8) * 0.15;
        arrow.scale.set(1, 1, s);
    });

    /* camera, HUD, ball arrow */
    updateCamera(player, ball, rawDt);
    updateHUD();
    updateBallArrow(ball.pos);

    renderer.render(scene, camera);
}
