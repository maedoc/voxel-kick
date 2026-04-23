import * as THREE from 'three';
import * as CONST from './constants.js';

let _ball, _player;

export function setAIRefs(ball, player) {
    _ball = ball;
    _player = player;
}

/**
 * Get AI input for the given AI car.
 * @param {Object} ai - The AI car state object (must contain pos, rot, onGround, canFlip, boost, etc.)
 * @param {any} world - Rapier world (currently unused but kept for future extensions)
 * @returns {Object} input object compatible with applyCarInput
 */
export function getAIInput(ai, world) {
    const inp = { forward: false, backward: false, left: false, right: false, jump: false, boost: false };

    const toBall = _ball.pos.clone().sub(ai.pos);
    toBall.y = 0;
    const distBall = toBall.length();

    const goalZ = CONST.AL / 2;
    const ballToGoal = new THREE.Vector3(0, 0, goalZ).sub(_ball.pos);
    ballToGoal.y = 0;
    const desired = _ball.pos.clone().add(ballToGoal.normalize().multiplyScalar(-4));
    desired.y = 0;

    const toDesired = desired.clone().sub(ai.pos);
    toDesired.y = 0;
    const angleToDesired = Math.atan2(toDesired.x, toDesired.z);
    let angleDiff = angleToDesired - ai.rot;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (angleDiff > 0.08) inp.left = true;
    else if (angleDiff < -0.08) inp.right = true;

    if (Math.abs(angleDiff) < Math.PI / 2.5) inp.forward = true;
    else if (Math.abs(angleDiff) > Math.PI * 0.6) inp.backward = true;
    else inp.forward = true;

    if (distBall < 22 && Math.abs(angleDiff) < 0.35 && ai.boost > 25) inp.boost = true;

    // Jump only when ball is elevated and within range
    if (distBall < 6 && ai.onGround && _ball.pos.y > 2.5) {
        inp.jump = true;
    }

    // Flip toward ball when in air near ball
    if (!ai.onGround && ai.canFlip && distBall < 8) {
        inp.jump = true;
        const toB = _ball.pos.clone().sub(ai.pos);
        toB.y = 0;
        const aToB = Math.atan2(toB.x, toB.z) - ai.rot;
        if (Math.abs(aToB) < Math.PI / 4) inp.forward = true;
        else if (aToB > 0) inp.left = true;
        else inp.right = true;
    }

    return inp;
}
