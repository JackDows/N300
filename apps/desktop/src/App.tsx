import { useState } from "react";
import { DeskStage, type ModalKind } from "./components/DeskStage";
import { ToastPill } from "./components/Toast";
import { TitleBar } from "./components/TitleBar";
import { useDevice } from "./device/DeviceContext";
import { UpdateNotice } from "./updates/UpdatePanel";

const initialModal = (): ModalKind => {
  const params = new URLSearchParams(location.search);
  const m = params.get("modal");
  if (m === "speaker" || m === "keyboard" || m === "system") return m;
  return null;
};

export default function App() {
  const { toast } = useDevice();
  const [modal, setModal] = useState<ModalKind>(initialModal);

  return (
    <div className="app">
      <TitleBar />
      <UpdateNotice onOpen={() => setModal("system")} />
      <main className="stage">
        <DeskStage activeModal={modal} onOpenModal={setModal} />
      </main>
      <ToastPill toast={toast} />
    </div>
  );
}
