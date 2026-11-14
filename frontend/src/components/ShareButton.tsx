import { Check, Link2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** "Bağlantıyı kopyala": copies the given URL; if the clipboard is blocked the link is shown to copy by hand. */
export default function ShareButton({ url }: { url: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("manual");
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void copy()}
        className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm text-ink-100 hover:border-white/30"
      >
        {state === "copied" ? (
          <Check className="size-4 text-ok-400" aria-hidden="true" />
        ) : (
          <Link2 className="size-4" aria-hidden="true" />
        )}
        {state === "copied" ? t("share.copied") : t("share.copy")}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? t("share.copied") : ""}
      </span>
      {state === "manual" && (
        <input
          readOnly
          value={url}
          aria-label={t("share.manual")}
          onFocus={(e) => e.currentTarget.select()}
          className="w-64 max-w-full rounded border border-white/15 bg-space-950/70 px-2 py-1 font-mono text-xs text-ink-100"
        />
      )}
    </span>
  );
}
