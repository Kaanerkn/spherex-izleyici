import { useTranslation } from "react-i18next";

import { track } from "../lib/events";
import { QUICK_TARGETS } from "../lib/quickTargets";

/** "Hızlı hedefler": one row under the search bar; wraps on narrow screens instead of overflowing. */
export default function QuickTargets({ onSearch }: { onSearch: (q: string) => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("quick.title")} className="px-3 pt-2 sm:px-4 lg:px-6">
      <ul className="flex flex-wrap items-center gap-1.5 text-xs">
        <li className="mr-1 font-medium text-ink-300">{t("quick.title")}:</li>
        {QUICK_TARGETS.map((x) => (
          <li key={x.key}>
            <button
              type="button"
              onClick={() => {
                track("ui_action", { payload: { button: "quick_target", target: x.key } });
                onSearch(x.q);
              }}
              title={t(`quick.items.${x.key}.note`)}
              className="flex min-h-8 cursor-pointer items-baseline gap-1 rounded-full border border-white/10 bg-space-950/50 px-2.5 py-1 text-ink-100 transition-colors duration-200 hover:border-white/30"
            >
              <span>{t(`quick.items.${x.key}.label`)}</span>
              <span className="text-[11px] text-ink-400">{t(`quick.items.${x.key}.note`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
