import os
import sys
import tempfile

import pytest


def _patch_windows_stdin_injection():
    if os.name != "nt":
        return

    from gltest.direct import loader
    from gltest.direct.vm import VMContext

    original_cleanup = VMContext._cleanup_after_deactivate

    def _inject_message_to_fd0_windows_safe(vm):
        try:
            from genlayer.py import calldata
            from genlayer.py.types import Address
        except ImportError:
            return

        sender_addr = vm.sender
        if isinstance(sender_addr, bytes):
            sender_addr = Address(sender_addr)

        contract_addr = vm._contract_address
        if isinstance(contract_addr, bytes):
            contract_addr = Address(contract_addr)

        origin_addr = vm.origin
        if isinstance(origin_addr, bytes):
            origin_addr = Address(origin_addr)

        message_data = {
            "contract_address": contract_addr,
            "sender_address": sender_addr,
            "origin_address": origin_addr,
            "stack": [],
            "value": vm._value,
            "datetime": vm._datetime,
            "is_init": False,
            "chain_id": vm._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }

        encoded = calldata.encode(message_data)
        fd, path = tempfile.mkstemp()
        os.write(fd, encoded)
        os.lseek(fd, 0, os.SEEK_SET)

        vm._original_stdin_fd = os.dup(0)
        vm._direct_temp_stdin_path = path

        os.dup2(fd, 0)
        os.close(fd)

    def _cleanup_after_deactivate_windows_safe(self):
        try:
            original_cleanup(self)
        finally:
            temp_path = getattr(self, "_direct_temp_stdin_path", None)
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
                self._direct_temp_stdin_path = None

    loader._inject_message_to_fd0 = _inject_message_to_fd0_windows_safe
    VMContext._cleanup_after_deactivate = _cleanup_after_deactivate_windows_safe


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    _patch_windows_stdin_injection()
