import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useDevice } from "../device/DeviceContext";
import { KeyboardConsole } from "../pages/KeyboardConsole";
import { SpeakerConsole } from "../pages/SpeakerConsole";
import { SystemConsole } from "../pages/SystemConsole";
import { DeskScene25D } from "./DeskScene25D";
import "./DeskStage.css";

export type ModalKind = "speaker" | "keyboard" | "system" | null;

function ConsoleDialog({ kind, onClose, children, returnFocus }: { kind: Exclude<ModalKind, null>; onClose(): void; children: ReactNode; returnFocus: HTMLElement | SVGElement | null }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const backdropPress = useRef(false);
  close.current = onClose;
  useEffect(() => {
    const trigger = returnFocus;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']"))
        .filter(el => el.getClientRects().length && !el.closest("[inert]"));
      const first = items[0], last = items.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); panel.current.focus(); }
      else if (!panel.current.contains(active) || active === panel.current || (event.shiftKey && active === first)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore after React has removed inert from the scene, including Strict Mode remounts.
      queueMicrotask(() => { if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus(); });
    };
  }, []);
  useEffect(() => { panel.current?.focus(); panel.current?.scrollTo(0, 0); }, [kind]);
  return <div className="desk-modal-backdrop"
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
    onPointerUp={event => { if (backdropPress.current && event.target === event.currentTarget) onClose(); backdropPress.current = false; }}>
    <div ref={panel} className={`desk-modal desk-modal--${kind}`} role="dialog" aria-modal="true" aria-labelledby="console-title" tabIndex={-1}>
      {children}
    </div>
  </div>;
}

export function DeskStage({
  activeModal,
  onOpenModal,
}: {
  activeModal: ModalKind;
  onOpenModal(modal: ModalKind): void;
}) {
  const { phase, values, keyboard } = useDevice();
  const returnFocus = useRef<HTMLElement | SVGElement | null>(null);

  const spkConnected = phase === "connected";
  const volume = values.volume?.value ?? 8;
  const volMax = values.volume?.max ?? 16;
  const volMin = values.volume?.min ?? 0;
  const led = values.led?.value ?? true;

  const kbConnected = keyboard.connected;
  const kbLevel = keyboard.brightness?.value ?? keyboard.lighting?.brightness ?? 0;
  const kbRgb: [number, number, number] = keyboard.lighting?.rgbRaw ?? [92, 225, 230];

  const spkRatio = spkConnected ? (volume - volMin) / (volMax - volMin || 1) : 0;
  const kbRatio = kbConnected ? kbLevel / 4 : 0;

  return (
    <div
      className="desk-hub"
      style={
        {
          "--spk-ratio": spkRatio,
          "--kb-ratio": kbRatio,
          "--kb-r": kbRgb[0],
          "--kb-g": kbRgb[1],
          "--kb-b": kbRgb[2],
        } as CSSProperties
      }
    >
      <div className={`desk-canvas${activeModal ? " is-receded" : ""}`} inert={activeModal !== null}>
        <DeskScene25D
          spkConnected={spkConnected}
          spkLed={spkConnected && !!led}
          spkVolumeRatio={spkRatio}
          kbConnected={kbConnected}
          kbBrightnessRatio={kbRatio}
          kbRgb={kbRgb}
          onSelectDevice={(modal) => {
            returnFocus.current = document.activeElement as HTMLElement | SVGElement | null;
            onOpenModal(modal);
          }}
        />
      </div>

      {activeModal !== null && (
        <ConsoleDialog kind={activeModal} returnFocus={returnFocus.current} onClose={() => onOpenModal(null)}>
            {activeModal === "speaker" && (
              <SpeakerConsole onClose={() => onOpenModal(null)} />
            )}
            {activeModal === "keyboard" && (
              <KeyboardConsole onClose={() => onOpenModal(null)} />
            )}
            {activeModal === "system" && (
              <SystemConsole
                onClose={() => onOpenModal(null)}
                onSelectDevice={(m) => onOpenModal(m)}
              />
            )}
        </ConsoleDialog>
      )}
    </div>
  );
}
