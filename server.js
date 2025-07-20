const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Static drivers and user
const drivers = [
  { id: "driver1", name: "Driver One", location: { lat: 12.91, lng: 77.64 } },
  { id: "driver2", name: "Driver Two", location: { lat: 12.92, lng: 77.63 } },
  { id: "driver3", name: "Driver Three", location: { lat: 12.93, lng: 77.65 } },
];

const users = [
  { id: "user1", name: "User One", location: { lat: 12.90, lng: 77.62 } }
];

// Sockets mapping
const connectedDrivers = {};
const connectedUsers = {};

// Ride request state
let rideState = {
  userId: null,
  currentDriverIndex: 0,
  requestTimeout: null,
  rejectedDrivers: [],
  ignoredDrivers: [],
  activeDriver: null,
};

// Serve frontend
app.use(express.static(__dirname + "/public"));

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("register-driver", (driverId) => {
    connectedDrivers[driverId] = socket;
    console.log("🟢 Driver registered:", driverId);
  });

  socket.on("register-user", (userId) => {
    connectedUsers[userId] = socket;
    console.log("🔵 User registered:", userId);
  });

  socket.on("request-ride", (userId) => {
    console.log(`📨 User ${userId} requested ride`);
    rideState = {
      userId,
      currentDriverIndex: 0,
      requestTimeout: null,
      rejectedDrivers: [],
      ignoredDrivers: [],
      activeDriver: null,
    };
    sendRideRequestToNextDriver();
  });

  socket.on("driver-response", ({ driverId, accepted }) => {
    if (rideState.activeDriver !== driverId) return;

    clearTimeout(rideState.requestTimeout);

    if (accepted) {
      console.log(`✅ Driver ${driverId} accepted ride`);
      const driver = drivers.find((d) => d.id === driverId);
      const user = users.find((u) => u.id === rideState.userId);

      // Send location coordinates to user
      if (connectedUsers[rideState.userId]) {
        connectedUsers[rideState.userId].emit("ride-confirmed", {
          driverId,
          route: [driver.location, user.location],
        });
      }

      if (connectedDrivers[driverId]) {
        connectedDrivers[driverId].emit("ride-confirmed", {
          userId: rideState.userId,
          route: [driver.location, user.location],
        });
      }

      rideState = {}; // Reset
    } else {
      console.log(`❌ Driver ${driverId} rejected ride`);
      rideState.rejectedDrivers.push(driverId);
      sendRideRequestToNextDriver();
    }
  });

  socket.on("disconnect", () => {
    for (let id in connectedDrivers) {
      if (connectedDrivers[id] === socket) delete connectedDrivers[id];
    }
    for (let id in connectedUsers) {
      if (connectedUsers[id] === socket) delete connectedUsers[id];
    }
    console.log("🔌 Disconnected:", socket.id);
  });
});

function sendRideRequestToNextDriver() {
  const { currentDriverIndex, rejectedDrivers, ignoredDrivers } = rideState;

  const availableDrivers = drivers.filter(
    (d) => !rejectedDrivers.includes(d.id) && !ignoredDrivers.includes(d.id)
  );

  if (availableDrivers.length === 0) {
    console.log("❗ No drivers available");
    if (connectedUsers[rideState.userId]) {
      connectedUsers[rideState.userId].emit("no-drivers");
    }
    return;
  }

  const nextDriver = availableDrivers[0];
  rideState.currentDriverIndex++;
  rideState.activeDriver = nextDriver.id;

  const driverSocket = connectedDrivers[nextDriver.id];
  if (driverSocket) {
    console.log(`📨 Sending ride request to ${nextDriver.id}`);
    driverSocket.emit("ride-request", {
      userId: rideState.userId,
      userLocation: users[0].location,
    });

    rideState.requestTimeout = setTimeout(() => {
      console.log(`⏰ Timeout - Driver ${nextDriver.id} ignored`);
      rideState.ignoredDrivers.push(nextDriver.id);
      if (driverSocket) {
        driverSocket.emit("request-expired");
      }
      sendRideRequestToNextDriver();
    }, 8000);
  } else {
    // If socket missing, treat as ignored
    rideState.ignoredDrivers.push(nextDriver.id);
    sendRideRequestToNextDriver();
  }
}

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});