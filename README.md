# Lost Island: Escape

A 2–4 player cooperative multiplayer escape-room web game.

## Run locally

1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`.
5. For devices on the same Wi-Fi, open the host computer's local IP at port 3000.

## Deploy

Deploy this project to any Node.js host that supports WebSockets. The app uses:
- Express for the web server
- WebSocket (`ws`) for real-time synchronization
- In-memory rooms for the prototype

For production scale, replace the in-memory `rooms` map with Redis (or another shared state store) and add persistent room/session management.

## Game flow

Create room → share code/link → 2–4 players ready → start → solve four puzzles → reach an ending.

Hints are unlimited and each costs 30 seconds.
