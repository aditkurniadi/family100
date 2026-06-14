const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8000;
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');

// Serve static files from the current directory
app.use(express.static(__dirname));

// Redirect root to operator or choice page, let's redirect to operator by default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'operator.html'));
});

// DEFAULT QUESTIONS FOR INITIAL GAME STATE
const defaultQuestions = [
  {
    category: "UMUM",
    question: "Sebutkan makanan khas Indonesia yang sangat populer!",
    answers: [
      { text: "NASI GORENG", points: 42 },
      { text: "RENDANG", points: 28 },
      { text: "SATE", points: 15 },
      { text: "BAKSO", points: 9 },
      { text: "GADO-GADO", points: 6 }
    ]
  },
  {
    category: "UMUM",
    question: "Sebutkan perlengkapan sekolah yang wajib dibawa siswa!",
    answers: [
      { text: "BUKU TULIS", points: 40 },
      { text: "PULPEN / PENSIL", points: 30 },
      { text: "TAS SEKOLAH", points: 18 },
      { text: "PENGHAPUS", points: 7 },
      { text: "PENGGARIS", points: 5 }
    ]
  },
  {
    category: "UMUM",
    question: "Benda apa di dalam rumah yang sering digunakan untuk bercermin?",
    answers: [
      { text: "CERMIN / KACA", points: 85 },
      { text: "LEMARI ES (PINTU KACA)", points: 10 },
      { text: "HP / SCREEN HP", points: 5 }
    ]
  },
  {
    category: "UMUM",
    question: "Sebutkan hewan berkaki empat yang memiliki leher sangat panjang!",
    answers: [
      { text: "JERAPAH", points: 95 },
      { text: "UNTA", points: 5 }
    ]
  }
];

function loadQuestionsFromFile() {
  if (fs.existsSync(QUESTIONS_FILE)) {
    try {
      const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error("Error reading questions.json, using defaults:", e);
      return defaultQuestions;
    }
  } else {
    try {
      fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(defaultQuestions, null, 2), 'utf8');
      return defaultQuestions;
    } catch (e) {
      console.error("Error writing default questions.json:", e);
      return defaultQuestions;
    }
  }
}

const OPERATOR_PASSWORD = "trpl2025";

// Server-side game state
let gameState = {
  questions: loadQuestionsFromFile(),
  scores: [0, 0, 0, 0, 0],
  currentQuestionIndex: 0,
  openedAnswers: [],
  wrongCount: 0,
  activeGroupIndex: null,
  buzzerState: "LOCKED", // "LOCKED", "READY", "BUZZED", "COUNTDOWN"
  buzzerGroup: null,
  roomPin: "1234", // Default Room PIN
  screenView: "bumper", // Default view is the intro looping bumper
  roundPoints: 0,
  initialGroupIndex: null,
  operatorPassword: "trpl2025", // Password login operator dinamis
  settingsPassword: "trpl2025" // Password pengaturan soal dinamis
};

// Listen for connections
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Flag to identify client role
  socket.role = null;
  socket.authenticated = false;
  socket.groupIndex = null;
  socket.operatorAuthenticated = false;

  // Join as Board or Buzzer (Operator must authenticate first)
  socket.on('join_role', (data) => {
    if (data.role === 'board' || data.role === 'buzzer') {
      socket.role = data.role;
      console.log(`Socket ${socket.id} joined as ${data.role}`);
      socket.emit('sync_state', gameState);
    }
  });

  // Authenticate Operator via Socket
  socket.on('authenticate_operator', (data) => {
    const { password } = data;
    const correctPassword = gameState.operatorPassword || "trpl2025";
    if (password === correctPassword) {
      socket.role = 'operator';
      socket.operatorAuthenticated = true;
      console.log(`Socket ${socket.id} successfully authenticated as Operator.`);
      socket.emit('operator_auth_result', { success: true });
      socket.emit('sync_state', gameState);
    } else {
      socket.emit('operator_auth_result', { success: false, message: 'Sandi Operator Salah!' });
    }
  });

  // Verify PIN for Mobile Buzzer
  socket.on('verify_pin', (data) => {
    const { groupIndex, pin } = data;
    if (String(pin) === String(gameState.roomPin)) {
      socket.role = 'buzzer';
      socket.authenticated = true;
      socket.groupIndex = parseInt(groupIndex, 10);
      console.log(`Socket ${socket.id} authenticated for Group ${socket.groupIndex}`);
      
      socket.emit('pin_verified', { success: true, groupIndex: socket.groupIndex });
    } else {
      socket.emit('pin_verified', { success: false, message: 'PIN Ruangan Salah! Silakan tanyakan Operator.' });
    }
  });

  // Receive State Sync from Operator
  socket.on('sync_state', (newState) => {
    // Only accept state updates from authenticated operator
    if (socket.role === 'operator' && socket.operatorAuthenticated) {
      gameState = newState;
      if (!gameState.roomPin) {
        gameState.roomPin = "1234";
      }
      
      // Persist questions to JSON file
      try {
        fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(gameState.questions || [], null, 2), 'utf8');
      } catch (e) {
        console.error("Failed to write questions to file:", e);
      }

      // Broadcast state update to everyone else
      socket.broadcast.emit('sync_state', gameState);
    }
  });

  // Trigger sound effect
  socket.on('play_sound', (data) => {
    if (socket.role === 'operator' && socket.operatorAuthenticated) {
      socket.broadcast.emit('play_sound', data);
    }
  });

  // Trigger wrong strike X animation
  socket.on('show_wrong', (data) => {
    if (socket.role === 'operator' && socket.operatorAuthenticated) {
      // Forward to everyone (especially board)
      socket.broadcast.emit('show_wrong', data);
    }
  });

  // Trigger buzzer from operator keyboard shortcuts
  socket.on('operator_trigger_buzzer', (data) => {
    if (socket.role === 'operator' && socket.operatorAuthenticated) {
      const groupNum = parseInt(data.groupIndex, 10);
      
      gameState.buzzerState = "BUZZED";
      gameState.buzzerGroup = groupNum;
      gameState.activeGroupIndex = groupNum - 1;

      io.emit('sync_state', gameState);
      io.emit('buzzer_trigger', { groupIndex: groupNum });
      io.emit('play_sound', { sound: 'buzzer' });
      console.log(`Buzzer triggered by Operator Keyboard for Group ${groupNum}`);
    }
  });

  // Handle buzzer press from mobile device
  socket.on('buzzer_press', () => {
    if (!socket.authenticated || socket.role !== 'buzzer') {
      socket.emit('buzzer_feedback', { success: false, message: 'Belum terautentikasi!' });
      return;
    }

    // Safety: Only allow buzz if operator has set the buzzer state to READY
    if (gameState.buzzerState !== 'READY') {
      socket.emit('buzzer_feedback', { success: false, message: 'Buzzer belum dibuka!' });
      return;
    }

    // Safety: If wrongCount is 3, the group that got 3 strikes (activeGroupIndex) cannot buzz!
    if (gameState.wrongCount === 3 && gameState.activeGroupIndex !== null && (socket.groupIndex - 1) === gameState.activeGroupIndex) {
      socket.emit('buzzer_feedback', { success: false, message: 'Kelompok Anda sudah gugur di ronde ini!' });
      return;
    }

    const groupNum = socket.groupIndex; // 1-5
    
    // Transition state to BUZZED
    gameState.buzzerState = "BUZZED";
    gameState.buzzerGroup = groupNum;
    gameState.activeGroupIndex = groupNum - 1; // Auto highlight active team

    // Broadcast update state to everyone
    io.emit('sync_state', gameState);
    
    // Broadcast specific buzzer trigger event to trigger visual effects
    io.emit('buzzer_trigger', { groupIndex: groupNum });
    // Also send sound event for buzzer
    io.emit('play_sound', { sound: 'buzzer' });

    console.log(`Buzzer triggered by Group ${groupNum} (State set to BUZZED). Buzzers locked.`);
  });

  // Handle board countdown finished to automatically arm/ready buzzers
  socket.on('board_countdown_finished', () => {
    gameState.buzzerState = "READY";
    io.emit('sync_state', gameState);
    console.log("Board countdown finished. Buzzers automatically armed/set to READY.");
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Family 100 WebSocket Server running on http://localhost:${PORT}`);
});
