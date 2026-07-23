import unittest

import throttle


class FakeRand:
    def __init__(self, value: float):
        self._value = value

    def uniform(self, low: float, high: float) -> float:
        return self._value


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class TestIsThrottleText(unittest.TestCase):
    def test_matches_throttle_signatures(self):
        for text in (
            "API Error: 429 Too Many Requests",
            "rate limit exceeded",
            "Overloaded",
            "you have hit your usage limit",
            "upstream returned 529",
            "quota exceeded for this billing period",
        ):
            self.assertTrue(throttle.is_throttle_text(text), text)

    def test_rejects_ordinary_failures(self):
        for text in ("", "claude: command not found", "MCP server disconnected"):
            self.assertFalse(throttle.is_throttle_text(text), text)


class TestBackoffSeconds(unittest.TestCase):
    def test_grows_exponentially_with_zero_jitter(self):
        rand = FakeRand(0.0)
        self.assertEqual(throttle.backoff_seconds(1, rand), 15.0)
        self.assertEqual(throttle.backoff_seconds(2, rand), 30.0)
        self.assertEqual(throttle.backoff_seconds(3, rand), 60.0)

    def test_caps_at_backoff_cap(self):
        rand = FakeRand(throttle.JITTER_MAX_SECONDS)
        self.assertEqual(throttle.backoff_seconds(10, rand), throttle.BACKOFF_CAP_SECONDS)


class TestThrottleGate(unittest.TestCase):
    def test_waits_out_cooldown_and_keeps_max_of_reports(self):
        fake = FakeClock()
        gate = throttle.ThrottleGate(clock=fake.clock, sleeper=fake.sleep)
        gate.report_throttle(5.0)
        gate.report_throttle(2.0)
        gate.wait_until_clear()
        self.assertEqual(fake.now, 5.0)
        self.assertEqual(fake.sleeps, [5.0])

    def test_clear_gate_returns_immediately(self):
        fake = FakeClock()
        gate = throttle.ThrottleGate(clock=fake.clock, sleeper=fake.sleep)
        gate.wait_until_clear()
        self.assertEqual(fake.sleeps, [])

    def test_rechecks_after_sleep_when_cooldown_extended(self):
        fake = FakeClock()
        gate = throttle.ThrottleGate(clock=fake.clock, sleeper=fake.sleep)
        gate.report_throttle(3.0)

        original_sleep = fake.sleep

        def sleep_then_extend(seconds: float) -> None:
            original_sleep(seconds)
            if len(fake.sleeps) == 1:
                gate.report_throttle(4.0)

        gate._sleeper = sleep_then_extend
        gate.wait_until_clear()
        self.assertEqual(fake.now, 7.0)
        self.assertEqual(len(fake.sleeps), 2)


if __name__ == "__main__":
    unittest.main()
