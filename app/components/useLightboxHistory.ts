import { useCallback, useEffect, useId, useRef, useState } from "react";

const historyKey = "photeryLightbox";

function getHistoryState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state !== null && typeof state === "object"
    ? (state as Record<string, unknown>)
    : {};
}

export function useLightboxHistory(onClose: () => void) {
  const owner = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const open = useRef(false);
  const closing = useRef(false);
  const queuedIndex = useRef<number | null>(null);

  // 写真を開く操作につき、同じURLの履歴を一件だけ追加する。
  const openImage = useCallback(
    (index: number) => {
      if (closing.current) {
        queuedIndex.current = index;
        return;
      }
      if (!open.current) {
        const state = { ...getHistoryState(), [historyKey]: owner };
        window.history.pushState(state, "", window.location.href);
        open.current = true;
      }
      setActiveIndex(index);
    },
    [owner],
  );

  // 閉じるボタンと戻る操作で、同じ表示状態の後始末を行う。
  const clearImage = useCallback(() => {
    open.current = false;
    setActiveIndex(null);
    onClose();
  }, [onClose]);

  const closeImage = useCallback(() => {
    if (!open.current || closing.current) return;
    clearImage();
    if (getHistoryState()[historyKey] === owner) {
      closing.current = true;
      window.history.back();
    }
  }, [clearImage, owner]);

  useEffect(() => {
    // 進む操作や再読み込みでは、写真を再表示せず専用の印を外す。
    const normalizeHistory = () => {
      const state = getHistoryState();
      if (!(historyKey in state)) return;
      const next = { ...state };
      delete next[historyKey];
      window.history.replaceState(next, "", window.location.href);
    };

    const handlePopState = () => {
      if (open.current) clearImage();
      closing.current = false;
      normalizeHistory();
      const index = queuedIndex.current;
      queuedIndex.current = null;
      if (index !== null) openImage(index);
    };

    normalizeHistory();
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      // アンマウント時は、別ページへの履歴移動を発生させない。
      if (getHistoryState()[historyKey] === owner) normalizeHistory();
    };
  }, [clearImage, openImage, owner]);

  return { activeIndex, setActiveIndex, openImage, closeImage };
}
