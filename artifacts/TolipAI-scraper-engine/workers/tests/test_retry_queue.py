"""Unit tests for retry_queue.py — no external deps required."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from workers.retry_queue import RetryQueue  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class TestRetryQueue:
    def test_enqueue_and_drain(self):
        """Items enqueued are drained and the callback fires."""
        results = []

        async def handler(item):
            results.append(item)

        q = RetryQueue(handler, max_retries=3, base_delay=0.0)

        async def run():
            await q.enqueue({"job_id": "abc", "type": "test"})
            await q._drain_once()

        _run(run())
        assert results == [{"job_id": "abc", "type": "test"}], f"got {results}"

    def test_max_retries_drops_item(self):
        """After max_retries failures the item is dropped, not retried forever."""
        calls = []

        async def failing_handler(item):
            calls.append(item)
            raise RuntimeError("transient failure")

        q = RetryQueue(failing_handler, max_retries=2, base_delay=0.0)

        async def run():
            await q.enqueue({"job_id": "fail", "type": "test"})
            for _ in range(5):
                await q._drain_once()

        _run(run())
        assert len(calls) <= 3, f"should retry at most max_retries+1 times, got {len(calls)}"

    def test_empty_queue_is_safe(self):
        """Draining an empty queue does not raise."""

        async def noop(item):
            pass

        q = RetryQueue(noop, max_retries=3, base_delay=0.0)

        async def run():
            await q._drain_once()

        _run(run())


if __name__ == "__main__":
    t = TestRetryQueue()
    t.test_enqueue_and_drain()
    print("test_enqueue_and_drain PASSED")
    t.test_max_retries_drops_item()
    print("test_max_retries_drops_item PASSED")
    t.test_empty_queue_is_safe()
    print("test_empty_queue_is_safe PASSED")
    print("All retry_queue tests passed.")
