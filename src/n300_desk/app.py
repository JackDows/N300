"""N300 Desk: an unofficial, local Windows BLE remote."""
import argparse
import asyncio
import copy
import ctypes
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import queue
import sys
import threading
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

from n300_desk.controller import N300Controller


def application_dir():
    return Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[2] / '.local'


class Worker:
    def __init__(self, events):
        self.events = events
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True, name='N300-BLE')
        self.thread.start()
        self.ready.wait(5)
        if not self.ready.is_set():
            raise RuntimeError('控制服务启动超时')

    def run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.controller = N300Controller(lambda kind, data: self.events.put((kind, copy.deepcopy(data))))
        self.ready.set()
        try:
            self.loop.run_forever()
        finally:
            tasks = asyncio.all_tasks(self.loop)
            for task in tasks:
                task.cancel()
            self.loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
            self.loop.close()

    def submit(self, method, *args):
        future = asyncio.run_coroutine_threadsafe(getattr(self.controller, method)(*args), self.loop)
        def finished(result):
            try:
                result.result()
            except Exception as exc:
                logging.getLogger('n300').exception('Operation failed', exc_info=exc)
                explanation = str(exc) or ('音响未及时回复，请刷新或重新连接。' if isinstance(exc, TimeoutError) else type(exc).__name__)
                self.events.put(('error', explanation))
            finally:
                self.events.put(('busy', False))
        future.add_done_callback(finished)

    def close(self):
        async def shutdown():
            await self.controller.disconnect()
        future = asyncio.run_coroutine_threadsafe(shutdown(), self.loop)
        future.add_done_callback(lambda _: self.loop.call_soon_threadsafe(self.loop.stop))


class App:
    def __init__(self, root, demo=False):
        self.root, self.demo = root, demo
        self.events = queue.Queue()
        self.worker = Worker(self.events)
        self.settings = self.worker.controller.settings
        self.state = {'connected': False, 'verified': False, 'capabilities': {}}
        self.busy = False
        self.devices = []
        self.actions = []
        self.band_vars = []
        self.band_signature = None
        self.root.title('N300 Desk' + (' · 离线预览' if demo else ''))
        scale = max(1, self.root.winfo_fpixels('1i') / 96)
        width = min(round(880 * scale), self.root.winfo_screenwidth() - 80)
        height = min(round(760 * scale), self.root.winfo_screenheight() - 100)
        self.root.geometry(f'{width}x{height}')
        self.root.minsize(min(round(780 * scale), width), min(round(690 * scale), height))
        self.root.configure(background='#f4f6fa')
        self.root.protocol('WM_DELETE_WINDOW', self.close)
        self.style()
        self.build()
        self.update_state(self.state)
        if demo:
            self.update_state(self.demo_state())
            self.status.set('离线预览 · 所有数值均为示例，不会搜索或控制音响')
        self.root.after(80, self.poll)

    def style(self):
        s = ttk.Style(self.root)
        s.theme_use('clam')
        s.configure('.', font=('Microsoft YaHei UI', 10), background='#f4f6fa', foreground='#202c40')
        s.configure('TFrame', background='#f4f6fa')
        s.configure('TLabelframe', background='#f4f6fa')
        s.configure('TLabelframe.Label', font=('Microsoft YaHei UI', 10, 'bold'))
        s.configure('TButton', padding=(13, 7), background='#e7edf6', borderwidth=0)
        s.map('TButton', background=[('active', '#d9e4f4')], foreground=[('disabled', '#99a3b1')])
        s.configure('Accent.TButton', background='#1d64d8', foreground='white')
        s.map('Accent.TButton', background=[('active', '#164eaa'), ('disabled', '#cbd5e5')])
        s.configure('Title.TLabel', font=('Microsoft YaHei UI', 24, 'bold'))
        s.configure('Muted.TLabel', foreground='#65748a')
        s.configure('TNotebook', borderwidth=0)
        s.configure('TNotebook.Tab', padding=(18, 10))
        s.map('TNotebook.Tab', background=[('selected', '#ffffff')])
        s.configure('TEntry', fieldbackground='white', padding=5)
        s.configure('TCombobox', fieldbackground='white', padding=5)

    def button(self, parent, text, callback, predicate=lambda state: True, **options):
        b = ttk.Button(parent, text=text, command=callback, **options)
        self.actions.append((b, predicate))
        return b

    def build(self):
        outer = ttk.Frame(self.root, padding=24)
        outer.pack(fill='both', expand=True)
        header = ttk.Frame(outer)
        header.pack(fill='x')
        ttk.Label(header, text='N300 Desk', style='Title.TLabel').pack(side='left')
        self.badge = ttk.Label(header, text='尚未连接', style='Muted.TLabel')
        self.badge.pack(side='right')
        subtitle = '离线预览 · 示例数据，不会连接音响' if self.demo else 'Windows 音响控制 · 非官方工具 · 等待实机验证'
        ttk.Label(outer, text=subtitle, style='Muted.TLabel').pack(anchor='w', pady=(3, 17))
        bar = ttk.Frame(outer)
        bar.pack(fill='x')
        self.device_choice = ttk.Combobox(bar, state='readonly', width=35)
        self.device_choice.pack(side='left', fill='x', expand=True, padx=(0, 8))
        self.device_choice.set('点击搜索，选择附近的 N300')
        self.button(bar, '搜索', lambda: self.run('scan'), lambda s: not s.get('connected')).pack(side='left', padx=3)
        self.button(bar, '连接', self.connect, lambda s: bool(self.devices) and not s.get('connected'), style='Accent.TButton').pack(side='left', padx=3)
        self.button(bar, '断开', lambda: self.run('disconnect'), lambda s: s.get('connected')).pack(side='left', padx=3)
        self.button(bar, '刷新', lambda: self.run('refresh'), lambda s: s.get('verified')).pack(side='left', padx=(3, 0))
        self.info = tk.StringVar(value='连接后读取功能、固件和当前设置。')
        ttk.Label(outer, textvariable=self.info, style='Muted.TLabel').pack(anchor='w', pady=(10, 16))
        tabs = ttk.Notebook(outer)
        tabs.pack(fill='both', expand=True)
        sound, equalizer, settings, help_tab = [ttk.Frame(tabs, padding=20) for _ in range(4)]
        for tab, label in zip((sound, equalizer, settings, help_tab), ('声音', '自定义 EQ', '设备设置', '连接帮助')):
            tabs.add(tab, text=label)
        self.build_sound(sound)
        self.build_eq(equalizer)
        self.build_settings(settings)
        self.build_help(help_tab)
        self.status = tk.StringVar(value='准备就绪 · 不会自动搜索或连接音响')
        ttk.Label(outer, textvariable=self.status, wraplength=810, style='Muted.TLabel').pack(anchor='w', pady=(16, 0))

    def build_sound(self, parent):
        ttk.Label(parent, text='音响音量', font=('Microsoft YaHei UI', 12, 'bold')).pack(anchor='w')
        row = ttk.Frame(parent)
        row.pack(fill='x', pady=(10, 20))
        self.volume = tk.DoubleVar(value=0)
        self.volume_scale = ttk.Scale(row, from_=0, to=1, variable=self.volume, command=self.show_volume)
        self.volume_scale.pack(side='left', fill='x', expand=True, padx=(0, 18))
        self.volume_text = ttk.Label(row, text='—', width=9)
        self.volume_text.pack(side='left')
        self.button(row, '应用音量', lambda: self.set_value('volume', round(self.volume.get())), lambda s: 'volume_max' in s).pack(side='left')
        ttk.Label(parent, text='音频输入', font=('Microsoft YaHei UI', 12, 'bold')).pack(anchor='w', pady=(8, 8))
        row = ttk.Frame(parent)
        row.pack(fill='x')
        self.input_choice = ttk.Combobox(row, state='disabled', width=37)
        self.input_choice.pack(side='left', fill='x', expand=True, padx=(0, 12))
        self.button(row, '切换输入', lambda: self.choose('input'), lambda s: bool(self.input_options(s))).pack(side='left')
        ttk.Label(parent, text='切换输入会改变音响播放来源。使用音频线时请选择 AUX。', style='Muted.TLabel', wraplength=700).pack(anchor='w', pady=(8, 25))
        ttk.Label(parent, text='音效模式', font=('Microsoft YaHei UI', 12, 'bold')).pack(anchor='w', pady=(0, 8))
        row = ttk.Frame(parent)
        row.pack(fill='x')
        self.eq_choice = ttk.Combobox(row, state='disabled', width=37)
        self.eq_choice.pack(side='left', fill='x', expand=True, padx=(0, 12))
        self.button(row, '应用音效', lambda: self.choose('eq'), lambda s: bool(self.eq_options(s)) and not s.get('eq_calibration')).pack(side='left')
        self.eq_note = ttk.Label(parent, text='可选音效以音响返回的信息为准。', style='Muted.TLabel', wraplength=710)
        self.eq_note.pack(anchor='w', pady=(8, 20))
        ttk.Label(parent, text='音频线负责播放，蓝牙负责控制。\n当前尚未验证 N300 在 AUX 模式下是否保持控制连接。', style='Muted.TLabel', wraplength=710).pack(anchor='w', pady=(10, 0))

    def build_eq(self, parent):
        self.eq_description = ttk.Label(parent, text='连接后读取音响支持的频段和调节范围。', wraplength=710)
        self.eq_description.pack(anchor='w', pady=(0, 14))
        self.eq_bands = ttk.Frame(parent)
        self.eq_bands.pack(fill='both', expand=True)
        row = ttk.Frame(parent)
        row.pack(fill='x', pady=(14, 0))
        ttk.Label(row, text='每段独立应用；频率与 Q 值沿用音响当前设置。', style='Muted.TLabel', wraplength=680).pack(anchor='w')

    def build_settings(self, parent):
        self.led = tk.BooleanVar()
        self.idle = tk.BooleanVar()
        self.led_check = ttk.Checkbutton(parent, text='指示灯', variable=self.led, command=lambda: self.set_value('led', self.led.get()))
        self.led_check.pack(anchor='w', pady=8)
        self.idle_check = ttk.Checkbutton(parent, text='无信号自动关机', variable=self.idle, command=lambda: self.set_value('idle_shutdown', self.idle.get()))
        self.idle_check.pack(anchor='w', pady=(8, 25))
        row = ttk.Frame(parent)
        row.pack(fill='x', pady=6)
        ttk.Label(row, text='定时关机').pack(side='left', padx=(0, 12))
        self.timer = tk.StringVar(value='30')
        ttk.Spinbox(row, from_=1, to=240, width=7, textvariable=self.timer).pack(side='left')
        ttk.Label(row, text='分钟').pack(side='left', padx=8)
        self.button(row, '设置', lambda: self.set_value('timer', self.timer.get()), lambda s: s.get('capabilities', {}).get('timer')).pack(side='left', padx=4)
        self.button(row, '取消定时', lambda: self.set_value('timer', 0), lambda s: s.get('capabilities', {}).get('timer')).pack(side='left', padx=4)
        self.timer_text = ttk.Label(parent, text='剩余时间：尚未读取', style='Muted.TLabel')
        self.timer_text.pack(anchor='w', pady=(6, 23))
        row = ttk.Frame(parent)
        row.pack(fill='x')
        ttk.Label(row, text='蓝牙名称').pack(side='left', padx=(0, 12))
        self.name = tk.StringVar()
        ttk.Entry(row, textvariable=self.name, width=29).pack(side='left', fill='x', expand=True, padx=(0, 12))
        self.button(row, '保存名称', lambda: self.set_value('name', self.name.get()), lambda s: s.get('capabilities', {}).get('rename_bytes')).pack(side='left')
        row = ttk.Frame(parent)
        row.pack(fill='x', pady=(30, 12))
        self.button(row, '关闭音响…', self.power_off, lambda s: s.get('capabilities', {}).get('power_off')).pack(side='left')
        ttk.Label(parent, text='灰色控件表示尚未读取到该功能，或当前固件未报告支持。', wraplength=710, style='Muted.TLabel').pack(anchor='w')

    def build_help(self, parent):
        text = ('第一次连接\n\n'
                '1. 打开电脑蓝牙，保持音响开机。\n'
                '2. 方便时先断开手机与音响的蓝牙连接，退出手机 App。\n'
                '3. 点击“搜索”。若找不到，按说明书让音响进入蓝牙可发现状态后重试。\n'
                '4. 选择 N300 并连接。读取到设置后，再尝试 AUX 输入与控制能否同时使用。\n\n'
                '软件只连接音响的控制服务，不会自动改变 Windows 默认播放设备。\n'
                '固件升级、恢复出厂和手机端在线内容暂不提供。\n\n'
                '诊断文件用于后续适配，包含设备地址、固件信息和控制回复。')
        ttk.Label(parent, text=text, justify='left', wraplength=710).pack(anchor='w')
        ttk.Button(parent, text='导出诊断', command=self.export_diagnostics).pack(anchor='w', pady=(20, 0))

    def input_options(self, state):
        return self.settings['inputs'].get(str(state.get('input_group')), [])

    def eq_options(self, state):
        return self.settings['eq_presets'].get(str(state.get('capabilities', {}).get('eq_index')), []) if 'eq_value' in state else []

    def show_volume(self, *_):
        if hasattr(self, 'volume_text'):
            self.volume_text.configure(text=f'{round(self.volume.get())} / {self.state.get("volume_max", "—")}')

    def choose(self, kind):
        combo = self.input_choice if kind == 'input' else self.eq_choice
        options = self.input_options(self.state) if kind == 'input' else self.eq_options(self.state)
        if 0 <= combo.current() < len(options):
            self.set_value(kind, options[combo.current()]['value'])

    def set_value(self, kind, value):
        if self.demo:
            keys = {'eq': 'eq_value', 'input': 'input_value', 'name': 'name', 'timer': 'timer_minutes'}
            self.state[keys.get(kind, kind)] = value
            self.update_state(self.state)
            self.status.set('离线预览 · 已改变示例数值，未向音响发送命令')
            return
        self.run('set_value', kind, value)

    def connect(self):
        if 0 <= self.device_choice.current() < len(self.devices):
            self.run('connect', self.devices[self.device_choice.current()]['address'])

    def run(self, method, *args):
        if self.demo:
            self.status.set('离线预览 · 此窗口不会操作蓝牙；关闭后正常启动即可连接')
            return
        if not self.busy:
            self.busy = True
            self.update_enabled()
            self.status.set('正在处理，请稍候…')
            self.worker.submit(method, *args)

    def power_off(self):
        if messagebox.askyesno('关闭音响', '确定关闭 N300？再次使用时需要在音响上开机。', parent=self.root):
            self.set_value('power_off', True)

    def update_enabled(self):
        available = self.state.get('verified') and not self.busy
        for button, predicate in self.actions:
            connected_only = button.cget('text') not in ('搜索', '连接', '断开')
            button.configure(state='normal' if not self.busy and predicate(self.state) and (available or not connected_only) else 'disabled')
        self.volume_scale.configure(state='normal' if available and 'volume_max' in self.state else 'disabled')
        self.input_choice.configure(state='readonly' if available and self.input_options(self.state) else 'disabled')
        self.eq_choice.configure(state='readonly' if available and self.eq_options(self.state) and not self.state.get('eq_calibration') else 'disabled')
        self.led_check.configure(state='normal' if available and 'led' in self.state else 'disabled')
        self.idle_check.configure(state='normal' if available and 'idle_shutdown' in self.state else 'disabled')
        for _, slider, apply_button in self.band_vars:
            slider.configure(state='normal' if available else 'disabled')
            apply_button.configure(state='normal' if available else 'disabled')

    def update_state(self, state):
        self.state = state
        self.badge.configure(text='离线预览' if self.demo else ('已连接' if state.get('verified') else '尚未连接'))
        self.info.set(f'{state.get("name", "N300")}  ·  固件 {state.get("firmware", "—")}  ·  {state.get("address", "")}' if state.get('connected') else '连接后读取功能、固件和当前设置。')
        self.volume_scale.configure(to=state.get('volume_max', 1))
        self.volume.set(state.get('volume', 0))
        self.show_volume()
        if 'volume' not in state:
            self.volume_text.configure(text='—')
        for combo, options, current in ((self.input_choice, self.input_options(state), state.get('input_value')), (self.eq_choice, self.eq_options(state), state.get('eq_value'))):
            combo.configure(values=[item['label'] for item in options])
            matching = next((i for i, item in enumerate(options) if item['value'] == current), None)
            if matching is not None:
                combo.current(matching)
            else:
                combo.set('尚未读取' if current is None else f'当前选项 {current} · 尚未适配')
        self.eq_note.configure(text='该固件附带校准数据，切换音效需进一步核对。' if state.get('eq_calibration') else '可选音效以音响返回的信息为准。')
        self.led.set(state.get('led', False))
        self.idle.set(state.get('idle_shutdown', False))
        self.timer_text.configure(text=f'剩余时间：{state["timer_minutes"]} 分钟（刷新时读取）' if 'timer_minutes' in state else '剩余时间：尚未读取')
        if 'name' in state and not self.name.get():
            self.name.set(state['name'])
        self.draw_eq(state.get('custom_eq'))
        self.update_enabled()

    def draw_eq(self, eq):
        signature = json.dumps(eq, sort_keys=True)
        if signature == self.band_signature:
            return
        self.band_signature = signature
        self.band_vars.clear()
        for child in self.eq_bands.winfo_children():
            child.destroy()
        if not eq:
            self.eq_description.configure(text='尚未读取到可编辑的 EQ 频段。若当前固件格式未适配，可导出诊断用于后续核对。')
            return
        self.eq_description.configure(text=f'共 {len(eq["bands"])} 个频段 · 拖动后点击对应频段的“应用”')
        for band in eq['bands']:
            row = ttk.Frame(self.eq_bands)
            row.pack(fill='x', pady=3)
            ttk.Label(row, text=f'{band["frequency"]} Hz', width=10).pack(side='left')
            value = tk.DoubleVar(value=band['gain'])
            slider = ttk.Scale(row, from_=eq['layout']['gain_min'], to=eq['layout']['gain_max'], variable=value)
            slider.pack(side='left', expand=True, fill='x', padx=8)
            label = ttk.Label(row, text=f'{band["gain"]:+g} dB', width=9)
            label.pack(side='left', padx=8)
            scale = eq['layout']['gain_scale']
            slider.configure(command=lambda raw, label=label, scale=scale: label.configure(text=f'{round(float(raw) * scale) / scale:+g} dB'))
            button = ttk.Button(row, text='应用', command=lambda i=band['index'], var=value, scale=scale: self.apply_band(i, round(var.get() * scale) / scale))
            button.pack(side='left')
            self.band_vars.append((value, slider, button))

    def apply_band(self, index, gain):
        if self.demo:
            self.state['custom_eq']['bands'][index]['gain'] = gain
            self.update_state(self.state)
            self.status.set('离线预览 · 已改变示例 EQ，未向音响发送命令')
        else:
            self.run('set_custom_gain', index, gain)

    def export_diagnostics(self):
        path = filedialog.asksaveasfilename(parent=self.root, defaultextension='.json', initialfile='n300-diagnostics.json', filetypes=[('JSON', '*.json')])
        if path:
            Path(path).write_text(json.dumps({'application': 'N300 Desk 0.1', 'demo': self.demo, 'state': self.state}, ensure_ascii=False, indent=2), encoding='utf-8')
            self.status.set('诊断文件已保存')

    def poll(self):
        try:
            while True:
                kind, data = self.events.get_nowait()
                if kind == 'state': self.update_state(data)
                elif kind == 'status': self.status.set(data)
                elif kind == 'busy':
                    self.busy = data
                    self.update_enabled()
                elif kind == 'devices':
                    self.devices = data
                    self.device_choice.configure(values=[f'{d["name"]}  ·  {d["address"]}' for d in data])
                    if data: self.device_choice.current(0)
                    else: self.device_choice.set('未发现 N300')
                    self.update_enabled()
                elif kind == 'error':
                    self.status.set(data)
                    messagebox.showerror('操作未完成', data, parent=self.root)
        except queue.Empty:
            pass
        self.root.after(80, self.poll)

    def demo_state(self):
        inputs = next((int(key) for key, value in self.settings['inputs'].items() if any(v['label'] == 'AUX' for v in value) and len(value) == 3), 0)
        presets = 19
        layout = self.settings['custom_eq'].get('1')
        return {'connected': True, 'verified': True, 'name': 'N300（示例）', 'firmware': '示例', 'address': '未连接真实设备',
                'capabilities': {'input': True, 'volume': True, 'eq_index': presets, 'timer': True, 'idle_shutdown': True, 'rename_bytes': 24, 'power_off': True},
                'volume': 8, 'volume_max': 16, 'input_group': inputs, 'input_value': 2,
                'eq_value': self.settings['eq_presets'].get(str(presets), [{'value': 0}])[0]['value'], 'eq_calibration': [], 'led': True, 'idle_shutdown': False, 'timer_minutes': 0,
                'custom_eq': {'kind': 1, 'layout': layout, 'bands': [{'index': i, 'frequency': f, 'gain': g, 'raw_gain': g + layout['gain_offset_value'], 'q': 7} for i, (f, g) in enumerate(zip((100, 500, 2000, 8000), (0, 2, -1, 0)))]} if layout else None}

    def close(self):
        self.worker.close()
        self.root.destroy()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--demo', action='store_true', help='Offline preview, no Bluetooth operations')
    parser.add_argument('--smoke-test', type=Path, help='Construct GUI offline, write result and exit')
    parser.add_argument('--capture', type=Path, help='Capture this application window and exit (offline demo only)')
    args = parser.parse_args()
    logs = application_dir() / 'logs'
    logs.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, handlers=[RotatingFileHandler(logs / 'n300.log', maxBytes=1_000_000, backupCount=2, encoding='utf-8')], format='%(asctime)s %(levelname)s %(message)s')
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    if args.smoke_test: root.withdraw()
    app = App(root, demo=args.demo or bool(args.capture))
    if args.smoke_test:
        from bleak.backends.winrt.client import BleakClientWinRT
        from bleak.backends.winrt.scanner import BleakScannerWinRT
        root.update_idletasks()
        result = {'gui_created': True, 'windows_bluetooth_backend_loaded': bool(BleakClientWinRT and BleakScannerWinRT), 'bluetooth_used': False, 'demo': app.demo, 'settings_groups': {key: len(value) for key, value in app.settings.items() if isinstance(value, dict)}, 'controls': len(app.actions), 'controller_connected': app.worker.controller.client is not None}
        args.smoke_test.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        app.close()
        app.worker.thread.join(5)
        return
    if args.capture:
        def capture():
            from PIL import ImageGrab
            try:
                root.update_idletasks()
                ImageGrab.grab(window=root.winfo_id()).save(args.capture)
            finally:
                app.close()
        root.after(1000, capture)
    root.mainloop()
    app.worker.thread.join(5)


if __name__ == '__main__':
    main()
