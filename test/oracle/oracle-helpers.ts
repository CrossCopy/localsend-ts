import { existsSync } from "node:fs"
import path from "node:path"

export const ORACLE_BIN = path.resolve("tools/oracle-rs/target/release/oracle")

export function oracleAvailable(): boolean {
	return process.env.LOCALSEND_ORACLE === "1" && existsSync(ORACLE_BIN)
}
