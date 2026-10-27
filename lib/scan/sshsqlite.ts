import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Client } from "ssh2";
import { SQLITE_REPORT_SCRIPT } from "./sqlitereport";

/**
 * Automatic SQLite check over SSH: TriLens logs in to the customer's server with the details they type in,
 * finds SQLite files, runs the read-only report script and disconnects. Credentials live only in this request:
 * never stored, never logged. Nothing on the server is written or changed.
 */
export type SshLogin = {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export class SshCheckError extends Error {}

const CONNECT_MS = 12_000;
const COMMAND_MS = 25_000;
const MAX_OUTPUT = 400_000;

// Where apps keep their data; system folders are skipped so the search stays fast.
const FIND_DBS = `find / \\( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /usr -o -path /snap -o -path /boot -o -path /var/lib/docker -o -path /var/cache -o -path /root/.cache -o -path '*/node_modules' -o -path '*/.git' \\) -prune -o -type f \\( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \\) -size +0 -print 2>/dev/null | grep -v -E '\\.(bak|backup)$|/(\\.cache|cache|tmp)/' | head -300`;

const lastLine = (s: string) => s.trim().split("\n").pop()?.trim() ?? "";
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v === "::" || v.startsWith("::ffff:") && privateAddress(v.slice(7));
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** The server must be a public address: TriLens never connects into private networks or its own host. */
async function resolvePublic(host: string): Promise<string> {
  const h = host.trim().replace(/^ssh:\/\//i, "").replace(/\/.*$/, "");
  if (!h || !/^[a-z0-9.:-]+$/i.test(h)) throw new SshCheckError("Enter the server's IP address or host name, for example 82.25.110.14.");
  let ip = h;
  if (!isIP(h)) {
    try {
      ip = (await lookup(h)).address;
    } catch {
      throw new SshCheckError(`Couldn't find a server called ${h}. Check the address in Hostinger under VPS → Overview.`);
    }
  }
  // TRILENS_SSH_ALLOW_PRIVATE is for local testing only; never set it on Vercel.
  if (privateAddress(ip) && process.env.TRILENS_SSH_ALLOW_PRIVATE !== "1") throw new SshCheckError("That address is a private or local network address. Enter the server's public IP.");
  return ip;
}

function connect(login: SshLogin, ip: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const fail = (msg: string) => { conn.end(); reject(new SshCheckError(msg)); };
    conn.on("ready", () => resolve(conn));
    conn.on("error", (err: Error & { level?: string }) => {
      if (err.level === "client-authentication") fail("The server refused the login. Check the username and password (or SSH key).");
      else if (/ECONNREFUSED/.test(err.message)) fail("The server refused the connection on that port. Check SSH is enabled (port 22 unless you changed it).");
      else if (/timed out|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(err.message)) fail("Couldn't reach the server. Check the IP address, and that the firewall allows SSH.");
      else fail("Couldn't connect to the server over SSH.");
    });
    try {
      conn.connect({
        host: ip,
        port: login.port ?? 22,
        username: login.username,
        password: login.password || undefined,
        privateKey: login.privateKey?.trim() ? login.privateKey.trim() + "\n" : undefined,
        passphrase: login.passphrase || undefined,
        readyTimeout: CONNECT_MS,
        tryKeyboard: false,
      });
    } catch (err) {
      // ssh2 throws synchronously when the key can't be read (public key pasted, wrong passphrase, .ppk format).
      const m = (err as Error).message ?? "";
      if (/passphrase|encrypted|bad decrypt|integrity/i.test(m)) fail("The SSH key's passphrase is wrong, or the key needs one. Leave the passphrase empty if the key has none.");
      else if (/parse|unsupported|key/i.test(m)) fail("That doesn't look like a private SSH key. Paste the private key (it starts with -----BEGIN … PRIVATE KEY-----), not the .pub file, or use Password instead.");
      else fail("Couldn't start the SSH connection.");
    }
  });
}

function run(conn: Client, command: string, stdin?: string): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SshCheckError("The server took too long to answer.")), COMMAND_MS);
    conn.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(new SshCheckError("The server didn't allow running the check.")); }
      let out = "", errOut = "";
      let exitCode: number | null = null;
      stream.on("exit", (code: number | null) => { exitCode = typeof code === "number" ? code : null; });
      stream.on("data", (d: Buffer) => { if (out.length < MAX_OUTPUT) out += d.toString("utf8"); });
      stream.stderr.on("data", (d: Buffer) => { if (errOut.length < 4000) errOut += d.toString("utf8"); });
      stream.on("close", () => { clearTimeout(timer); resolve({ out, err: errOut, code: exitCode }); });
      if (stdin !== undefined) stream.end(stdin); else stream.end();
    });
  });
}

/** Log in, then either list SQLite files (no dbPath) or return the read-only report for dbPath. */
export async function sshSqlite(login: SshLogin, dbPath?: string | null): Promise<{ candidates: string[] } | { report: string }> {
  if (!login.username.trim()) throw new SshCheckError("Enter the username, for example root.");
  if (!login.password && !login.privateKey) throw new SshCheckError("Enter the password or paste an SSH private key.");
  const ip = await resolvePublic(login.host);
  const conn = await connect(login, ip);
  try {
    if (!dbPath) {
      const r = await run(conn, FIND_DBS);
      const candidates = [...new Set(r.out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")))];
      return { candidates };
    }
    if (!dbPath.startsWith("/") || dbPath.includes("\n")) throw new SshCheckError("Pick a database file from the list.");
    const r = await run(conn, `command -v python3 >/dev/null 2>&1 || { echo NO_PYTHON >&2; exit 3; }; python3 - ${quote(dbPath)}`, SQLITE_REPORT_SCRIPT);
    if (/NO_PYTHON/.test(r.err)) throw new SshCheckError("Python 3 isn't installed on the server. Ask your host to install it (apt install python3), or use “Run a command myself”.");
    if ((r.code !== null && r.code !== 0) || !r.out.includes("-- trilens sqlite")) {
      if (/No such file|FileNotFoundError/.test(r.err)) throw new SshCheckError("That database file doesn't exist on the server.");
      if (/Permission denied|PermissionError|unable to open/i.test(r.err)) throw new SshCheckError("This login can't read that database file. Use a login that can read the app's folder.");
      const notSqlite = r.err.match(/NOT_SQLITE (\w+)/)?.[1];
      if (notSqlite === "encrypted") throw new SshCheckError("That file is encrypted (or isn't SQLite), so its tables can't be read. If it's the app's database, encryption is good for privacy; pick another file to check.");
      if (notSqlite) throw new SshCheckError(notSqlite === "empty" ? "That file is empty." : "That file is a text file with a database name, not a SQLite database. Pick another file.");
      const sqliteErr = r.err.match(/SQLITE_ERR (.+)/)?.[1] ?? lastLine(r.err);
      throw new SshCheckError(`SQLite couldn't read that file${sqliteErr ? `: ${sqliteErr.slice(0, 160)}` : "."}`);
    }
    return { report: r.out };
  } finally {
    conn.end();
  }
}
