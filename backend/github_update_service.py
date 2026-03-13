import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_REPO_URL = "https://github.com/Spakieone/AdminPanel"
DEFAULT_BRANCH = "main"

# Docker mode: when running inside Docker, use docker pull + recreate instead of ZIP overlay.
_IS_DOCKER = os.path.isfile("/.dockerenv") or os.environ.get("ADMINPANEL_DATA_DIR") == "/data"


def _now() -> float:
    return time.time()


def _safe_repo_owner_name(repo_url: str) -> Tuple[str, str]:
    s = str(repo_url or "").strip()
    if s.endswith(".git"):
        s = s[:-4]
    if s.startswith("git@github.com:"):
        tail = s.split("git@github.com:", 1)[1]
        owner, name = tail.split("/", 1)
        return owner.strip(), name.strip()
    u = urllib.parse.urlparse(s)
    if "github.com" not in str(u.netloc or ""):
        raise ValueError("Only github.com repositories are supported")
    parts = [p for p in str(u.path or "").split("/") if p]
    if len(parts) < 2:
        raise ValueError("Invalid GitHub repository URL")
    return parts[0].strip(), parts[1].strip()


def _update_zip_url(repo_url: str, branch: str) -> str:
    owner, name = _safe_repo_owner_name(repo_url)
    b = str(branch or DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    return f"https://codeload.github.com/{owner}/{name}/zip/refs/heads/{b}"


def default_update_config() -> Dict[str, Any]:
    return {
        "repo_url": DEFAULT_REPO_URL,
        "branch": DEFAULT_BRANCH,
        "public_repo": True,
    }


def fetch_github_commits(repo_url: str, branch: str, per_page: int = 20) -> List[Dict[str, Any]]:
    """Fetch recent commits from GitHub API (public repo, no auth required)."""
    owner, name = _safe_repo_owner_name(repo_url)
    b = str(branch or DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
    n = max(1, min(100, int(per_page or 20)))
    api_url = f"https://api.github.com/repos/{owner}/{name}/commits?sha={b}&per_page={n}"
    req = urllib.request.Request(
        api_url,
        headers={"Accept": "application/vnd.github.v3+json", "User-Agent": "AdminPanel/1.0"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:  # nosec
        raw = json.loads(resp.read().decode("utf-8"))
    if not isinstance(raw, list):
        return []
    commits = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        commit_obj = item.get("commit") or {}
        author = commit_obj.get("author") or {}
        committer = commit_obj.get("committer") or {}
        commits.append({
            "sha": str(item.get("sha") or "")[:40],
            "short_sha": str(item.get("sha") or "")[:7],
            "message": str(commit_obj.get("message") or "").strip(),
            "author_name": str(author.get("name") or ""),
            "author_date": str(author.get("date") or committer.get("date") or ""),
            "html_url": str(item.get("html_url") or ""),
        })
    return commits


class GitHubUpdateManager:
    def __init__(
        self,
        *,
        project_root: Path,
        config_file: Path,
        state_file: Path,
        log_file: Path,
        service_name: str = "admin-panel",
    ) -> None:
        self.project_root = Path(project_root)
        self.config_file = Path(config_file)
        self.state_file = Path(state_file)
        self.log_file = Path(log_file)
        self.service_name = str(service_name)
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._running_since: Optional[float] = None

    def load_config(self) -> Dict[str, Any]:
        cfg = default_update_config()
        try:
            raw = json.loads(self.config_file.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and "public_repo" in raw:
                cfg["public_repo"] = bool(raw.get("public_repo"))
        except Exception:
            pass
        cfg["repo_url"] = DEFAULT_REPO_URL
        cfg["branch"] = DEFAULT_BRANCH
        return cfg

    def save_config(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        cfg = self.load_config()
        if isinstance(payload, dict) and "public_repo" in payload:
            cfg["public_repo"] = bool(payload.get("public_repo"))
        cfg["repo_url"] = DEFAULT_REPO_URL
        cfg["branch"] = DEFAULT_BRANCH
        self.config_file.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        return cfg

    def _append_log(self, message: str) -> None:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{ts}] {message}\n"
        self.log_file.parent.mkdir(parents=True, exist_ok=True)
        with self.log_file.open("a", encoding="utf-8") as f:
            f.write(line)

    def _set_state(self, state: Dict[str, Any]) -> None:
        base = {
            "status": "idle",
            "stage": "",
            "message": "",
            "started_at": None,
            "finished_at": None,
            "triggered_by": "",
        }
        base.update(state or {})
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(json.dumps(base, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_status(self) -> Dict[str, Any]:
        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
        except Exception:
            data = {}
        running_for = None
        with self._lock:
            if self._running and self._running_since:
                running_for = max(0, int(_now() - self._running_since))
        data["running"] = bool(self._running)
        data["running_for_sec"] = running_for
        data["docker_mode"] = _IS_DOCKER
        return data

    def read_log_tail(self, max_lines: int = 200) -> List[str]:
        n = max(10, min(1000, int(max_lines or 200)))
        try:
            lines = self.log_file.read_text(encoding="utf-8", errors="replace").splitlines()
            return lines[-n:]
        except Exception:
            return []

    def check_remote(self) -> Dict[str, Any]:
        if _IS_DOCKER:
            return self._check_remote_docker()
        cfg = self.load_config()
        url = _update_zip_url(str(cfg.get("repo_url") or DEFAULT_REPO_URL), str(cfg.get("branch") or DEFAULT_BRANCH))
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=15) as resp:  # nosec
            return {
                "ok": True,
                "url": url,
                "status_code": int(getattr(resp, "status", 200)),
                "content_type": str(resp.headers.get("Content-Type") or ""),
            }

    def _check_remote_docker(self) -> Dict[str, Any]:
        """Check if a newer image is available on GHCR via Docker API."""
        owner, name = _safe_repo_owner_name(DEFAULT_REPO_URL)
        image = f"ghcr.io/{owner.lower()}/{name.lower()}:latest"

        # Try to check with docker pull --dry-run or just verify registry is reachable
        try:
            res = subprocess.run(
                ["docker", "manifest", "inspect", image],
                capture_output=True, text=True, timeout=30,
            )
            if res.returncode == 0:
                return {
                    "ok": True,
                    "url": image,
                    "status_code": 200,
                    "content_type": "docker-image",
                    "docker_mode": True,
                }
            else:
                # Might need GHCR login
                self._docker_ghcr_login()
                res2 = subprocess.run(
                    ["docker", "manifest", "inspect", image],
                    capture_output=True, text=True, timeout=30,
                )
                if res2.returncode == 0:
                    return {
                        "ok": True,
                        "url": image,
                        "status_code": 200,
                        "content_type": "docker-image",
                        "docker_mode": True,
                    }
                raise RuntimeError(f"Cannot access {image}: {res2.stderr.strip()}")
        except subprocess.TimeoutExpired:
            raise RuntimeError("Timeout checking GHCR registry")

    def _docker_ghcr_login(self) -> None:
        """Login to GHCR using token from /data/.env or environment."""
        token = os.environ.get("GHCR_TOKEN", "")
        ghcr_owner = os.environ.get("GHCR_OWNER", "spakieone")

        if not token:
            env_file = Path("/data/.env")
            if env_file.exists():
                for line in env_file.read_text().splitlines():
                    if line.startswith("GHCR_TOKEN="):
                        token = line.split("=", 1)[1].strip()
                    elif line.startswith("GHCR_OWNER="):
                        ghcr_owner = line.split("=", 1)[1].strip()

        if not token:
            # Also check the host-mounted .env
            for p in [Path("/host-project/.env"), self.project_root / ".env"]:
                if p.exists():
                    for line in p.read_text().splitlines():
                        if line.startswith("GHCR_TOKEN="):
                            token = line.split("=", 1)[1].strip()
                        elif line.startswith("GHCR_OWNER="):
                            ghcr_owner = line.split("=", 1)[1].strip()
                    if token:
                        break

        if token:
            subprocess.run(
                ["docker", "login", "ghcr.io", "-u", ghcr_owner, "--password-stdin"],
                input=token, capture_output=True, text=True, timeout=15,
            )

    def start_update(self, *, triggered_by: str = "unknown") -> Dict[str, Any]:
        with self._lock:
            if self._running:
                raise RuntimeError("Update is already running")
            self._running = True
            self._running_since = _now()
            self._thread = threading.Thread(
                target=self._run_update_docker if _IS_DOCKER else self._run_update_bare,
                kwargs={"triggered_by": triggered_by},
                daemon=True,
                name="github-update-worker",
            )
            self._thread.start()
        return {"ok": True, "started": True}

    def _run_cmd(self, cmd: List[str], *, cwd: Path, timeout_sec: int = 1800) -> str:
        self._append_log(f"$ {' '.join(cmd)}")
        res = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
        out = (res.stdout or "").strip()
        err = (res.stderr or "").strip()
        for line in out.splitlines()[-200:]:
            if line.strip():
                self._append_log(line)
        for line in err.splitlines()[-200:]:
            if line.strip():
                self._append_log(line)
        if res.returncode != 0:
            raise RuntimeError(f"Command failed ({res.returncode}): {' '.join(cmd)}")
        return out

    def _copy_preserve(self, src_root: Path, dst_root: Path, rel_path: str) -> None:
        src = src_root / rel_path
        if not src.exists():
            return
        dst = dst_root / rel_path
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    def _detect_project_src_dir(self, extracted_root: Path) -> Path:
        direct = extracted_root / "adminpanel"
        if (direct / "backend").exists() and (direct / "frontend").exists() and (direct / "admin_cli.py").exists():
            return direct
        if (extracted_root / "backend").exists() and (extracted_root / "frontend").exists() and (extracted_root / "admin_cli.py").exists():
            return extracted_root
        for p in extracted_root.iterdir():
            if p.is_dir() and (p / "backend").exists() and (p / "frontend").exists() and (p / "admin_cli.py").exists():
                return p
        raise RuntimeError("Could not detect project directory in downloaded archive")

    def _overlay_copy(self, src_dir: Path, dst_dir: Path) -> None:
        for item in src_dir.iterdir():
            if item.name in {".git", ".github"}:
                continue
            dst = dst_dir / item.name
            if item.is_dir():
                shutil.copytree(item, dst, dirs_exist_ok=True)
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dst)

    # ===========================
    # Docker update flow
    # ===========================
    def _run_update_docker(self, *, triggered_by: str) -> None:
        """Update flow for Docker: pull new image from GHCR and recreate container."""
        started_at = _now()
        self._set_state({
            "status": "running", "stage": "start",
            "message": "Docker update started",
            "started_at": started_at, "finished_at": None,
            "triggered_by": triggered_by,
        })
        self._append_log(f"Docker update started by: {triggered_by}")

        try:
            owner, name = _safe_repo_owner_name(DEFAULT_REPO_URL)
            image = f"ghcr.io/{owner.lower()}/{name.lower()}:latest"
            self._append_log(f"Image: {image}")

            # Step 1: Login to GHCR
            self._set_state({"status": "running", "stage": "login", "message": "Logging in to GHCR", "started_at": started_at, "triggered_by": triggered_by})
            self._docker_ghcr_login()
            self._append_log("GHCR login completed")

            # Step 2: Pull latest image
            self._set_state({"status": "running", "stage": "pull", "message": f"Pulling {image}", "started_at": started_at, "triggered_by": triggered_by})
            self._run_cmd(["docker", "pull", image], cwd=Path("/"), timeout_sec=600)
            self._append_log("Image pulled successfully")

            # Step 3: Find compose file on host
            compose_file = self._find_compose_file()
            self._append_log(f"Compose file: {compose_file}")

            # Step 4: Recreate container with new image
            self._set_state({"status": "running", "stage": "recreate", "message": "Recreating container with new image", "started_at": started_at, "triggered_by": triggered_by})

            # Write state before restart (container will be replaced)
            self._set_state({
                "status": "success", "stage": "done",
                "message": "Update completed. Container restart in progress...",
                "started_at": started_at, "finished_at": _now(),
                "triggered_by": triggered_by,
            })
            self._append_log("Scheduling container recreate...")

            # Fire-and-forget: stop current + start new container
            subprocess.Popen(  # nosec
                ["bash", "-c", f"sleep 2 && docker compose -f {compose_file} up -d --force-recreate --no-build"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            self._append_log("Container recreate scheduled. Service will restart momentarily.")

        except Exception as e:
            self._append_log(f"ERROR: {e}")
            self._set_state({
                "status": "failed", "stage": "failed",
                "message": str(e),
                "started_at": started_at, "finished_at": _now(),
                "triggered_by": triggered_by,
            })
        finally:
            with self._lock:
                self._running = False
                self._running_since = None
                self._thread = None

    def _find_compose_file(self) -> str:
        """Find the docker-compose file used to run this container."""
        # Check common locations
        for candidate in [
            "/host-project/docker-compose.ghcr.yml",
            "/host-project/docker-compose.yml",
        ]:
            if os.path.isfile(candidate):
                return candidate

        # Try to detect from container labels
        try:
            res = subprocess.run(
                ["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project.working_dir"}}', "adminpanel"],
                capture_output=True, text=True, timeout=10,
            )
            project_dir = res.stdout.strip()
            if project_dir:
                for f in ["docker-compose.ghcr.yml", "docker-compose.yml"]:
                    path = f"{project_dir}/{f}"
                    # From inside container we can't check host FS, but we know the path
                    return path
        except Exception:
            pass

        # Fallback: use host project dir from env or default
        host_dir = os.environ.get("HOST_PROJECT_DIR", "/root/adminpanel")
        return f"{host_dir}/docker-compose.ghcr.yml"

    # ===========================
    # Bare-metal update flow (original)
    # ===========================
    def _run_update_bare(self, *, triggered_by: str) -> None:
        preserve_paths = [
            "bot_profiles.json",
            "remnawave_profiles.json",
            "auth_credentials.json",
            ".auth_tokens.json",
            "panel_users.sqlite",
            "ui_settings.json",
            "monitoring_settings.json",
            "monitoring_state.json",
            "notifications_state.json",
            "sender_saved_messages.json",
            "uploads/sender",
        ]

        started_at = _now()
        self._set_state({
            "status": "running", "stage": "start",
            "message": "Update started",
            "started_at": started_at, "finished_at": None,
            "triggered_by": triggered_by,
        })
        self._append_log(f"Update started by: {triggered_by}")

        try:
            cfg = self.load_config()
            repo_url = str(cfg.get("repo_url") or DEFAULT_REPO_URL).strip()
            branch = str(cfg.get("branch") or DEFAULT_BRANCH).strip() or DEFAULT_BRANCH
            zip_url = _update_zip_url(repo_url, branch)
            self._append_log(f"Repository: {repo_url} ({branch})")

            with tempfile.TemporaryDirectory(prefix="adminpanel_update_") as tmp:
                tmp_root = Path(tmp)
                backup_dir = tmp_root / "backup"
                extract_dir = tmp_root / "extract"
                extract_dir.mkdir(parents=True, exist_ok=True)

                self._set_state({"status": "running", "stage": "backup", "message": "Backing up current data", "started_at": started_at, "triggered_by": triggered_by})
                for rel in preserve_paths:
                    self._copy_preserve(self.project_root, backup_dir, rel)
                self._append_log("Backup completed")

                self._set_state({"status": "running", "stage": "download", "message": "Downloading latest main archive", "started_at": started_at, "triggered_by": triggered_by})
                archive_path = tmp_root / "update.zip"
                req = urllib.request.Request(zip_url, method="GET")
                with urllib.request.urlopen(req, timeout=60) as resp:  # nosec
                    with archive_path.open("wb") as f:
                        while True:
                            chunk = resp.read(1024 * 1024)
                            if not chunk:
                                break
                            f.write(chunk)
                self._append_log(f"Downloaded archive: {archive_path}")

                self._set_state({"status": "running", "stage": "extract", "message": "Extracting archive", "started_at": started_at, "triggered_by": triggered_by})
                with zipfile.ZipFile(archive_path, "r") as zf:
                    zf.extractall(extract_dir)
                roots = [p for p in extract_dir.iterdir() if p.is_dir()]
                if not roots:
                    raise RuntimeError("Archive has no root directory")
                src_root = self._detect_project_src_dir(roots[0])
                self._append_log(f"Detected project source: {src_root}")

                self._set_state({"status": "running", "stage": "replace", "message": "Replacing project files", "started_at": started_at, "triggered_by": triggered_by})
                self._overlay_copy(src_root, self.project_root)
                self._append_log("Project files replaced")

                self._set_state({"status": "running", "stage": "restore", "message": "Restoring backup files", "started_at": started_at, "triggered_by": triggered_by})
                for rel in preserve_paths:
                    self._copy_preserve(backup_dir, self.project_root, rel)
                self._append_log("Backup restore completed")

            self._set_state({"status": "running", "stage": "install", "message": "Running install/setup commands", "started_at": started_at, "triggered_by": triggered_by})
            self._run_cmd(["python3", "admin_cli.py", "install"], cwd=self.project_root, timeout_sec=3600)
            self._run_cmd(["python3", "admin_cli.py", "autostart", "--recreate", "--yes"], cwd=self.project_root, timeout_sec=600)

            self._set_state({"status": "running", "stage": "restart", "message": "Scheduling service restart", "started_at": started_at, "triggered_by": triggered_by})
            subprocess.Popen(  # nosec
                ["bash", "-lc", f"sleep 2 && systemctl restart {self.service_name}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            self._append_log("Restart scheduled")

            self._set_state({
                "status": "success", "stage": "done",
                "message": "Update completed successfully. Service restart scheduled.",
                "started_at": started_at, "finished_at": _now(),
                "triggered_by": triggered_by,
            })
        except Exception as e:
            self._append_log(f"ERROR: {e}")
            self._set_state({
                "status": "failed", "stage": "failed",
                "message": str(e),
                "started_at": started_at, "finished_at": _now(),
                "triggered_by": triggered_by,
            })
        finally:
            with self._lock:
                self._running = False
                self._running_since = None
                self._thread = None
