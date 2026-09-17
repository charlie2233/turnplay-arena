import { Fragment, useEffect, useMemo, useState } from "react";

import type {
  BasketballMove,
  BasketballSnapshot,
  PoolBallId,
  PoolMove,
  PoolPocket,
  PoolSnapshot,
} from "../types";

const pocketLabels: Record<PoolPocket, string> = {
  TL: "top left",
  TM: "top middle",
  TR: "top right",
  BL: "bottom left",
  BM: "bottom middle",
  BR: "bottom right",
};

const pocketPositions: ReadonlyArray<{ pocket: PoolPocket; x: number; y: number }> = [
  { pocket: "TL", x: 1, y: 1 },
  { pocket: "TM", x: 50, y: 1 },
  { pocket: "TR", x: 99, y: 1 },
  { pocket: "BL", x: 1, y: 99 },
  { pocket: "BM", x: 50, y: 99 },
  { pocket: "BR", x: 99, y: 99 },
];

function poolMoveParts(move: PoolMove): { ballId: PoolBallId; pocket: PoolPocket } | undefined {
  if (!move.startsWith("POT:")) return;
  const [, ball, pocket] = move.split(":");
  return { ballId: Number(ball) as PoolBallId, pocket: pocket as PoolPocket };
}

export function PoolBoard({ game, onMove, disabled }: { game: PoolSnapshot; onMove: (move: string) => void; disabled: boolean }) {
  const potMoves = useMemo(() => game.legalMoves.map(poolMoveParts).filter((move): move is NonNullable<typeof move> => move !== undefined), [game.legalMoves]);
  const selectable = useMemo(() => new Set(potMoves.map((move) => move.ballId)), [potMoves]);
  const [selectedBall, setSelectedBall] = useState<PoolBallId>();
  useEffect(() => {
    setSelectedBall(undefined);
  }, [game.gameId, game.resetEpoch, game.stateVersion]);
  useEffect(() => {
    if (selectedBall !== undefined && !selectable.has(selectedBall)) setSelectedBall(undefined);
  }, [selectable, selectedBall]);
  const selectedPockets = new Set(potMoves.filter((move) => move.ballId === selectedBall).map((move) => move.pocket));
  const renderPockets = (ballId?: PoolBallId) => pocketPositions.map(({ pocket, x, y }) => {
    if (ballId === undefined) {
      return <span key={pocket} className="pool-pocket" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true"/>;
    }
    const available = selectedPockets.has(pocket);
    const move = `POT:${ballId}:${pocket}` as PoolMove;
    return <button
      key={pocket}
      type="button"
      className={`pool-pocket${available ? " available" : ""}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      disabled={disabled || !available}
      aria-label={available ? `Pot ball ${ballId} in the ${pocketLabels[pocket]} pocket` : `${pocketLabels[pocket]} pocket`}
      onClick={() => onMove(move)}
    />;
  });

  return <section className="pool-game" aria-label="Mini 8-Ball">
    <div className="pool-score" aria-label="Pool progress">
      <span>Solids left <b>{game.balls.filter((ball) => ball.group === "solids").length}</b></span>
      <strong aria-live="polite" aria-atomic="true">{selectedBall === undefined ? "Choose a ball or play safe" : `Ball ${selectedBall}: choose a pocket`}</strong>
      <span>Stripes left <b>{game.balls.filter((ball) => ball.group === "stripes").length}</b></span>
    </div>
    <div className="pool-table" role="group" aria-label="Mini 8-Ball pool table">
      <span className="pool-rail-line" aria-hidden="true"/>
      {selectedBall === undefined && renderPockets()}
      <span className="pool-ball cue" style={{ left: `${game.cueBall.x}%`, top: `${game.cueBall.y * 2}%` }} aria-label="Cue ball" role="img"/>
      {game.balls.map((ball) => {
        const available = selectable.has(ball.id);
        const pockets = potMoves.filter((move) => move.ballId === ball.id).length;
        return <Fragment key={ball.id}><button
          type="button"
          className={`pool-ball object ${ball.group}${selectedBall === ball.id ? " selected" : ""}`}
          style={{ left: `${ball.x}%`, top: `${ball.y * 2}%` }}
          disabled={disabled || !available}
          aria-pressed={selectedBall === ball.id}
          aria-label={`Ball ${ball.id}, ${ball.group}${available ? `, ${pockets} legal ${pockets === 1 ? "pocket" : "pockets"}` : ", not currently playable"}`}
          onClick={() => setSelectedBall((current) => current === ball.id ? undefined : ball.id)}
        ><span>{ball.id}</span></button>{selectedBall === ball.id && renderPockets(ball.id)}</Fragment>;
      })}
    </div>
    <div className="pool-safeties" role="group" aria-label="Safety shots">
      {(["L", "T", "C", "B", "R"] as const).map((zone) => {
        const move = `SAFE:${zone}` as PoolMove;
        return <button type="button" key={zone} disabled={disabled || !game.legalMoves.includes(move)} onClick={() => onMove(move)}>Safe {zone}</button>;
      })}
    </div>
  </section>;
}

const shotLabels: Record<BasketballMove, string> = {
  drive: "Drive",
  "pull-up": "Pull-up",
  three: "Three",
};

export function BasketballBoard({ game, onMove, disabled }: { game: BasketballSnapshot; onMove: (move: string) => void; disabled: boolean }) {
  const lastShot = game.shotResults.at(-1);
  return <section className="basketball-game" aria-label="Court Duel basketball game">
    <div className="court-score" aria-label="Court Duel score">
      <span>YOU <b>{game.score[game.playerColor]}</b></span>
      <strong>{game.phase === "regulation" ? `ROUND ${game.round} / 5` : `OVERTIME ${game.round - 5} / 3`}</strong>
      <span>Opponent <b>{game.score[game.playerColor === "black" ? "white" : "black"]}</b></span>
    </div>
    <div className="half-court">
      <span className="court-hoop" aria-hidden="true">◉</span>
      <span className="court-key" aria-hidden="true"/>
      <span className="court-arc" aria-hidden="true"/>
      <span className="court-ball" aria-hidden="true">🏀</span>
      <div className="shot-actions" role="group" aria-label="Shot choices">
        {game.shotOptions.map((option) => <button
          type="button"
          key={option.move}
          className={`shot-${option.move}`}
          disabled={disabled || !game.legalMoves.includes(option.move)}
          aria-label={`${shotLabels[option.move]}, ${option.points} points, ${option.accuracy} percent accuracy, costs ${option.energyCost} energy`}
          onClick={() => onMove(option.move)}
        ><strong>{shotLabels[option.move]}</strong><span>{option.points}PT · {option.accuracy}%</span><small>{option.energyCost === 0 ? "FREE" : `−${option.energyCost} ENERGY`}</small></button>)}
      </div>
    </div>
    <div className="court-meta">
      <span>Your energy <b>{game.energy[game.playerColor]} / 4</b></span>
      <strong aria-live="polite">{lastShot ? `${lastShot.actor === "player" ? "You" : "Opponent"} ${lastShot.made ? `made ${lastShot.points}` : "missed"} (${lastShot.move})` : "Pick your first shot"}</strong>
      <span>Opponent energy <b>{game.energy[game.playerColor === "black" ? "white" : "black"]} / 4</b></span>
    </div>
  </section>;
}
