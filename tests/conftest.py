"""
pytest configuration for HealthPoint IDR Platform test suite.
"""
from __future__ import annotations

import asyncio
import os

import pytest


def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line("markers", "asyncio: mark test as async")
    config.addinivalue_line("markers", "integration: mark test as integration test (requires running services)")
    config.addinivalue_line("markers", "load: mark test as load/performance test")
    config.addinivalue_line("markers", "security: mark test as security test")


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def pytest_collection_modifyitems(items):
    """Add asyncio marker to all async tests."""
    for item in items:
        if asyncio.iscoroutinefunction(item.function):
            item.add_marker(pytest.mark.asyncio)
