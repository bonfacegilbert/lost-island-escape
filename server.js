import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/{*splat}", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const puzzles = [
  {
    id: "compass",
    title: "The Stone Compass",
    text: "Four carved arrows surround a stone dial. The inscription says: NORTH, EAST, SOUTH, WEST. A second inscription reads: “Turn twice north, once east, twice south. Enter the number of turns as a four-digit code.”",
    answer: "2122",
    success: "The dial clicks. A hidden panel opens and reveals a brass key.",
    hint: "Count the turns in the order given: north, east, south."
  },
  {
    id: "totems",
    title: "The Four Totems",
    text: "Each player receives a symbol clue. The symbols are SUN, MOON, WAVE, LEAF. Arrange them from oldest to newest according to the clues shown on your screen.",
    answer: "sunmoonwaveleaf",
    success: "The four totems sink into the sand. A stone stairway appears.",
    hint: "Think of a natural cycle: day, night, water, growth."
  },
  {
    id: "cave",
    title: "The Cave Sequence",
    text: "A wall shows: 2, 6, 12, 20, __. Enter the missing number.",
    answer: "30",
    success: "The cave glows blue. The final gate powers on.",
    hint: "Each number is n × (n + 1): 1×2, 2×3, 3×4..."
  },
  {
    id: "gate",
    title: "The Rescue Gate",
    text: "Four players each see one fragment: PLAYER 1: 8. PLAYER 2: 3. PLAYER 3: 1. PLAYER 4: 5. The gate asks for the fragments from highest to lowest.",
    answer: "8531",
    success: "The rescue gate unlocks. You hear an approaching boat.",
    hint: "Put the four numbers in descending order."
  }
];

function newRoomCode() {
  let code;
  do code = Math.random().toString(36).slice(2, 6).toUpperCase();
  while (rooms.has(code));
  return code;
}

function roomState(room) {
  return {
    code: room.code,
    phase: room.phase,
    startedAt: room.startedAt,
    remaining: room.startedAt ? Math.max(0, 20 * 60 - Math.floor((Date.now() - room.startedAt) / 1000)) : 1200,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    puzzleIndex: room.puzzleIndex,
    solved: room.solved,
    hintsUsed: room.hintsUsed,
    hintPenalty: room.hintsUsed * 30,
    puzzle: puzzles[room.puzzleIndex],
    ending: room.ending
  };
}

function broadcast(room) {
  const msg = JSON.stringify({ type: "state", state: roomState(room) });
  for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}

function endRoom(room, ending) {
  room.phase = "ended";
  room.ending = ending;
  broadcast(room);
}

function evaluate(room) {
  if (room.puzzleIndex >= puzzles.length) {
    const elapsed = Math.floor((Date.now() - room.startedAt) / 1000);
    const hints = room.hintsUsed;
    if (elapsed <= 600 && hints <= 1) endRoom(room, "perfect");
    else if (elapsed < 1200) endRoom(room, "narrow");
    else endRoom(room, "stranded");
  }
}

wss.on("connection", ws => {
  let player = null;

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "create") {
      const code = newRoomCode();
      const id = crypto.randomUUID();
      const room = {
        code, phase: "lobby", startedAt: null, puzzleIndex: 0,
        solved: [], hintsUsed: 0, ending: null, players: new Map()
      };
      player = { id, name: String(msg.name || "Player 1").slice(0, 24), ready: false, ws };
      room.players.set(id, player);
      rooms.set(code, room);
      ws.send(JSON.stringify({ type: "joined", code, id }));
      broadcast(room);
      return;
    }

    if (msg.type === "join") {
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return ws.send(JSON.stringify({ type: "error", message: "Room not found." }));
      if (room.players.size >= 4) return ws.send(JSON.stringify({ type: "error", message: "Room is full." }));
      if (room.phase !== "lobby") return ws.send(JSON.stringify({ type: "error", message: "Game already started." }));
      const id = crypto.randomUUID();
      player = { id, name: String(msg.name || `Player ${room.players.size + 1}`).slice(0, 24), ready: false, ws };
      room.players.set(id, player);
      ws.send(JSON.stringify({ type: "joined", code, id }));
      broadcast(room);
      return;
    }

    if (!player) return;
    const room = [...rooms.values()].find(r => r.players.has(player.id));
    if (!room) return;

    if (msg.type === "ready") {
      player.ready = !player.ready;
      broadcast(room);
    }

    if (msg.type === "start") {
      if (room.phase !== "lobby") return;
      if (room.players.size < 2) return ws.send(JSON.stringify({ type: "error", message: "At least 2 players are needed." }));
      if (![...room.players.values()].every(p => p.ready)) return ws.send(JSON.stringify({ type: "error", message: "Everyone must be ready." }));
      room.phase = "playing";
      room.startedAt = Date.now();
      broadcast(room);
    }

    if (msg.type === "solve") {
      if (room.phase !== "playing") return;
      const puzzle = puzzles[room.puzzleIndex];
      const answer = String(msg.answer || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (answer === puzzle.answer) {
        room.solved.push(puzzle.id);
        room.puzzleIndex++;
        if (room.puzzleIndex >= puzzles.length) evaluate(room);
        else broadcast(room);
      } else {
        ws.send(JSON.stringify({ type: "wrong" }));
      }
    }

    if (msg.type === "hint") {
      if (room.phase !== "playing") return;
      room.hintsUsed++;
      ws.send(JSON.stringify({ type: "hint", text: puzzles[room.puzzleIndex].hint }));
      broadcast(room);
    }
  });

  ws.on("close", () => {
    if (!player) return;
    for (const room of rooms.values()) {
      if (room.players.delete(player.id)) {
        broadcast(room);
        if (room.players.size === 0) rooms.delete(room.code);
        break;
      }
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === "playing") {
      const left = 20 * 60 - Math.floor((Date.now() - room.startedAt) / 1000);
      if (left <= 0) endRoom(room, "stranded");
      else broadcast(room);
    }
  }
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Lost Island Escape running on port ${PORT}`));