import { discover } from './discovery.mjs';
import { connect } from './bridge.mjs';

async function main() {
  const settings = await discover();
  const close = await connect(settings, process.stdin, process.stdout);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
main().catch(error => {
  // Discovery returns actionable setup errors; never log arbitrary file content or SDK errors.
  const message = /^(Choose the local URL|Open 2Do|Several libraries|Windows could not read|This connector runs)/.test(error.message)
    ? error.message : '2Do could not open its local connection. Check Settings > Automation and reconnect.';
  console.error(message);
  process.exitCode = 1;
});
