import type { GameSnapshot } from "../types";
export function GameChrome({ game, thinking = false, unconfirmed = false }: { game: GameSnapshot; thinking?: boolean; unconfirmed?: boolean }) {
  const mine = game.turn === game.playerColor && game.status === "active";
  const mark = (color: "white" | "black") => game.kind === "basketball" ? "🏀" : game.kind === "chess" ? color === "white" ? "♙" : "♟" : game.kind === "tic-tac-toe" ? color === "black" ? "X" : "O" : <i className={`disk-mark ${color}`}/>;
  const turnLabel = game.status === "finished" ? "Game finished" : mine ? "Your turn" : thinking ? "Opponent choosing a move…" : unconfirmed ? "Opponent move not confirmed" : "Opponent to move";
  return <><section className="roles" aria-label="Game roles"><div><span className="token player-token">{mark(game.playerColor)}</span><strong>{roleName(game.kind, game.playerColor, true)}</strong></div><div className="turn" aria-live="polite"><i className={mine ? "dot mine" : "dot"}/><b>{turnLabel}</b><span>{game.message}</span></div><div><span className="token gpt-token">{mark(other(game.playerColor))}</span><span className="gpt-role"><strong>{roleName(game.kind, other(game.playerColor), false)}</strong><small>{title(game.difficulty)} difficulty</small></span></div></section><aside className={`history${game.moveHistory.length === 0 ? " history-empty" : ""}`}><h2>Move history</h2><ol>{game.moveHistory.map(move => <li key={move.ply}><span>{move.ply}.</span><span>{move.notation} · {move.actor === "gpt" ? "Opponent" : "Player"} ({sideName(game.kind, move.color)})</span></li>)}</ol></aside></>;
}
function title(color: string) { return color[0].toUpperCase() + color.slice(1); }
function other(color: "white" | "black") { return color === "white" ? "black" : "white"; }
function sideName(kind: GameSnapshot["kind"], color: "white" | "black"): string {
  if (kind === "pool") return color === "black" ? "Solids" : "Stripes";
  if (kind === "basketball") return color === "black" ? "Home" : "Away";
  return title(color);
}
function roleName(kind: GameSnapshot["kind"], color: "white" | "black", player: boolean): string {
  const prefix = player ? "You are" : "Opponent is";
  return `${prefix} ${sideName(kind, color)}`;
}
