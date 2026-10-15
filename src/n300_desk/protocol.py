"""Edifier packets recovered from EDIFIER Connect 8.5.3. No device I/O here."""
from dataclasses import dataclass

PROFILES = {
    '00007e00-0000-1000-8000-00805f9b34fb': ('N300', '48097e01-1a48-11e9-ab14-d663bd873d93'),
    '00009503-0000-1000-8000-00805f9b34fb': ('N300 2026', '48099503-1a48-11e9-ab14-d663bd873d93'),
}
READ_UUID = '48090001-1a48-11e9-ab14-d663bd873d93'
WRITE_UUID = '48090002-1a48-11e9-ab14-d663bd873d93'
CRC_BASE = 0x2019


@dataclass(frozen=True)
class Frame:
    header: int
    command: int
    payload: bytes
    raw: bytes


class Codec:
    def __init__(self, version=1, encryption=0):
        if version not in (0, 1, 2):
            raise ValueError(f'音响广播了尚未验证的协议版本 {version}，请保留诊断日志。')
        if encryption not in (0, 0x10):
            raise ValueError(f'音响采用尚未实现的握手方式 0x{encryption:02X}，当前版本无法连接。')
        self.version = max(1, version)
        self.encryption = encryption
        self.buffer = bytearray()
        self.bad_checksums = 0

    def crypt(self, payload):
        return bytes(b ^ 0xA5 for b in payload) if self.encryption == 0x10 else bytes(payload)

    def encode(self, command, payload=b'', header=0xAA):
        if not 0 <= command <= 255:
            raise ValueError('Invalid command')
        payload = bytes(payload)
        if self.version == 1:
            if len(payload) > 254:
                raise ValueError('V1 payload exceeds its one-byte length')
            frame = bytes([header, len(payload) + 1, command]) + payload
            return frame + ((sum(frame) + CRC_BASE) & 0xFFFF).to_bytes(2, 'big')
        if len(payload) > 4096:
            raise ValueError('Control payload is too large')
        frame = bytes([header, 0xEC, command]) + len(payload).to_bytes(2, 'big') + self.crypt(payload)
        return frame + bytes([sum(frame) & 0xFF])

    def feed(self, data):
        self.buffer.extend(data)
        frames = []
        while len(self.buffer) >= (5 if self.version == 1 else 6):
            if self.buffer[0] not in (0xAA, 0xBB, 0xCC):
                del self.buffer[0]
                continue
            if self.version == 1:
                if self.buffer[1] < 1:
                    del self.buffer[0]
                    continue
                total = self.buffer[1] + 4
            else:
                if self.buffer[1] != 0xEC:
                    del self.buffer[0]
                    continue
                size = int.from_bytes(self.buffer[3:5], 'big')
                if size > 4096:
                    del self.buffer[0]
                    continue
                total = size + 6
            if len(self.buffer) < total:
                break
            raw = bytes(self.buffer[:total])
            valid = (int.from_bytes(raw[-2:], 'big') == (sum(raw[:-2]) + CRC_BASE) & 0xFFFF) if self.version == 1 else raw[-1] == sum(raw[:-1]) & 0xFF
            if not valid:
                self.bad_checksums += 1
                del self.buffer[0]
                continue
            del self.buffer[:total]
            payload = raw[3:-2] if self.version == 1 else self.crypt(raw[5:-1])
            frames.append(Frame(raw[0], raw[2], payload, raw))
        if len(self.buffer) > 8192:
            self.buffer.clear()
        return frames


def advertised_protocol(manufacturer_data):
    data = manufacturer_data.get(2016)
    if data is None:
        return 1, 0
    if len(data) < 2:
        raise ValueError('音响广播数据不完整，请重新扫描。')
    return data[-2], data[-1]


def capabilities(data):
    def byte(index):
        return data[index] if index < len(data) else 0
    return {
        'name': byte(2) == 1,
        'rename_bytes': {1: 24, 2: 30, 3: 29, 4: 35, 5: 30, 6: 24}.get(byte(3), 0),
        'firmware': byte(5) == 1,
        'idle_shutdown': byte(8) == 1,
        'timer': byte(9) > 0,
        'power_off': byte(10) == 1,
        'eq_index': byte(13),
        'input': bool(byte(19) & 1),
        'volume': bool(byte(19) & 2),
        'ambient_light': bool(byte(19) & 128),
        'raw': bytes(data).hex(),
    }
