import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

for (const name of ["logistic_recovery_v1.json", "parity_v1.json"]) {
  const source = resolve("src/services/scorer/models", name);
  const destination = resolve("dist/src/services/scorer/models", name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}
