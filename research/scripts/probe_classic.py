import ctypes as c
from ctypes import wintypes as w
import json
from pathlib import Path


class SystemTime(c.Structure):
    _fields_ = [(name, w.WORD) for name in ['year', 'month', 'day_of_week', 'day', 'hour', 'minute', 'second', 'milliseconds']]


class DeviceInfo(c.Structure):
    _fields_ = [('size', w.DWORD), ('address', c.c_ulonglong), ('device_class', w.ULONG),
                ('connected', w.BOOL), ('remembered', w.BOOL), ('authenticated', w.BOOL),
                ('last_seen', SystemTime), ('last_used', SystemTime), ('name', w.WCHAR * 248)]


class SearchParams(c.Structure):
    _fields_ = [('size', w.DWORD), ('authenticated', w.BOOL), ('remembered', w.BOOL),
                ('unknown', w.BOOL), ('connected', w.BOOL), ('inquiry', w.BOOL),
                ('timeout_multiplier', c.c_ubyte), ('radio', w.HANDLE)]


api = c.WinDLL('BluetoothAPIs.dll', use_last_error=True)
api.BluetoothFindFirstDevice.argtypes = [c.POINTER(SearchParams), c.POINTER(DeviceInfo)]
api.BluetoothFindFirstDevice.restype = w.HANDLE
api.BluetoothFindNextDevice.argtypes = [w.HANDLE, c.POINTER(DeviceInfo)]
api.BluetoothFindNextDevice.restype = w.BOOL
api.BluetoothFindDeviceClose.argtypes = [w.HANDLE]
params = SearchParams(c.sizeof(SearchParams), True, True, True, True, True, 4, None)
info = DeviceInfo()
info.size = c.sizeof(DeviceInfo)
handle = api.BluetoothFindFirstDevice(c.byref(params), c.byref(info))
result = {'target_devices': [], 'observed_device_count': 0, 'error': None}
if not handle:
    result['error'] = c.get_last_error()
else:
    try:
        while True:
            result['observed_device_count'] += 1
            if 'N300' in info.name.upper() or 'EDIFIER' in info.name.upper():
                address = ':'.join(f'{byte:02X}' for byte in info.address.to_bytes(6, 'big'))
                result['target_devices'].append({'name': info.name, 'address': address, 'connected': bool(info.connected), 'remembered': bool(info.remembered), 'authenticated': bool(info.authenticated), 'device_class': info.device_class})
            if not api.BluetoothFindNextDevice(handle, c.byref(info)):
                break
    finally:
        api.BluetoothFindDeviceClose(handle)
output = Path(__file__).resolve().parents[1] / 'evidence' / 'classic-discovery.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps(result, ensure_ascii=True))
