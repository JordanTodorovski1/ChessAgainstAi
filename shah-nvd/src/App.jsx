import { Chess } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import stockfishWorkerUrl from "stockfish/bin/stockfish-18-asm.js?url";

const BOARD_SIZE = 560;
const TOKEN_KEY = "chess_auth_token";
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const PIECE_IMAGES = {
  wK: "https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg",
  wQ: "https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg",
  wR: "https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg",
  wB: "https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg",
  wN: "https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg",
  wP: "https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg",
  bK: "https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg",
  bQ: "https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg",
  bR: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg",
  bB: "https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg",
  bN: "https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg",
  bP: "https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg",
};
const DIFFICULTY_CONFIG = {
  beginner: { label: "Beginner", skillLevel: 2, moveTimeMs: 180 },
  intermediate: { label: "Intermediate", skillLevel: 10, moveTimeMs: 700 },
  pro: { label: "Pro", skillLevel: 20, moveTimeMs: 1700 },
};

export default function App() {
  const [game, setGame] = useState(new Chess());
  const [gameStarted, setGameStarted] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [moveTargets, setMoveTargets] = useState({});
  const [isEngineThinking, setIsEngineThinking] = useState(false);
  const [draggedSourceSquare, setDraggedSourceSquare] = useState(null);
  const [draggingPiece, setDraggingPiece] = useState(null);
  const [gameHistory, setGameHistory] = useState([]);
  const [difficulty, setDifficulty] = useState("intermediate");
  const [userColor, setUserColor] = useState("w");
  const [authMode, setAuthMode] = useState("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [currentUser, setCurrentUser] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const engineRef = useRef(null);
  const boardRef = useRef(null);
  const suppressClickRef = useRef(false);
  const resultLoggedRef = useRef(false);

  const authHeaders = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    }),
    [authToken]
  );

  useEffect(() => {
    let engine;
    try {
      engine = new Worker(stockfishWorkerUrl);
      engine.postMessage("uci");
      engine.postMessage("isready");
      engineRef.current = engine;
    } catch (error) {
      console.error("Stockfish could not start:", error);
    }

    return () => {
      if (engineRef.current?.postMessage) {
        engineRef.current.postMessage("quit");
      }
      if (engineRef.current?.terminate) {
        engineRef.current.terminate();
      }
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function verifyAndLoad() {
      if (!authToken) {
        if (isMounted) {
          setCurrentUser(null);
          setGameHistory([]);
          setAuthChecking(false);
        }
        return;
      }

      setAuthChecking(true);
      try {
        const meResponse = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!meResponse.ok) {
          throw new Error("Unauthorized");
        }

        const meData = await meResponse.json();
        const gamesResponse = await fetch("/api/games", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const games = gamesResponse.ok ? await gamesResponse.json() : [];

        if (isMounted) {
          setCurrentUser(meData.user ?? null);
          setGameHistory(Array.isArray(games) ? games : []);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        if (isMounted) {
          setAuthToken("");
          setCurrentUser(null);
          setGameHistory([]);
        }
      } finally {
        if (isMounted) {
          setAuthChecking(false);
        }
      }
    }

    verifyAndLoad();
    return () => {
      isMounted = false;
    };
  }, [authToken]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!authUsername.trim() || !authPassword) {
      setAuthError("Username and password are required.");
      return;
    }

    setAuthSubmitting(true);
    setAuthError("");
    try {
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: authUsername.trim(),
          password: authPassword,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setAuthError(data?.error || "Authentication failed.");
        return;
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setAuthToken(data.token);
      setCurrentUser(data.user ?? null);
      setIsGuest(false);
      setAuthPassword("");
      setGame(new Chess());
      setGameStarted(false);
      setSelectedSquare(null);
      setMoveTargets({});
      setDraggedSourceSquare(null);
      setDraggingPiece(null);
      resultLoggedRef.current = false;
    } catch {
      setAuthError("Cannot reach server. Make sure backend is running.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      if (authToken) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }
    } catch {
      // Best effort logout.
    }

    localStorage.removeItem(TOKEN_KEY);
    setAuthToken("");
    setCurrentUser(null);
    setIsGuest(false);
    setGameHistory([]);
    setGame(new Chess());
    setGameStarted(false);
    setSelectedSquare(null);
    setMoveTargets({});
    setDraggedSourceSquare(null);
    setDraggingPiece(null);
    resultLoggedRef.current = false;
  }

  const requestEngineMove = useCallback(
    (fen) => {
      const engine = engineRef.current;
      if (!engine) return;
      const settings = DIFFICULTY_CONFIG[difficulty] ?? DIFFICULTY_CONFIG.intermediate;

      setIsEngineThinking(true);

      const handleMessage = (event) => {
        const line = typeof event === "string" ? event : event?.data;
        if (typeof line !== "string" || !line.startsWith("bestmove")) return;

        const bestMove = line.split(" ")[1];
        if (!bestMove || bestMove === "(none)") {
          setIsEngineThinking(false);
          return;
        }

        const from = bestMove.slice(0, 2);
        const to = bestMove.slice(2, 4);
        const promotion = bestMove.length > 4 ? bestMove[4] : undefined;

        setGame((currentGame) => {
          const gameCopy = new Chess(currentGame.fen());
          try {
            gameCopy.move({ from, to, promotion });
          } catch {
            // Ignore invalid engine move safely.
          }
          return gameCopy;
        });

        setIsEngineThinking(false);
        if (engine.removeEventListener) {
          engine.removeEventListener("message", handleMessage);
        }
      };

      if (engine.addEventListener) {
        engine.addEventListener("message", handleMessage);
      } else {
        const previousOnMessage = engine.onmessage;
        engine.onmessage = (event) => {
          if (previousOnMessage) previousOnMessage(event);
          handleMessage(event);
        };
      }

      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`setoption name Skill Level value ${settings.skillLevel}`);
      engine.postMessage(`go movetime ${settings.moveTimeMs}`);
    },
    [difficulty]
  );

  useEffect(() => {
    if (!currentUser && !isGuest) return;
    if (!gameStarted) return;
    if (game.isGameOver()) return;
    if (game.turn() === userColor) return;
    if (isEngineThinking) return;
    requestEngineMove(game.fen());
  }, [currentUser, game, gameStarted, isEngineThinking, isGuest, requestEngineMove, userColor]);

  function getGameResultSummary(currentGame) {
    if (currentGame.isCheckmate()) {
      const winnerColor = currentGame.turn() === "w" ? "b" : "w";
      return winnerColor === userColor
        ? { result: "Win", detail: "Checkmate" }
        : { result: "Loss", detail: "Checkmate" };
    }
    if (currentGame.isDraw()) {
      if (currentGame.isStalemate()) return { result: "Draw", detail: "Stalemate" };
      if (currentGame.isThreefoldRepetition()) return { result: "Draw", detail: "3-fold repetition" };
      if (currentGame.isInsufficientMaterial()) {
        return { result: "Draw", detail: "Insufficient material" };
      }
      if (currentGame.isDrawByFiftyMoves()) return { result: "Draw", detail: "50-move rule" };
      return { result: "Draw", detail: "Draw" };
    }
    return null;
  }

  function recordGameResultIfFinished(currentGame) {
    if (!currentUser || !authToken) return;
    if (!currentGame.isGameOver() || resultLoggedRef.current) return;

    const summary = getGameResultSummary(currentGame);
    if (!summary) return;

    const entry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      ...summary,
      endedAt: new Date().toLocaleString(),
    };

    setGameHistory((previous) => [entry, ...previous]);

    fetch("/api/games", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        result: entry.result,
        detail: entry.detail,
        endedAt: entry.endedAt,
      }),
    }).catch(() => {
      // Keep local history even if backend persistence fails.
    });

    resultLoggedRef.current = true;
  }

  useEffect(() => {
    if (!currentUser) return;
    if (!gameStarted) return;
    if (!game.isGameOver()) {
      resultLoggedRef.current = false;
      return;
    }
    recordGameResultIfFinished(game);
  }, [currentUser, game, gameStarted]);

  const getSquareFromPoint = useCallback((x, y) => {
    const boardRect = boardRef.current?.getBoundingClientRect();
    if (!boardRect) return null;

    if (x < boardRect.left || x > boardRect.right || y < boardRect.top || y > boardRect.bottom) {
      return null;
    }

    const squareSize = boardRect.width / 8;
    const fileIndex = Math.floor((x - boardRect.left) / squareSize);
    const rankIndex = Math.floor((y - boardRect.top) / squareSize);
    const clampedFileIndex = Math.min(Math.max(fileIndex, 0), 7);
    const clampedRankIndex = Math.min(Math.max(rankIndex, 0), 7);
    const file =
      userColor === "w" ? FILES[clampedFileIndex] : FILES[FILES.length - 1 - clampedFileIndex];
    const rank =
      userColor === "w"
        ? String(8 - clampedRankIndex)
        : String(1 + clampedRankIndex);

    if (!file || !rank) return null;
    return `${file}${rank}`;
  }, [userColor]);

  function safeMove(move) {
    let moveResult = null;
    setGame((currentGame) => {
      try {
        const gameCopy = new Chess(currentGame.fen());
        const attemptedMove = gameCopy.move(move);

        if (!attemptedMove) {
          return currentGame;
        }

        moveResult = attemptedMove;
        return gameCopy;
      } catch {
        return currentGame;
      }
    });
    return moveResult;
  }

  useEffect(() => {
    if (!draggingPiece) return;

    function handlePointerMove(event) {
      setDraggingPiece((current) =>
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
            }
          : null
      );
    }

    function handlePointerUp(event) {
      setDraggingPiece(null);
      setDraggedSourceSquare(null);
      suppressClickRef.current = true;

      if (!gameStarted || isEngineThinking || game.turn() !== userColor || game.isGameOver()) {
        return;
      }

      const targetSquare = getSquareFromPoint(event.clientX, event.clientY);
      if (!targetSquare) return;

      safeMove({
        from: draggingPiece.sourceSquare,
        to: targetSquare,
        promotion: "q",
      });
      setSelectedSquare(null);
      setMoveTargets({});
    }

    function handlePointerCancel() {
      setDraggingPiece(null);
      setDraggedSourceSquare(null);
      setSelectedSquare(null);
      setMoveTargets({});
      suppressClickRef.current = true;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [draggingPiece, game, gameStarted, getSquareFromPoint, isEngineThinking]);

  function getMoveOptions(square) {
    const moves = game.moves({ square, verbose: true });
    if (moves.length === 0) {
      setMoveTargets({});
      return;
    }

    const nextTargets = {};
    for (const move of moves) {
      nextTargets[move.to] = Boolean(game.get(move.to));
    }
    setMoveTargets(nextTargets);
  }

  function onPiecePointerDown(event, square) {
    if (!gameStarted || isEngineThinking || game.turn() !== userColor || game.isGameOver()) {
      return;
    }

    const piece = game.get(square);
    if (!piece || piece.color !== userColor) return;

    event.preventDefault();
    setSelectedSquare(square);
    getMoveOptions(square);
    setDraggedSourceSquare(square);
    setDraggingPiece({
      sourceSquare: square,
      pieceType: `${piece.color}${piece.type.toUpperCase()}`,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function onSquareClick(square) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    if (!gameStarted || isEngineThinking || game.turn() !== userColor || game.isGameOver()) {
      return;
    }

    if (selectedSquare) {
      const move = safeMove({ from: selectedSquare, to: square, promotion: "q" });
      if (move) {
        setSelectedSquare(null);
        setMoveTargets({});
        setDraggedSourceSquare(null);
        return;
      }
    }

    const piece = game.get(square);
    if (piece && piece.color === game.turn()) {
      setSelectedSquare(square);
      getMoveOptions(square);
    } else {
      setSelectedSquare(null);
      setMoveTargets({});
    }
  }

  const boardPosition = {};
  const currentBoard = game.board();
  for (let rankIndex = 0; rankIndex < currentBoard.length; rankIndex += 1) {
    const rank = currentBoard[rankIndex];
    for (let fileIndex = 0; fileIndex < rank.length; fileIndex += 1) {
      const piece = rank[fileIndex];
      if (!piece) continue;

      const square = `${String.fromCharCode(97 + fileIndex)}${8 - rankIndex}`;
      boardPosition[square] = {
        pieceType: `${piece.color}${piece.type.toUpperCase()}`,
      };
    }
  }

  if (draggedSourceSquare) {
    delete boardPosition[draggedSourceSquare];
  }

  const statusMessage = !gameStarted
    ? `Choose color and difficulty, then Start Game (${userColor === "w" ? "White" : "Black"}, ${DIFFICULTY_CONFIG[difficulty].label})`
    : game.isCheckmate()
    ? `Checkmate! ${game.turn() === "w" ? "Black" : "White"} wins!`
    : game.isDraw()
    ? "Draw!"
    : game.isCheck()
    ? `${game.turn() === "w" ? "White" : "Black"} is in check!`
    : isEngineThinking
    ? "Robot is thinking... 🤖"
    : `${game.turn() === "w" ? "White" : "Black"}'s turn`;

  const canPlayerMove =
    gameStarted && !isEngineThinking && game.turn() === userColor && !game.isGameOver();
  const wins = gameHistory.filter((entry) => entry.result === "Win").length;
  const losses = gameHistory.filter((entry) => entry.result === "Loss").length;
  const draws = gameHistory.filter((entry) => entry.result === "Draw").length;
  const filesForView = userColor === "w" ? FILES : [...FILES].reverse();
  const ranksForView = userColor === "w" ? RANKS : [...RANKS].reverse();
  const bottomRankForView = userColor === "w" ? "1" : "8";
  const leftFileForView = userColor === "w" ? "a" : "h";

  if (authChecking) {
    return (
      <div style={{ margin: "40px auto", textAlign: "center", color: "#f8e7cf", fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif" }}>
        Checking session...
      </div>
    );
  }

  if (!currentUser && !isGuest) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          boxSizing: "border-box",
          background:
            "radial-gradient(circle at 10% 20%, rgba(120,86,44,0.2) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(180,112,52,0.16) 0%, transparent 45%), linear-gradient(150deg, #0f0b08 0%, #1d130d 52%, #120c08 100%)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "430px",
            padding: "26px 24px 22px",
            borderRadius: "18px",
            background:
              "linear-gradient(160deg, rgba(54,35,20,0.94) 0%, rgba(24,15,10,0.97) 52%, rgba(66,40,22,0.94) 100%)",
            boxShadow:
              "0 24px 50px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 1px rgba(255,255,255,0.08)",
            color: "#f8e7cf",
            fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              marginBottom: "14px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(0,0,0,0.26)",
            }}
          >
            <div
              style={{
                padding: "12px 10px",
                textAlign: "center",
                fontWeight: 700,
                color: "#f8e7cf",
                letterSpacing: "0.2px",
                background: "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.24) 100%)",
              }}
            >
              Can you outsmart the AI?
            </div>
          </div>
          <h2 style={{ margin: "0 0 4px", textAlign: "center", fontSize: "1.5rem" }}>
            {authMode === "login" ? "Welcome Back" : "Create Account"}
          </h2>
          <p style={{ margin: "0 0 16px", textAlign: "center", color: "rgba(248,231,207,0.82)", fontSize: "0.92rem" }}>
            {authMode === "login" ? "Sign in to view your personal matches." : "Register to keep match history private."}
          </p>

          <div
            style={{
              marginBottom: "14px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "8px",
                border: authMode === "login" ? "1px solid #ffe4af" : "1px solid rgba(255,255,255,0.2)",
                background:
                  authMode === "login"
                    ? "linear-gradient(180deg, #f4d8ab 0%, #d4a96f 100%)"
                    : "rgba(0,0,0,0.24)",
                color: authMode === "login" ? "#2b1a11" : "#f8e7cf",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "8px",
                border: authMode === "register" ? "1px solid #ffe4af" : "1px solid rgba(255,255,255,0.2)",
                background:
                  authMode === "register"
                    ? "linear-gradient(180deg, #f4d8ab 0%, #d4a96f 100%)"
                    : "rgba(0,0,0,0.24)",
                color: authMode === "register" ? "#2b1a11" : "#f8e7cf",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleAuthSubmit}>
            <div style={{ marginBottom: "10px" }}>
              <input
                value={authUsername}
                onChange={(event) => setAuthUsername(event.target.value)}
                placeholder="Username"
                autoComplete="username"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  borderRadius: "9px",
                  border: "1px solid rgba(255,255,255,0.24)",
                  background: "rgba(0,0,0,0.3)",
                  color: "#fff",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ marginBottom: "10px" }}>
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="Password"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  borderRadius: "9px",
                  border: "1px solid rgba(255,255,255,0.24)",
                  background: "rgba(0,0,0,0.3)",
                  color: "#fff",
                  outline: "none",
                }}
              />
            </div>
            {authError ? (
              <div
                style={{
                  color: "#ffb3b3",
                  marginBottom: "10px",
                  fontSize: "0.9rem",
                  background: "rgba(122,24,24,0.26)",
                  border: "1px solid rgba(255,120,120,0.38)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                }}
              >
                {authError}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={authSubmitting}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.28)",
                background: "linear-gradient(180deg, #f4d8ab 0%, #d4a96f 100%)",
                color: "#2b1a11",
                fontWeight: 700,
                cursor: authSubmitting ? "default" : "pointer",
                opacity: authSubmitting ? 0.72 : 1,
              }}
            >
              {authSubmitting ? "Please wait..." : authMode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setIsGuest(true);
              setAuthError("");
              setGameHistory([]);
              setGame(new Chess());
              setGameStarted(false);
              setSelectedSquare(null);
              setMoveTargets({});
              setDraggedSourceSquare(null);
              setDraggingPiece(null);
            }}
            style={{
              width: "100%",
              marginTop: "10px",
              padding: "10px 12px",
              borderRadius: "9px",
              border: "1px solid rgba(255,255,255,0.24)",
              background: "rgba(0,0,0,0.24)",
              color: "#f8e7cf",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Play as Guest (No History)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: "980px",
        margin: "16px auto",
        fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif",
        display: "flex",
        gap: "18px",
        alignItems: "flex-start",
        justifyContent: "center",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          width: `${BOARD_SIZE + 56}px`,
          padding: "18px 18px 20px",
          borderRadius: "18px",
          background:
            "linear-gradient(160deg, rgba(52,34,20,0.92) 0%, rgba(24,15,10,0.96) 52%, rgba(61,38,22,0.92) 100%)",
          boxShadow: "0 18px 36px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
      >
        <p
          style={{
            textAlign: "center",
            fontSize: "1.02rem",
            margin: "0 0 14px",
            color: "#f8e7cf",
            letterSpacing: "0.2px",
            background: "rgba(0,0,0,0.22)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "10px",
            padding: "8px 10px",
          }}
        >
          {statusMessage}
        </p>
        {!gameStarted ? (
          <div
            style={{
              marginBottom: "12px",
              display: "flex",
              gap: "8px",
              justifyContent: "center",
            }}
          >
            {Object.entries(DIFFICULTY_CONFIG).map(([key, config]) => {
              const isActive = difficulty === key;
              return (
                <button
                  key={key}
                  onClick={() => setDifficulty(key)}
                  style={{
                    padding: "7px 12px",
                    fontSize: "0.85rem",
                    letterSpacing: "0.2px",
                    fontWeight: 700,
                    borderRadius: "8px",
                    border: isActive ? "1px solid #ffe4af" : "1px solid rgba(255,255,255,0.22)",
                    background: isActive
                      ? "linear-gradient(180deg, #f4d8ab 0%, #d4a96f 100%)"
                      : "rgba(0,0,0,0.26)",
                    color: isActive ? "#2b1a11" : "#f8e7cf",
                    cursor: "pointer",
                  }}
                >
                  {config.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          ref={boardRef}
          style={{
            width: `${BOARD_SIZE}px`,
            height: `${BOARD_SIZE}px`,
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gridTemplateRows: "repeat(8, 1fr)",
            border: "8px solid #3a2416",
            borderRadius: "10px",
            overflow: "hidden",
            boxSizing: "border-box",
            position: "relative",
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
            boxShadow: "0 14px 30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          {ranksForView.map((rank) =>
            filesForView.map((file) => {
              const square = `${file}${rank}`;
              const fileNumber = file.charCodeAt(0) - 96;
              const isLight = (fileNumber + Number(rank)) % 2 === 1;
              const piece = boardPosition[square];
              const isSelected = selectedSquare === square;
              const targetState = moveTargets[square];
              const showFileLabel = rank === bottomRankForView;
              const showRankLabel = file === leftFileForView;

              return (
                <div
                  key={square}
                  onClick={() => onSquareClick(square)}
                  style={{
                    backgroundColor: isSelected ? "#eed776" : isLight ? "#f3dfb7" : "#ae7a49",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    cursor: canPlayerMove ? "pointer" : "default",
                    transition: "background-color 120ms ease",
                  }}
                >
                  {piece && square !== draggedSourceSquare ? (
                    <img
                      onPointerDown={(event) => onPiecePointerDown(event, square)}
                      src={PIECE_IMAGES[piece.pieceType]}
                      alt={piece.pieceType}
                      style={{
                        width: "78%",
                        height: "78%",
                        objectFit: "contain",
                        cursor: canPlayerMove ? "grab" : "default",
                        filter: "drop-shadow(0 2px 1px rgba(0,0,0,0.35))",
                      }}
                      draggable={false}
                    />
                  ) : null}

                  {!piece && targetState === false ? (
                    <span
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "50%",
                        backgroundColor: "rgba(32,32,32,0.26)",
                      }}
                    />
                  ) : null}

                  {targetState === true ? (
                    <span
                      style={{
                        position: "absolute",
                        inset: "9px",
                        borderRadius: "50%",
                        border: "4px solid rgba(186, 35, 35, 0.74)",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : null}

                  {showFileLabel ? (
                    <span
                      style={{
                        position: "absolute",
                        right: "5px",
                        bottom: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        color: isLight ? "rgba(78,52,29,0.78)" : "rgba(255,244,224,0.7)",
                      }}
                    >
                      {file}
                    </span>
                  ) : null}

                  {showRankLabel ? (
                    <span
                      style={{
                        position: "absolute",
                        left: "5px",
                        top: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        color: isLight ? "rgba(78,52,29,0.78)" : "rgba(255,244,224,0.7)",
                      }}
                    >
                      {rank}
                    </span>
                  ) : null}
                </div>
              );
            })
          )}

          {draggingPiece ? (
            <div
              style={{
                position: "fixed",
                left: `${draggingPiece.x}px`,
                top: `${draggingPiece.y}px`,
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
                width: "58px",
                height: "58px",
                zIndex: 1000,
                filter: "drop-shadow(0 8px 10px rgba(0,0,0,0.45))",
              }}
            >
              <img
                src={PIECE_IMAGES[draggingPiece.pieceType]}
                alt={draggingPiece.pieceType}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                draggable={false}
              />
            </div>
          ) : null}
        </div>

        <div style={{ textAlign: "center", marginTop: "16px" }}>
          {!gameStarted ? (
            <div
              style={{
                marginBottom: "10px",
                display: "flex",
                gap: "8px",
                justifyContent: "center",
              }}
            >
              {[
                { value: "w", label: "Play White" },
                { value: "b", label: "Play Black" },
              ].map((option) => {
                const isActive = userColor === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setUserColor(option.value)}
                    style={{
                      padding: "7px 12px",
                      fontSize: "0.85rem",
                      letterSpacing: "0.2px",
                      fontWeight: 700,
                      borderRadius: "8px",
                      border: isActive ? "1px solid #ffe4af" : "1px solid rgba(255,255,255,0.22)",
                      background: isActive
                        ? "linear-gradient(180deg, #f4d8ab 0%, #d4a96f 100%)"
                        : "rgba(0,0,0,0.26)",
                      color: isActive ? "#2b1a11" : "#f8e7cf",
                      cursor: "pointer",
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            onClick={() => {
              recordGameResultIfFinished(game);
              if (engineRef.current?.postMessage) {
                engineRef.current.postMessage("stop");
              }
              setGame(new Chess());
              setGameStarted(true);
              setSelectedSquare(null);
              setMoveTargets({});
              setIsEngineThinking(false);
              setDraggedSourceSquare(null);
              setDraggingPiece(null);
              resultLoggedRef.current = false;
            }}
            style={{
              padding: "9px 26px",
              fontSize: "0.92rem",
              letterSpacing: "0.2px",
              fontWeight: 600,
              cursor: "pointer",
              borderRadius: "9px",
              border: "1px solid rgba(255,255,255,0.28)",
              background: "linear-gradient(180deg, #f4d8ab 0%, #d4a96f 100%)",
              color: "#2b1a11",
              boxShadow: "0 6px 14px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.45)",
            }}
          >
            {gameStarted ? "New Game" : "Start Game"}
          </button>
        </div>
      </div>

      <aside
        style={{
          width: "260px",
          minHeight: "250px",
          borderRadius: "14px",
          background: "linear-gradient(180deg, rgba(28,20,14,0.96) 0%, rgba(19,14,10,0.98) 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 12px 26px rgba(0,0,0,0.35)",
          padding: "14px",
          color: "#f2dfc2",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ fontSize: "1rem", fontWeight: 700, textAlign: "left" }}>Previous Games</div>
          <button
            onClick={isGuest ? () => setIsGuest(false) : handleLogout}
            style={{
              padding: "4px 8px",
              fontSize: "0.76rem",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.28)",
              color: "#f8e7cf",
              cursor: "pointer",
            }}
          >
            {isGuest ? "Exit Guest" : "Logout"}
          </button>
        </div>
        <div style={{ fontSize: "0.86rem", opacity: 0.94, marginBottom: "10px", textAlign: "left" }}>
          User: <strong>{isGuest ? "Guest" : currentUser.username}</strong>
        </div>
        <div style={{ fontSize: "0.9rem", opacity: 0.9, marginBottom: "12px", textAlign: "left" }}>
          W: {wins} | L: {losses} | D: {draws}
        </div>

        <div style={{ maxHeight: "520px", overflowY: "auto", paddingRight: "2px" }}>
          {isGuest ? (
            <div
              style={{
                fontSize: "0.88rem",
                color: "rgba(255,244,225,0.75)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "10px",
                textAlign: "left",
              }}
            >
              Guest mode does not save game history.
            </div>
          ) : gameHistory.length === 0 ? (
            <div
              style={{
                fontSize: "0.88rem",
                color: "rgba(255,244,225,0.75)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "10px",
                textAlign: "left",
              }}
            >
              No finished games yet.
            </div>
          ) : (
            gameHistory.map((entry, index) => {
              const tone =
                entry.result === "Win"
                  ? "rgba(86,178,118,0.92)"
                  : entry.result === "Loss"
                  ? "rgba(212,98,98,0.92)"
                  : "rgba(214,177,106,0.92)";

              return (
                <div
                  key={entry.id}
                  style={{
                    marginBottom: "8px",
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.04)",
                    padding: "9px 10px",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: "0.84rem", opacity: 0.78, marginBottom: "4px" }}>
                    Game #{gameHistory.length - index}
                  </div>
                  <div style={{ fontWeight: 700, color: tone, fontSize: "0.95rem" }}>
                    {entry.result} • {entry.detail}
                  </div>
                  <div style={{ fontSize: "0.76rem", opacity: 0.72, marginTop: "3px" }}>
                    {entry.endedAt}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
