import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

import bcrypt
from fastapi.testclient import TestClient


class AdminPanelSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Prevent infinite background loops during import/startup
        os.environ["ADMINPANEL_DISABLE_BACKGROUND_LOOPS"] = "1"

        # Import after env is set. unittest loads tests as top-level modules, so use sys.path.
        backend_dir = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(backend_dir))
        import main as app_main  # type: ignore

        cls.main = app_main

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        root = Path(self.tmpdir.name)

        # Patch file locations to temp dir so tests don't touch production JSON files
        self.main.AUTH_CREDENTIALS_FILE = root / "auth_credentials.json"
        self.main.AUTH_TOKENS_FILE = root / ".auth_tokens.json"

        # Reset rate limit state
        self.main._LOGIN_ATTEMPTS.clear()

        # Seed credentials
        username = "admin"
        password = "pass123"
        pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        self.main._write_json(self.main.AUTH_CREDENTIALS_FILE, {"username": username, "password_hash": pw_hash})
        self.main._write_json(self.main.AUTH_TOKENS_FILE, {})

        self.client = TestClient(self.main.app)
        self.username = username
        self.password = password

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_login_rate_limit(self):
        # 10 wrong attempts -> 401, 11th -> 429
        for _ in range(10):
            r = self.client.post("/api/auth/login", json={"username": self.username, "password": "wrong"})
            self.assertEqual(r.status_code, 401)
        r = self.client.post("/api/auth/login", json={"username": self.username, "password": "wrong"})
        self.assertEqual(r.status_code, 429)

    def test_sessions_invalidated_on_password_change(self):
        # Login
        r = self.client.post("/api/auth/login", json={"username": self.username, "password": self.password})
        self.assertEqual(r.status_code, 200)
        csrf = r.json().get("csrf_token")
        self.assertTrue(csrf)

        # Auth check ok
        r2 = self.client.get("/api/auth/check")
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("authenticated"))

        # Change password (should invalidate all sessions)
        r3 = self.client.post(
            "/api/auth/change-password",
            json={"old_password": self.password, "new_password": "newpass123"},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(r3.status_code, 200)

        # Existing cookie should no longer be valid
        r4 = self.client.get("/api/auth/check")
        self.assertEqual(r4.status_code, 200)
        self.assertFalse(r4.json().get("authenticated"))

    def test_legacy_list_response_is_paginated_and_clamped(self):
        # Unit-test internal helper: if Bot API returns list, we slice by page/per_page and clamp per_page<=200.
        profile = {"token": "", "adminId": "", "botApiUrl": "http://example.invalid"}

        class DummyResp:
            status_code = 200

            def json(self):
                return list(range(1000))

        class DummyClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url, params=None):
                return DummyResp()

        orig = self.main.httpx.AsyncClient
        try:
            self.main.httpx.AsyncClient = lambda *args, **kwargs: DummyClient()  # type: ignore

            # Request 50 per page page=2
            res = asyncio.run(self.main._fetch_bot_paginated(profile, "users", {"page": 2, "limit": 50}))
            self.assertEqual(res["page"], 2)
            self.assertEqual(res["per_page"], 50)
            self.assertEqual(res["total"], 1000)
            self.assertEqual(res["total_pages"], 20)
            self.assertEqual(res["items"], list(range(50, 100)))

            # Request absurd limit -> should clamp to 200
            res2 = asyncio.run(self.main._fetch_bot_paginated(profile, "users", {"page": 1, "limit": 999999}))
            self.assertEqual(res2["per_page"], 200)
            self.assertEqual(len(res2["items"]), 200)
        finally:
            self.main.httpx.AsyncClient = orig  # type: ignore


if __name__ == "__main__":
    unittest.main()


