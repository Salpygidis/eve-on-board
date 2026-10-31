# SOURCE Skirmish

An EVE-inspired hex skirmish for the browser. Each pilot brings three ships, plots secret orders, then reveals movement and fire on a shared grid. No accounts — a room code is enough. Friends can join as pilots or spectators. It runs on a desktop or a phone.

The hex foundation (axial coordinates, flat-to-flat steps, tile geometry, stacking, and edges) stays in `shared/hex.js`, `shared/boardFit.js`, and `src/meshes.js`. The skirmish rules sit on top of that grid.

## How a room works

1. One person opens the game and clicks **Create room**. They get a 4-character code.
2. **Practice vs bot** starts a private match against one opponent.
3. Everyone else **Joins** with the code. Check **Join as spectator** to watch.
4. The host clicks **Launch** with 2–4 pilots (humans and bots).
5. Late arrivals join the same code as spectators.

Room state lives in the Node process. If the server restarts or sleeps, open rooms disappear.

## Rules (short)

Each pilot fields exactly three ships: any mix of Rifter (small), Rupture (medium), and Tempest (large). Modules spend racks. A dash in the fitting list means that hull cannot mount it.

A round is simultaneous:

1. Secret orders for every living ship.
2. Reveal.
3. Movement and collisions.
4. Smart bombs.
5. Attacks.
6. Cleanup.

Orders, per ship:

- **Turn** — up to Agility faces of 60°, shown as stacked tokens.
- **Maneuver** — Approach, Orbit Left, Orbit Right, Keep at Range, Strafe Left, Strafe Right, or Hold. You have two of each card. Hold is any card placed face-down.
- **Color** — Light Blue 1, Light Green 2, Yellow 3, Red 4. Speed is the furthest color without Overdrive. Red is the Overdrive Movement step past Yellow.
- **Overdrive** — optional, costs 1 energy, one per ship until that ship Holds. Movement +1 color, Weapons +2 damage, Shield +1 shield.
- One optional active module.

Hold refills energy, restores 1 shield, and resets spent modules and Overdrive.

Approach and Keep at Range are low transversal. Orbit and Strafe are high. Inside optimal with low transversal is a red hit (full ship damage). Other shots still in range are yellow (damage − 1) or a miss. Past falloff is a miss. Weapons fire in any direction.

| Weapon | Optimal | Falloff | Type |
| --- | --- | --- | --- |
| Blasters | 1 | 1 | Thermal |
| Autocannons | 2 | 2 | Kinetic |
| Rails | 4 | 2 | Kinetic |
| Artillery | 5 | 1 | Explosive |
| Rockets | 3 | 3 | Explosive |

A smart bomb mines the hex you occupy when you drop it. After movement, it detonates if another ship is on that hex. You do not set off your own bomb on the turn you drop it. It stays until it blows, then hits everyone in the hex except you on the drop turn.

Collisions happen when two ships finish on the same hex or trade places. Both take 1 hull. The smaller ship takes 1 more hull per size step. Shields do not absorb it. Knockback equals hull lost, then each ship may twist one face. A ship destroyed by the collision does not fire. A ship destroyed any other way still shoots that phase.

Last fleet with a ship left wins.

Right-drag (or one-finger drag on a phone) orbits the camera. Scroll or pinch zooms. Tap a ship to focus it. Hold a hex to read it.

## Run locally

Needs **Node 18+**.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

That starts two processes:

- Vite client on port **5173** (proxies `/socket.io` and `/api` to the game server)
- Socket.io + Express on port **3000**

Open a second window, or a phone on the same Wi-Fi at `http://YOUR_LAN_IP:5173`, and join with the room code.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Client + server with hot reload |
| `npm test` | Hex foundation and skirmish rules |
| `npm run build` | Vite production build into `dist/` |
| `npm start` | Serve `dist/` + Socket.io (production) |

### Environment variables

Copy `.env.example` if you want a local file. None are required for a normal deploy.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket listen port. **Render sets this for you.** |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | unset | `production` serves the Vite build from `dist/` |
| `VITE_SOCKET_URL` | *(same origin)* | Only if the client and Socket.io host differ |

## Deploy on Render

This is **one Web Service** (Node), not a static site. Socket.io needs a long-lived server.

1. Push this repo to GitHub.
2. On [Render](https://render-www.onrender.com/), **New → Web Service** and point it at the repo.
3. Settings:

   | Setting | Value |
   | --- | --- |
   | Runtime | Node |
   | Build command | `npm install && npm run build` |
   | Start command | `npm start` |
   | Instance | Free is fine for playtesting |

4. Environment:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `20` |

   Do not set `PORT`. Render injects it.

5. Health check path (optional): `/api/health`

There is a `render.yaml` in the repo if you prefer Blueprint deploys.

After deploy, share `https://YOUR-SERVICE.onrender.com/`. Free instances sleep when idle — the first load after a nap can take a minute, and in-memory rooms reset.

## Stack

- Vite + Three.js client
- Express + Socket.io server (authoritative rules)
- Shared hex math in `shared/hex.js`
- Skirmish rules in `shared/rules.js` and `server/game.js`

The server owns fleets, secret orders, movement, collisions, bombs, and shots. Clients send plans. Everyone, including late spectators, gets a snapshot. Other pilots' orders stay hidden until the reveal.
