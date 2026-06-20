"""Unit tests for config.py — key rotation and settings validation."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


class TestConfig:
    def test_settings_loads(self):
        """Settings can be instantiated without crashing."""
        from workers.config import Settings

        s = Settings()
        assert s is not None

    def test_rotate_key_cycles(self):
        """rotate_key returns each key in turn and wraps around."""
        from workers.config import Settings

        s = Settings()
        keys = getattr(s, "groq_api_keys", None) or []
        if not keys:
            print("  SKIP: no GROQ keys configured in env")
            return

        seen = set()
        for _ in range(len(keys) * 2):
            k = s.rotate_key("groq")
            seen.add(k)

        assert len(seen) == len(keys), f"Expected {len(keys)} unique keys, got {len(seen)}"

    def test_proxy_url_format(self):
        """proxy_url returns None or a valid proxy string."""
        from workers.config import Settings

        s = Settings()
        url = s.proxy_url()
        if url is not None:
            assert url.startswith("http"), f"Proxy URL should start with http: {url}"


if __name__ == "__main__":
    t = TestConfig()
    t.test_settings_loads()
    print("test_settings_loads PASSED")
    t.test_rotate_key_cycles()
    print("test_rotate_key_cycles PASSED")
    t.test_proxy_url_format()
    print("test_proxy_url_format PASSED")
    print("\nAll config tests passed.")
