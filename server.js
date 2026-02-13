const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// ============================================
// PASTE YOUR RENDER API KEY HERE
// ============================================
const RENDER_API_KEY = 'PASTE_YOUR_RENDER_API_KEY_HERE';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Game state
const games = new Map();
const players = new Map();

class Game {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.towers = [];
    this.enemies = [];
    this.wave = 0;
    this.gameStarted = false;
    this.enemyPath = [
      { x: 0, y: 300 },
      { x: 200, y: 300 },
      { x: 200, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 400 },
      { x: 600, y: 400 },
      { x: 600, y: 200 },
      { x: 800, y: 200 }
    ];
    this.health = 100;
    this.gold = 500;
    this.lastUpdate = Date.now();
  }

  addPlayer(playerId, playerName) {
    this.players.push({ id: playerId, name: playerName, ready: false });
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
  }

  placeTower(x, y, type, playerId) {
    const costs = { basic: 100, fast: 150, strong: 200 };
    if (this.gold >= costs[type]) {
      this.towers.push({
        id: Date.now(),
        x, y, type,
        playerId,
        damage: type === 'strong' ? 30 : type === 'fast' ? 10 : 15,
        range: type === 'strong' ? 120 : type === 'fast' ? 100 : 100,
        fireRate: type === 'fast' ? 300 : type === 'strong' ? 1500 : 800,
        lastFire: 0
      });
      this.gold -= costs[type];
      return true;
    }
    return false;
  }

  update() {
    const now = Date.now();
    const delta = now - this.lastUpdate;
    this.lastUpdate = now;

    // Move enemies
    this.enemies.forEach(enemy => {
      if (enemy.health <= 0) return;
      
      const target = this.enemyPath[enemy.pathIndex];
      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 5) {
        enemy.pathIndex++;
        if (enemy.pathIndex >= this.enemyPath.length) {
          this.health -= enemy.damage;
          enemy.health = 0;
        }
      } else {
        enemy.x += (dx / dist) * enemy.speed * (delta / 16);
        enemy.y += (dy / dist) * enemy.speed * (delta / 16);
      }
    });

    // Tower attacks
    this.towers.forEach(tower => {
      if (now - tower.lastFire < tower.fireRate) return;

      const target = this.enemies.find(enemy => {
        if (enemy.health <= 0) return false;
        const dx = enemy.x - tower.x;
        const dy = enemy.y - tower.y;
        return Math.sqrt(dx * dx + dy * dy) <= tower.range;
      });

      if (target) {
        target.health -= tower.damage;
        tower.lastFire = now;
        if (target.health <= 0) {
          this.gold += target.reward;
        }
      }
    });

    // Clean up dead enemies
    this.enemies = this.enemies.filter(e => e.health > 0 && e.pathIndex < this.enemyPath.length);
  }

  spawnWave() {
    this.wave++;
    const enemyCount = 5 + this.wave * 2;
    
    for (let i = 0; i < enemyCount; i++) {
      setTimeout(() => {
        this.enemies.push({
          id: Date.now() + i,
          x: this.enemyPath[0].x,
          y: this.enemyPath[0].y,
          pathIndex: 0,
          health: 50 + this.wave * 10,
          maxHealth: 50 + this.wave * 10,
          speed: 1 + this.wave * 0.1,
          damage: 5,
          reward: 25
        });
      }, i * 1000);
    }
  }

  getState() {
    return {
      players: this.players,
      towers: this.towers,
      enemies: this.enemies,
      wave: this.wave,
      health: this.health,
      gold: this.gold,
      gameStarted: this.gameStarted
    };
  }
}

// Serve static files
app.use(express.static('public'));

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('New client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          handleJoin(ws, data);
          break;
        case 'ready':
          handleReady(ws, data);
          break;
        case 'placeTower':
          handlePlaceTower(ws, data);
          break;
        case 'startWave':
          handleStartWave(ws, data);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});

function handleJoin(ws, data) {
  const gameId = data.gameId || 'default';
  
  if (!games.has(gameId)) {
    games.set(gameId, new Game(gameId));
  }

  const game = games.get(gameId);
  const playerId = Date.now().toString();
  
  game.addPlayer(playerId, data.playerName);
  players.set(ws, { gameId, playerId });
  
  ws.send(JSON.stringify({
    type: 'joined',
    playerId,
    gameState: game.getState()
  }));

  broadcast(gameId, {
    type: 'playerJoined',
    player: { id: playerId, name: data.playerName }
  });
}

function handleReady(ws, data) {
  const playerInfo = players.get(ws);
  if (!playerInfo) return;

  const game = games.get(playerInfo.gameId);
  const player = game.players.find(p => p.id === playerInfo.playerId);
  if (player) {
    player.ready = true;
  }

  broadcast(playerInfo.gameId, {
    type: 'gameState',
    state: game.getState()
  });

  if (game.players.every(p => p.ready) && game.players.length > 0) {
    game.gameStarted = true;
    broadcast(playerInfo.gameId, {
      type: 'gameStarted'
    });
  }
}

function handlePlaceTower(ws, data) {
  const playerInfo = players.get(ws);
  if (!playerInfo) return;

  const game = games.get(playerInfo.gameId);
  const success = game.placeTower(data.x, data.y, data.towerType, playerInfo.playerId);

  broadcast(playerInfo.gameId, {
    type: 'gameState',
    state: game.getState()
  });
}

function handleStartWave(ws, data) {
  const playerInfo = players.get(ws);
  if (!playerInfo) return;

  const game = games.get(playerInfo.gameId);
  if (game.enemies.length === 0) {
    game.spawnWave();
  }
}

function handleDisconnect(ws) {
  const playerInfo = players.get(ws);
  if (!playerInfo) return;

  const game = games.get(playerInfo.gameId);
  if (game) {
    game.removePlayer(playerInfo.playerId);
    
    if (game.players.length === 0) {
      games.delete(playerInfo.gameId);
    } else {
      broadcast(playerInfo.gameId, {
        type: 'playerLeft',
        playerId: playerInfo.playerId
      });
    }
  }

  players.delete(ws);
}

function broadcast(gameId, message) {
  const game = games.get(gameId);
  if (!game) return;

  players.forEach((info, ws) => {
    if (info.gameId === gameId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

// Game loop
setInterval(() => {
  games.forEach(game => {
    if (game.gameStarted) {
      game.update();
      broadcast(game.id, {
        type: 'gameState',
        state: game.getState()
      });
    }
  });
}, 50);

server.listen(PORT, () => {
  console.log(`Tower Defense server running on port ${PORT}`);
  console.log(`Render API Key configured: ${RENDER_API_KEY ? 'YES' : 'NO'}`);
});
