import { useTranslation } from "react-i18next";

import { CAT_COLOR, type CatalogLayer } from "../lib/catalog";
import { fmt } from "../lib/format";

/** "Alandaki cisimler": the catalogue sources on the image, brightest first; hovering a row highlights the
 *  marker, hovering a marker highlights the row. */
export default function FieldObjects({
  layer,
  highlight,
  setHighlight,
}: {
  layer: CatalogLayer;
  highlight: string | null;
  setHighlight: (k: string | null) => void;
}) {
  const { t } = useTranslation();
  if (!layer.items.length) return <p className="text-sm text-ink-300">{t("catalog.empty")}</p>;
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-xs text-ink-300">
        <caption className="sr-only">{t("catalog.tableTitle")}</caption>
        <thead className="sticky top-0 bg-space-950/95 text-ink-400">
          <tr>
            <th className="px-2 py-1 font-medium">{t("catalog.colName")}</th>
            <th className="px-2 py-1 font-medium">{t("catalog.colCatalog")}</th>
            <th className="px-2 py-1 font-medium">{t("catalog.colType")}</th>
            <th className="px-2 py-1 font-medium">{t("catalog.colMag")}</th>
            <th className="px-2 py-1 font-medium">{t("catalog.colSep")}</th>
            <th className="px-2 py-1 font-medium">{t("catalog.colEpoch")}</th>
          </tr>
        </thead>
        <tbody>
          {layer.items.map((i) => (
            <tr
              key={i.key}
              onMouseEnter={() => setHighlight(i.key)}
              onMouseLeave={() => setHighlight(null)}
              className={i.key === highlight ? "bg-white/10 text-ink-100" : "border-t border-white/5"}
            >
              <td className="px-2 py-1" title={i.full_name}>
                <span
                  className="mr-1.5 inline-block size-2 rounded-sm"
                  style={{ backgroundColor: CAT_COLOR[i.cat] }}
                  aria-hidden="true"
                />
                {i.label}
                {i.label !== i.id && <span className="block text-[11px] text-ink-400">{i.full_name}</span>}
              </td>
              <td className="px-2 py-1">{i.cat}</td>
              <td className="px-2 py-1">{i.otype ?? "—"}</td>
              <td className="px-2 py-1 font-mono">
                {i.mag === null ? t("catalog.noData") : `${fmt(i.mag, 2)} (${i.band ?? "?"})`}
              </td>
              <td className="px-2 py-1 font-mono">{fmt(i.sep_arcsec, 1)}″</td>
              <td className="px-2 py-1">{t(i.epoch === "moved" ? "catalog.moved" : "catalog.notMoved")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
