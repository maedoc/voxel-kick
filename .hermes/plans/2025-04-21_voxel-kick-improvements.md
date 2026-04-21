# Voxel Kick Improvements — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix physics bugs, refactor the single-file architecture, and add four gameplay improvements: better steering, ball off-screen indicator, rounded walls with wall-driving, and clear goal ownership indicators.

**Architecture:** Split `index.html` into an HTML shell + ES6 modules (`js/`). Keep zero-build GitHub Pages deploy. Use a fixed-timestep physics accumulator. Curved walls are cylindrical segments; wall-riding rotates gravity/reorientation.

**Tech Stack:** Vanilla JS, Three.js 0.160.0 via CDN importmap, GitHub Pages.

---

## Phase 0: Refactor — Split Monolith into Modules

### Task 0.1: Create `js/constants.js`

**Objective:** Extract all game constants into a single export block.

**Files:**
- Create: `js/constants.js`
- Modify: `index.html` (remove constants block, add module import)

**Details:**
Move lines 136-170 from `index.html` into `js/constants.js` as named exports. Add `export` keyword to each const.

```js
export const V = 0.3;
export const AW = 108;
// ... etc
```

Update `index.html` to import them:
```html
<script type="module">
import * as THREE from 'three';
import * as CONST from './js/constants.js';
```

**Verification:** Open `index.html` in browser; check console for "CONST is not defined" errors. Game should still run.

**Commit:** `git add js/constants.js index.html && git commit -m "refactor: extract constants to module"`

---

### Task 0.2: Create `js/physics.js` — Extract Physics Functions

**Objective:** Move all physics code into a dedicated module.

**Files:**
- Create: `js/physics.js`
- Modify: `index.html`

**Details:**
Move these functions from `index.html` to `js/physics.js`:
- `fwd(rot)` (line 465)
- `updateCar(c, input, dt)` (line 467-563)
- `updateBallPhysics(dt)` (line 565-590)
- `endWallBall(zSign)` (line 592-619)
- `carBallCollision(car, carMesh)` (line 621-667)
- `carCarCollision()` (line 669-685)
- `checkGoals()` (line 687-698)
- `resetPositions()` (line 705-711)

`physics.js` must import `THREE` and constants. Export all functions.

Add a `FixedTimestep` class:
```js
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
```

Update `index.html` to import from `./js/physics.js` and instantiate `FixedTimestep`.

**Commit:** `git add js/physics.js index.html && git commit -m "refactor: extract physics to module, add fixed timestep"`

---

### Task 0.3: Create `js/input.js` — Extract Input Handling

**Objective:** Move keyboard and touch input into a module.

**Files:**
- Create: `js/input.js`
- Modify: `index.html`

**Details:**
Move from `index.html`:
- `keys` object and keydown/keyup listeners (lines 361-364)
- `touchState` and all touch/joystick code (lines 813-910)
- `getPlayerInput()` (lines 912-928)

Export `keys`, `touchState`, `getPlayerInput()`, and a setup function `initInput()`.

Fix the keyboard/touch merge bug: if both are active, use whichever has non-zero analog. Keyboard should set a flag so joystick isn't silently overridden.

**Commit:** `git add js/input.js index.html && git commit -m "refactor: extract input handling to module"`

---

### Task 0.4: Create `js/ai.js` — Extract AI Logic

**Objective:** Move AI controller into its own module.

**Files:**
- Create: `js/ai.js`
- Modify: `index.html`

**Details:**
Move `getAIInput()` (lines 714-761) to `js/ai.js`. Export it. Import `THREE` and constants.

Fix the random jump spam: replace `Math.random()<0.008` with a deterministic timer or only jump when ball is actually above 2 units and within range.

**Commit:** `git add js/ai.js index.html && git commit -m "refactor: extract AI to module, fix random jump"`

---

### Task 0.5: Create `js/renderer.js` — Extract Mesh & Render Logic

**Objective:** Move Three.js scene setup, mesh creation, and render loop helpers into a module.

**Files:**
- Create: `js/renderer.js`
- Modify: `index.html`

**Details:**
Move from `index.html`:
- `makeVoxelMesh`, `addBox`, `buildCar`, `buildBall` (lines 215-280)
- `createArena` (lines 282-353)
- `createScenery` (lines 369-446)
- `updateCarMesh`, `updateBallMesh` (lines 763-789)
- `updateCamera` (lines 791-810)
- Scene, camera, renderer, lights setup (lines 172-213)

Export an `initRenderer()` function that returns `{ scene, camera, renderer }`.
Export `updateCarMesh`, `updateBallMesh`, `updateCamera`, `createArena`, `createScenery`, `buildCar`, `buildBall`, `makeVoxelMesh`.

**Commit:** `git add js/renderer.js index.html && git commit -m "refactor: extract renderer and scene setup to module"`

---

### Task 0.6: Create `js/game.js` — Main Game Loop & State

**Objective:** Create the main game module that wires everything together.

**Files:**
- Create: `js/game.js`
- Modify: `index.html`

**Details:**
`js/game.js` imports all other modules and exports `initGame()` and `gameLoop()`.

Move game state from `index.html`:
- `player`, `ai`, `ball` objects
- `pScore`, `aScore`, `goalCD`, `lastTime`
- HUD DOM references and `updateHUD()`
- `showGoal()`

`index.html` should be reduced to:
```html
<!DOCTYPE html>
<html>
<head>...</head>
<body>
  <div id="hud">...</div>
  <script type="importmap">...</script>
  <script type="module">
    import { initGame, gameLoop } from './js/game.js';
    initGame();
    requestAnimationFrame(gameLoop);
  </script>
</body>
</html>
```

**Verification:** Game runs identically to before refactoring. No console errors.

**Commit:** `git add js/game.js index.html && git commit -m "refactor: create main game module, slim index.html"`

---

## Phase 1: Physics Fixes

### Task 1.1: Fix Velocity Clamping & Friction Frame-Dependence

**Objective:** Make friction and speed limits timestep-independent and logically ordered.

**Files:**
- Modify: `js/physics.js` — `updateCar()`

**Details:**
Current issues:
1. Horizontal speed clamp happens before gravity/jump, which is wrong — clamp after all velocity changes.
2. Friction is multiplicative per frame: `vel *= 0.945` — at 30fps vs 144fps the car stops differently.

Fixes:
```js
// Convert per-frame friction to per-second for timestep independence
const C_GFRI_PER_SEC = Math.log(CONST.C_GFRI) / Math.log(1/60); // approx -3.1
const C_AFRI_PER_SEC = Math.log(CONST.C_AFRI) / Math.log(1/60);

// In updateCar, after all accelerations/gravity/jump:
const hSpeed = Math.sqrt(c.vel.x**2 + c.vel.z**2);
if (hSpeed > CONST.C_MAX) {
    const scale = CONST.C_MAX / hSpeed;
    c.vel.x *= scale; c.vel.z *= scale;
}

// Friction using exponential decay
const fricExp = Math.exp((c.onGround ? C_GFRI_PER_SEC : C_AFRI_PER_SEC) * dt);
c.vel.x *= fricExp; c.vel.z *= fricExp;
```

Also fix ball friction in `updateBallPhysics()` the same way.

**Commit:** `git add js/physics.js && git commit -m "fix: timestep-independent friction and clamp ordering"`

---

### Task 1.2: Fix Car-Ball Collision Impulse

**Objective:** Correct momentum transfer so car reacts properly to ball hits.

**Files:**
- Modify: `js/physics.js` — `carBallCollision()`

**Details:**
Current code scales impulse by `massRatio` then applies that same impulse to the ball, but the car reaction uses `impulse * BL_MASS / C_MASS` which double-scales.

Fix:
```js
const e = 0.85;
const relVel = car.vel.clone().sub(ball.vel);
const velAlong = relVel.dot(normal);
if (velAlong <= 0) return;

const j = -(1 + e) * velAlong / (1/C_MASS + 1/BL_MASS);
let impulse = j;
if (car.flipHit) impulse *= F_MULT;

ball.vel.addScaledVector(normal, -impulse / BL_MASS);
car.vel.addScaledVector(normal, impulse / C_MASS);
```

Wait — check sign. `relVel = car.vel - ball.vel`. `velAlong` positive means car moving toward ball. We want to push ball away from car (along normal) and car away from ball (opposite normal).

Actually normal points from car to ball. So:
- `ball.vel += impulse * normal / ballMass` (ball gets pushed along normal)
- `car.vel -= impulse * normal / carMass` (car gets pushed opposite)

Verify with a simple test: stationary car, ball moving toward car. Should bounce ball back.

**Commit:** `git add js/physics.js && git commit -m "fix: correct car-ball collision impulse math"`

---

### Task 1.3: Fix Ball Sleep / Oscillation on Ground and Ceiling

**Objective:** Prevent the ball from jittering when energy is low.

**Files:**
- Modify: `js/physics.js` — `updateBallPhysics()`

**Details:**
Add a velocity threshold:
```js
// After ground bounce
if (Math.abs(ball.vel.y) < 0.3) ball.vel.y = 0;
// After ceiling bounce
if (Math.abs(ball.vel.y) < 0.3) ball.vel.y = 0;
// After wall bounce
if (Math.abs(ball.vel.x) < 0.2) ball.vel.x = 0;
if (Math.abs(ball.vel.z) < 0.2) ball.vel.z = 0;
```

Also apply ground friction only if horizontal speed is above a small threshold, otherwise zero horizontal velocity.

**Commit:** `git add js/physics.js && git commit -m "fix: add velocity sleep threshold to stop ball jitter"`

---

## Phase 2: Gameplay Improvements

### Task 2.1: Improve Steering Feel

**Objective:** Make the car less floaty and more responsive to steer.

**Files:**
- Modify: `js/physics.js` — `updateCar()`
- Modify: `js/input.js` — `getPlayerInput()`

**Details:**
Current steering is direct rotation: `rot += steer * C_TURN * dt`. This feels robotic.

Improvements:
1. **Speed-sensitive steering:** tighter turning circle at low speeds, wider at high speeds.
   ```js
   const speed = Math.sqrt(c.vel.x**2 + c.vel.z**2);
   const turnFactor = Math.max(0.4, 1.0 - speed / (CONST.C_MAX * 0.6));
   c.rot += steer * CONST.C_TURN * turnFactor * dt;
   ```
2. **Analog steering smoothing:** joystick input should be smoothed, not instant.
   ```js
   // In input.js
   const targetSteer = // computed from keys/touch
   steerAnalog += (targetSteer - steerAnalog) * 10 * dt;
   ```
3. **Reverse steering flip:** when driving backward, invert steering direction so it feels like a car.
   ```js
   const fwdSpeed = c.vel.dot(f);
   if (fwdSpeed < -0.5) steer *= -1; // flip steering when reversing
   ```

**Commit:** `git add js/physics.js js/input.js && git commit -m "feat: improve steering with speed-sensitive turn and reverse flip"`

---

### Task 2.2: Add Goal Clarity — Colored Goal Labels & Field Arrows

**Objective:** Make it obvious which goal the player should score in.

**Files:**
- Modify: `js/renderer.js` — add `createGoalIndicators()`
- Modify: `index.html` — update scoreboard labels

**Details:**
1. **Scoreboard labels:**
   Change HTML from:
   ```html
   <span class="blue" id="p-score">0</span><span>&nbsp;&ndash;&nbsp;</span><span class="red" id="a-score">0</span>
   ```
   To:
   ```html
   <div style="font-size:16px;letter-spacing:2px;color:rgba(255,255,255,0.5)">SCORE IN RED</div>
   <span class="blue" id="p-score">0</span> ...
   ```

2. **Field arrows:** Add arrow meshes on the floor pointing toward the AI goal (red goal at -Z).
   Use `THREE.ConeGeometry` flattened and rotated to point -Z. Place a row of arrows at z=20, z=10, z=0, z=-10, z=-20.
   Color them red (#ff6b6b), semi-transparent.
   Make them gently pulse (scale oscillation) in the render loop.

3. **Goal frames:** Make the actual goal boxes more distinct — the player goal (AI side, z=-AL/2) should have a red glow, the AI goal (player side, z=+AL/2) should have a blue glow. Actually wait — the player scores in the AI's goal at z=-AL/2. So the target goal is at -Z. Make that goal have a red rim light. The player's own goal at +Z should have a blue rim light.

   Add a `PointLight` inside each goal with the team color.

**Commit:** `git add js/renderer.js index.html && git commit -m "feat: add goal clarity with labels, field arrows, and goal lights"`

---

### Task 2.3: Add Ball Off-Screen Indicator

**Objective:** Show an arrow at the screen edge pointing to the ball when it's off-camera.

**Files:**
- Create: `js/ui.js` (or add to `js/renderer.js`)
- Modify: `js/game.js` — call in render loop

**Details:**
Add a DOM-based indicator (simpler than canvas projection).

In HTML, add:
```html
<div id="ball-arrow" style="display:none;position:absolute;width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:20px solid #ffeaa7;pointer-events:none;z-index:20;transform-origin:center center;"></div>
```

In JS, each frame:
```js
function updateBallArrow(camera, ballPos) {
    const arrow = document.getElementById('ball-arrow');
    const pos = ballPos.clone().project(camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;

    const margin = 40;
    const offLeft = x < margin;
    const offRight = x > window.innerWidth - margin;
    const offTop = y < margin;
    const offBottom = y > window.innerHeight - margin;

    if (!offLeft && !offRight && !offTop && !offBottom) {
        arrow.style.display = 'none';
        return;
    }

    arrow.style.display = 'block';
    // Clamp to screen edge with margin
    const cx = Math.max(margin, Math.min(window.innerWidth - margin, x));
    const cy = Math.max(margin, Math.min(window.innerHeight - margin, y));
    arrow.style.left = cx + 'px';
    arrow.style.top = cy + 'px';

    // Compute angle toward ball from screen center
    const dx = x - window.innerWidth / 2;
    const dy = y - window.innerHeight / 2;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    arrow.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
}
```

Call this in the main loop after camera update.

**Commit:** `git add js/ui.js index.html js/game.js && git commit -m "feat: add off-screen ball indicator arrow"`

---

## Phase 3: Rounded Walls & Wall Driving

### Task 3.1: Replace Sharp Walls with Curved Stadium Geometry

**Objective:** Build a Rocket League-style stadium with curved corners and quarter-pipe wall transitions.

**Files:**
- Modify: `js/renderer.js` — rewrite `createArena()`

**Details:**
Replace the boxy `BoxGeometry` walls with:
1. **Floor:** Keep as is (green plane).
2. **Side walls:** Vertical planes with a curved transition at the bottom.
   - Use `THREE.CylinderGeometry(radius, radius, length, 32, 1, true, startAngle, endAngle)` for the quarter-pipe corners.
   - For straight wall sections: a vertical plane.
   - The transition from floor to wall is a quarter-cylinder of radius ~4 units at the base of each wall.
3. **End walls with goals:** Same treatment — curved bottom transition.
4. **Ceiling:** Keep as flat box.

Simplified approach for this scope:
- The arena is a rectangle with rounded corners.
- Build the wall as a `Shape` extruded or as a `TubeGeometry` following a rectangular path with rounded corners.
- Actually, simplest: keep vertical walls but add a **curved ramp** at the bottom (a quarter-cylinder mesh) that smoothly connects floor to wall. This lets the car drive up.

Implementation:
```js
function createRoundedWall(x, z, w, d, height, radius, material) {
    // Vertical wall
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material);
    wall.position.set(x, height/2, z);
    scene.add(wall);
    // Quarter-pipe at base
    const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, 16, 1, true, 0, Math.PI/2),
        material
    );
    // Position and rotate pipe so flat side is against wall, curved side faces inward
    // ... careful positioning
}
```

Actually, to save time and complexity, use a simpler but effective approach:
- Create the floor as before.
- Create walls as before (vertical boxes).
- BUT at the junction of floor and each wall, add a **curved ramp** (cylinder segment) of radius 3 that lets the car transition smoothly from floor to wall.
- The car doesn't need to reorient fully to drive on the wall for this to feel good — just being able to ride up the curve and jump off is the goal.

Let's call this the **"ramp + wall ride"** approach:
1. Add quarter-cylinder ramps at the base of all walls (radius = 4).
2. These ramps are `Mesh` objects with collision handled in physics.
3. When car is on a ramp or wall, switch physics mode.

For geometry, create a `CylinderGeometry` with `thetaLength = Math.PI / 2` and open ends. Rotate it so the flat face is against the wall and the curved face faces the arena interior, with the bottom edge flush with the floor.

Do this for:
- 4 side walls (2 long, 2 short above goal gaps)
- Top sections above goals
- Goal box back/sides/top remain as before (they're inside the arena, not rideable)

**Commit:** `git add js/renderer.js && git commit -m "feat: add curved wall ramps for wall driving"`

---

### Task 3.2: Implement Wall-Riding Physics

**Objective:** Allow car to drive up walls, stick to them, and reorient.

**Files:**
- Modify: `js/physics.js` — `updateCar()`, add wall collision/ramp logic

**Details:**
Add a `car.surfaceNormal` property (default `new THREE.Vector3(0,1,0)`).

**Ramp collision:**
When the car is near a wall and low to the ground, check if it's on the ramp. A ramp is a quarter-cylinder of radius R=4 centered at `(±AW/2, 0, z)` for side walls, or `(x, 0, ±AL/2)` for end walls.

For a right wall at x = AW/2:
- The ramp center is at `(AW/2 + R, 0, z)` — no wait.
- The ramp is inside the arena. The wall is at x = AW/2. The ramp curves from the floor up to the wall.
- So the cylinder center is at `(AW/2 - R, R, z)` with the quarter facing +X and -Y? This is getting complex.

Alternative simpler physics: **Raycast-style wall proximity.**
- If car is within `CHX + 1` of a side wall AND `y < R + CHY`, treat it as "on wall transition."
- The further up the wall (higher y), the more gravity rotates toward the wall normal.
- If `y > R + CHY` and still touching wall, full wall ride mode.

Wall ride rules:
```js
if (car.onWall) {
    // Gravity pulls toward wall instead of down
    const wallNormal = getWallNormal(car.pos); // e.g. (-1,0,0) for right wall
    car.vel.addScaledVector(wallNormal, GRAV * dt);
    
    // Reorient car: its "up" becomes wall normal
    // This affects how forward vector is computed
    // fwd is still along car.rot, but projected onto wall plane
} else {
    car.vel.y += GRAV * dt;
}
```

Actually, for the car to drive *up* the wall, when on a side wall (e.g. right wall), the car's "ground" is the wall surface. Pressing forward should move the car +Z (along the wall), pressing up should move it +Y (up the wall), not jump.

This is a big change. Let's simplify for playability:
- When on wall: gravity is reduced to `GRAV * 0.3` and pulls toward the wall normal (keeps car stuck).
- Forward input moves car along wall surface in facing direction.
- The car auto-reorients to align with wall surface.
- Jumping applies impulse in wall normal direction (away from wall).

`getWallNormal(pos)`:
```js
function getWallNormal(pos) {
    const margin = CHX + 0.5;
    if (pos.x > AW/2 - margin) return new THREE.Vector3(-1, 0, 0);
    if (pos.x < -AW/2 + margin) return new THREE.Vector3(1, 0, 0);
    if (pos.z > AL/2 - margin) return new THREE.Vector3(0, 0, -1);
    if (pos.z < -AL/2 + margin) return new THREE.Vector3(0, 0, 1);
    return null;
}
```

In `updateCar`:
1. Check if touching wall AND `y > 2` (not just floor brushing).
2. If so, `car.onWall = true`, `car.surfaceNormal = wallNormal`.
3. Else `car.onWall = false`.

When `onWall`:
- Apply gravity along `-surfaceNormal` (toward wall) instead of -Y.
- Cap Y velocity so car doesn't float away.
- `fwd()` returns a vector perpendicular to `surfaceNormal` based on `car.rot`.
  ```js
  function fwdOnWall(rot, normal) {
      const base = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
      base.sub(normal.clone().multiplyScalar(base.dot(normal))).normalize();
      return base;
  }
  ```
- Friction uses `C_GFRI` (ground friction) since wall is "ground."
- Jump applies impulse: `vel += surfaceNormal * J_VEL` (away from wall).
- When jumping off wall, `onWall = false`, normal gravity resumes.

Update wall collision to not bounce the car off when `onWall` is true. Instead, just keep the car within bounds.

Update `updateCarMesh` to tilt the car when on wall:
```js
if (car.onWall) {
    const up = car.surfaceNormal.clone().multiplyScalar(-1);
    const fwdVec = fwd(car.rot);
    const right = new THREE.Vector3().crossVectors(up, fwdVec).normalize();
    const actualFwd = new THREE.Vector3().crossVectors(right, up).normalize();
    const matrix = new THREE.Matrix4().makeBasis(right, up, actualFwd.negate());
    mesh.quaternion.setFromRotationMatrix(matrix);
} else {
    mesh.rotation.set(0, car.rot, 0);
}
```

**Commit:** `git add js/physics.js && git commit -m "feat: add wall-riding physics with reorientation"`

---

### Task 3.3: Update Ball Collision for Curved Walls

**Objective:** Ball should bounce off the curved ramp sections correctly.

**Files:**
- Modify: `js/physics.js` — `updateBallPhysics()`, `endWallBall()`

**Details:**
For side/end walls, if ball is near the floor AND near the wall (within ramp radius), compute collision against the cylinder instead of the plane.

For a right wall ramp (cylinder centered at `(AW/2 - R, R, ball.z)` with radius R):
```js
if (ball.pos.x > AW/2 - R && ball.pos.y < R * 2) {
    // Cylinder collision
    const cx = AW/2 - R;
    const cy = R;
    const dx = ball.pos.x - cx;
    const dy = ball.pos.y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > R - r && dist < R + r) {
        const nx = dx / dist;
        const ny = dy / dist;
        ball.pos.x = cx + nx * (R - r);
        ball.pos.y = cy + ny * (R - r);
        const vDotN = ball.vel.x * nx + ball.vel.y * ny;
        ball.vel.x -= 2 * vDotN * nx * W_REST;
        ball.vel.y -= 2 * vDotN * ny * W_REST;
    }
}
```

Do this for all 4 walls. This gives natural rolling behavior at the wall base.

**Commit:** `git add js/physics.js && git commit -m "feat: ball collision with curved wall ramps"`

---

## Phase 4: Integration & Polish

### Task 4.1: Test Full Game Loop

**Objective:** Verify all modules load, physics work, new features function.

**Files:**
- All modified files

**Verification Checklist:**
- [ ] Game loads without console errors
- [ ] WASD driving works, steering feels responsive
- [ ] Touch controls still work (check on mobile or devtools mobile emulation)
- [ ] Boost bar fills/drains correctly
- [ ] Ball indicator appears when ball is off-screen
- [ ] Goal arrows/lights are visible
- [ ] Car can drive up wall ramps
- [ ] Car reorients on wall
- [ ] Jumping off wall works
- [ ] Ball bounces correctly on curved walls
- [ ] AI still plays (doesn't crash)
- [ ] Goals register correctly
- [ ] Shadow updates work

**Commit:** If any fixes needed, commit them individually with descriptive messages.

---

### Task 4.2: Final Commit & Push

**Objective:** Push all changes to GitHub.

**Commands:**
```bash
git log --oneline -10  # review commit history
git push origin main
```

Verify the GitHub Actions workflow deploys successfully. Check `https://maedoc.github.io/voxel-kick/` (or the correct Pages URL).

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Module splitting breaks GH Pages | Test locally with `python -m http.server` first; ensure relative imports use `./js/...` |
| Wall-riding physics is buggy / hard to control | Simplify to "reduced gravity toward wall" first; add full reorientation only if it feels good |
| Curved wall geometry is complex | Use simple quarter-cylinder ramps; don't try to build a full parametric stadium |
| Ball indicator projection is wrong | DOM-based approach is forgiving; test at multiple camera angles |
| Refactor introduces regressions | Commit after each task; use `git bisect` if needed |

## Open Questions

1. **Wall ride scope:** Should the car be able to drive on the ceiling? (No — keep it to walls only for now.)
2. **Ball indicator style:** Should it show distance? (Nice-to-have; skip for now.)
3. **Goal arrow count:** How many arrows on the field? (5 arrows along center line is plenty.)

---

## Task Summary

| # | Task | Phase | Est. Time |
|---|---|---|---|
| 0.1 | Extract constants | Refactor | 5 min |
| 0.2 | Extract physics | Refactor | 10 min |
| 0.3 | Extract input | Refactor | 10 min |
| 0.4 | Extract AI | Refactor | 5 min |
| 0.5 | Extract renderer | Refactor | 10 min |
| 0.6 | Create game module | Refactor | 10 min |
| 1.1 | Fix friction/clamp | Physics | 10 min |
| 1.2 | Fix collision impulse | Physics | 10 min |
| 1.3 | Fix ball sleep | Physics | 5 min |
| 2.1 | Improve steering | Gameplay | 10 min |
| 2.2 | Goal clarity | Gameplay | 15 min |
| 2.3 | Ball indicator | Gameplay | 15 min |
| 3.1 | Curved wall geometry | Walls | 20 min |
| 3.2 | Wall-riding physics | Walls | 25 min |
| 3.3 | Ball curved collision | Walls | 15 min |
| 4.1 | Integration test | Polish | 15 min |
| 4.2 | Push | Deploy | 2 min |

**Total: ~3-4 hours of subagent work**
