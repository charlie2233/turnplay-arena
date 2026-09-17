#!/usr/bin/env node

import {
  parseProductionAcceptanceArgs,
  ProductionAcceptanceError,
  runProductionAcceptance,
} from "./production-acceptance.mjs";

const usage = `Turnplay Arena production acceptance

Seed a real v22 game before restarting the provider:
  npm run verify:production -- --phase seed --base-url https://turnplay-arena.onrender.com --challenge-token-file /private/openai-domain-token

After restarting the same single provider instance with its disk attached:
  npm run verify:production -- --phase resume --base-url https://turnplay-arena.onrender.com --challenge-token-file /private/openai-domain-token

Options:
  --state-file PATH        Receipt path (default: .data/production-acceptance-v22.json)
  --challenge-token-file   Mode-0600 file containing the exact OpenAI portal token
  --require-challenge      Require route presence in a localhost simulation
  --allow-http-localhost   Allow HTTP only for localhost development checks
  --help                   Show this help
`;

try {
  const options = parseProductionAcceptanceArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
  } else {
    const result = await runProductionAcceptance(options);
    if (result.production) {
      console.log(`${result.phase === "seed" ? "Seed" : "Post-restart"} production acceptance passed for ${result.origin}.`);
    } else {
      console.log(`${result.phase === "seed" ? "Seed" : "Post-restart"} local acceptance simulation passed for ${result.origin}.`);
      console.log("This HTTP localhost run is not production evidence.");
    }
    console.log(`Current widget: ${result.widgetResourceUri}`);
    console.log(`Authoritative state: reset epoch ${result.resetEpoch}, version ${result.stateVersion}, digest ${result.snapshotDigest.slice(0, 12)}…`);
    console.log(`Domain challenge: ${result.challengeExact ? "exact portal token verified" : result.challengePresent ? "present (not matched to a token file)" : "not configured"}`);
    if (result.phase === "seed") {
      console.log(`Private receipt: ${result.stateFile}`);
      console.log("Restart exactly one provider instance without clearing its persistent disk, then run the resume phase with the same origin and receipt.");
    } else {
      console.log("Provider process identity: changed since seed.");
      console.log("Provider restart: proven when the deployment is independently confirmed to have exactly one live instance.");
      console.log("The exact seeded game state and render survived the observed process identity change.");
    }
  }
} catch (error) {
  const message = error instanceof ProductionAcceptanceError ? error.message : "Unexpected verifier failure.";
  console.error(`Production acceptance failed: ${message}`);
  process.exitCode = 1;
}
