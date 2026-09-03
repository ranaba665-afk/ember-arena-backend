// socket.js
//
// Central place to init Socket.io and access the instance from
// controllers (avoids passing `io` through every function call).
//
// In server.js:
//   const http = require("http");
//   const { initSocket } = require("./socket");
//   const server = http.createServer(app);
//   initSocket(server);
//   server.listen(PORT);

const { Server } = require("socket.io");

let io;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    // Frontend joins a room per tournament page it's viewing, so
    // updates only go to clients actually looking at that tournament.
    socket.on("joinTournament", (tournamentId) => {
      socket.join(`tournament:${tournamentId}`);
    });

    socket.on("leaveTournament", (tournamentId) => {
      socket.leave(`tournament:${tournamentId}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized — call initSocket(server) first.");
  }
  return io;
}

module.exports = { initSocket, getIO };
