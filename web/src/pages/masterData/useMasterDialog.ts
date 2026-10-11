import { useEffect, useRef, useState, type MouseEvent } from "react";

export type Banner = { id: number; message: string };

export function useMasterDialog(open: boolean) {
  const pageRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const bannerSeq = useRef(0);
  const [notice, setNotice] = useState<Banner | null>(null);

  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    if (open) {
      node.setAttribute("inert", "");
      return () => node.removeAttribute("inert");
    }
    node.removeAttribute("inert");
    if (restoreFocus.current) {
      const target = restoreFocus.current;
      restoreFocus.current = null;
      target.focus();
      return;
    }
    if (notice) noticeRef.current?.focus();
  }, [open, notice]);

  function rememberOpener(event: MouseEvent<HTMLButtonElement>) {
    openerRef.current = event.currentTarget;
    restoreFocus.current = null;
    setNotice(null);
  }

  function closeDialog() {
    restoreFocus.current = openerRef.current;
  }

  function showNotice(message: string) {
    restoreFocus.current = null;
    setNotice({ id: bannerSeq.current + 1, message });
    bannerSeq.current += 1;
  }

  return { pageRef, noticeRef, notice, setNotice, rememberOpener, closeDialog, showNotice };
}
