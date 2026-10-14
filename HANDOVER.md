# Farm Brawl - Handover & Developer Guide for AI Agents & Developers

This document serves as a complete handover guide for any developer or AI assistant continuing development on Farm Brawl on another machine.

---

## 1. Project Overview

- **Name:** Farm Brawl (`farm-brawl`)
- **Type:** Multiplayer .io web action game (browser-based 3D)
- **Gameplay:** Players control animals (Chicken, Sheep, Horse, Cow, Duck, Pig, Dog, Elephant, etc.) in an arena, ramming rivals into hazards (electric fences, buzzsaws, spikes, water), eating crops to gain mass and size, and capturing the central podium to become the King of the Farm.
- **Game Modes:** Free-For-All (FFA) & 2-Team Battle (Blue vs Red).
- **Live URL:** [https://farm-brawl.farm-brawl.workers.dev](https://farm-brawl.farm-brawl.workers.dev)
- **GitHub Repository:** [https://github.com/dandewindy/farm-brawl.git](https://github.com/dandewindy/farm-brawl.git)
- **Branch:** `main`

---

## 2. Tech Stack

- **Client:**
  - Rendering: **Three.js** (`^0.186.1`) with custom procedural low-poly 3D models.
  - Bundler: **Vite** (`^8.3.3`)
  - Language: **TypeScript** (`^5.9.3`)
  - UI: Glassmorphism HUD, HTML5 Canvas / CSS3, responsive touch controls for mobile/tablet/desktop.
- **Server:**
  - Platform: **Cloudflare Workers** with **Durable Objects** (`GameRoom` with SQLite persistence & WebSocket hibernation).
  - Protocol: Custom binary/JSON WebSocket protocol (`/ws?room=...`).
- **Shared:**
  - Deterministic 2D/3D physics simulation engine (`shared/src/sim/world.ts`), constants, and protocol definitions shared between client and server.
- **Testing:**
  - **Vitest** (`^5.0.3`) for deterministic physics simulation unit tests (50 tests).

---

## 3. Directory Structure

```text
farm-brawl/
├── client/                     # Frontend client (Vite + Three.js)
│   ├── index.html              # Main HTML entry & HUD overlay
│   ├── vite.config.ts          # Vite configuration (port 5180)
│   └── src/
│       ├── main.ts             # Main loop, network event hooks, state sync, camera, modals
│       ├── style.css           # Glassmorphism UI, buttons, HUD styles
│       ├── input/
│       │   └── controls.ts     # Keyboard, mouse, virtual touch joystick & dash button
│       ├── net/
│       │   ├── transport.ts    # Transport interface & LocalServer fallback
│       │   ├── ws.ts           # WebSocket client, latency tracking, colo auto-steer (SIN)
│       │   └── firebase.ts     # Optional Firebase / auth / stats integration
│       ├── render/
│       │   ├── animals.ts      # 3D procedural animal models, eyes, tails, swim & walk anims
│       │   ├── corpses.ts      # Death animations (electrocution, fire, slice, drown)
│       │   ├── particles.ts    # Particle showers (puffs, electric sparks, water splashes)
│       │   └── world.ts        # 3D arena, ground, podium tile glow, hazards, trees/flowers
│       └── ui/
│           ├── hud.ts          # Scoreboard, kill feed, death modal, quick exit button
│           └── sounds.ts       # Web Audio API sound synthesis & effects
├── server/                     # Backend Cloudflare Worker + Durable Objects
│   ├── wrangler.toml           # Worker configuration & Durable Object bindings
│   ├── tsconfig.json           # Server TypeScript configuration
│   └── src/
│       └── index.ts            # Worker router, WebSocket upgrade, Durable Objects GameRoom
├── shared/                     # Shared physics, protocol & simulation
│   ├── src/
│   │   ├── constants.ts        # Arena bounds, tick rate, animal stats, hazard damage
│   │   ├── protocol.ts         # ClientMsg, ServerMsg network contracts
│   │   └── sim/
│   │       └── world.ts        # Server-authoritative deterministic physics engine & bots
│   └── test/
│       └── sim.test.ts         # 50 unit tests for physics & gameplay rules
├── dist/                       # Production build output (static assets served by Worker)
├── HANDOVER.md                 # This file
├── package.json                # Project root scripts and dependencies
└── tsconfig.json               # Root TypeScript configuration
```

---

## 4. Setup on a New Machine

### Prerequisites
1. **Node.js**: v20+ or v24+ (with npm)
2. **Git**

### Installation Steps
```bash
# 1. Clone repository
git clone https://github.com/dandewindy/farm-brawl.git
cd farm-brawl

# 2. Install dependencies
npm install

# 3. Verify tests and typechecking
npm test
npm run typecheck # or npx tsc --noEmit
```

### Development Commands
```bash
# Start local development server (Vite at http://localhost:5180)
npm run dev

# Run unit tests (50 tests)
npm test

# Build client for production into /dist
npm run build

# Run local Worker with Durable Objects
npm run dev:server
```

---

## 5. Cloudflare Deployment Configuration

To deploy to Cloudflare Workers from the new machine:

### Required Credentials:
- `CLOUDFLARE_ACCOUNT_ID`: `6c5390b3a9e87640c4f9f752054d44c1`
- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API Token with Workers & Durable Objects permissions.

### Deploy Command:
```powershell
# In PowerShell (Windows):
$env:CLOUDFLARE_API_TOKEN = "<YOUR_TOKEN>"
$env:CLOUDFLARE_ACCOUNT_ID = "6c5390b3a9e87640c4f9f752054d44c1"
npm run build
cd server
npx wrangler deploy
cd ..
```
Or in Bash / Linux / macOS:
```bash
export CLOUDFLARE_API_TOKEN="<YOUR_TOKEN>"
export CLOUDFLARE_ACCOUNT_ID="6c5390b3a9e87640c4f9f752054d44c1"
npm run build
cd server && npx wrangler deploy && cd ..
```

---

## 6. Key Systems & Recent Enhancements

### 1. Domain & URL Structure
- **Current URL:** `https://farm-brawl.farm-brawl.workers.dev`
- **Why double `farm-brawl`?**
  - Worker Name in `server/wrangler.toml`: `farm-brawl`
  - Cloudflare Account Subdomain: `farm-brawl`
  - Cloudflare naming standard: `https://<worker-name>.<account-subdomain>.workers.dev`
- **How to make it shorter/cleaner:**
  - Option A: Change `name = "play"` in `server/wrangler.toml` -> URL becomes `https://play.farm-brawl.workers.dev`.
  - Option B: Add a Custom Domain in Cloudflare Dashboard (e.g. `play.yourdomain.com`).

### 2. Electric Fence Hazard & Visuals (`client/src/render/world.ts`)
- High-voltage fences run along the arena boundaries.
- Contact causes electrocution, damage, knockback, and a unique charred death animation.
- Dynamic visual effects:
  - 3D volumetric lightning arc ribbons (`lightningRibbons`).
  - Flying spark particle showers (`sparkMesh`).
  - Pinpoint plasma contact sparks reduced to 10% size (`0.07m` core, `0.16m` halo) so they don't block the screen.

### 3. October 20th Vietnamese Women's Day Theme (`client/src/render/world.ts`)
- Features autumn/pink seasonal environment:
  - Alternating tall flowering trees and flowering bushes.
  - Foliage in soft shades of rose, blush, and magenta.
  - Scattered 3D blossom flowers (`0xff69b4`, `0xff1493`, `0xffb6c1`) placed on foliage surfaces.

### 4. Animal Models & Polish (`client/src/render/animals.ts`)
- **Elephant:** Features proper rounded eyes, curved tusks placed close to the mouth, and tuned leg swinging animation.
- **Dog:** Fixed nametag clipping so the player/bot name stays visible while swimming in water.
- **Cow & Horse:** Rounded capsule bodies, ears, mane, cowbell on neck, and tail positioned with natural outward slope.
- **Water Drowning:** Slow, gentle flailing paddling animation with water puffs before submerging.

### 5. Touch & Mobile Controls (`client/src/input/controls.ts`)
- Virtual floating joystick on left half of screen.
- Independent touch tracking using `t.identifier` so lifting the dash finger on iPad/tablet does not interrupt joystick movement.
- In-game quick zoom (`➕`/`➖`) and sound mute buttons (`🔊`/`🔇`).

### 6. Death Modal & UX (`client/src/ui/hud.ts`, `client/src/main.ts`)
- Death camera delay: 1.5s delay following the death location before opening the death overlay so the player sees their corpse animation.
- Quick exit button: Exit door icon (🚪) on the top right of the death modal allowing players to leave directly without extra steps.

### 7. Networking & Ping Stability (`client/src/net/ws.ts`)
- Client monitors latency (RTT) and detects Cloudflare Colo.
- Prefers low-latency Asian colos (`SIN`, `HKG`, `BKK`, `HAN`, `SGN`).
- Preserves smooth gameplay without abrupt mid-game disconnects or unwanted state resets.

---

## 7. Handover Prompt for the New AI Agent

If you are opening this project with a new AI agent on another machine, copy and paste the prompt below:

```text
Hi! You are continuing development on the "Farm Brawl" project.
Please read HANDOVER.md in the project root to understand the full architecture, tech stack, and conventions.

Quick summary:
- Tech Stack: Three.js + Vite + TypeScript (Client), Cloudflare Workers + Durable Objects (Server), Vitest (Tests).
- Repository: https://github.com/dandewindy/farm-brawl.git (Branch: main)
- Live: https://farm-brawl.farm-brawl.workers.dev
- All 50 unit tests currently pass (`npm test`).
- To deploy: build with `npm run build`, then run `npx wrangler deploy` in the `server` directory with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.

Please verify the current git status, run tests, and let me know when you're ready for the next task!
```
