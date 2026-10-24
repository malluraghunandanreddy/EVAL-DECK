import { createWriteStream } from "node:fs";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as extractTar } from "tar";
import { isTextFile, MAX_FILES, skipPath } from "./files";

export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

export type Ingested = { dir: string; sha: string | null; cleanup: () => Promise<void> };

function ghHeaders(token: string | null, accept = "application/vnd.github+json"): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, "User-Agent": "PolicyDrift", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Latest commit SHA of a branch (default branch when omitted). Null on failure. */
export async function getHeadSha(repoFullName: string, token: string | null, branch?: string | null): Promise<{ sha: string; branch: string } | null> {
  try {
    let ref = branch;
    if (!ref) {
      const r = await fetch(`https://api.github.com/repos/${repoFullName}`, { headers: ghHeaders(token) });
      if (!r.ok) return null;
      ref = ((await r.json()) as { default_branch?: string }).default_branch ?? "main";
    }
    const res = await fetch(`https://api.github.com/repos/${repoFullName}/commits/${encodeURIComponent(ref)}`, { headers: ghHeaders(token, "application/vnd.github.sha") });
    if (!res.ok) return null;
    return { sha: (await res.text()).trim(), branch: ref };
  } catch {
    return null;
  }
}

/** Stream a response body to disk, aborting past the size cap. */
async function download(res: Response, file: string): Promise<void> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_ARCHIVE_BYTES) throw new Error("Repository archive is larger than 20 MB");
  if (!res.body) throw new Error("Empty archive response");
  let seen = 0;
  const src = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  src.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > MAX_ARCHIVE_BYTES) src.destroy(new Error("Repository archive is larger than 20 MB"));
  });
  await pipeline(src, createWriteStream(file));
}

/** Extract a tarball into dir, dropping the top-level folder, vendored/binary files and anything past MAX_FILES. */
async function extract(file: string, dir: string): Promise<void> {
  let count = 0;
  await extractTar({
    file,
    cwd: dir,
    strip: 1,
    filter: (path, entry) => {
      const type = "type" in entry ? entry.type : undefined;
      if (type && type !== "File" && type !== "Directory" && type !== "OldFile" && type !== "ContiguousFile") return false; // no links
      const rel = path.split("/").slice(1).join("/");
      if (!rel || rel.includes("..") || skipPath(rel)) return false;
      if (type === "Directory") return true;
      if (!isTextFile(rel)) return false;
      return ++count <= MAX_FILES;
    },
  });
}

/** Download a GitHub repo tarball (with the user's decrypted token) into a fresh /tmp dir. Caller must call cleanup(). */
export async function ingestGithub(repoFullName: string, token: string | null, branch?: string | null): Promise<Ingested> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoFullName)) throw new Error("Invalid repository name");
  const root = await mkdtemp(join(tmpdir(), "pd-scan-"));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    const head = await getHeadSha(repoFullName, token, branch);
    const ref = head?.sha ?? branch ?? "";
    const res = await fetch(`https://api.github.com/repos/${repoFullName}/tarball/${ref}`, { headers: ghHeaders(token), redirect: "follow" });
    if (res.status === 404) throw new Error("Repository not found or not accessible with this GitHub account");
    if (!res.ok) throw new Error(`GitHub tarball download failed (${res.status})`);
    const archive = join(root, "repo.tar.gz");
    await download(res, archive);
    const dir = join(root, "src");
    await mkdir(dir);
    await extract(archive, dir);
    await rm(archive, { force: true });
    return { dir, sha: head?.sha ?? null, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Zip uploads (Replit / Lovable users) stored in Supabase Storage at projects.zip_path.
 * TODO(T2): no unzip dependency is installed yet (e.g. `yauzl`/`fflate`). Download via
 * `${SUPABASE_URL}/storage/v1/object/<bucket>/<zip_path>` with SUPABASE_SERVICE_ROLE_KEY, unzip into /tmp
 * with the same skipPath/isTextFile/MAX_FILES filter, then delete the object after the scan.
 */
export async function ingestZip(_zipPath: string): Promise<Ingested> {
  throw new Error("Zip uploads are not supported yet. Connect the repo through GitHub instead.");
}
