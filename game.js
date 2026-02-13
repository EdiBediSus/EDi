class TowerDefenseGame {
  constructor() {
    this.ws = null;
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.gameState = null;
    this.selectedTower = null;
    this.playerId = null;
    this.playerNameToJoin = null;
    
    this.setupCanvas();
    this.setupEventListeners();
  }

  setupCanvas() {
    const wrapper = document.getElementById('canvasWrapper');
    this.canvas.width = wrapper.clientWidth;
    this.canvas.height = wrapper.clientHeight;
  }

  setupEventListeners() {
    document.getElementById('joinBtn').addEventListener('click', () => this.joinGame());
    document.getElementById('readyBtn').addEventListener('click', () => this.setReady());
    document.getElementById('waveBtn').addEventListener('click', () => this.startWave());
    
    document.querySelectorAll('.tower-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tower-btn').forEach(b => b.classList.remove('selected'));
        e.target.classList.add('selected');
        this.selectedTower = e.target.dataset.type;
      });
    });

    this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
    
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.selectedTower && this.gameState) {
        this.showTowerPreview(e);
      }
    });

    window.addEventListener('resize', () => this.setupCanvas());
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Connected to server');
      
      // Send join message now that connection is open
      if (this.playerNameToJoin) {
        this.ws.send(JSON.stringify({
          type: 'join',
          playerName: this.playerNameToJoin,
          gameId: 'default'
        }));
      }
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      const joinBtn = document.getElementById('joinBtn');
      if (joinBtn) {
        joinBtn.textContent = 'Join Game';
        joinBtn.disabled = false;
      }
      alert('Connection failed! Please check if the server is running.');
    };

    this.ws.onclose = () => {
      console.log('Disconnected from server');
      const joinBtn = document.getElementById('joinBtn');
      if (joinBtn) {
        joinBtn.textContent = 'Join Game';
        joinBtn.disabled = false;
      }
      if (this.playerId) {
        alert('Lost connection to server!');
      }
    };
  }

  joinGame() {
    const playerName = document.getElementById('playerName').value.trim();
    if (!playerName) {
      alert('Please enter your name');
      return;
    }

    const joinBtn = document.getElementById('joinBtn');
    joinBtn.textContent = 'Connecting...';
    joinBtn.disabled = true;

    this.playerNameToJoin = playerName;
    this.connect();
  }

  setReady() {
    this.ws.send(JSON.stringify({ type: 'ready' }));
    document.getElementById('readyBtn').disabled = true;
  }

  startWave() {
    this.ws.send(JSON.stringify({ type: 'startWave' }));
  }

  handleMessage(data) {
    switch (data.type) {
      case 'joined':
        this.playerId = data.playerId;
        this.gameState = data.gameState;
        document.getElementById('waitingRoom').style.display = 'block';
        this.updateLobby();
        break;
      
      case 'playerJoined':
        this.updateLobby();
        break;
      
      case 'gameStarted':
        document.getElementById('lobby').style.display = 'none';
        document.getElementById('gameContainer').classList.add('active');
        this.startGameLoop();
        break;
      
      case 'gameState':
        this.gameState = data.state;
        this.updateUI();
        break;
    }
  }

  updateLobby() {
    const lobbyPlayers = document.getElementById('lobbyPlayers');
    if (this.gameState && this.gameState.players) {
      lobbyPlayers.innerHTML = this.gameState.players.map(p => 
        `<div class="player-item ${p.ready ? 'player-ready' : ''}">
          ${p.name} ${p.ready ? '✓' : ''}
        </div>`
      ).join('');
    }
  }

  updateUI() {
    if (!this.gameState) return;

    document.getElementById('waveNum').textContent = this.gameState.wave;
    document.getElementById('goldAmount').textContent = this.gameState.gold;
    
    const healthPercent = Math.max(0, (this.gameState.health / 100) * 100);
    document.getElementById('healthBar').style.width = healthPercent + '%';

    const activePlayers = document.getElementById('activePlayers');
    activePlayers.innerHTML = this.gameState.players.map(p =>
      `<div class="player-item">${p.name}</div>`
    ).join('');
  }

  handleCanvasClick(e) {
    if (!this.selectedTower || !this.gameState) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.ws.send(JSON.stringify({
      type: 'placeTower',
      x: x,
      y: y,
      towerType: this.selectedTower
    }));
  }

  showTowerPreview(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const tooltip = document.getElementById('tooltip');
    tooltip.style.left = (e.clientX + 15) + 'px';
    tooltip.style.top = (e.clientY + 15) + 'px';
    tooltip.textContent = `Place ${this.selectedTower} tower`;
    tooltip.style.opacity = '1';
  }

  startGameLoop() {
    const animate = () => {
      this.render();
      requestAnimationFrame(animate);
    };
    animate();
  }

  render() {
    if (!this.gameState) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw path
    this.drawPath();

    // Draw towers
    this.gameState.towers.forEach(tower => this.drawTower(tower));

    // Draw enemies
    this.gameState.enemies.forEach(enemy => this.drawEnemy(enemy));
  }

  drawPath() {
    const path = [
      { x: 0, y: 300 },
      { x: 200, y: 300 },
      { x: 200, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 400 },
      { x: 600, y: 400 },
      { x: 600, y: 200 },
      { x: 800, y: 200 }
    ];

    this.ctx.strokeStyle = 'rgba(0, 247, 255, 0.3)';
    this.ctx.lineWidth = 40;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.beginPath();
    this.ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      this.ctx.lineTo(path[i].x, path[i].y);
    }
    this.ctx.stroke();

    // Draw path border
    this.ctx.strokeStyle = 'rgba(0, 247, 255, 0.6)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  drawTower(tower) {
    const ctx = this.ctx;
    
    // Tower colors
    const colors = {
      basic: '#00f7ff',
      fast: '#ff00ff',
      strong: '#ffff00'
    };

    // Draw range circle
    ctx.strokeStyle = `${colors[tower.type]}33`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, tower.range, 0, Math.PI * 2);
    ctx.stroke();

    // Draw tower base
    ctx.fillStyle = colors[tower.type];
    ctx.shadowBlur = 15;
    ctx.shadowColor = colors[tower.type];
    
    if (tower.type === 'basic') {
      ctx.fillRect(tower.x - 15, tower.y - 15, 30, 30);
    } else if (tower.type === 'fast') {
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, 15, 0, Math.PI * 2);
      ctx.fill();
    } else if (tower.type === 'strong') {
      ctx.beginPath();
      ctx.moveTo(tower.x, tower.y - 20);
      ctx.lineTo(tower.x + 17, tower.y + 10);
      ctx.lineTo(tower.x - 17, tower.y + 10);
      ctx.closePath();
      ctx.fill();
    }

    ctx.shadowBlur = 0;

    // Draw tower barrel
    ctx.fillStyle = '#fff';
    ctx.fillRect(tower.x - 3, tower.y - 25, 6, 15);
  }

  drawEnemy(enemy) {
    if (enemy.health <= 0) return;

    const ctx = this.ctx;
    
    // Draw enemy
    ctx.fillStyle = '#ff0000';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff0000';
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw health bar
    const healthPercent = enemy.health / enemy.maxHealth;
    const barWidth = 30;
    const barHeight = 4;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - 20, barWidth, barHeight);
    
    ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - 20, barWidth * healthPercent, barHeight);
  }
}

// Initialize game
const game = new TowerDefenseGame();
