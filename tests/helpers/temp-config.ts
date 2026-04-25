import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempEnv {
  cleanup: () => void;
  configHome: string;
}

/**
 * Per-test isolated XDG config dir. Use as:
 *   const env = createTempEnv();
 *   afterEach(() => env.cleanup());
 *
 *   await runCli(['auth', 'login', '--token', 'X'], { XDG_CONFIG_HOME: env.configHome });
 */
export function createTempEnv(): TempEnv {
  const configHome = mkdtempSync(join(tmpdir(), "na-test-config-"));
  return {
    configHome,
    cleanup: () => {
      try {
        rmSync(configHome, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}
