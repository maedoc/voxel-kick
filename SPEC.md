# Voxel Kick Rewrite Spec — Rapier Physics

## Architecture

New file: `js/rapier-physics.js` — replaces `js/physics.js` entirely.

Rewritten files:
- `js/game.js` — simplified game loop using rapier-physics
- `js/ai.js` — adapted to read from car state objects (pos/vel still plain Vector3 + rot)
- `js/constants.js` — physics constants stay the same, remove friction constants that Rapier handles
- `js/renderer.js` — no changes
- `js/input.js` — no changes

## Rapier Physics Module API (`js/rapier-physics.js`)

```
export async function initPhysics()
  - Create RAPIER.World with gravity (0, -14, 0)
  - Create all arena colliders (floor, walls, ramps, goal boxes) as FIXED bodies
  - Create ball body (dynamic sphere, restitution 0.82, mass 1)
  - Create car bodies (dynamic cuboid, mass 5)
  - Returns { world, playerBody, aiBody, ballBody, playerCol, aiCol, ballCol, goalSensorZ, goalSensorNZ }

export function applyCarInput(body, collider, input, dt, carState)
  - Read input: { forward, backward, left, right, jump, boost, steerAnalog }
  - Apply forces: acceleration along forward direction, turning via torque
  - Jump: impulse upward when onGround
  - Boost: extra force when boost > 0
  - Update carState: pos, vel, rot, onGround, boost, etc.
  - Clamp horizontal speed to C_MAX

export function stepWorld(world, dt)
  - world.step()

export function syncBodyToState(body, stateObj)
  - Copy Rapier body position/rotation/linvel into stateObj.pos/vel/rot

export function checkGoals(ballBody, pScore, aScore, goalCD)
  - Check if ball is past end walls inside goal opening
  - Return true if goal scored

export function resetAll(playerBody, aiBody, ballBody, playerState, aiState)
  - Reset positions to start

## Arena Colliders

### Floor
- Cuboid half-extents: (AW/2, 0.1, AL/2), position (0, -0.1, 0), FIXED

### Side Walls (left/right, x = ±AW/2)
The ramp is a quarter-cylinder (radius RAMP_RADIUS=30) that transitions from floor to wall.
- Use a Trimesh or set of cuboids to approximate the curve
- OR use a compound of: flat vertical wall (height AH - RAMP_RADIUS) + quarter-cylinder approximated as a convex hull or polyline
- SIMPLEST: Use a convex hull of points along the quarter-circle arc at each side wall
  - Right wall: center at (AW/2 - R, R). Arc from angle π (bottom, ground) to 3π/2 (side, wall)
  - Approximate with 8-12 segments → convex hull or trimesh collider
  - Then flat wall above from y=R to y=AH

Actually, for simplicity, use a set of flat ramp segments (cuboids) arranged in a staircase pattern to approximate the curve. ~10 segments per wall is enough.

### End Walls (front/back, z = ±AL/2)  
Same ramp pattern but along Z axis.
- Leave goal opening (width GW, height GH) as a gap in the wall collider
- Add goal box colliders behind the opening

### Ceiling
- Cuboid at y = AH, FIXED

### Goal boxes
- Back wall, side walls, top for each goal at z = ±AL/2 extending outward by GD

## Car Physics (applyCarInput)

- Car is a dynamic RigidBody with cuboid collider (half-extents CHX, CHY, CHZ)
- Lock rotation on X and Z axes (keep car upright) — only allow Y rotation
- Actually: use enabledRotations(false, true, false) to lock to Y-axis only
- Lock X and Z angular velocity manually each frame for stability

### Acceleration
- Get forward direction from body rotation (Y-axis quaternion → (sin(rot), 0, cos(rot)))
- If input.forward: apply force C_ACC * mass along forward
- If input.backward: apply force C_ACC * mass along backward
- Damping: set body linearDamping to achieve similar friction effect
  - groundDamping ~3.0, airDamping ~0.5 (or use Rapier's linearDamping)

### Turning
- Rotate car.rot by C_TURN * steerInput * dt
- Set body rotation quaternion from car.rot (Y-axis only)
- Speed-sensitive steering: reduce turn rate at high speed

### Jump
- Check onGround via Rapier contacts (body is touching floor or ramp)
- If jump && onGround: apply impulse J_VEL * mass upward

### Boost
- If boost && input.forward: apply extra force B_ACC * mass along forward
- Drain boost, regen when not boosting

### Ground detection
- Use world.contactPair(carCollider, floorCollider) or similar
- OR use world.contactsWith(carCollider) and check if any contact normal.y > 0.5

### Flip (aerial)
- Track canFlip (set true when leaving ground, false after flip or landing)
- On jump in air: apply forward+up impulse, set isFlipping

## Ball Physics

- Ball is dynamic sphere (radius BR, restitution B_REST, mass BL_MASS)
- Rapier handles all bouncing, friction, collision automatically
- Set angularDamping to simulate rolling friction
- Read ball position/velocity back to game state each frame

## Car-Ball Collision

- Rapier handles this automatically via rigid body collision
- For flip-hit multiplier: check if car.isFlipping when collision event fires
  - Use world.eventQueue to get collision events
  - On collision between car and ball, if car.flipHit, apply extra impulse to ball

## Constants to keep/remove

KEEP: V, AW, AL, AH, GW, GH, GD, BR, CHX, CHY, CHZ, GRAV, C_ACC, C_MAX, C_TURN,
      J_VEL, F_VEL, F_DUR, B_ACC, B_MAX, B_DRAIN, B_REGEN, B_REST, W_REST, F_MULT,
      C_MASS, BL_MASS, GOAL_CD, RAMP_RADIUS, J_CUT

REMOVE: C_GFRI, C_AFRI, ACCEL_RAMP_T, BG_FRI, BA_FRI (Rapier handles friction via damping)

## Game State Objects

Car state (player and ai):
```js
{
    pos: THREE.Vector3,   // synced from Rapier body
    vel: THREE.Vector3,   // synced from Rapier body
    rot: number,          // Y-axis rotation (radians)
    onGround: boolean,    // from Rapier contacts
    canFlip: boolean,
    isFlipping: boolean,
    flipTimer: number,
    flipType: string,
    boost: number,
    jumpHeld: boolean,
    flipHit: boolean,
    onWall: boolean,
    surfaceNormal: THREE.Vector3
}
```

Ball state:
```js
{
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    angVel: THREE.Vector3
}
```
