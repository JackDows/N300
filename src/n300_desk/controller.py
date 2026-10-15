"""Windows BLE control; all writes are named operations with validated ranges."""
import asyncio
import json
import logging
import copy
from dataclasses import dataclass
from pathlib import Path
from bleak import BleakClient, BleakScanner
from n300_desk.protocol import Codec, PROFILES, READ_UUID, WRITE_UUID, advertised_protocol, capabilities

log = logging.getLogger('n300')


@dataclass
class Candidate:
    device: object
    model: str
    service: str
    version: int
    encryption: int
    rssi: int


class N300Controller:
    def __init__(self, emit):
        self.emit = emit
        self.client = None
        self.codec = None
        self.pending = None
        self.lock = asyncio.Lock()
        self.state = {'connected': False, 'verified': False, 'capabilities': {}, 'responses': {}}
        self.candidates = {}
        self.settings = json.loads(Path(__file__).with_name('settings-catalog.json').read_text(encoding='utf-8'))

    def publish(self):
        self.emit('state', copy.deepcopy(self.state))

    async def scan(self):
        if self.client and self.client.is_connected:
            raise RuntimeError('请先断开当前控制连接，再搜索其他音响。')
        self.emit('status', '正在搜索 N300…')
        found = await BleakScanner.discover(timeout=10, return_adv=True)
        self.candidates.clear()
        visible = []
        for device, adv in found.values():
            uuids = {u.lower() for u in adv.service_uuids}
            profile = next((value for key, value in PROFILES.items() if key in uuids or value[1] in uuids), None)
            # Names alone do not identify another Edifier speaker as an N300.
            if profile is None:
                if 'N300' not in (adv.local_name or device.name or '').upper():
                    continue
                profile = ('N300（待核对服务）', '')
            try:
                version, encryption = advertised_protocol(adv.manufacturer_data)
            except ValueError:
                log.warning('Incomplete advertisement from %s', device.address)
                continue
            candidate = Candidate(device, *profile, version, encryption, adv.rssi)
            self.candidates[device.address] = candidate
            visible.append({'address': device.address, 'name': adv.local_name or device.name or profile[0], 'model': profile[0], 'rssi': adv.rssi})
        self.emit('devices', visible)
        self.emit('status', f'找到 {len(visible)} 台 N300' if visible else '未发现 N300。手机断开后，让音响进入蓝牙可发现状态再搜索。')
        return visible

    def disconnected(self, _):
        self.state.update(connected=False, verified=False)
        if self.pending and not self.pending[1].done():
            self.pending[1].set_exception(ConnectionError('音响控制连接已断开'))
        self.publish()
        self.emit('status', '控制连接已断开')

    async def connect(self, address):
        if address not in self.candidates:
            raise ValueError('请先搜索并选择 N300。')
        if self.client:
            await self.disconnect()
        candidate = self.candidates[address]
        self.codec = Codec(candidate.version, candidate.encryption)
        client = BleakClient(candidate.device, disconnected_callback=self.disconnected, timeout=20, winrt={'use_cached_services': False})
        self.emit('status', '正在连接音响控制服务…')
        try:
            await client.connect()
            services = {service.uuid.lower(): service for service in client.services}
            service = services.get(candidate.service) if candidate.service else next((services[uuid] for _, uuid in PROFILES.values() if uuid in services), None)
            if service is None:
                raise RuntimeError('设备没有官方 N300 控制服务，已停止连接。')
            chars = {char.uuid.lower(): char for char in service.characteristics}
            self.write_char = chars.get(WRITE_UUID)
            self.read_char = chars.get(READ_UUID)
            if self.write_char is None or self.read_char is None:
                raise RuntimeError('N300 控制服务的读写通道不完整。')
            if not {'notify', 'indicate'}.intersection(self.read_char.properties):
                raise RuntimeError('音响没有提供控制回复通知。')
            self.write_response = 'write' in self.write_char.properties
            if not self.write_response and 'write-without-response' not in self.write_char.properties:
                raise RuntimeError('音响控制通道不可写。')
            self.client = client
            await client.start_notify(self.read_char, self.notification)
            self.state = {'connected': True, 'verified': False, 'capabilities': {}, 'responses': {}, 'address': address, 'model': candidate.model, 'protocol': self.codec.version}
            self.publish()
            await self.request(0xD8)
            if not self.state['verified']:
                raise RuntimeError('连接成功，但未收到有效的功能信息。请确认手机 App 已退出后重试。')
            await self.refresh()
        except BaseException:
            if client.is_connected:
                await client.disconnect()
            self.client = None
            self.state.update(connected=False, verified=False)
            self.publish()
            raise

    def notification(self, _, data):
        log.info('RX %s', bytes(data).hex(' '))
        for frame in self.codec.feed(data):
            if frame.header not in (0xBB, 0xCC):
                continue
            if self.codec.version == 2 and frame.raw[1] != 0xEC:
                continue
            self.state['responses'][f'{frame.command:02x}'] = frame.payload.hex()
            self.apply_response(frame.command, frame.payload)
            if self.pending and self.pending[0] == frame.command and not self.pending[1].done():
                self.pending[1].set_result(frame)
            self.publish()

    def apply_response(self, command, data):
        if command == 0xD8 and len(data) >= 14:
            self.state['capabilities'] = capabilities(data)
            self.state['verified'] = True
        elif command == 0xC9 and data:
            self.state['name'] = data.rstrip(b'\0').decode('utf-8', 'replace')
        elif command == 0xC6 and data:
            self.state['firmware'] = '.'.join(str(n) for n in data)
        elif command == 0x66 and len(data) == 2 and 0 < data[0] <= 255 and data[1] <= data[0]:
            self.state.update(volume_max=data[0], volume=data[1])
        elif command == 0x61 and len(data) >= 2:
            self.state.update(input_group=data[0], input_value=data[1])
        elif command == 0xD5 and data:
            self.state['eq_value'] = data[0]
            # Calibration tails must be preserved when selecting a preset.
            self.state['eq_calibration'] = list(data[1:])
        elif command == 0xF7 and len(data) == 1 and data[0] in (0, 1):
            self.state['led'] = bool(data[0])
        elif command == 0xD7 and len(data) == 1 and data[0] in (0, 1):
            self.state['idle_shutdown'] = bool(data[0])
        elif command == 0xD3:
            self.state['timer_minutes'] = int.from_bytes(data[:2], 'big') if len(data) >= 2 else 0
        elif command == 0x43:
            self.state['custom_eq_raw'] = data.hex()
            self.state['custom_eq'] = self.parse_custom_eq(data)

    def parse_custom_eq(self, payload):
        kind = payload[0] if self.codec.version == 2 and payload else 1
        offset = 2 if self.codec.version == 2 else 0
        layout = self.settings.get('custom_eq', {}).get(str(kind))
        if not layout:
            return None
        count, stride = layout['bands'], layout['stride']
        if len(payload) < offset + count * stride:
            return None
        bands = []
        for index in range(count):
            block = payload[offset + index * stride:offset + (index + 1) * stride]
            freq_offset, gain_offset = layout['freq_offset'], layout['gain_offset']
            raw_gain = block[gain_offset]
            gain = (raw_gain - layout['gain_offset_value']) / layout['gain_scale']
            frequency = int.from_bytes(block[freq_offset:freq_offset + 2], 'big')
            if block[0] != index or not 20 <= frequency <= 20000 or not layout['gain_min'] <= gain <= layout['gain_max']:
                return None
            bands.append({'index': index, 'frequency': frequency, 'raw_gain': raw_gain, 'gain': gain,
                          'q': block[layout['q_offset']] if layout.get('q_offset') is not None else None})
        return {'kind': kind, 'bands': bands, 'layout': layout}

    async def request(self, command, payload=b'', timeout=3.0):
        if self.client is None or not self.client.is_connected:
            raise ConnectionError('请先连接 N300。')
        async with self.lock:
            future = asyncio.get_running_loop().create_future()
            self.pending = (command, future)
            packet = self.codec.encode(command, payload)
            log.info('TX %s', packet.hex(' '))
            try:
                limit = max(20, min(512, self.client.mtu_size - 3)) if self.write_response else max(20, self.write_char.max_write_without_response_size)
                for offset in range(0, len(packet), limit):
                    await self.client.write_gatt_char(self.write_char, packet[offset:offset + limit], response=self.write_response)
                    if offset + limit < len(packet):
                        await asyncio.sleep(0.03)
                return await asyncio.wait_for(future, timeout)
            finally:
                self.pending = None

    async def refresh(self):
        caps = self.state['capabilities']
        commands = []
        if caps.get('name'): commands.append(0xC9)
        if caps.get('firmware'): commands.append(0xC6)
        if caps.get('volume'): commands.append(0x66)
        if caps.get('input'): commands.append(0x61)
        if caps.get('eq_index'): commands.extend([0xD5, 0x43])
        if caps.get('timer'): commands.append(0xD3)
        if caps.get('idle_shutdown'): commands.append(0xD7)
        # A successful boolean response is required before enabling this setting.
        commands.append(0xF7)
        missing = []
        for command in commands:
            try:
                await self.request(command, timeout=2.0)
            except asyncio.TimeoutError:
                missing.append(f'{command:02x}')
                self.invalidate_response(command)
                log.info('No reply for query %02x', command)
        self.state['missing_queries'] = missing
        self.publish()
        self.emit('status', '已连接 · 设置已读取' if not missing else '已连接 · 部分设置未返回，相关控件保持禁用')

    def invalidate_response(self, command):
        fields = {0x66: ('volume', 'volume_max'), 0x61: ('input_group', 'input_value'), 0xD5: ('eq_value', 'eq_calibration'),
                  0x43: ('custom_eq',), 0xF7: ('led',), 0xD7: ('idle_shutdown',), 0xD3: ('timer_minutes',),
                  0xC9: ('name',), 0xC6: ('firmware',)}
        for key in fields.get(command, ()):
            self.state.pop(key, None)
        self.publish()

    async def set_value(self, kind, value):
        if not self.state.get('verified'):
            raise RuntimeError('先读取并验证音响信息，才能修改设置。')
        if kind == 'volume':
            value = int(value)
            if not 0 <= value <= self.state.get('volume_max', -1): raise ValueError('音量超出设备报告的范围。')
            command, payload, query = 0x67, bytes([value]), 0x66
        elif kind == 'input':
            group = self.state.get('input_group')
            choices = self.settings['inputs'].get(str(group), [])
            if value not in [item['value'] for item in choices]: raise ValueError('此固件的输入选项尚未识别。')
            command, payload, query = 0x62, bytes([group, value]), 0x61
        elif kind == 'eq':
            group = self.state['capabilities'].get('eq_index')
            choices = self.settings['eq_presets'].get(str(group), [])
            if value not in [item['value'] for item in choices]: raise ValueError('此固件的音效选项尚未识别。')
            if self.state.get('eq_calibration'): raise ValueError('此固件附带校准数据，需实机核对后才能切换。')
            command, payload, query = 0xC4, bytes([value]), 0xD5
        elif kind in ('led', 'idle_shutdown'):
            if kind not in self.state: raise ValueError('此设置尚未读取。')
            command, query = (0xF8, 0xF7) if kind == 'led' else (0xD6, 0xD7)
            payload = bytes([bool(value)])
        elif kind == 'timer':
            if not self.state['capabilities'].get('timer'): raise ValueError('音响尚未报告定时功能。')
            value = int(value)
            if not 0 <= value <= 240: raise ValueError('请选择 0 至 240 分钟。')
            command, payload, query = (0xD2, b'', 0xD3) if value == 0 else (0xD1, value.to_bytes(2, 'big'), 0xD3)
        elif kind == 'name':
            limit = self.state['capabilities'].get('rename_bytes', 0)
            payload = value.strip().encode('utf-8')
            if not payload or len(payload) > limit or b'\0' in payload: raise ValueError(f'名称必须为 1 至 {limit} 个 UTF-8 字节。')
            command, query = 0xCA, 0xC9
        elif kind == 'power_off':
            if not self.state['capabilities'].get('power_off'): raise ValueError('音响尚未报告关机功能。')
            try:
                await self.request(0xCE)
            except (asyncio.TimeoutError, ConnectionError):
                if self.client and self.client.is_connected:
                    raise RuntimeError('关机命令未收到回复，请确认音响当前状态。')
            await self.disconnect()
            self.emit('status', '关机命令已发送，控制连接已断开；请确认音响状态')
            return
        else:
            raise ValueError('未知设置')
        try:
            await self.request(command, payload)
        except asyncio.TimeoutError:
            log.info('No setter acknowledgement for %02x; checking actual state', command)
        await asyncio.sleep(0.1)
        key = {'input': 'input_value', 'eq': 'eq_value', 'name': 'name', 'timer': 'timer_minutes'}.get(kind, kind)
        self.invalidate_response(query)
        await self.request(query)
        actual = self.state.get(key)
        expected = value.strip() if kind == 'name' else value
        matches = actual == expected
        if kind == 'timer' and actual is not None:
            matches = max(0, value - 1) <= actual <= value
        if not matches:
            raise RuntimeError('音响回读与请求不同，请查看当前设置；本次修改未确认成功。')
        self.emit('status', '已应用 · 音响回读确认')

    async def set_custom_gain(self, index, gain):
        if not self.state.get('verified'):
            raise RuntimeError('请先连接并读取音响设置。')
        eq = self.state.get('custom_eq')
        if not eq or not isinstance(index, int) or not 0 <= index < len(eq['bands']):
            raise ValueError('此固件的 EQ 频段尚未适配。')
        choices = self.settings['eq_presets'].get(str(self.state['capabilities'].get('eq_index')), [])
        current = next((item for item in choices if item['value'] == self.state.get('eq_value')), {})
        if current.get('type') != 'CUSTOMIZED':
            raise ValueError('请先在“声音”页选择自定义音效，再调整 EQ。')
        layout, band = eq['layout'], eq['bands'][index]
        raw_gain = float(gain) * layout['gain_scale'] + layout['gain_offset_value']
        if not layout['gain_min'] <= gain <= layout['gain_max'] or not raw_gain.is_integer():
            raise ValueError('增益超出此 EQ 格式支持的范围或步进。')
        frequency = band['frequency'].to_bytes(2, 'big')
        payload = bytes([index, 0]) + frequency + bytes([int(raw_gain), band['q']]) if layout['stride'] == 6 else bytes([index]) + frequency + bytes([int(raw_gain)])
        try:
            await self.request(0x44, payload)
        except asyncio.TimeoutError:
            log.info('No EQ setter acknowledgement; checking actual bands')
        self.invalidate_response(0x43)
        await self.request(0x43)
        readback = self.state.get('custom_eq')
        if not readback or readback['bands'][index]['raw_gain'] != int(raw_gain):
            raise RuntimeError('音响没有确认该频段的增益，请查看回读值。')
        self.emit('status', 'EQ 已应用 · 音响回读确认')

    async def disconnect(self):
        client, self.client = self.client, None
        if client and client.is_connected:
            await client.disconnect()
        self.state.update(connected=False, verified=False)
        self.publish()
