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

A round:

1. Secret orders for every living ship.
2. Everyone moves at once. Collisions resolve as paths cross.
3. Ships alternate one weapon at a time.
4. Smart bombs explode.
5. Ships at 0 hull are removed, then Hold recovers whoever is left.

Orders, per ship:

- **Turn** — up to Agility faces of 60°, shown as stacked tokens, before the move.
- **Maneuver** — a card from a deck of two each: Approach, Orbit Left, Orbit Right, Keep at Range, Strafe Left, Strafe Right. Hold is any one of those cards placed face-down, and it skips the whole turn.
- **Color** — how far along the printed card you travel. Speed 1 reaches blue, 2 green, 3 yellow. Speed 4 or Overdrive Movement reaches red. Approach is 3 / 4 / 5 / 6 hexes. Strafe and Keep at Range are 2 / 3 / 4 / 5. Orbit is 3 / 5 / 7 / 8.
- **Overdrive** — optional, one per ship, costs 1 energy. Speed, Shields, and Damage each cool on their own until a Hold resolves. Movement adds a color, Weapons adds 1 damage, Shield restores 1. Weapon Overcharge makes yellow bands hit as red while Weapons is overdriven.
- Modules that say they are played in the hidden phase, such as Smart Bomb and Stealth.

Hold does nothing until the end of the round. If the ship still has hull, it refills energy, gains 1 shield, resets modules and Overdrive, and Auxiliary Armor Repairer also restores 1 armor.

Each weapon has a printed range diagram and one ammo token chosen for the match. Gray range is no shot. If the first point of a hit lands on armor, that hit is reduced by 1. An ammo bonus applies only when the first point lands on that ammo's layer: Kinetic armor, Thermal hull, EM shield, Explosive knockback on hull.

A smart bomb is placed on the hex behind the ship during orders and explodes at the end of the attack phase. The bomb hex and its neighbors take 5. The ring beyond takes 2.

Collisions happen when two ships cross or finish on the same hex. Both take 1 hull. The smaller ship takes 1 more hull per size step. Shields do not absorb it. A ship destroyed by the collision does not fire.

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
