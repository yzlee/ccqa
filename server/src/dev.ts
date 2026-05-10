/**
 * Dev entrypoint for `npm run dev:server`.
 *
 * Production users go through `@ccqa/cli`'s `serve` subcommand, which
 * imports `startServer` and passes a webDist. This file is just a
 * thin wrapper for local development that uses env-based defaults.
 */
import { startServer } from "./index.js";

startServer().catch((e) => {
  console.error(e);
  process.exit(1);
});
