#!/usr/bin/env python3
"""Resolution executor push verification: remote HEAD tree vs local HEAD
tree, blob-for-blob via the GitHub Trees API. Sole named exception:
scripts/__pycache__/build_site.cpython-312.pyc (LF-normalized remote
form, standing documented exception since wave 34).
Exit 0 = PASS (equality modulo the .pyc), 1 = FAIL."""
import subprocess, sys
sys.path.insert(0, "/home/hatch/workspace/skills/github/bin")
import importlib.util
spec = importlib.util.spec_from_file_location(
    "ghpush", "/home/hatch/workspace/skills/github/bin/gh-push.py")
gh = importlib.util.module_from_spec(spec)
sys.modules["ghpush"] = gh
spec.loader.exec_module(gh)

ROOT = "/home/hatch/workspace/trend-machine"
REPO = "astercast/trend-machine"
PYC = "scripts/__pycache__/build_site.cpython-312.pyc"

st, ref = gh.api("GET", f"/repos/{REPO}/git/refs/heads/main")
assert st == 200, (st, ref)
remote_head = ref["object"]["sha"]
print("remote HEAD:", remote_head)
st, commit = gh.api("GET", f"/repos/{REPO}/git/commits/{remote_head}")
tree_sha = commit["tree"]["sha"]
st, tree = gh.api("GET", f"/repos/{REPO}/git/trees/{tree_sha}?recursive=1")
assert st == 200 and not tree.get("truncated"), (st, tree.get("truncated"))
remote = {t["path"]: t["sha"] for t in tree["tree"] if t["type"] == "blob"}
local_head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                            capture_output=True, text=True, check=True).stdout.strip()
print("local HEAD:", local_head)
local = {}
out = subprocess.run(["git", "ls-tree", "-r", "HEAD"], cwd=ROOT,
                     capture_output=True, text=True, check=True).stdout
for line in out.splitlines():
    meta, path = line.split("\t", 1)
    local[path] = meta.split()[2]
diffs, pyc_diff = [], False
for path in sorted(set(local) | set(remote)):
    if local.get(path) != remote.get(path):
        if path == PYC:
            pyc_diff = True
        else:
            diffs.append(path)
print("pyc exception differs:", pyc_diff)
print("other diffs:", diffs)
print("VERDICT:", "PASS" if not diffs else "FAIL")
sys.exit(0 if not diffs else 1)
