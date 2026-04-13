"use client";

import { useRouter } from "next/navigation";
import {
  Heading,
  Button,
  Modal,
} from "@wix/design-system";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (companyId: string) => void;
}

export function CreateCompanyWizard({ open, onClose }: Props) {
  const router = useRouter();

  if (!open) return null;

  return (
    <Modal isOpen={open} onRequestClose={onClose} shouldCloseOnOverlayClick>
      <div style={{ padding: "44px 36px 36px", textAlign: "center", maxWidth: 420, background: "white", borderRadius: 12 }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
          margin: "0 auto 20px",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ color: "white", fontSize: 28, fontWeight: 700 }}>C</span>
        </div>
        <Heading size="medium">Start a new AI Team</Heading>
        <div style={{ margin: "12px 0 32px", color: "#666", fontSize: 14, lineHeight: 1.6 }}>
          Your AI Team Lead will review your business, suggest the right specialists, and get your AI Team working inside Wix.
        </div>
        <Button
          onClick={() => { onClose(); router.push("/new"); }}
          size="large"
          style={{ width: "100%" }}
        >
          Start AI Team setup
        </Button>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 13, padding: "12px 0 0", display: "block", margin: "0 auto" }}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
