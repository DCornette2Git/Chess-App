import { renderBoard, getCapturedPieces, getPieceSymbol } from './board.js';
import { initSupabase, createGame, fetchGame, sendMove, joinGame, subscribeToGame } from './network.js';

// --- State ---
let chess;
let gameId = null;
let playerColor = null;
let selectedSquare = null;
let legalMoves = [];
let lastMove = null;
let gameStatus = 'waiting';

// --- DOM refs ---
const boardEl = document.getElementById('board');
const shareBanner = document.getElementById('share-banner');
const shareLink = document.getElementById('share-link');
const copyBtn = document.getElementById('copy-btn');
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
  const opponentColor = playerColor === 'w' ? 'b' : 'w';

  // Opponent's pieces you have taken
  capturedByPlayer.innerHTML = captured[opponentColor]
    .map(t => `<span class="${opponentColor === 'w' ? 'text-white' : 'text-white/40'}">${getPieceSymbol(opponentColor, t)}</span>`).join(' ');

  // Your pieces that have been taken
  capturedByOpponent.innerHTML = captured[playerColor]
    .map(t => `<span class="${playerColor === 'w' ? 'text-white' : 'text-white/40'}">${getPieceSymbol(playerColor, t)}</span>`).join(' ');

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
    const isSpectator = playerColor === 'spectator';
    const colorName = playerColor === 'w' ? 'White' : (playerColor === 'b' ? 'Black' : 'Spectator');
    const oppName = playerColor === 'w' ? 'Black' : (playerColor === 'b' ? 'White' : 'Both Players');

    playerColorLabel.textContent = colorName;
    playerColorLabel.className = `text-sm font-semibold ${playerColor === 'w' ? 'text-white' : (playerColor === 'b' ? 'text-gray-300' : 'text-violet-400')}`;

    console.log('Role identified:', playerColor); // Debug log

    playerName.textContent = isSpectator ? 'Spectating View' : `You (${colorName})`;
    opponentName.textContent = isSpectator ? 'Active Game' : oppName;
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
  if (!playerColor || playerColor === 'spectator') return;
  if (chess.turn() !== playerColor) return;
  if (chess.game_over()) return;
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
    // Retry once
    setTimeout(() => sendMove(gameId, movesStr, syncStatus).catch(console.error), 2000);
  });

  draw();
  updateUI();
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
  if (data.status === 'active' && gameStatus === 'waiting') {
    gameStatus = 'active';
    shareBanner.style.transform = 'translateY(-100%)';
    setTimeout(() => shareBanner.classList.add('hidden'), 500);
  }
  if (data.status === 'checkmate' || data.status === 'stalemate' || data.status === 'draw') {
    gameStatus = data.status;
  }

  updateUI();
}

// --- Init ---
async function init() {
  chess = new Chess();

  // Render board immediately so UI is never blank
  playerColor = 'w';
  draw();
  updateUI();

  // Attempt Supabase connection
  try {
    initSupabase();
  } catch (err) {
    console.error('Supabase init failed:', err);
    statusEl.textContent = 'Set your Supabase URL & key in js/config.js';
    statusEl.className = 'text-sm font-semibold text-red-400';
    return;
  }

  // Parse URL
  const params = new URLSearchParams(window.location.search);
  gameId = params.get('gameID');

  if (!gameId) {
    // --- Create new game ---
    gameId = generateGameId();
    playerColor = 'w';
    localStorage.setItem(`chess_${gameId}`, 'w');

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

    // Show share banner
    const link = window.location.href;
    shareLink.value = link;
    shareBanner.classList.remove('hidden');
    setTimeout(() => { shareBanner.style.transform = 'translateY(0)'; }, 50);

    gameStatus = 'waiting';
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
    } else if (game.status === 'waiting') {
      playerColor = 'b';
      localStorage.setItem(`chess_${gameId}`, 'b');
      try {
        await joinGame(gameId);
      } catch (err) {
        console.error('Failed to join game:', err);
      }
      gameStatus = 'active';
    } else {
      // If status is active but no moves made yet, allow joining as black
      const moveCount = (game.moves || '').split('|').filter(m => m).length;
      if (moveCount === 0 || moveCount === 1) {
        // This handles cases where white already moved but black is just now clicking the link
        playerColor = 'b';
        localStorage.setItem(`chess_${gameId}`, 'b');
        try {
          await joinGame(gameId);
        } catch (err) {
          console.error('Failed to join game:', err);
        }
        gameStatus = 'active';
      } else {
        // Game definitely in progress with multiple moves — spectator
        playerColor = 'spectator';
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

// --- Event listeners (Global Delegate for robustness) ---
document.addEventListener('click', (e) => {
  const targetId = e.target.closest('button')?.id;
  if (!targetId) return;

  if (targetId === 'copy-btn') {
    navigator.clipboard.writeText(shareLink.value).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('bg-emerald-500/30');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('bg-emerald-500/30');
      }, 2000);
    });
  }

  if (targetId === 'new-game-btn') {
    window.location.href = window.location.pathname;
  }

  if (targetId === 'reset-btn') {
    console.log('Reset button clicked. Role:', playerColor);
    if (playerColor === 'spectator') {
      alert('Spectators cannot reset the game.');
      return;
    }
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
    if (playerColor === 'spectator') {
      alert('Spectators cannot undo moves.');
      return;
    }

    const move = chess.undo();
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
    const status = computeStatus();

    sendMove(gameId, movesStr, status);
    draw();
    updateUI();
  }
});

// Start
init().catch(err => console.error('Init error:', err));
