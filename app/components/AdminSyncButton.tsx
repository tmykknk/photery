"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncStatus = "idle" | "syncing" | "success" | "error";

interface SyncResult {
  success?: boolean;
  count?: number;
  deletedCount?: number;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSyncResult(value: unknown): SyncResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    success: typeof value.success === "boolean" ? value.success : undefined,
    count: typeof value.count === "number" ? value.count : undefined,
    deletedCount:
      typeof value.deletedCount === "number" ? value.deletedCount : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M20 7v5h-5M4 17v-5h5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M18.1 11A6.5 6.5 0 0 0 6.7 7.4L4 10M5.9 13a6.5 6.5 0 0 0 11.4 3.6L20 14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export default function AdminSyncButton() {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [message, setMessage] = useState("");

  const handleSync = async () => {
    setStatus("syncing");
    setMessage("Syncing with Google Drive...");

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = parseSyncResult(await response.json().catch(() => null));

      if (!response.ok || result.success === false) {
        throw new Error(result.error ?? "Sync failed.");
      }

      setStatus("success");
      setMessage(`Sync completed
      - Added: ${result.count ?? 0}
      - Deleted: ${result.deletedCount ?? 0}`);
      router.refresh();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Sync failed.";

      setStatus("error");
      setMessage(errorMessage);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={handleSync}
        disabled={status === "syncing"}
        className="inline-flex items-center gap-2 rounded-none border
          border-[#cbd5d1] bg-white px-3 py-2 text-xs font-bold text-[#2f5d7c]
          shadow-[0_10px_24px_rgba(17,24,22,0.05)] transition
          hover:shadow-[0_14px_30px_rgba(17,24,22,0.095)]
          focus-visible:outline-2 focus-visible:outline-[#2f5d7c]/30
          disabled:cursor-wait disabled:text-[#68736f] disabled:opacity-70"
      >
        <SyncIcon />
        {status === "syncing" ? "Syncing" : "Sync"}
      </button>
      {message ? (
        <p
          role="status"
          className={
            status === "error"
              ? `max-w-64 text-left text-xs font-semibold whitespace-pre-line
                text-[#b24a3b]`
              : `max-w-64 text-left text-xs font-semibold whitespace-pre-line
                text-[#56707c]`
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
