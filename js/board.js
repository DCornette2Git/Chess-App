const PIECE_SYMBOLS = {
  wk: '\u2654\uFE0E', wq: '\u2655\uFE0E', wr: '\u2656\uFE0E', wb: '\u2657\uFE0E', wn: '\u2658\uFE0E', wp: '\u2659\uFE0E',
  bk: '\u265A\uFE0E', bq: '\u265B\uFE0E', br: '\u265C\uFE0E', bb: '\u265D\uFE0E', bn: '\u265E\uFE0E', bp: '\u265F\uFE0E',
};

const COLORS = {
  light: '#f0d9b5',
  dark: '#b58863',
  selectedLight: '#f7ec63',
  selectedDark: '#dac34b',
  lastMoveLight: '#cdd26a',
  lastMoveDark: '#aaa23a',
  checkGlow: '#ef4444',
};

function toSquare(row, col) {
  return String.fromCharCode(97 + col) + (8 - row);
}

export function getPieceSymbol(color, type) {
  return PIECE_SYMBOLS[color + type] || '';
}

export function renderBoard(boardEl, chess, playerColor, selectedSquare, legalMoves, lastMove) {
  boardEl.innerHTML = '';

  const board = chess.board();
  const isFlipped = playerColor === 'b';
  const rows = isFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const cols = isFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

  for (const r of rows) {
    for (const c of cols) {
      const sq = toSquare(r, c);
      const piece = board[r][c];
      const isLight = (r + c) % 2 === 0;

      const div = document.createElement('div');
      div.id = 'sq-' + sq;
      div.dataset.square = sq;
      div.className = 'square relative flex items-center justify-center cursor-pointer transition-all duration-150 w-full h-full overflow-hidden';

      // Background color
      let bg;
      if (selectedSquare === sq) {
        bg = isLight ? COLORS.selectedLight : COLORS.selectedDark;
      } else if (lastMove && (lastMove.from === sq || lastMove.to === sq)) {
        bg = isLight ? COLORS.lastMoveLight : COLORS.lastMoveDark;
      } else {
        bg = isLight ? COLORS.light : COLORS.dark;
      }
      div.style.backgroundColor = bg;

      // Check highlight on king
      if (piece && piece.type === 'k' && chess.in_check() && piece.color === chess.turn()) {
        div.style.boxShadow = `inset 0 0 18px 4px ${COLORS.checkGlow}`;
      }

      // Render piece
      if (piece) {
        const span = document.createElement('span');
        span.textContent = PIECE_SYMBOLS[piece.color + piece.type];
        span.className = 'piece select-none pointer-events-none leading-none';
        span.style.fontSize = 'clamp(2rem, 6vw, 3.2rem)';
        span.style.color = piece.color === 'w' ? '#ffffff' : '#000000';
        span.style.textShadow = piece.color === 'w'
          ? '0 2px 6px rgba(0,0,0,0.25)'
          : '0 2px 6px rgba(0,0,0,0.45)';
        div.appendChild(span);
      }

      // Legal move indicators
      if (legalMoves.includes(sq)) {
        const dot = document.createElement('div');
        dot.className = 'absolute pointer-events-none';
        if (piece) {
          // Capture ring
          dot.className += ' inset-0.5 rounded-full';
          dot.style.border = '4px solid rgba(0,0,0,0.2)';
        } else {
          // Move dot
          dot.className += ' w-[26%] h-[26%] rounded-full';
          dot.style.backgroundColor = 'rgba(0,0,0,0.2)';
        }
        div.appendChild(dot);
      }

      // Coordinate labels
      const isLeftEdge = c === (playerColor === 'w' ? 0 : 7);
      const isBottomEdge = r === (playerColor === 'w' ? 7 : 0);
      const labelColor = isLight ? 'color:#b58863' : 'color:#f0d9b5';

      if (isLeftEdge) {
        const rank = document.createElement('span');
        rank.textContent = 8 - r;
        rank.className = 'absolute top-0.5 left-1 text-[10px] font-bold pointer-events-none select-none';
        rank.style.cssText = labelColor;
        div.appendChild(rank);
      }
      if (isBottomEdge) {
        const file = document.createElement('span');
        file.textContent = String.fromCharCode(97 + c);
        file.className = 'absolute bottom-0.5 right-1 text-[10px] font-bold pointer-events-none select-none';
        file.style.cssText = labelColor;
        div.appendChild(file);
      }

      boardEl.appendChild(div);
    }
  }
}

export function getCapturedPieces(chess) {
  const history = chess.history({ verbose: true });
  const captured = { w: [], b: [] };
  for (const move of history) {
    if (move.captured) {
      const capturedColor = move.color === 'w' ? 'b' : 'w';
      captured[capturedColor].push(move.captured);
    }
  }
  return captured;
}
