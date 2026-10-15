import asyncio
import json
from pathlib import Path
from bleak import BleakScanner
from winrt.windows.devices.bluetooth import BluetoothAdapter, BluetoothDevice
from winrt.windows.devices.enumeration import DeviceInformation


async def main():
    adapter = await BluetoothAdapter.get_default_async()
    result = {"adapter": None, "paired_targets": [], "advertised_targets": []}
    if adapter:
        result["adapter"] = {
            "classic_supported": adapter.is_classic_supported,
            "low_energy_supported": adapter.is_low_energy_supported,
        }
    for device in await DeviceInformation.find_all_async_aqs_filter(BluetoothDevice.get_device_selector()):
        if "N300" in device.name.upper() or "EDIFIER" in device.name.upper():
            result["paired_targets"].append({"name": device.name, "id": device.id, "paired": device.pairing.is_paired})
    devices = await BleakScanner.discover(timeout=10, return_adv=True)
    result["advertisement_count"] = len(devices)
    for device, advertisement in devices.values():
        name = advertisement.local_name or device.name or ""
        target_uuids = {'00007e00-0000-1000-8000-00805f9b34fb', '00009503-0000-1000-8000-00805f9b34fb', '48097e01-1a48-11e9-ab14-d663bd873d93', '48099503-1a48-11e9-ab14-d663bd873d93'}
        if "N300" in name.upper() or "EDIFIER" in name.upper() or target_uuids.intersection(uuid.lower() for uuid in advertisement.service_uuids):
            result["advertised_targets"].append({
                "name": name, "address": device.address, "rssi": advertisement.rssi,
                "service_uuids": advertisement.service_uuids,
                "manufacturer_data": {str(key): value.hex() for key, value in advertisement.manufacturer_data.items()},
            })
    path = Path(__file__).resolve().parents[1] / "evidence" / "bluetooth-discovery.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True))


asyncio.run(main())
