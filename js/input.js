/* ===== KEYBOARD ===== */
export const keys = {};

window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

/* ===== TOUCH ===== */
export const touchState = {
    forward: false, backward: false, left: false, right: false,
    jump: false, boost: false, joyX: 0, joyY: 0
};

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

if (isTouchDevice) {
    document.getElementById('touch-controls').classList.add('active');
    document.getElementById('hint').style.display = 'none';
    document.getElementById('boost-wrap').style.bottom = '230px';

    /* action buttons */
    const actionBtnMap = { 'btn-jump': 'jump', 'btn-boost': 'boost' };
    for (const [id, key] of Object.entries(actionBtnMap)) {
        const el = document.getElementById(id);
        el.addEventListener('touchstart', e => {
            e.preventDefault();
            touchState[key] = true;
            el.classList.add('pressed');
        }, { passive: false });
        el.addEventListener('touchend', e => {
            e.preventDefault();
            touchState[key] = false;
            el.classList.remove('pressed');
        }, { passive: false });
        el.addEventListener('touchcancel', e => {
            touchState[key] = false;
            el.classList.remove('pressed');
        });
    }

    /* virtual joystick */
    const joystickZone = document.getElementById('joystick-zone');
    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    let joyTouchId = null;
    let joyCenter = { x: 0, y: 0 };
    const JOY_MAX_R = 55;
    const JOY_DEAD = 10;

    joystickZone.addEventListener('touchstart', e => {
        e.preventDefault();
        if (joyTouchId !== null) return;
        const t = e.changedTouches[0];
        joyTouchId = t.identifier;
        joyCenter = { x: t.clientX, y: t.clientY };
        joystickBase.style.display = 'block';
        joystickBase.style.left = (joyCenter.x - 70) + 'px';
        joystickBase.style.top  = (joyCenter.y - 70) + 'px';
        joystickKnob.style.left = '50%';
        joystickKnob.style.top  = '50%';
    }, { passive: false });

    document.addEventListener('touchmove', e => {
        if (joyTouchId === null) return;
        let joyTouch = null;
        for (const t of e.changedTouches) {
            if (t.identifier === joyTouchId) { joyTouch = t; break; }
        }
        if (!joyTouch) return;
        e.preventDefault();

        let dx = joyTouch.clientX - joyCenter.x;
        let dy = joyTouch.clientY - joyCenter.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > JOY_MAX_R) {
            dx = dx / dist * JOY_MAX_R;
            dy = dy / dist * JOY_MAX_R;
        }
        joystickKnob.style.left = `calc(50% + ${dx}px)`;
        joystickKnob.style.top  = `calc(50% + ${dy}px)`;

        const normX = dx / JOY_MAX_R;
        const normY = dy / JOY_MAX_R;
        touchState.joyX = normX;
        touchState.joyY = normY;
        touchState.left     = normX < -0.15;
        touchState.right    = normX >  0.15;
        touchState.forward  = normY < -0.15;
        touchState.backward = normY >  0.15;
    }, { passive: false });

    function resetJoystick() {
        joyTouchId = null;
        joystickBase.style.display = 'none';
        joystickKnob.style.left = '50%';
        joystickKnob.style.top  = '50%';
        touchState.forward  = false;
        touchState.backward = false;
        touchState.left     = false;
        touchState.right    = false;
        touchState.joyX = 0;
        touchState.joyY = 0;
    }

    document.addEventListener('touchend', e => {
        if (joyTouchId === null) return;
        for (const t of e.changedTouches) {
            if (t.identifier === joyTouchId) { resetJoystick(); return; }
        }
    });
    document.addEventListener('touchcancel', e => {
        if (joyTouchId === null) return;
        for (const t of e.changedTouches) {
            if (t.identifier === joyTouchId) { resetJoystick(); return; }
        }
    });
}

/* ===== PLAYER INPUT ===== */
export function getPlayerInput() {
    const kbLeft  = keys['KeyA'] || keys['ArrowLeft'];
    const kbRight = keys['KeyD'] || keys['ArrowRight'];
    const kbUp    = keys['KeyW'] || keys['ArrowUp'];
    const kbDown  = keys['KeyS'] || keys['ArrowDown'];

    let steerAnalog = 0;
    const joyActive = touchState.left || touchState.right;
    const kbActive  = kbLeft || kbRight;

    if (joyActive && !kbActive) {
        steerAnalog = -touchState.joyX;
    } else if (kbActive) {
        if (kbLeft)  steerAnalog = 1;
        if (kbRight) steerAnalog = -1;
    }

    return {
        forward:  kbUp    || touchState.forward,
        backward: kbDown  || touchState.backward,
        left:     kbLeft  || touchState.left,
        right:    kbRight || touchState.right,
        steerAnalog,
        jump:     keys['Space'] || touchState.jump,
        boost:    keys['ShiftLeft'] || keys['ShiftRight'] || touchState.boost
    };
}
