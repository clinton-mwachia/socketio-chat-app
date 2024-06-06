import express from "express";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

// open the db
const db = await open({
  filename: "chat.db",
  driver: sqlite3.Database,
});

// create messages table
await db.exec(`
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT
    );
`);

const app = express();
const server = createServer(app);
const io = new Server(server);

// get current directory
const __dirname = dirname(fileURLToPath(import.meta.url));

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});
const onlineUsers = new Set();

io.on("connection", async (socket) => {
  // Assign a default nickname if not provided
  socket.nickname = socket.handshake.auth.nickname || "Anonymous";

  // Add the user to the set of online users
  onlineUsers.add(socket.nickname);

  // Broadcast the list of online users to all clients
  io.emit("online users", Array.from(onlineUsers));

  // Broadcast a message when a user connects
  socket.broadcast.emit("user status", `${socket.nickname} has connected`);

  socket.on("disconnect", () => {
    // Remove the user from the set of online users
    onlineUsers.delete(socket.nickname);

    // Broadcast the updated list of online users to all clients
    io.emit("online users", Array.from(onlineUsers));

    // Broadcast a message when a user disconnects
    io.emit("user status", `${socket.nickname} has disconnected`);
  });
  socket.on("chat message", async (msg) => {
    let result;
    try {
      // store message in db
      result = await db.run("INSERT INTO messages (content) VALUES (?)", msg);
      io.emit("chat message", `${socket.nickname}: ${msg}`, result.lastID);
    } catch (error) {
      console.error("Error storing message:", error);
    }
  });

  socket.on("typing", (isTyping) => {
    if (isTyping) {
      socket.broadcast.emit("typing", `${socket.nickname} is typing...`);
    } else {
      socket.broadcast.emit("typing", "");
    }
  });

  socket.on("delete all chats", async () => {
    try {
      await db.run("DELETE FROM messages");
      io.emit("chats deleted");
    } catch (error) {
      console.error("Error deleting chats:", error);
    }
  });

  const serverOffset = socket.handshake.auth.serverOffset || 0;

  // if the connection state recovery was not successful
  try {
    const rows = await db.all(
      "SELECT id, content FROM messages WHERE id > ?",
      serverOffset
    );
    rows.forEach((row) => {
      socket.emit("chat message", row.content, row.id);
    });
  } catch (e) {
    console.error("Error recovering messages:", e);
  }
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
