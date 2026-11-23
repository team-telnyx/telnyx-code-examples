/**
 * CLI: hash an operator password for SIGNALDESK_OPERATOR_PASSWORD_HASH.
 *
 *   npm run hash-password -- "correct horse battery staple"
 */
import "dotenv/config";
import { hashPassword } from "../src/lib/password";

async function main() {
  const password = process.argv[2];

  if (!password) {
    console.error("Usage: npm run hash-password -- <password>");
    process.exit(1);
  }

  const hash = await hashPassword(password);
  process.stdout.write(hash + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
