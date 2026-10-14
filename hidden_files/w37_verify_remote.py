#!/usr/bin/env python3
"""Wave 37 push verification: remote HEAD tree vs local HEAD tree,
blob-for-blob via the GitHub Trees API. Expected sole exception:
scripts/__pycache__/build_site.cpython-312.pyc (LF-normalized remote
form, per wave 34). Paths changed by the intervening parallel base
commit (not in this wave's commit) are reported separately."""
import json, subprocess, sys
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
sys.path.insert(0, "/home/hatch/workspace/skills/github/bin")
import importlib.util
spec = importlib.util.spec_from_file_location("ghpush", "/home/hatch/workspace/skills/github/bin/gh-push.py")
gh = importlib.util.module_from_spec(spec)
sys.modules["ghpush"] = gh
spec.loader.exec_module(gh)

ROOT = "/home/hatch/workspace/trend-machine"
REPO = "astercast/trend-machine"

st, ref = gh.api("GET", f"/repos/{REPO}/git/refs/heads/main")
assert st == 200, (st, ref)
remote_head = ref["object"]["sha"]
print("remote HEAD:", remote_head)
st, commit = gh.api("GET", f"/repos/{REPO}/git/commits/{remote_head}")
tree_sha = commit["tree"]["sha"]
st, tree = gh.api("GET", f"/repos/{REPO}/git/trees/{tree_sha}?recursive=1")
assert st == 200 and not tree.get("truncated"), (st, tree.get("truncated"))
remote = {t["path"]: t["sha"] for t in tree["tree"] if t["type"] == "blob"}
print("remote blobs:", len(remote))

local = {}
out = subprocess.run(["git", "ls-tree", "-r", "HEAD"], cwd=ROOT,
                     capture_output=True, text=True, check=True).stdout
for line in out.splitlines():
    meta, path = line.split("\t", 1)
    local[path] = meta.split()[2]
print("local blobs:", len(local))

changed = set(subprocess.run(
    ["git", "diff", "--name-only", "2a5bdf1..HEAD"], cwd=ROOT,
    capture_output=True, text=True, check=True).stdout.split())
print("paths in wave-37 commit:", len(changed))

PYC = "scripts/__pycache__/build_site.cpython-312.pyc"
diffs, pyc_diff, foreign = [], False, []
for path in sorted(set(local) | set(remote)):
    if local.get(path) != remote.get(path):
        if path == PYC:
            pyc_diff = True
        elif path in changed:
            diffs.append(path)
        else:
            foreign.append(path)
print("pyc exception differs:", pyc_diff)
print("FOREIGN diffs (parallel base commit, not this wave):", foreign)
print("DEFECT diffs (wave paths differing remotely):", diffs)
print("VERDICT:", "PASS" if not diffs else "FAIL")
sys.exit(1 if diffs else 0)
