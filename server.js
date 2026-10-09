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
    text: "Four totems bear the symbols SUN, MOON, WAVE and LEAF. Each survivor sees only their own age clue below — share your clues out loud, then enter the symbols from oldest to newest as one word.",
    answer: "sunmoonwaveleaf",
    success: "The four totems sink into the sand. A stone stairway appears.",
    hint: "Think of a natural cycle: day, night, water, growth.",
    fragments: [
      "SUN — carved first. The oldest.",
      "MOON — born after the sun, before the tides.",
      "WAVE — younger than the moon, older than the forest.",
      "LEAF — the last to grow. The youngest."
    ]
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
    text: "The gate needs the four number fragments from highest to lowest. Each survivor sees only their own fragment below — share them out loud, then enter the code.",
    answer: "8531",
    success: "The rescue gate unlocks. You hear an approaching boat.",
    hint: "Put the four numbers in descending order.",
    fragments: [
      "8 — the first fragment",
      "3 — the second fragment",
      "1 — the third fragment",
      "5 — the fourth fragment"
    ]
  }
];

function newRoomCode() {
  let code;
  do code = Math.random().toString(36).slice(2, 6).toUpperCase();
  while (rooms.has(code));
  return code;
}

function effectiveElapsed(room) {
  return Math.floor((Date.now() - room.startedAt) / 1000) + (room.timePenalty || 0);
}

function remainingSecs(room) {
  if (!room.startedAt) return 20 * 60;
  return Math.max(0, 20 * 60 - effectiveElapsed(room));
}

// Fragments are dealt round-robin so every fragment is seen by at least
// one player no matter the crew size (2-4). Answers are stripped so they
// never reach the client.
function personalPuzzle(room, idx) {
  const puzzle = puzzles[room.puzzleIndex];
  if (!puzzle) return null;
  const safe = { id: puzzle.id, title: puzzle.title, text: puzzle.text };
  if (puzzle.fragments) {
    const n = room.players.size;
    safe.myFragments = puzzle.fragments.filter((_, j) => j % n === idx);
  }
  return safe;
}

function roomState(room, idx = 0) {
  return {
    code: room.code,
    phase: room.phase,
    startedAt: room.startedAt,
    remaining: remainingSecs(room),
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    puzzleIndex: room.puzzleIndex,
    solved: room.solved,
    hintsUsed: room.hintsUsed,
    hintPenalty: room.hintsUsed * 30,
    puzzle: personalPuzzle(room, idx),
    ending: room.ending
  };
}

function broadcast(room) {
  const players = [...room.players.values()];
  players.forEach((p, idx) => {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: "state", state: roomState(room, idx) }));
  });
}

function endRoom(room, ending) {
  room.phase = "ended";
  room.ending = ending;
  broadcast(room);
}

function evaluate(room) {
  if (room.puzzleIndex >= puzzles.length) {
    const elapsed = effectiveElapsed(room);
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
        solved: [], hintsUsed: 0, timePenalty: 0, ending: null, players: new Map()
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
      room.timePenalty += 30;
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
      const left = remainingSecs(room);
      if (left <= 0) endRoom(room, "stranded");
      else broadcast(room);
    }
  }
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Lost Island Escape running on port ${PORT}`));