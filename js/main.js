import { renderBoard, getCapturedPieces, getPieceSymbol } from './board.js?v=2.3';
import { initSupabase, createGame, fetchGame, sendMove, joinGame, subscribeToGame, signUpUser, signInUser, signOutUser, getCurrentSession, fetchOpenGames, deleteGame, deleteAllOpenGames } from './network.js?v=2.6';

// --- State ---
let chess;
let currentUser = null;
let isLoginMode = true;
let gameId = null;
let playerColor = null;
let selectedSquare = null;
let legalMoves = [];
let lastMove = null;
let gameStatus = 'waiting';
let isAIMode = false;
let aiLevel = 10;
let engine = null;
let engineThinking = false;

// --- DOM refs ---
const gameView = document.getElementById('game-view');
const authView = document.getElementById('auth-view');
const authForm = document.getElementById('auth-form');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authError = document.getElementById('auth-error');
const lobbyView = document.getElementById('lobby-view');
const lobbyUsername = document.getElementById('lobby-username');
const openGamesList = document.getElementById('open-games-list');
const boardEl = document.getElementById('board');
const statusEl = document.getElementById('game-status');
const turnEl = document.getElementById('turn-indicator');
const playerColorLabel = document.getElementById('player-color-label');
const capturedByPlayer = document.getElementById('captured-by-player');
const capturedByOpponent = document.getElementById('captured-by-opponent');
const moveHistoryEl = document.getElementById('move-history');
const opponentName = document.getElementById('opponent-name');
const playerName = document.getElementById('player-name');
const promotionDialog = document.getElementById('promotion-dialog');
const promotionPieces = document.getElementById('promotion-pieces');
const gameoverDialog = document.getElementById('gameover-dialog');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverSubtitle = document.getElementById('gameover-subtitle');
const newGameBtn = document.getElementById('new-game-btn');
const resetBtn = document.getElementById('reset-btn');
const undoBtn = document.getElementById('undo-btn');
const resetModal = document.getElementById('reset-modal');
const confirmResetBtn = document.getElementById('confirm-reset-btn');
const cancelResetBtn = document.getElementById('cancel-reset-btn');
const playAIBtn = document.getElementById('play-ai-btn');
const aiModal = document.getElementById('ai-modal');
const cancelAIBtn = document.getElementById('cancel-ai-btn');
const confirmAIBtn = document.getElementById('confirm-ai-btn');
const aiLevelSelect = document.getElementById('ai-level-select');
const aiColorW = document.getElementById('ai-color-w');
const aiColorB = document.getElementById('ai-color-b');
let selectedAIColor = 'w';

// --- Helpers ---
function generateGameId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function getMovesString() {
  return chess.history({ verbose: true })
    .map(m => m.from + m.to + (m.promotion || ''))
    .join('|');
}

function computeStatus() {
  if (chess.in_checkmate()) return 'checkmate';
  if (chess.in_stalemate()) return 'stalemate';
  if (chess.in_draw()) return 'draw';
  return 'active';
}

function needsPromotion(from, to) {
  const piece = chess.get(from);
  if (!piece || piece.type !== 'p') return false;
  const rank = to[1];
  return (piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1');
}

// --- Rendering ---
function draw() {
  renderBoard(boardEl, chess, playerColor || 'w', selectedSquare, legalMoves, lastMove);
  // Re-attach click handlers
  boardEl.querySelectorAll('[data-square]').forEach(el => {
    el.addEventListener('click', () => handleSquareClick(el.dataset.square));
  });
}

function updateUI() {
  // Turn
  const isWhiteTurn = chess.turn() === 'w';
  const turnText = isWhiteTurn ? "White's turn" : "Black's turn";
  turnEl.textContent = turnText;
  const isMyTurn = chess.turn() === playerColor;
  turnEl.className = isMyTurn
    ? 'text-sm font-semibold text-emerald-400'
    : 'text-sm font-medium text-white/60';

  // Status
  if (chess.in_checkmate()) {
    const winner = chess.turn() === 'w' ? 'Black' : 'White';
    statusEl.textContent = `Checkmate — ${winner} wins!`;
    statusEl.className = 'text-sm font-semibold text-amber-400';
  } else if (chess.in_stalemate()) {
    statusEl.textContent = 'Stalemate — Draw';
    statusEl.className = 'text-sm font-semibold text-amber-400';
  } else if (chess.in_draw()) {
    statusEl.textContent = 'Draw';
    statusEl.className = 'text-sm font-semibold text-amber-400';
  } else if (chess.in_check()) {
    statusEl.textContent = 'Check!';
    statusEl.className = 'text-sm font-semibold text-red-400';
  } else if (gameStatus === 'waiting') {
    statusEl.textContent = 'Waiting for opponent…';
    statusEl.className = 'text-sm font-medium text-violet-400 animate-pulse';
  } else {
    statusEl.textContent = 'In progress';
    statusEl.className = 'text-sm font-medium text-emerald-400';
  }

  // Captured pieces
  const captured = getCapturedPieces(chess);

  // Top = Opponent's pieces you captured, Bottom = Your pieces they captured
  const topColor = playerColor === 'w' ? 'b' : 'w';
  const bottomColor = playerColor || 'w';

  if (captured[topColor]) {
    capturedByPlayer.innerHTML = captured[topColor]
      .map(t => `<span class="${topColor === 'w' ? 'text-white' : 'text-white/40'}">${getPieceSymbol(topColor, t)}</span>`).join(' ');
  }

  if (captured[bottomColor]) {
    capturedByOpponent.innerHTML = captured[bottomColor]
      .map(t => `<span class="${bottomColor === 'w' ? 'text-white' : 'text-white/40'}">${getPieceSymbol(bottomColor, t)}</span>`).join(' ');
  }

  // Move history
  const history = chess.history();
  if (history.length === 0) {
    moveHistoryEl.innerHTML = '<p class="text-white/30 text-xs italic">No moves yet</p>';
  } else {
    let html = '<div class="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-0.5 text-xs">';
    for (let i = 0; i < history.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      html += `<span class="text-white/30 text-right">${num}.</span>`;
      html += `<span class="text-white/80 font-mono">${history[i]}</span>`;
      html += i + 1 < history.length
        ? `<span class="text-white/60 font-mono">${history[i + 1]}</span>`
        : '<span></span>';
    }
    html += '</div>';
    moveHistoryEl.innerHTML = html;
    moveHistoryEl.scrollTop = moveHistoryEl.scrollHeight;
  }

  // Player labels
  if (playerColor) {
    const colorName = playerColor === 'w' ? 'White' : 'Black';
    const levelMap = {'0': '1', '5': '2', '10': '3', '15': '4', '20': '5'};
    const oppName = isAIMode ? `Computer (Level ${levelMap[aiLevel] || 3})` : (playerColor === 'w' ? 'Black' : 'White');

    playerColorLabel.textContent = colorName;
    playerColorLabel.className = `text-sm font-semibold ${playerColor === 'w' ? 'text-white' : 'text-gray-300'}`;

    playerName.textContent = `You (${colorName})`;
    opponentName.textContent = oppName;
  }

  // Game over dialog
  if (chess.game_over() && !gameoverDialog.classList.contains('shown')) {
    gameoverDialog.classList.add('shown');
    setTimeout(() => {
      gameoverDialog.classList.remove('hidden');
      gameoverDialog.classList.add('flex');
      if (chess.in_checkmate()) {
        const winner = chess.turn() === 'w' ? 'Black' : 'White';
        gameoverTitle.textContent = 'Checkmate!';
        gameoverSubtitle.textContent = `${winner} wins the game.`;
      } else if (chess.in_stalemate()) {
        gameoverTitle.textContent = 'Stalemate';
        gameoverSubtitle.textContent = 'The game is a draw.';
      } else {
        gameoverTitle.textContent = 'Draw';
        gameoverSubtitle.textContent = 'The game ended in a draw.';
      }
    }, 600);
  }
}

// --- Interaction ---
function handleSquareClick(square) {
  if (!playerColor) return;
  if (chess.turn() !== playerColor) return;
  if (chess.game_over() || engineThinking) return;
  if (gameStatus !== 'active' && !(gameStatus === 'waiting' && playerColor === 'w' && chess.history().length === 0)) {
    // Only white can move first while waiting, once game is created
    // Actually, let white move even while waiting - moves will sync when opponent joins
    if (gameStatus !== 'waiting') return;
  }

  const piece = chess.get(square);

  if (selectedSquare) {
    if (square === selectedSquare) {
      // Deselect
      deselect();
    } else if (piece && piece.color === playerColor) {
      // Select different piece
      select(square);
    } else if (legalMoves.includes(square)) {
      // Attempt move
      tryMove(selectedSquare, square);
    } else {
      deselect();
    }
  } else {
    if (piece && piece.color === playerColor) {
      select(square);
    }
  }
  draw();
  updateUI();
}

function select(square) {
  selectedSquare = square;
  const moves = chess.moves({ square, verbose: true });
  legalMoves = moves.map(m => m.to);
}

function deselect() {
  selectedSquare = null;
  legalMoves = [];
}

function tryMove(from, to) {
  if (needsPromotion(from, to)) {
    showPromotionDialog(from, to);
    return;
  }
  executeMove(from, to);
}

function executeMove(from, to, promotion) {
  const move = chess.move({ from, to, promotion });
  if (!move) return;
  afterMove(move);
}

function afterMove(move) {
  deselect();
  lastMove = { from: move.from, to: move.to };

  const movesStr = getMovesString();
  const computedStatus = computeStatus();

  // Keep 'waiting' status even after white's move, until opponent joins
  let syncStatus = computedStatus;
  if (computedStatus === 'active' && gameStatus === 'waiting') {
    syncStatus = 'waiting';
  }

  // Update local gameStatus only if it's a terminals state
  if (['checkmate', 'stalemate', 'draw'].includes(computedStatus)) {
    gameStatus = computedStatus;
    syncStatus = computedStatus;
  }

  sendMove(gameId, movesStr, syncStatus).catch(err => {
    console.error('Failed to send move:', err);
    statusEl.textContent = 'Sync error — retrying…';
    setTimeout(() => sendMove(gameId, movesStr, syncStatus).catch(console.error), 2000);
  });

  draw();
  updateUI();

  if (isAIMode && gameStatus === 'active' && chess.turn() !== playerColor && !chess.game_over()) {
    askEngine();
  }
}

// --- Promotion ---
function showPromotionDialog(from, to) {
  promotionDialog.classList.remove('hidden');
  promotionDialog.classList.add('flex');
  promotionPieces.innerHTML = '';

  const pieces = ['q', 'r', 'b', 'n'];
  const names = ['Queen', 'Rook', 'Bishop', 'Knight'];
  pieces.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'w-16 h-16 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-xl border border-white/20 transition-all hover:scale-110 cursor-pointer';
    btn.title = names[i];
    const span = document.createElement('span');
    span.textContent = getPieceSymbol(playerColor, p);
    span.className = `text-4xl select-none ${playerColor === 'w' ? 'text-white' : 'text-white/40'}`;
    btn.appendChild(span);
    btn.addEventListener('click', () => {
      promotionDialog.classList.add('hidden');
      promotionDialog.classList.remove('flex');
      executeMove(from, to, p);
    });
    promotionPieces.appendChild(btn);
  });
}

// --- Remote sync ---
function onRemoteUpdate(data) {
  const remoteMoves = data.moves ? data.moves.split('|').filter(m => m) : [];
  const localCount = chess.history().length;

  // Detect reset (remote has fewer moves than local)
  if (remoteMoves.length < localCount) {
    chess.reset();
    lastMove = null;
    deselect();
    // Replay any moves that might still be in remote (e.g., if it wasn't a full reset)
    for (const uci of remoteMoves) {
      const from = uci.substring(0, 2);
      const to = uci.substring(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = chess.move({ from, to, promotion });
      if (move) lastMove = { from: move.from, to: move.to };
    }
    draw();
  } 
  // Apply new moves
  else if (remoteMoves.length > localCount) {
    for (let i = localCount; i < remoteMoves.length; i++) {
      const uci = remoteMoves[i];
      const from = uci.substring(0, 2);
      const to = uci.substring(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = chess.move({ from, to, promotion });
      if (move) lastMove = { from: move.from, to: move.to };
    }
    deselect();
    draw();
  }

  // Status change
  if (data.status === 'active') {
    if (gameStatus === 'waiting') {
      gameStatus = 'active';
    }
    gameoverDialog.classList.add('hidden');
    gameoverDialog.classList.remove('flex');
    gameoverDialog.classList.remove('shown');
  }
  if (data.status === 'checkmate' || data.status === 'stalemate' || data.status === 'draw') {
    gameStatus = data.status;
  }

  updateUI();
}

// --- AI Logic ---
function startEngine() {
  if (!engine) {
    try {
      engine = new Worker('js/stockfish.js');
      engine.onmessage = handleEngineMessage;
    } catch (e) {
      console.warn('Local worker failed, trying cloud fallback...', e);
      try {
        const workerBlob = new Blob([`importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`], { type: 'application/javascript' });
        engine = new Worker(URL.createObjectURL(workerBlob));
        engine.onmessage = handleEngineMessage;
      } catch (err) {
        console.error('Failed to start engine completely:', err);
      }
    }
  }
}

function handleEngineMessage(event) {
  const line = event.data;
  if (line && line.startsWith('bestmove')) {
    engineThinking = false;
    const move = line.split(' ')[1];
    if (move && move !== '(none)') {
      const from = move.substring(0, 2);
      const to = move.substring(2, 4);
      const promotion = move.length > 4 ? move[4] : undefined;
      executeMove(from, to, promotion);
    }
  }
}

function askEngine() {
  if (!engine || chess.game_over()) return;
  engineThinking = true;
  engine.postMessage('setoption name Skill Level value ' + aiLevel);
  engine.postMessage('position fen ' + chess.fen());
  engine.postMessage('go movetime 500');
}

// --- Auth & Lobby Logic ---
async function showLobby() {
  authView.classList.add('hidden');
  gameView.classList.add('hidden');
  lobbyView.classList.remove('hidden');
  
  lobbyUsername.textContent = currentUser.user_metadata?.username || 'Player';
  await refreshLobby();
}

async function refreshLobby() {
  openGamesList.innerHTML = '<p class="text-white/30 text-sm italic text-center mt-8">Loading games...</p>';
  try {
    const games = await fetchOpenGames();
    if (games.length === 0) {
      openGamesList.innerHTML = '<p class="text-white/30 text-sm italic text-center mt-8">No open games found. Create one!</p>';
      return;
    }
    
    let html = '';
    for (const g of games) {
      const parts = g.status.split(':');
      const hostName = parts.length > 1 ? parts[1] : 'Unknown';
      html += `
        <div class="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-3 flex items-center justify-between transition-colors mb-2">
          <div>
            <div class="text-white font-medium text-sm">Host: ${hostName}</div>
            <div class="text-white/40 text-xs">Game ID: ${g.id}</div>
          </div>
          <div class="flex items-center gap-2">
            <button data-delete="${g.id}" class="text-white/40 hover:text-red-400 transition-colors p-1" title="Delete Game">
              🗑️
            </button>
            <button data-join="${g.id}" class="bg-violet-600 hover:bg-violet-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer active:scale-95">Join Game</button>
          </div>
        </div>
      `;
    }
    openGamesList.innerHTML = html;
  } catch (err) {
    console.error(err);
    openGamesList.innerHTML = '<p class="text-red-400 text-sm text-center mt-8">Failed to load games.</p>';
  }
}

// --- Init ---
async function init() {
  chess = new Chess();

  // Attempt Supabase connection first
  try {
    initSupabase();
  } catch (err) {
    console.error('Supabase init failed:', err);
    authError.textContent = 'Set your Supabase URL & key in js/config.js';
    authError.classList.remove('hidden');
    return;
  }

  // Check auth
  try {
    const session = await getCurrentSession();
    if (session) {
      currentUser = session.user;
    }
  } catch (err) {
    console.error('Session check failed', err);
  }

  // Parse URL
  const params = new URLSearchParams(window.location.search);
  
  if (params.get('ai') === 'true') {
    isAIMode = true;
    aiLevel = parseInt(params.get('level')) || 10;
  }
  
  gameId = params.get('gameID');

  if (!currentUser && !gameId) {
    // Show Auth
    authView.classList.remove('hidden');
    gameView.classList.add('hidden');
    return;
  }

  if (currentUser && !gameId) {
    // Show Lobby
    showLobby();
    return;
  }

  // If we reach here, we have a gameId, so we show the game view
  authView.classList.add('hidden');
  lobbyView.classList.add('hidden');
  gameView.classList.remove('hidden');
  
  playerColor = 'w';
  draw();
  updateUI();

  if (!gameId) {
    // --- Create new game ---
    gameId = generateGameId();
    playerColor = isAIMode ? (params.get('c') === 'b' ? 'b' : 'w') : 'w';
    localStorage.setItem(`chess_${gameId}`, playerColor);

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('gameID', gameId);
    window.history.replaceState({}, '', url);

    try {
      await createGame(gameId);
    } catch (err) {
      console.error('Failed to create game:', err);
      statusEl.textContent = 'Error creating game. Check Supabase config.';
      statusEl.className = 'text-sm font-semibold text-red-400';
      draw();
      updateUI();
      return;
    }

    if (isAIMode) {
      gameStatus = 'active'; // In AI mode we don't wait for opponent
      startEngine();
      if (playerColor === 'b') askEngine();
    } else {
      gameStatus = currentUser ? `waiting:${currentUser.user_metadata?.username || 'Player'}` : 'waiting';
      // Sync waiting status
      try { await sendMove(gameId, '', gameStatus); } catch(e){}
    }
  } else {
    // --- Join existing game ---
    const savedColor = localStorage.getItem(`chess_${gameId}`);

    let game;
    try {
      game = await fetchGame(gameId);
    } catch (err) {
      console.error('Failed to fetch game:', err);
      statusEl.textContent = 'Error loading game.';
      statusEl.className = 'text-sm font-semibold text-red-400';
      draw();
      updateUI();
      return;
    }

    if (!game) {
      statusEl.textContent = 'Game not found.';
      statusEl.className = 'text-sm font-semibold text-red-400';
      draw();
      updateUI();
      return;
    }

    if (savedColor) {
      playerColor = savedColor;
      if (isAIMode) startEngine();
    } else if (!isAIMode && game.status.startsWith('waiting')) {
      playerColor = params.get('c') === 'w' ? 'w' : 'b';
      localStorage.setItem(`chess_${gameId}`, playerColor);
      try {
        await joinGame(gameId);
      } catch (err) {
        console.error('Failed to join game:', err);
      }
      gameStatus = 'active';
    } else if (!isAIMode) {
      // If status is active but no moves made yet, allow joining
      const moveCount = (game.moves || '').split('|').filter(m => m).length;
      if (moveCount === 0 || moveCount === 1) {
        // Handles the case where white already moved but black is just now clicking the link
        playerColor = params.get('c') === 'w' ? 'w' : 'b';
        localStorage.setItem(`chess_${gameId}`, playerColor);
        try {
          await joinGame(gameId);
        } catch (err) {
          console.error('Failed to join game:', err);
        }
        gameStatus = 'active';
      } else {
        // Game in progress — default to black (read-only, cannot move)
        playerColor = 'b';
      }
    }

    gameStatus = game.status;

    // Replay moves
    if (game.moves) {
      const moves = game.moves.split('|').filter(m => m);
      for (const uci of moves) {
        const from = uci.substring(0, 2);
        const to = uci.substring(2, 4);
        const promotion = uci.length > 4 ? uci[4] : undefined;
        const move = chess.move({ from, to, promotion });
        if (move) lastMove = { from: move.from, to: move.to };
      }
    }
  }

  // Subscribe to realtime
  subscribeToGame(gameId, onRemoteUpdate);

  // Re-render with final state
  draw();
  updateUI();
}

// Auth Form Handler
if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = authUsername.value.trim();
    const password = authPassword.value;
    if (!username || !password) return;
    
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = 'Please wait...';
    authError.classList.add('hidden');
    
    try {
      if (isLoginMode) {
        const data = await signInUser(username, password);
        currentUser = data.user;
      } else {
        const data = await signUpUser(username, password);
        currentUser = data.user;
      }
      showLobby();
    } catch (err) {
      authError.textContent = err.message || 'Authentication failed';
      authError.classList.remove('hidden');
    } finally {
      authSubmitBtn.disabled = false;
      authSubmitBtn.textContent = 'Play Now';
    }
  });
}

// Auth Toggle Handler
if (authToggleBtn) {
  authToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    authToggleBtn.innerHTML = isLoginMode 
      ? 'Need an account? <span class="text-violet-400">Register</span>'
      : 'Already have an account? <span class="text-violet-400">Login</span>';
    authSubmitBtn.textContent = 'Play Now';
    authError.classList.add('hidden');
  });
}

// --- Event listeners (Global Delegate for robustness) ---
document.addEventListener('click', (e) => {
  const targetId = e.target.closest('button')?.id;
  if (!targetId) return;

  if (targetId === 'new-game-btn') {
    window.location.href = window.location.pathname;
  }

  if (targetId === 'rematch-btn') {
    chess.reset();
    lastMove = null;
    deselect();
    gameStatus = 'active';

    sendMove(gameId, '', 'active').then(() => {
      console.log('Rematch successfully synced to Supabase.');
    }).catch(err => {
      console.error('Network Error: Rematch failed to sync:', err);
    });

    gameoverDialog.classList.add('hidden');
    gameoverDialog.classList.remove('flex');
    gameoverDialog.classList.remove('shown');

    draw();
    updateUI();
  }

  if (targetId === 'rotate-btn') {
    // Swap color
    playerColor = playerColor === 'w' ? 'b' : 'w';
    localStorage.setItem(`chess_${gameId}`, playerColor);
    
    draw();
    updateUI();
  }

  if (targetId === 'reset-btn') {
    // Show custom modal instead of window.confirm
    resetModal.classList.remove('hidden');
    resetModal.classList.add('flex');
  }

  if (targetId === 'cancel-reset-btn') {
    resetModal.classList.add('hidden');
    resetModal.classList.remove('flex');
  }

  if (targetId === 'confirm-reset-btn') {
    console.log('Reset confirmed by user.');
    resetModal.classList.add('hidden');
    resetModal.classList.remove('flex');

    chess.reset();
    lastMove = null;
    deselect();
    gameStatus = 'active';

    sendMove(gameId, '', 'active').then(() => {
      console.log('Global reset successfully synced to Supabase.');
    }).catch(err => {
      console.error('Network Error: Reset failed to sync:', err);
    });

    draw();
    updateUI();
  }

  if (targetId === 'undo-btn') {

    let move = null;
    if (isAIMode) {
      // Undo both AI an player move
      chess.undo();
      move = chess.undo();
    } else {
      move = chess.undo();
    }
    if (!move) return;

    const history = chess.history({ verbose: true });
    if (history.length > 0) {
      const prev = history[history.length - 1];
      lastMove = { from: prev.from, to: prev.to };
    } else {
      lastMove = null;
    }

    deselect();
    const movesStr = getMovesString();
    
    // In AI Game, status could have been checkmate, now back to active
    gameStatus = computeStatus();
    
    sendMove(gameId, movesStr, gameStatus);
    
    draw();
    updateUI();
  }
  if (targetId === 'play-ai-btn') {
    aiModal.classList.remove('hidden');
    aiModal.classList.add('flex');
    
    // Select White by default
    selectedAIColor = 'w';
    aiColorW.classList.replace('bg-white/5', 'bg-white/20');
    aiColorW.classList.replace('text-white/60', 'text-white');
    aiColorW.classList.replace('border-transparent', 'border-emerald-500');
    aiColorB.classList.replace('bg-white/20', 'bg-white/5');
    aiColorB.classList.replace('text-white', 'text-white/60');
    aiColorB.classList.replace('border-emerald-500', 'border-transparent');
  }

  if (targetId === 'logout-btn') {
    signOutUser().then(() => {
      currentUser = null;
      window.location.search = '';
    }).catch(err => console.error(err));
  }

  if (targetId === 'create-public-btn') {
    // We create a new game manually here to avoid reload
    gameId = generateGameId();
    playerColor = 'w';
    localStorage.setItem(`chess_${gameId}`, playerColor);

    const url = new URL(window.location);
    url.searchParams.set('gameID', gameId);
    window.history.replaceState({}, '', url);

    createGame(gameId).then(() => {
      gameStatus = currentUser ? `waiting:${currentUser.user_metadata?.username || 'Player'}` : 'waiting';
      sendMove(gameId, '', gameStatus).catch(e => console.error(e));

      authView.classList.add('hidden');
      lobbyView.classList.add('hidden');
      gameView.classList.remove('hidden');

      subscribeToGame(gameId, onRemoteUpdate);
      draw();
      updateUI();
    }).catch(err => {
      console.error('Failed to create public game:', err);
      alert('Error creating game.');
    });
  }

  if (targetId === 'lobby-play-ai-btn') {
    aiModal.classList.remove('hidden');
    aiModal.classList.add('flex');
    selectedAIColor = 'w';
    aiColorW.classList.replace('bg-white/5', 'bg-white/20');
    aiColorW.classList.replace('text-white/60', 'text-white');
    aiColorW.classList.replace('border-transparent', 'border-emerald-500');
    aiColorB.classList.replace('bg-white/20', 'bg-white/5');
    aiColorB.classList.replace('text-white', 'text-white/60');
    aiColorB.classList.replace('border-emerald-500', 'border-transparent');
  }

  if (targetId === 'refresh-lobby-btn') {
    refreshLobby();
  }

  const joinBtn = e.target.closest('button[data-join]');
  if (joinBtn) {
    const joinId = joinBtn.dataset.join;
    window.location.search = `?gameID=${joinId}&c=b`;
  }

  const deleteBtn = e.target.closest('button[data-delete]');
  if (deleteBtn) {
    const delId = deleteBtn.dataset.delete;
    if (confirm('Delete this game?')) {
      deleteGame(delId).then(() => {
        refreshLobby();
      }).catch(err => console.error(err));
    }
  }

  if (targetId === 'clear-lobby-btn') {
    if (confirm('Delete ALL open games in the lobby?')) {
      deleteAllOpenGames().then(() => {
        refreshLobby();
      }).catch(err => console.error(err));
    }
  }

  if (targetId === 'cancel-ai-btn') {
    aiModal.classList.add('hidden');
    aiModal.classList.remove('flex');
  }

  if (targetId === 'ai-color-w') {
    selectedAIColor = 'w';
    aiColorW.classList.replace('bg-white/5', 'bg-white/20');
    aiColorW.classList.replace('text-white/60', 'text-white');
    aiColorW.classList.replace('border-transparent', 'border-emerald-500');
    aiColorB.classList.replace('bg-white/20', 'bg-white/5');
    aiColorB.classList.replace('text-white', 'text-white/60');
    aiColorB.classList.replace('border-emerald-500', 'border-transparent');
  }

  if (targetId === 'ai-color-b') {
    selectedAIColor = 'b';
    aiColorB.classList.replace('bg-white/5', 'bg-white/20');
    aiColorB.classList.replace('text-white/60', 'text-white');
    aiColorB.classList.replace('border-transparent', 'border-emerald-500');
    aiColorW.classList.replace('bg-white/20', 'bg-white/5');
    aiColorW.classList.replace('text-white', 'text-white/60');
    aiColorW.classList.replace('border-emerald-500', 'border-transparent');
  }

  if (targetId === 'confirm-ai-btn') {
    const level = aiLevelSelect.value;
    window.location.search = `?ai=true&level=${level}&c=${selectedAIColor}`;
  }
});

// Start
init().catch(err => console.error('Init error:', err));
