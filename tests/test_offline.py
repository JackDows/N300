"""Offline protocol/transport integration tests. Never instantiate real Bluetooth."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from n300_desk.protocol import Codec, PROFILES, READ_UUID, WRITE_UUID, advertised_protocol, capabilities
from n300_desk.controller import Candidate, N300Controller


def capability_packet():
    data = bytearray(20)
    for index in (2, 3, 5, 8, 9, 10): data[index] = 1
    data[13], data[19] = 19, 3
    return bytes(data)


def eq_packet():
    return b''.join(bytes([i, 0]) + frequency.to_bytes(2, 'big') + bytes([6, 7]) for i, frequency in enumerate((100, 500, 2000, 8000)))


class SimulatedGatt:
    """Deterministic device fixture implementing the APK's query/set semantics."""
    def __init__(self, controller, version=1):
        self.controller = controller
        self.codec = Codec(version)
        self.is_connected = True
        self.mtu_size = 23
        self.requests = []
        self.values = {0xD8: capability_packet(), 0xC9: b'N300', 0xC6: b'\x01\x05\x01', 0x66: bytes([16, 8]), 0x61: bytes([5, 2]), 0xD5: b'\x04', 0x43: eq_packet() if version == 1 else bytes([1, 4]) + eq_packet(), 0xD3: b'\x00\x00', 0xD7: b'\x00', 0xF7: b'\x01'}
        self.reject = False
        self.ignore = False
        read = SimpleNamespace(uuid=READ_UUID, properties=['notify'])
        write = SimpleNamespace(uuid=WRITE_UUID, properties=['write-without-response'], max_write_without_response_size=20)
        self.services = [SimpleNamespace(uuid=next(iter(PROFILES.values()))[1], characteristics=[read, write])]

    async def connect(self): self.is_connected = True
    async def disconnect(self): self.is_connected = False
    async def start_notify(self, char, callback): self.callback = callback

    async def write_gatt_char(self, char, data, response=False):
        for frame in self.codec.feed(data):
            cmd, payload = frame.command, frame.payload
            self.requests.append((cmd, payload))
            if self.ignore: continue
            if cmd in self.values:
                answer = self.values[cmd]
            else:
                mapping = {0x62: 0x61, 0xC4: 0xD5, 0xF8: 0xF7, 0xD6: 0xD7, 0xD1: 0xD3, 0xCA: 0xC9}
                if not self.reject:
                    if cmd in mapping: self.values[mapping[cmd]] = payload
                    elif cmd == 0x67: self.values[0x66] = bytes([16, payload[0]])
                    elif cmd == 0xD2: self.values[0xD3] = b'\0\0'
                    elif cmd == 0x44:
                        index = payload[0]
                        block = bytearray(self.values[0x43])
                        offset = (2 if self.codec.version == 2 else 0) + index * 6
                        block[offset:offset + 6] = payload
                        self.values[0x43] = bytes(block)
                # Some setters return the new boolean state, including zero.
                answer = payload if cmd in (0xF8, 0xD6) else bytes([not self.reject])
            packet = self.codec.encode(cmd, answer, header=0xBB)
            for i in range(0, len(packet), 3):
                self.controller.notification(None, packet[i:i + 3])


class CodecTests(unittest.TestCase):
    def test_apk_reference_packets(self):
        vectors = [(1, 0, 0xD8, b'', 'aa01d8219c'), (1, 0, 0x67, b'\x08', 'aa0267082134'),
                   (1, 0, 0x62, b'\x05\x02', 'aa03620502212f'), (1, 0, 0xD2, b'', 'aa01d22196'),
                   (2, 0, 0xD8, b'', 'aaecd800006e'), (2, 0, 0x62, b'\x05\x02', 'aaec620002050201'),
                   (2, 0x10, 0x62, b'\x05\x02', 'aaec620002a0a741')]
        for version, encryption, cmd, data, golden in vectors:
            with self.subTest(golden=golden):
                self.assertEqual(Codec(version, encryption).encode(cmd, data).hex(), golden)

    def test_all_fragment_boundaries_and_coalesced_frames(self):
        for version, encryption in ((1, 0), (2, 0), (2, 0x10)):
            writer = Codec(version, encryption)
            first = writer.encode(0xD8, capability_packet(), 0xBB)
            second = writer.encode(0x66, bytes([16, 8]), 0xBB)
            for split in range(len(first) + 1):
                reader = Codec(version, encryption)
                frames = reader.feed(first[:split]) + reader.feed(first[split:] + second)
                self.assertEqual([f.payload for f in frames], [capability_packet(), bytes([16, 8])])

    def test_invalid_crc_is_rejected_then_stream_recovers(self):
        for version in (1, 2):
            codec = Codec(version)
            damaged = bytearray(codec.encode(0x66, b'\x10\x08', 0xBB))
            damaged[-1] ^= 1
            frames = codec.feed(b'\0\x11' + damaged + codec.encode(0xD7, b'\0', 0xBB))
            self.assertEqual([(f.command, f.payload) for f in frames], [(0xD7, b'\0')])
            self.assertEqual(codec.bad_checksums, 1)

    def test_v2_other_application_is_ignored(self):
        codec = Codec(2)
        self.assertEqual(codec.feed(bytes.fromhex('bbed660002100828')), [])

    def test_unsupported_protocol_does_not_silently_fallback(self):
        for version, encryption in ((3, 0), (2, 0x31)):
            with self.assertRaises(ValueError): Codec(version, encryption)

    def test_advertisement_only_uses_edifier_manufacturer(self):
        self.assertEqual(advertised_protocol({2016: b'prefix\x02\x10'}), (2, 16))
        self.assertEqual(advertised_protocol({5: b'\x02\x10'}), (1, 0))
        with self.assertRaises(ValueError): advertised_protocol({2016: b'\0'})

    def test_capabilities_are_not_assumed(self):
        self.assertFalse(capabilities(b'')['volume'])
        self.assertEqual(capabilities(capability_packet())['eq_index'], 19)
        self.assertEqual(capabilities(capability_packet())['rename_bytes'], 24)


class ControllerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = []
        self.control = N300Controller(lambda *event: self.events.append(event))
        self.control.codec = Codec(1)
        self.device = SimulatedGatt(self.control)
        self.control.client = self.device
        self.control.write_response = False
        self.control.write_char = self.device.services[0].characteristics[1]
        self.control.state['connected'] = True
        await self.control.request(0xD8)
        await self.control.refresh()
        self.device.requests.clear()

    async def test_handshake_and_reads_only(self):
        self.control.client = None
        self.control.candidates['demo'] = Candidate(SimpleNamespace(address='demo'), 'N300', next(iter(PROFILES.values()))[1], 1, 0, -40)
        with patch('n300_desk.controller.BleakClient', return_value=self.device):
            await self.control.connect('demo')
        self.assertTrue(self.control.state['verified'])
        self.assertEqual(self.control.state['volume'], 8)
        self.assertTrue(all(cmd in self.device.values and payload == b'' for cmd, payload in self.device.requests))

    async def test_wrong_service_rejected_before_any_command(self):
        self.control.client = None
        self.control.candidates['demo'] = Candidate(object(), 'N300', 'wrong', 1, 0, -40)
        with patch('n300_desk.controller.BleakClient', return_value=self.device):
            with self.assertRaisesRegex(RuntimeError, 'N300'):
                await self.control.connect('demo')
        self.assertEqual(self.device.requests, [])
        self.assertFalse(self.device.is_connected)

    async def test_volume_set_and_actual_readback(self):
        await self.control.set_value('volume', 9)
        self.assertEqual(self.device.requests, [(0x67, b'\x09'), (0x66, b'')])
        self.assertEqual(self.control.state['volume'], 9)

    async def test_out_of_range_volume_sends_nothing(self):
        for value in (-1, 17):
            with self.assertRaises(ValueError): await self.control.set_value('volume', value)
        self.assertEqual(self.device.requests, [])

    async def test_input_and_preset_wire_values(self):
        await self.control.set_value('input', 2)
        await self.control.set_value('eq', 3)
        self.assertIn((0x62, b'\x05\x02'), self.device.requests)
        self.assertIn((0xC4, b'\x03'), self.device.requests)

    async def test_unknown_option_sends_nothing(self):
        for kind in ('input', 'eq'):
            with self.assertRaises(ValueError): await self.control.set_value(kind, 99)
        self.assertEqual(self.device.requests, [])

    async def test_led_off_accepts_zero_response_after_verification(self):
        await self.control.set_value('led', False)
        self.assertFalse(self.control.state['led'])
        self.assertEqual(self.device.requests, [(0xF8, b'\0'), (0xF7, b'')])

    async def test_rejected_setting_is_not_reported_as_success(self):
        self.device.reject = True
        with self.assertRaises(RuntimeError): await self.control.set_value('volume', 12)
        self.assertEqual(self.control.state['volume'], 8)

    async def test_timer_zero_cancels_instead_of_powering_off(self):
        await self.control.set_value('timer', 30)
        await self.control.set_value('timer', 0)
        self.assertIn((0xD1, b'\0\x1e'), self.device.requests)
        self.assertIn((0xD2, b''), self.device.requests)
        self.assertNotIn((0xD1, b'\0\0'), self.device.requests)

    async def test_name_utf8_byte_limit(self):
        with self.assertRaises(ValueError): await self.control.set_value('name', '音' * 9)
        self.assertEqual(self.device.requests, [])
        await self.control.set_value('name', '桌面 N300')
        self.assertEqual(self.control.state['name'], '桌面 N300')

    async def test_eq_write_preserves_frequency_and_q(self):
        await self.control.set_custom_gain(1, -2)
        self.assertEqual(self.device.requests, [(0x44, bytes.fromhex('010001f40407')), (0x43, b'')])
        band = self.control.state['custom_eq']['bands'][1]
        self.assertEqual((band['frequency'], band['gain'], band['q']), (500, -2, 7))

    async def test_eq_requires_custom_mode_and_valid_gain(self):
        with self.assertRaises(ValueError): await self.control.set_custom_gain(0, 100)
        self.control.state['eq_value'] = 0
        with self.assertRaises(ValueError): await self.control.set_custom_gain(0, 0)
        self.assertEqual(self.device.requests, [])

    async def test_unknown_eq_format_is_read_only(self):
        self.control.codec = Codec(2)
        self.control.apply_response(0x43, bytes([99, 4]) + eq_packet())
        self.assertIsNone(self.control.state['custom_eq'])

    async def test_bad_band_index_is_not_editable(self):
        data = bytearray(eq_packet())
        data[0] = 99
        self.control.apply_response(0x43, data)
        self.assertIsNone(self.control.state['custom_eq'])

    async def test_command_timeout_and_disconnect_cleanup(self):
        self.device.ignore = True
        with self.assertRaises(TimeoutError): await self.control.request(0x66, timeout=0.01)
        self.assertIsNone(self.control.pending)
        await self.control.disconnect()
        self.assertFalse(self.control.state['verified'])
        self.assertIsNone(self.control.client)

    async def test_v2_integration_and_fragmented_eq(self):
        self.control.codec = Codec(2)
        self.control.client = self.device = SimulatedGatt(self.control, 2)
        await self.control.refresh()
        await self.control.set_custom_gain(3, 1)
        self.assertEqual(self.control.state['custom_eq']['bands'][3]['gain'], 1)

    async def test_snapshots_are_independent(self):
        self.control.publish()
        snapshot = self.events[-1][1]
        self.control.state['capabilities']['eq_index'] = 99
        self.assertEqual(snapshot['capabilities']['eq_index'], 19)

    async def test_catalog_matches_app_n300_style_options(self):
        eq = self.control.settings['eq_presets']['19']
        self.assertEqual([(v['value'], v['type']) for v in eq], [(0, 'MUSIC'), (1, 'MONITOR'), (2, 'GAME'), (3, 'MOVIE'), (4, 'CUSTOMIZED')])
        self.assertEqual([(v['value'], v['type']) for v in self.control.settings['inputs']['5']], [(1, 1), (2, 2), (3, 3)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
